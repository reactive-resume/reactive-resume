package me.rxresu.feature.builder

import androidx.annotation.StringRes
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import me.rxresu.core.data.DocumentDraft
import me.rxresu.core.data.OutsideChange
import me.rxresu.core.data.withWriteResult
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.database.SaveStatus
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.GetResumeChecksResponse
import me.rxresu.core.network.generated.Resume
import me.rxresu.core.page.PageSource
import me.rxresu.core.page.RenderDebouncer
import android.net.Uri
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import me.rxresu.core.network.UploadPart
import me.rxresu.core.network.generated.CreateImprovementRequestAction
import me.rxresu.core.network.generated.CreateResumeJobMatchRequest
import me.rxresu.core.network.generated.ImproveLineRequest
import me.rxresu.core.strings.R as S

/** A toast the shell shows; [undo] adds Undo, which undoes the last draft change. */
internal data class BuilderToast(@StringRes val text: Int, val args: List<Any> = emptyList(), val undo: Boolean = false, val danger: Boolean = false, val success: Boolean = false)

internal data class BuilderUiState(
    val resume: Resume? = null,
    val loadFailed: Boolean = false,
    val status: SaveStatus = SaveStatus.Saved,
    val locked: Boolean = false,
    val canUndo: Boolean = false,
    val canRedo: Boolean = false,
    val recoveredCopyName: String? = null,
    /** Rendered pages (white paper), newest good render; empty until the first render lands. */
    val pages: List<ImageBitmap> = emptyList(),
    val renderFailed: Boolean = false,
    /** Tap targets on the pages; null when this phone can't read PDF text (tap opens Outline instead). */
    val blocks: List<PageBlock>? = emptyList(),
    val highlight: BlockTarget? = null,
    /** The highlighted block sits above the entry sheet (B2) rather than on a bare page (Show on page). */
    val highlightAboveSheet: Boolean = false,
    val checks: GetResumeChecksResponse? = null,
    val application: Application? = null,
    val improve: ImproveState = ImproveState.Idle,
    val match: MatchState = MatchState.Idle,
    val photoUploading: Boolean = false,
    val aiProvider: AiProvider? = null,
    val fitting: Boolean = false,
    val pdfCheck: PdfCheckState = PdfCheckState.Idle,
    val writingNotes: List<WritingNote> = emptyList(),
    /** Bumps on every finished render, so Fit can wait for the page count after each step. */
    val renderCount: Int = 0,
    /** Someone else's change the draft just took (B1 strip with Undo); cleared by the next edit, Undo or Redo. */
    val outsideChange: OutsideChange? = null,
    /** Open applications for "Link an application…"; null until asked for. */
    val applications: List<Application>? = null,
    /** Linking, copying or saving a job is in flight. */
    val jobBusy: Boolean = false,
    /** A picked photo waiting in Crop photo (B5). */
    val crop: PhotoCrop? = null,
    /** A writing review is running. */
    val reviewing: Boolean = false,
) {
    val doc: ResumeDoc? = resume?.let { ResumeDoc(it.toJson()) }
    val issueCount get() = checks?.findings?.size ?: 0
}

/**
 * Owns the live draft for one resume while the builder is open: the pages, checks and every edit. Shared by the
 * builder screen and the screens pushed over it (entry sheet, rich text, basics) through the builder's back stack
 * entry. Closes the draft when the builder leaves the back stack.
 */
internal class BuilderViewModel(
    val resumeId: String,
    private val repositories: RrRepositories,
    private val pageWidthPx: Int = 1080,
    private val readText: (File) -> List<List<TextRun>>? = PdfTextReader::read,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    /** Reads a picked photo: bytes, file name and type, or null when unreadable. */
    private val readPhoto: (Uri) -> PickedPhoto? = { null },
) : ViewModel(), BuilderActions {
    private val mutable = MutableStateFlow(BuilderUiState())
    val state: StateFlow<BuilderUiState> = mutable.asStateFlow()
    private val toasts = Channel<BuilderToast>(Channel.BUFFERED)
    val toastEvents = toasts.receiveAsFlow()
    private val opened = Channel<String>(Channel.BUFFERED)
    /** Resume ids to open on Job match: a copy made for a job. */
    val openCopyEvents = opened.receiveAsFlow()
    /** The newest rendered page text, sent as the writing review's extracted text. */
    private var pageText: String = ""

    private var draft: DocumentDraft<Resume>? = null
    private val editLock = Mutex()
    private val debouncer = RenderDebouncer(viewModelScope)
    private var renderedRevision: String? = null

    init {
        viewModelScope.launch {
            val handle = try { repositories.resumes.openDraft(resumeId) } catch (e: CancellationException) { throw e } catch (_: Exception) {
                mutable.update { it.copy(loadFailed = true) }; return@launch
            }
            draft = handle
            launch { handle.outsideChanges.collect { change -> mutable.update { it.copy(outsideChange = change) } } }
            handle.state.collect { s ->
                val resume = s.document
                mutable.update {
                    it.copy(resume = resume ?: it.resume, status = s.status, locked = s.locked || resume?.isLocked == true, canUndo = s.canUndo, canRedo = s.canRedo, recoveredCopyName = s.recoveredCopyName)
                }
                if (resume == null) return@collect
                if (renderedRevision == null) { renderedRevision = resume.updatedAt; launch { render(resume.updatedAt) }; launch { refreshChecks() }; launch { loadApplication(resume.applicationId) }; launch { loadWritingNotes() } }
                else if (s.status == SaveStatus.Saved && resume.updatedAt != renderedRevision) {
                    renderedRevision = resume.updatedAt
                    debouncer.submit { render(resume.updatedAt); refreshChecks() }
                }
            }
        }
    }

    /** Re-renders in place: the last good pages stay until the new ones are ready (offline keeps them). */
    private suspend fun render(revision: String) {
        val source = PageSource.Resume(resumeId, revision)
        val pages = repositories.pages
        val document = try { pages.render(source) } catch (e: CancellationException) { throw e } catch (_: Exception) { pages.lastGood(source) }
        if (document == null) { mutable.update { it.copy(renderFailed = true) }; return }
        val bitmaps = (0 until document.pageCount).map { pages.page(document, it, pageWidthPx).asImageBitmap() }
        val runs = withContext(io) { readText(document.file) }
        pageText = runs?.joinToString("\n\n") { page -> page.joinToString(" ") { it.text } }.orEmpty()
        val doc = state.value.doc
        val blocks = if (runs == null || doc == null) null else PageBlocks.build(doc, runs, templateColumns(doc.template) == 2)
        mutable.update { it.copy(pages = bitmaps, blocks = blocks, renderFailed = false, renderCount = it.renderCount + 1) }
    }

    override fun retryRender() { state.value.resume?.let { r -> viewModelScope.launch { render(r.updatedAt) } } }

    private suspend fun refreshChecks() {
        val checks = try { repositories.checks.getResumeChecks(resumeId) } catch (e: CancellationException) { throw e } catch (_: Exception) { return }
        mutable.update { it.copy(checks = checks) }
    }

    private suspend fun loadApplication(id: String?) {
        if (id == null) return
        val app = try { repositories.applications.getApplication(id) } catch (e: CancellationException) { throw e } catch (_: Exception) { return }
        mutable.update { it.copy(application = app) }
    }

    // Edits ----------------------------------------------------------------------------------------------------------

    /**
     * Applies [change] to the newest document and autosaves. Each change is one undo step; consecutive changes passing
     * the same [undoStep] share one (a held stepper, Fit).
     */
    override fun edit(toast: BuilderToast?, undoStep: String?, change: (JsonObject) -> JsonObject) {
        viewModelScope.launch { if (editNow(undoStep, change) && toast != null) toasts.send(toast) }
    }

    suspend fun editNow(undoStep: String? = null, change: (JsonObject) -> JsonObject): Boolean = editLock.withLock {
        val handle = draft ?: return false
        val current = handle.state.value.document ?: return false
        if (state.value.locked) return false
        val next = try { change(current.toJson()).toResume() } catch (e: CancellationException) { throw e } catch (_: Exception) { return false }
        mutable.update { it.copy(outsideChange = null) }
        try { handle.update(next, undoStep = undoStep); true } catch (e: CancellationException) { throw e } catch (_: Exception) { false }
    }

    override fun set(path: Path, value: kotlinx.serialization.json.JsonElement) = edit { it.set(path, value) as JsonObject }

    override fun undo() { mutable.update { it.copy(outsideChange = null) }; viewModelScope.launch { runCatching { draft?.undo() } } }
    override fun redo() { mutable.update { it.copy(outsideChange = null) }; viewModelScope.launch { runCatching { draft?.redo() } } }
    override fun flush() { viewModelScope.launch { runCatching { draft?.flush() } } }
    override fun setEditing(editing: Boolean) { viewModelScope.launch { runCatching { draft?.setEditing(editing) } } }
    override fun highlight(target: BlockTarget?, aboveSheet: Boolean) = mutable.update { it.copy(highlight = target, highlightAboveSheet = target != null && aboveSheet) }
    fun toast(toast: BuilderToast) { viewModelScope.launch { toasts.send(toast) } }

    // Entries ---------------------------------------------------------------------------------------------------------

    override fun addItem(section: String, onCreated: (String) -> Unit) {
        val doc = state.value.doc ?: return
        val ref = doc.section(section) ?: return
        val id = newId()
        viewModelScope.launch {
            if (editNow { json -> json.update(ref.path + "items") { JsonArray(it.arr() + ref.kind.newItem(id)) } as JsonObject }) onCreated(id)
        }
    }

    override fun setItemHidden(section: String, itemId: String, hidden: Boolean) = editItem(section, itemId) { it.set(listOf("hidden"), JsonPrimitive(hidden)) as JsonObject }

    override fun duplicateItem(section: String, itemId: String) {
        val doc = state.value.doc ?: return
        val ref = doc.section(section) ?: return
        val index = doc.itemIndex(ref, itemId).takeIf { it >= 0 } ?: return
        edit { json ->
            json.update(ref.path + "items") { items ->
                val list = items.arr().toMutableList()
                list.add(index + 1, JsonObject(list[index].obj() + ("id" to JsonPrimitive(newId()))))
                JsonArray(list)
            } as JsonObject
        }
    }

    override fun deleteItem(section: String, itemId: String) {
        val doc = state.value.doc ?: return
        val ref = doc.section(section) ?: return
        edit(BuilderToast(S.string.entry_deleted, undo = true)) { json ->
            json.update(ref.path + "items") { items -> JsonArray(items.arr().filter { it.obj()["id"].str() != itemId }) } as JsonObject
        }
    }

    /** Moves an entry to another section of the same type (the web's Move to…). */
    override fun moveItem(section: String, itemId: String, target: String) {
        val doc = state.value.doc ?: return
        val from = doc.section(section) ?: return
        val to = doc.section(target) ?: return
        val item = doc.items(from).firstOrNull { it["id"].str() == itemId } ?: return
        edit { json ->
            val removed = json.update(from.path + "items") { items -> JsonArray(items.arr().filter { it.obj()["id"].str() != itemId }) }
            removed.update(to.path + "items") { JsonArray(it.arr() + item) } as JsonObject
        }
    }

    override fun reorderItem(section: String, itemId: String, delta: Int) {
        val doc = state.value.doc ?: return
        val ref = doc.section(section) ?: return
        val index = doc.itemIndex(ref, itemId).takeIf { it >= 0 } ?: return
        edit { json ->
            json.update(ref.path + "items") { items ->
                val list = items.arr().toMutableList()
                val target = (index + delta).coerceIn(0, list.lastIndex)
                list.add(target, list.removeAt(index)); JsonArray(list)
            } as JsonObject
        }
    }

    override fun editItem(section: String, itemId: String, change: (JsonObject) -> JsonObject) {
        val doc = state.value.doc ?: return
        val ref = doc.section(section) ?: return
        edit { json ->
            val path = ResumeDoc(json).itemPath(ref, itemId) ?: return@edit json
            if (ref.kind == SectionKind.Summary) json.update(path) { change(it.obj()) } as JsonObject
            else json.update(path) { change(it.obj()) } as JsonObject
        }
    }

    // Sections and layout ----------------------------------------------------------------------------------------------

    override fun setSectionHidden(key: String, hidden: Boolean) {
        val ref = state.value.doc?.section(key) ?: return
        edit { it.set(ref.path + "hidden", JsonPrimitive(hidden)) as JsonObject }
    }

    override fun setLayout(change: (List<PageLayout>) -> List<PageLayout>) = edit { json -> json.withPages(change(ResumeDoc(json).pages)) }

    /** Adds a built-in section that's missing from every page to the end of page 1's main column. */
    override fun addSection(kind: SectionKind) {
        val doc = state.value.doc ?: return
        edit { json ->
            var next = json
            if (doc.pageOf(kind.key) == null) next = next.withPages(placeOnFirstPage(ResumeDoc(next).pages, kind.key))
            next = next.set(listOf("data", "sections", kind.key, "hidden"), JsonPrimitive(false)) as JsonObject
            next
        }
    }

    /** A custom section of [kind] titled [title], placed at the end of page 1. */
    override fun addCustomSection(kind: SectionKind, title: String) {
        val id = newId()
        edit { json ->
            val section = JsonObject(mapOf(
                "id" to JsonPrimitive(id), "type" to JsonPrimitive(kind.key), "title" to JsonPrimitive(title), "icon" to JsonPrimitive(""),
                "columns" to JsonPrimitive(1), "hidden" to JsonPrimitive(false), "keepTogether" to JsonPrimitive(false), "startOnNewPage" to JsonPrimitive(false),
                "items" to JsonArray(emptyList()),
            ))
            val withSection = json.update(listOf("data", "customSections")) { JsonArray(it.arr() + section) } as JsonObject
            withSection.withPages(placeOnFirstPage(ResumeDoc(withSection).pages, id))
        }
    }

    // Check -------------------------------------------------------------------------------------------------------------

    override fun ignoreIssue(key: String) = edit(BuilderToast(S.string.issue_ignored, undo = true)) { json ->
        json.update(listOf("data", "metadata", "check")) { check ->
            val c = check.obj()
            JsonObject(mapOf("ignored" to JsonArray(c["ignored"].arr() + JsonPrimitive(key)), "hiddenTerms" to JsonArray(c["hiddenTerms"].arr())))
        } as JsonObject
    }

    override fun showIgnored() = edit(BuilderToast(S.string.ignored_issues_are_back, undo = true)) { json ->
        json.update(listOf("data", "metadata", "check")) { check -> JsonObject(mapOf("ignored" to JsonArray(emptyList()), "hiddenTerms" to JsonArray(check.obj()["hiddenTerms"].arr()))) } as JsonObject
    }

    override fun applyFix(fix: CheckFix) = edit(BuilderToast(R.string.builder_check_fixed, listOf(fix.done), undo = true)) { fix.apply(it) }

    /** "Add to Skills" writes a skill named as the posting spells it; the term moves to the covered chips at once. */
    override fun addSkill(label: String) {
        moveTerm(label, covered = true)
        addSkillItem(label)
    }

    private fun moveTerm(label: String, covered: Boolean) = mutable.update { s ->
        val m = s.match as? MatchState.Ready ?: return@update s
        val term = m.missing.firstOrNull { it.label == label } ?: return@update s
        s.copy(match = m.copy(missing = m.missing - term, found = if (covered) m.found + term else m.found))
    }

    private fun addSkillItem(label: String) = edit(BuilderToast(S.string.message_0_added_to_skills, listOf(label), undo = true)) { json ->
        json.update(listOf("data", "sections", "skills", "items")) { JsonArray(it.arr() + SectionKind.Skills.newItem().let { item -> JsonObject(item + ("name" to JsonPrimitive(label))) }) } as JsonObject
    }

    override fun hideTerm(term: String, label: String) {
        moveTerm(label, covered = false)
        hideTermItem(term, label)
    }

    private fun hideTermItem(term: String, label: String) = edit(BuilderToast(S.string.message_0_hidden, listOf(label), undo = true)) { json ->
        json.update(listOf("data", "metadata", "check")) { check ->
            val c = check.obj()
            JsonObject(mapOf("ignored" to JsonArray(c["ignored"].arr()), "hiddenTerms" to JsonArray(c["hiddenTerms"].arr() + JsonPrimitive(term))))
        } as JsonObject
    }

    // Layout ------------------------------------------------------------------------------------------------------------

    override fun moveSection(key: String, delta: Int) = setLayout { pages ->
        pages.map { p ->
            fun List<String>.shift(): List<String> { val i = indexOf(key); return if (i < 0) this else moved(i, (i + delta).coerceIn(0, lastIndex)) }
            p.copy(main = p.main.shift(), sidebar = p.sidebar.shift())
        }
    }

    /** Moves a section to page [page] (a new page when it's past the last), main or sidebar, and shows it. */
    override fun placeSection(key: String, page: Int, sidebar: Boolean) {
        val ref = state.value.doc?.section(key) ?: return
        edit { json ->
            val pages = ResumeDoc(json).pages.map { p -> p.copy(main = p.main - key, sidebar = p.sidebar - key) }.toMutableList()
            if (page >= pages.size) pages += PageLayout(emptyList(), emptyList(), fullWidth = false)
            pages[page] = pages[page].let { if (sidebar) it.copy(sidebar = it.sidebar + key) else it.copy(main = it.main + key) }
            json.withPages(pages).set(ref.path + "hidden", JsonPrimitive(false)) as JsonObject
        }
    }

    /** Custom sections are deleted ("{title} deleted"); built-in ones are cleared ("{title} cleared"). */
    override fun clearSection(key: String, title: String) {
        val ref = state.value.doc?.section(key) ?: return
        if (ref.custom) edit(BuilderToast(S.string.title_deleted, listOf(title), undo = true)) { json ->
            val removed = json.update(listOf("data", "customSections")) { list -> JsonArray(list.arr().filter { it.obj()["id"].str() != key }) } as JsonObject
            removed.withPages(ResumeDoc(removed).pages.map { it.copy(main = it.main - key, sidebar = it.sidebar - key) })
        } else edit(BuilderToast(S.string.title_cleared, listOf(title), undo = true)) { it.set(ref.path + "items", JsonArray(emptyList())) as JsonObject }
    }

    /**
     * The web's Fit (design/fit.ts): tighten density, then margins, then text size by 0.5 pt down to 9, re-rendering
     * after each step (8 s each) until the resume fits on one page.
     */
    override fun fitToOnePage() {
        if (state.value.fitting) return
        viewModelScope.launch {
            mutable.update { it.copy(fitting = true) }
            // The whole run is one undo step (web fit.ts coalesceKey + sameStep).
            val key = "design.fit:${System.nanoTime()}"
            var fitted: Resume? = null // the document after Fit's last step; another edit since means no revert
            try {
                repeat(16) {
                    if (state.value.pages.size <= 1) {
                        if (fitted != null) toasts.send(BuilderToast(R.string.builder_fit_done, undo = true, success = true))
                        return@launch
                    }
                    val step = state.value.doc?.let { FitSteps.next(it.json) }
                    if (step == null) {
                        // Nothing gained: put the design back, unless something else was edited meanwhile.
                        if (fitted != null && draft?.state?.value?.document?.data == fitted.data) draft?.undo()
                        toasts.send(BuilderToast(R.string.builder_fit_failed, danger = true)); return@launch
                    }
                    val before = state.value.renderCount
                    if (!editNow(key, step)) return@launch
                    fitted = draft?.state?.value?.document
                    withTimeoutOrNull(8_000) { state.first { it.renderCount > before } }
                        ?: run { toasts.send(BuilderToast(R.string.builder_fit_timeout, undo = true)); return@launch }
                }
            } finally { mutable.update { it.copy(fitting = false) } }
        }
    }

    // Job match ---------------------------------------------------------------------------------------------------------

    /** Matches the linked application's posting, or [pasted] for this visit only. */
    override fun matchPosting(text: String?) {
        val app = state.value.application
        val posting = text ?: app?.jobDescription
        if (posting.isNullOrBlank()) { mutable.update { it.copy(match = MatchState.NoPosting) }; return }
        viewModelScope.launch {
            mutable.update { it.copy(match = MatchState.Reading) }
            val result = try {
                repositories.checks.createResumeJobMatch(resumeId, CreateResumeJobMatchRequest(company = if (text == null) app?.company else null, jobDescription = posting))
            } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(match = MatchState.Failed(text)) }; return@launch }
            mutable.update {
                it.copy(match = MatchState.Ready(result.found.map(::MatchTerm), result.missing.map(::MatchTerm), pasted = text))
            }
        }
    }

    override fun showHiddenTerms() = edit(BuilderToast(S.string.hidden_terms_are_back, undo = true)) { json ->
        json.update(listOf("data", "metadata", "check")) { check -> JsonObject(mapOf("ignored" to JsonArray(check.obj()["ignored"].arr()), "hiddenTerms" to JsonArray(emptyList()))) } as JsonObject
    }

    /** The open applications "Link an application…" lists (closed ones are left out, as on the web). */
    override fun loadApplications() {
        if (state.value.applications != null) return
        viewModelScope.launch {
            val apps = try { repositories.applications.listApplications() } catch (e: CancellationException) { throw e } catch (_: Exception) { emptyList() }
            mutable.update { it.copy(applications = apps.filter { a -> a.status != me.rxresu.core.network.generated.ApplicationStage.Closed }) }
        }
    }

    /**
     * Links this resume to [applicationId] (null unlinks) through the draft's metadata write, so the next autosave builds
     * on the linked revision, then matches against the new posting.
     */
    override fun linkApplication(applicationId: String?) { viewModelScope.launch { link(applicationId) } }

    private suspend fun link(applicationId: String?): Boolean {
        val handle = draft ?: return false
        mutable.update { it.copy(jobBusy = true) }
        return try {
            handle.writeMetadata { baseline ->
                val result = repositories.documents.putDocumentApplication(
                    me.rxresu.core.network.generated.DocumentType.Resume, resumeId,
                    me.rxresu.core.network.generated.PutDocumentApplicationRequest(applicationId, JsonPrimitive(baseline.updatedAt)),
                    me.rxresu.core.network.RequestOptions(nullFields = if (applicationId == null) setOf("/applicationId") else emptySet()),
                ) ?: error("No resume returned")
                baseline.withWriteResult(result).copy(applicationId = applicationId)
            }
            val app = applicationId?.let { id -> state.value.applications?.firstOrNull { it.id == id } ?: repositories.applications.getApplication(id) }
            mutable.update { it.copy(application = app, match = MatchState.Idle) }
            if (app != null) matchPosting(null) else mutable.update { it.copy(match = MatchState.NoPosting) }
            true
        } catch (e: CancellationException) { throw e } catch (_: Exception) {
            toasts.send(BuilderToast(S.string.couldn_t_link_the_application_try_again, danger = true))
            false
        } finally { mutable.update { it.copy(jobBusy = false) } }
    }

    /**
     * Copies this resume for an existing job ([applicationId]) or a new one saved with it ([job]), leaving this resume as
     * it was, and opens the copy on Job match. Pending edits are saved first so the copy has what's on screen.
     */
    override fun copyForJob(applicationId: String?, job: NewJob?) {
        val company = job?.company ?: state.value.applications?.firstOrNull { it.id == applicationId }?.company ?: state.value.application?.company.orEmpty()
        viewModelScope.launch {
            mutable.update { it.copy(jobBusy = true) }
            try {
                val handle = draft ?: return@launch
                handle.flush()
                // The web waits up to 10 s for pending edits (SAVE_WAIT_MS); offline or a failed save refuses the copy.
                val settled = withTimeoutOrNull(10_000) { handle.state.first { it.status != SaveStatus.Saving } }
                if (settled?.status != SaveStatus.Saved) { toasts.send(BuilderToast(R.string.builder_save_before_copy, danger = true)); return@launch }
                val copyId = repositories.documents.copyResumeForJob(me.rxresu.core.network.generated.CopyResumeForJobRequest(
                    resumeId = resumeId, applicationId = applicationId, newId = newId(),
                    application = job?.let { me.rxresu.core.network.generated.CopyResumeForJobRequestApplication(company = it.company, role = it.role, jobDescription = it.posting) },
                ))
                toasts.send(BuilderToast(S.string.copy_made_for_company_this_resume_is_unchanged, listOf(company)))
                opened.send(copyId)
            } catch (e: CancellationException) { throw e } catch (_: Exception) {
                toasts.send(BuilderToast(if (job != null) S.string.couldn_t_save_the_job_and_its_copy_your_edits_are_kept_try_again else R.string.builder_copy_failed, danger = true))
            } finally { mutable.update { it.copy(jobBusy = false) } }
        }
    }

    /** "Save and link this resume": saves the pasted posting as a job linked to this resume. */
    override fun saveJobAndLink(job: NewJob) {
        viewModelScope.launch {
            mutable.update { it.copy(jobBusy = true) }
            val id = try {
                repositories.applications.createApplication(me.rxresu.core.network.generated.CreateApplicationRequest(company = job.company, role = job.role, jobDescription = job.posting, resumeId = resumeId, newId = newId()))
            } catch (e: CancellationException) { throw e } catch (_: Exception) {
                mutable.update { it.copy(jobBusy = false) }
                toasts.send(BuilderToast(R.string.builder_save_job_failed, danger = true)); return@launch
            }
            mutable.update { it.copy(jobBusy = false, applications = null) }
            if (link(id)) toasts.send(BuilderToast(S.string.saved_as_a_job_and_linked_to_this_resume))
        }
    }

    /** A linked application without a posting takes the pasted one ("Save to the application"), then matches it. */
    override fun savePostingToApplication(text: String) {
        val app = state.value.application ?: return
        viewModelScope.launch {
            mutable.update { it.copy(jobBusy = true) }
            try {
                val saved = repositories.applications.patchApplication(app.id, me.rxresu.core.network.generated.PatchApplicationRequest(jobDescription = text.trim()))
                mutable.update { it.copy(application = saved) }
                matchPosting(null)
            } catch (e: CancellationException) { throw e } catch (_: Exception) {
                toasts.send(BuilderToast(R.string.builder_save_posting_failed, danger = true))
            } finally { mutable.update { it.copy(jobBusy = false) } }
        }
    }

    // Improve -------------------------------------------------------------------------------------------------------------

    /** Asks the first usable AI provider (enabled and tested) for a better line. Never applies it. */
    override fun improve(line: String, context: String, where: String, action: CreateImprovementRequestAction, request: String?) {
        viewModelScope.launch {
            val provider = state.value.aiProvider ?: provider()
            if (provider == null) { mutable.update { it.copy(improve = ImproveState.NoProvider) }; return@launch }
            val asked = ImproveRequest(line, action, request, provider.label, provider.model)
            mutable.update { it.copy(improve = ImproveState.Working(asked)) }
            val answer = try {
                repositories.ai.improveLine(ImproveLineRequest(action = action, aiProviderId = provider.id, context = context, includeProvenance = true, line = line, request = request, where = where))
            } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(improve = ImproveState.Failed(asked)) }; return@launch }
            mutable.update { it.copy(improve = ImproveState.Ready(asked, answer.text, answer.why, answer.addsFacts, answer.aiOperationIds.orEmpty())) }
        }
    }

    override fun clearImprovement() = mutable.update { it.copy(improve = ImproveState.Idle) }

    /** Replace writes the field with only that line swapped, as its own undo step, and records the AI operation. */
    override fun replaceField(path: Path, html: String, operations: List<String>) {
        mutable.update { it.copy(improve = ImproveState.Idle) }
        edit(BuilderToast(R.string.builder_line_replaced, undo = true)) { json ->
            val withLine = json.set(path, JsonPrimitive(html)) as JsonObject
            if (operations.isEmpty()) withLine
            else withLine.update(listOf("aiOperationIds")) { JsonArray((it.arr() + operations.map(::JsonPrimitive)).distinct()) } as JsonObject
        }
    }

    override fun toastError(text: Int) = toast(BuilderToast(text, danger = true))

    /** The first usable provider (enabled and tested), for the disclosure line and Improve. */
    override fun loadAiProvider() {
        if (state.value.aiProvider != null) return
        viewModelScope.launch { provider()?.let { p -> mutable.update { it.copy(aiProvider = p) } } }
    }

    private suspend fun provider(): AiProvider? = try {
        repositories.ai.listAiProviders().firstOrNull { it.enabled && it.testStatus == "success" }?.let { AiProvider(it.id, it.label, it.fastModel ?: it.model) }
    } catch (e: CancellationException) { throw e } catch (_: Exception) { null }

    // Photo -------------------------------------------------------------------------------------------------------------

    /** A picked photo opens Crop photo (B5) at the photo's aspect ratio; nothing uploads until Crop and upload. */
    override fun uploadPhoto(uri: Uri) {
        viewModelScope.launch {
            val photo = withContext(io) { readPhoto(uri) }
            val bitmap = photo?.let { withContext(io) { PhotoCrops.decode(it.bytes) } }
            if (photo == null || bitmap == null) { toasts.send(BuilderToast(R.string.builder_photo_unreadable, danger = true)); return@launch }
            mutable.update { it.copy(crop = PhotoCrop(bitmap, photo.name, photo.type)) }
        }
    }

    override fun uploadCameraPhoto(bitmap: android.graphics.Bitmap) = mutable.update { it.copy(crop = PhotoCrop(bitmap, "photo.jpg", "image/jpeg")) }

    override fun cancelCrop() = mutable.update { it.copy(crop = null) }

    /** Crops [area] (photo pixels) and uploads it, shrunk until it fits the 10 MB limit (web picture-settings.tsx). */
    override fun cropAndUpload(area: android.graphics.Rect) {
        val crop = state.value.crop ?: return
        mutable.update { it.copy(crop = null) }
        viewModelScope.launch {
            val photo = try { withContext(io) { PhotoCrops.encode(crop.bitmap, area, crop.type, crop.name) } } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
            if (photo == null) { toasts.send(BuilderToast(R.string.builder_crop_failed, danger = true)); return@launch }
            upload(photo)
        }
    }

    /** Uploads through POST /files (10 MB at most) and puts the returned URL on the page. */
    private suspend fun upload(photo: PickedPhoto?) {
        if (photo == null) { toasts.send(BuilderToast(R.string.builder_photo_unreadable, danger = true)); return }
        if (photo.bytes.size > 10 * 1024 * 1024) { toasts.send(BuilderToast(R.string.builder_photo_too_large, danger = true)); return }
        mutable.update { it.copy(photoUploading = true) }
        try {
            val file = repositories.account.createFile(UploadPart("file", photo.bytes, photo.name, photo.type))
            editNow { json -> json.set(listOf("data", "picture", "url"), JsonPrimitive(file.url)).set(listOf("data", "picture", "hidden"), JsonPrimitive(false)) as JsonObject }
            toasts.send(BuilderToast(R.string.builder_photo_uploaded, success = true))
        } catch (e: CancellationException) { throw e } catch (_: Exception) {
            toasts.send(BuilderToast(S.string.couldn_t_upload_the_photo_choose_a_readable_png_jpeg_webp_or_gif_photo_up_to_10_mb_then_try_again, danger = true))
        } finally { mutable.update { it.copy(photoUploading = false) } }
    }

    override fun removePhoto() = edit(BuilderToast(S.string.photo_removed, undo = true)) { it.set(listOf("data", "picture", "url"), JsonPrimitive("")) as JsonObject }

    // Exported PDF and writing ----------------------------------------------------------------------------------------

    /** Sends the exported PDF (the same render the page shows) through the file-level check. */
    override fun checkExportedPdf() {
        val resume = state.value.resume ?: return
        viewModelScope.launch {
            mutable.update { it.copy(pdfCheck = PdfCheckState.Checking) }
            val result = try {
                val document = repositories.pages.render(PageSource.Resume(resumeId, resume.updatedAt))
                val bytes = withContext(io) { document.file.readBytes() }
                repositories.checks.createPdfCheck(UploadPart("file", bytes, "${resume.slug.ifBlank { "resume" }}.pdf", "application/pdf"))
            } catch (e: CancellationException) { throw e } catch (_: Exception) {
                mutable.update { it.copy(pdfCheck = PdfCheckState.Idle) }
                toasts.send(BuilderToast(R.string.builder_pdf_failed, danger = true)); return@launch
            }
            val findings = result.findings.size
            mutable.update { it.copy(pdfCheck = PdfCheckState.Done(findings)) }
            toasts.send(if (findings == 0) BuilderToast(R.string.builder_pdf_clean) else BuilderToast(R.string.builder_pdf_more, listOf(findings)))
        }
    }

    /**
     * "Review writing": asks the first usable AI provider about the page's wording (POST /ai/ats-review), which saves
     * the review, then shows its notes. Without a provider, Set up AI opens instead (the screen checks [aiProvider]).
     */
    override fun reviewWriting() {
        if (state.value.reviewing) return
        viewModelScope.launch {
            val provider = state.value.aiProvider ?: provider()
            if (provider == null) { mutable.update { it.copy(improve = ImproveState.NoProvider) }; return@launch }
            mutable.update { it.copy(reviewing = true, aiProvider = provider) }
            try {
                repositories.ai.atsReview(me.rxresu.core.network.generated.AtsReviewRequest(aiProviderId = provider.id, extractedText = pageText.take(MAX_REVIEW_CHARS), resumeId = resumeId))
                loadWritingNotes()
            } catch (e: CancellationException) { throw e } catch (_: Exception) {
                toasts.send(BuilderToast(R.string.builder_review_failed, danger = true))
            } finally { mutable.update { it.copy(reviewing = false) } }
        }
    }

    private suspend fun loadWritingNotes() {
        val review = try { repositories.ai.getWritingReview(resumeId) } catch (e: CancellationException) { throw e } catch (_: Exception) { return } ?: return
        val json = me.rxresu.core.network.ApiJson.encodeToJsonElement(me.rxresu.core.network.generated.GetWritingReviewResponse.serializer(), review)
        val notes = json.at(listOf("review", "suggestions")).arr().map { it.obj() }.map { WritingNote(it["section"].str(), it["issue"].str(), it["rewrite"].str()) }
        mutable.update { it.copy(writingNotes = notes) }
    }

    override fun onCleared() {
        debouncer.cancel()
        val handle = draft ?: return
        // The builder owns close; it flushes first and must outlive this view model's scope.
        closeScope.launch { runCatching { handle.close() } }
    }

    private companion object {
        /** The web's MAX_TEXT_CHARS for the writing review's extracted text. */
        const val MAX_REVIEW_CHARS = 50_000
        val closeScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    }
}

internal fun placeOnFirstPage(pages: List<PageLayout>, key: String): List<PageLayout> =
    if (pages.isEmpty()) listOf(PageLayout(listOf(key), emptyList(), fullWidth = false))
    else pages.mapIndexed { i, p -> if (i == 0) p.copy(main = p.main + key) else p }

internal fun JsonObject.withPages(pages: List<PageLayout>): JsonObject = set(
    listOf("data", "metadata", "layout", "pages"),
    JsonArray(pages.map { p ->
        JsonObject(mapOf("fullWidth" to JsonPrimitive(p.fullWidth), "main" to JsonArray(p.main.map(::JsonPrimitive)), "sidebar" to JsonArray(p.sidebar.map(::JsonPrimitive))))
    }),
) as JsonObject
