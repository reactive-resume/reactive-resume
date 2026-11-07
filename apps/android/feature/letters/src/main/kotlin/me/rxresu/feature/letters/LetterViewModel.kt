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
    val draft: DraftState<CoverLetter> = DraftState(null), val loading: Boolean = true, val failed: Boolean = false, val busy: Boolean = false,
    val page: ImageBitmap? = null, val pageFailed: Boolean = false, val pageCount: Int? = null,
    val resumes: List<ResumeSummary> = emptyList(), val applications: List<Application> = emptyList(), val versions: List<LetterVersionSummary> = emptyList(),
) { val letter get() = draft.document; val editable get() = letter != null && letter?.isLocked != true && !busy && !draft.locked }

internal class LetterViewModel(private val repositories: RrRepositories, private val id: String) : ViewModel() {
    private val mutable = MutableStateFlow(LetterState())
    val state = mutable.asStateFlow()
    private var draft: DocumentDraft<CoverLetter>? = null
    private val writes = Mutex()
    private val render = RenderDebouncer(viewModelScope)
    private var lastRevision: Long? = null
    init { viewModelScope.launch {
        try {
            val handle = repositories.letters.openDraft(id); draft = handle
            launch { handle.state.collect { value ->
                mutable.update { it.copy(draft = value, loading = false) }
                value.document?.let { letter -> if (value.status == SaveStatus.Saved && letter.revision != lastRevision) {
                    lastRevision = letter.revision
                    render.submit { page(letter) }
                } }
            } }
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
            if (lastRevision == letter.revision) mutable.update { it.copy(page = image, pageCount = document.pageCount, pageFailed = document.source.revision != source.revision) }
        } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(pageFailed = true) } }
    }
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
    fun pageFormat(format: CreateCoverLetterResponseStyleMetadataPageFormat) = edit(change = { before -> before.copy(style = before.style.copy(metadata = before.style.metadata.copy(page = before.style.metadata.page.copy(format = format)))) })
    fun locale(locale: String) = metadata({ PatchCoverLetterRequest(expectedRevision = it.revision, locale = locale) })
    fun template(template: CreateResumeRequestTemplate) = metadata({ PatchCoverLetterRequest(expectedRevision = it.revision, template = template) })
    fun font(size: Double) = edit(change = { before -> before.copy(style = before.style.copy(metadata = before.style.metadata.copy(typography = before.style.metadata.typography.copy(body = before.style.metadata.typography.body.copy(fontSize = size))))) })
    fun color(color: String) = edit(change = { before -> before.copy(style = before.style.copy(metadata = before.style.metadata.copy(design = before.style.metadata.design.copy(colors = before.style.metadata.design.colors.copy(primary = color))))) })
    fun linkResume(resumeId: String?, done: () -> Unit) = edit({ it.copy(sourceResumeId = resumeId) }, done)
    fun linkApplication(applicationId: String?, done: () -> Unit) = edit({ it.copy(sourceApplicationId = applicationId) }, done)
    fun lock(done: () -> Unit) = action {
        draft!!.writeMetadata { before -> repositories.documents.lockDocument(LockDocumentRequest(id, !before.isLocked, DocumentType.Letter)); repositories.letters.getCoverLetter(id) }; draft!!.refresh(); done()
    }
    fun createVersion(name: String, done: () -> Unit) = action { draft!!.flush(); check(draft!!.state.value.status == SaveStatus.Saved); repositories.letters.createCoverLetterVersion(id, PatchDocumentNameRequest(name)); loadLists(); done() }
    fun restore(version: String, done: () -> Unit) = action { draft!!.writeMetadata { repositories.letters.restoreCoverLetterVersion(id, version, RestoreResumeVersionRequest(PatchResumeRequestProposalSafety.V1)) }; draft!!.refresh(); loadLists(); done() }
    fun assistant(providerId: String?, done: (String) -> Unit) = action {
        val before = requireNotNull(state.value.letter); draft!!.flush()
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
        render.cancel()
        val handle = draft ?: return
        // Navigation normally closes explicitly; removal by account routing still releases this owned handle.
        CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate).launch {
            try { handle.close() } catch (_: Exception) { /* The draft owner retains unpersisted text when close refuses. */ } finally { coroutineContext.cancel() }
        }
    }
}
