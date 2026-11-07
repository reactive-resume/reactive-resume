package me.rxresu.feature.letters

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import me.rxresu.core.data.*
import me.rxresu.core.database.SaveStatus
import me.rxresu.core.network.generated.*
import me.rxresu.core.page.*

internal data class LetterState(
    val aiDraft: LetterAiDraft? = null, val draft: DraftState<CoverLetter> = DraftState(null), val loading: Boolean = true, val failed: Boolean = false, val busy: Boolean = false,
    val resumePage: ImageBitmap? = null, val resumePageFailed: Boolean = false, val blocks: List<LetterBlock> = emptyList(), val page: ImageBitmap? = null, val pageFailed: Boolean = false, val pageCount: Int? = null,
    val resumes: List<ResumeSummary> = emptyList(), val applications: List<Application> = emptyList(), val versions: List<LetterVersionSummary> = emptyList(),
) { val letter get() = draft.document; val editable get() = letter != null && letter?.isLocked != true && !busy && !draft.locked }

internal class LetterViewModel(private val repositories: RrRepositories, private val id: String, private val recovery: LetterDraftRecovery? = null, private val io: CoroutineDispatcher = Dispatchers.IO) : ViewModel() {
    private val mutable = MutableStateFlow(LetterState())
    val state = mutable.asStateFlow()
    private var draft: DocumentDraft<CoverLetter>? = null
    private val writes = Mutex()
    private var aiJob: Job? = null
    private val account = repositories.authSession.state.value
    private val origin = repositories.authSession.origin.value
    private fun sameAccount() = repositories.authSession.state.value == account && repositories.authSession.origin.value == origin
    private val render = RenderDebouncer(viewModelScope)
    private var lastRevision: Long? = null
    private var linkedResume: String? = null
    private var resumeRender: Job? = null
    init { viewModelScope.launch {
        try {
            val handle = repositories.letters.openDraft(id); draft = handle
            launch { handle.state.collect { value ->
                mutable.update { it.copy(draft = value, loading = false) }
                value.document?.let { letter -> if (value.status == SaveStatus.Saved && letter.revision != lastRevision) {
                    lastRevision = letter.revision
                    render.submit { page(letter) }
                    if (linkedResume != letter.sourceResumeId || letter.designLinked) {
                        linkedResume = letter.sourceResumeId
                        resumeRender?.cancel()
                        mutable.update { it.copy(resumePage = null, resumePageFailed = false) }
                        letter.sourceResumeId?.let { source -> resumeRender = viewModelScope.launch { attempt { resumePage(source) } } }
                    }
                } }
            } }
            val restored = if (recovery == null) null else withContext(io) { recovery.read() }; mutable.update { it.copy(aiDraft = restored) }
            loadLists()
        } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(loading = false, failed = true) } }
    } }
    private suspend fun loadLists() = supervisorScope {
        launch { attempt { val v = repositories.resumes.listResumes(); mutable.update { it.copy(resumes = v) } } }
        launch { attempt { val v = repositories.applications.listApplications(); mutable.update { it.copy(applications = v) } } }
        launch { attempt { val v = repositories.letters.listCoverLetterVersions(id); mutable.update { it.copy(versions = v) } } }
    }
    private suspend fun page(letter: CoverLetter) {
        val source = PageSource.Letter(id, letter.revision.toString())
        try {
            val document = try { repositories.pages.render(source) } catch (e: CancellationException) { throw e } catch (e: Exception) { repositories.pages.lastGood(source) ?: throw e }
            val image = repositories.pages.page(document, 0, 716).asImageBitmap()
            val blocks = withContext(io) { readLetterRuns(document.file)?.let { letterBlocks(letter, it) }.orEmpty() }
            if (lastRevision == letter.revision) mutable.update { it.copy(page = image, blocks = if (document.source.revision == source.revision) blocks else emptyList(), pageCount = document.pageCount, pageFailed = document.source.revision != source.revision) }
        } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(pageFailed = true) } }
    }
    private suspend fun resumePage(id: String) {
        try {
            val resume = repositories.resumes.getResume(id)
            val source = PageSource.Resume(id, resume.updatedAt)
            val document = repositories.pages.render(source)
            val image = repositories.pages.page(document, 0, 358).asImageBitmap()
            if (linkedResume == id) mutable.update { it.copy(resumePage = image, resumePageFailed = false) }
        } catch (e: CancellationException) { throw e } catch (_: Exception) { if (linkedResume == id) mutable.update { it.copy(resumePageFailed = true) } }
    }
    fun design(change: (CreateCoverLetterResponseStyleMetadata) -> CreateCoverLetterResponseStyleMetadata) = edit(change = { before ->
        check(!before.designLinked)
        before.copy(style = before.style.copy(metadata = change(before.style.metadata)))
    })
    fun retry() = viewModelScope.launch { attempt { draft?.flush(); draft?.refresh(); state.value.letter?.let { page(it) }; loadLists() } }
    fun edit(change: (CoverLetter) -> CoverLetter, done: () -> Unit = {}) = action {
        val handle = requireNotNull(draft); check(!handle.state.value.locked)
        handle.update(change(requireNotNull(handle.state.value.document))); done()
    }
    fun metadata(change: (CoverLetter) -> PatchCoverLetterRequest, done: () -> Unit = {}) = action {
        draft!!.writeMetadata { before -> repositories.letters.updateCoverLetter(id, change(before).copy(expectedRevision = before.revision)) }; done()
    }
    fun focus(editing: Boolean) = viewModelScope.launch { attempt { draft?.setEditing(editing) } }
    fun undo() = action { draft?.undo() }
    fun designLinked(linked: Boolean, done: () -> Unit) = metadata({ PatchCoverLetterRequest(expectedRevision = it.revision, designLinked = linked) }, done)
    fun pageFormat(format: CreateCoverLetterResponseStyleMetadataPageFormat) = design { it.copy(page = it.page.copy(format = format)) }
    fun locale(locale: String) = metadata({ PatchCoverLetterRequest(expectedRevision = it.revision, locale = locale) })
    fun template(template: CreateResumeRequestTemplate) = metadata({ PatchCoverLetterRequest(expectedRevision = it.revision, template = template) })
    fun font(size: Double) = design { metadata ->
        val ratio = metadata.typography.heading.fontSize / metadata.typography.body.fontSize.takeIf { it > 0.0 }.let { it ?: 1.0 }
        metadata.copy(typography = metadata.typography.copy(body = metadata.typography.body.copy(fontSize = size), heading = metadata.typography.heading.copy(fontSize = kotlin.math.round(size * ratio * 2) / 2)))
    }
    fun color(color: String) = design { it.copy(design = it.design.copy(colors = it.design.colors.copy(primary = color))) }
    fun linkResume(resumeId: String?, done: () -> Unit) = edit({ it.copy(sourceResumeId = resumeId) }, done)
    fun linkApplication(applicationId: String?, done: () -> Unit) = edit({ it.copy(sourceApplicationId = applicationId) }, done)
    fun lock(done: () -> Unit) = action {
        draft!!.writeMetadata { before -> repositories.documents.lockDocument(LockDocumentRequest(id, !before.isLocked, DocumentType.Letter)); repositories.letters.getCoverLetter(id) }; draft!!.refresh(); done()
    }
    fun createVersion(name: String, done: () -> Unit) = action { draft!!.flushSaved(); repositories.letters.createCoverLetterVersion(id, PatchDocumentNameRequest(name)); loadLists(); done() }
    fun restore(version: String, done: () -> Unit) = action { draft!!.writeMetadata { repositories.letters.restoreCoverLetterVersion(id, version, RestoreResumeVersionRequest(PatchResumeRequestProposalSafety.V1)) }; draft!!.refresh(); loadLists(); done() }
    private suspend fun keepAiState(value: LetterAiDraft?) {
        check(sameAccount())
        mutable.update { it.copy(aiDraft = value) }
        if (recovery != null) withContext(io) { recovery.write(value) }
    }
    fun retryDraft() = generate(state.value.aiDraft?.variant ?: CreateCoverLetterDraftRequestVariant.Draft)
    fun generate(variant: CreateCoverLetterDraftRequestVariant = CreateCoverLetterDraftRequestVariant.Draft) {
        if (aiJob?.isActive == true || !state.value.editable || state.value.aiDraft?.generating == true || !sameAccount()) return
        val old = state.value.aiDraft
        aiJob = viewModelScope.launch {
            try {
                val handle = requireNotNull(draft); handle.flushSaved()
                val current = requireNotNull(handle.state.value.document)
                val versions = (old?.versions.orEmpty() + listOfNotNull(old?.takeIf { it.text.isNotBlank() }?.let { LetterAiVersion(it.text, it.operationIds) })).takeLast(4)
                keepAiState(LetterAiDraft(operationIds = if (variant == CreateCoverLetterDraftRequestVariant.Draft) emptyList() else old?.operationIds.orEmpty(), revision = current.revision, baseContent = current.content, variant = variant, versions = versions, generating = true))
                repositories.letters.draftCoverLetter(id, DraftCoverLetterRequest(includeProvenance = true, previous = old?.text?.takeIf { variant != CreateCoverLetterDraftRequestVariant.Draft }, variant = variant)).collect { event ->
                    keepAiState(reduceLetterDraft(requireNotNull(state.value.aiDraft), event))
                }
                val ready = requireNotNull(state.value.aiDraft)
                check(ready.text.isNotBlank())
                keepAiState(ready.copy(generating = false))
            } catch (e: CancellationException) { throw e } catch (_: Exception) {
                if (sameAccount()) { val kept = state.value.aiDraft ?: old ?: LetterAiDraft(); mutable.update { it.copy(aiDraft = kept.copy(generating = false, failed = true), failed = true) } }
            }
        }
    }
    fun stopDraft() = viewModelScope.launch { aiJob?.cancelAndJoin(); state.value.aiDraft?.let { keepAiState(it.copy(generating = false)) } }
    fun discardDraft() = viewModelScope.launch { aiJob?.cancelAndJoin(); attempt { keepAiState(null) } }
    fun previousDraft(index: Int) = viewModelScope.launch { attempt {
        val current = requireNotNull(state.value.aiDraft); check(!current.generating)
        val version = current.versions[index]
        keepAiState(current.copy(text = version.text, operationIds = version.operationIds, failed = false))
    } }
    fun keepDraft() = action {
        val ai = requireNotNull(state.value.aiDraft); val handle = requireNotNull(draft)
        check(!ai.generating && ai.text.isNotBlank() && sameAccount())
        val current = requireNotNull(handle.state.value.document)
        check(current.revision == ai.revision && current.content == ai.baseContent && !current.isLocked)
        handle.update(current.copy(content = letterDraftHtml(ai.text), aiOperationIds = (current.aiOperationIds.orEmpty() + ai.operationIds).distinct()))
        keepAiState(null)
    }
    fun draftCopy(done: (String) -> Unit) = action {
        val ai = requireNotNull(state.value.aiDraft); check(!ai.generating && ai.text.isNotBlank() && sameAccount())
        val copy = ai.copyId ?: repositories.documents.duplicate(DocumentType.Letter, id).also { keepAiState(ai.copy(copyId = it)) }
        val handle = repositories.letters.openDraft(copy)
        val before = requireNotNull(handle.state.value.document)
        handle.update(before.copy(content = letterDraftHtml(ai.text), aiOperationIds = (before.aiOperationIds.orEmpty() + ai.operationIds).distinct()))
        handle.flushSaved(); handle.close()
        keepAiState(null); done(copy)
    }
    fun assistant(providerId: String?, done: (String) -> Unit) = action {
        val before = requireNotNull(state.value.letter); draft!!.flushSaved()
        val thread = repositories.assistant.startAgentThread(StartAgentThreadRequest(aiProviderId = providerId, applicationId = before.sourceApplicationId, coverLetterId = id, scope = StartAgentThreadRequestScope.Document)); done(thread.id)
    }
    fun leave(done: () -> Unit) = action { draft?.close(); draft = null; done() }
    private suspend fun attempt(block: suspend () -> Unit) {
        try { block() } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } }
    }
    private fun action(block: suspend () -> Unit) = viewModelScope.launch { writes.withLock {
        mutable.update { it.copy(busy = true, failed = false) }; try { attempt(block) } finally { mutable.update { it.copy(busy = false) } }
    } }
    override fun onCleared() {
        render.cancel(); aiJob?.cancel(); resumeRender?.cancel()
        val handle = draft ?: return
        // Navigation normally closes explicitly; removal by account routing still releases this owned handle.
        CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate).launch {
            try { handle.close() } catch (_: Exception) { /* The draft owner retains unpersisted text when close refuses. */ } finally { coroutineContext.cancel() }
        }
    }
}

// TODO(lead): move terminal-status wait into DocumentDraft.flush.
private suspend fun <T> DocumentDraft<T>.flushSaved() {
    flush()
    check(state.first { it.status != SaveStatus.Saving }.status == SaveStatus.Saved)
}
