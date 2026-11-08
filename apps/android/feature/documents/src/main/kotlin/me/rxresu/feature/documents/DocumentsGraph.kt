package me.rxresu.feature.documents

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.toRoute
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrToastHostState
import me.rxresu.core.designsystem.RrToastResult
import me.rxresu.core.designsystem.RrToastTone
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.Builder
import me.rxresu.core.navigation.BuilderBasics
import me.rxresu.core.navigation.DocumentActions
import me.rxresu.core.navigation.DocumentKind
import me.rxresu.core.navigation.DocumentsTab
import me.rxresu.core.navigation.Import
import me.rxresu.core.navigation.Letter
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.NewDocument
import me.rxresu.core.navigation.RrNavMotion
import me.rxresu.core.navigation.SaveJob
import me.rxresu.core.navigation.Search
import me.rxresu.core.navigation.Settings
import me.rxresu.core.navigation.SettingsAi
import me.rxresu.core.navigation.Trash
import me.rxresu.core.navigation.TrashTab
import me.rxresu.core.navigation.modal
import me.rxresu.core.navigation.screen
import me.rxresu.core.navigation.sheet
import me.rxresu.core.navigation.tabRoot
import me.rxresu.core.network.generated.CreateResumeRequest
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.network.generated.DocumentType

/** D2's Select hands the document back to D1 through the library entry's saved state. */
private const val SELECT_KEY = "documents.select"

/** File types the importer reads (web new-document-dialog accept list). */
private val ImportTypes = arrayOf(
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/zip",
    "application/json",
)

/** Registers D1–D4 and D6. */
fun NavGraphBuilder.documentsGraph(nav: NavController, motion: RrNavMotion) {
    tabRoot<DocumentsTab>(motion) { entry -> LibraryRoute(nav, entry) }
    sheet<DocumentActions> { entry -> DocumentActionsRoute(nav, entry.toRoute()) }
    sheet<NewDocument> { entry -> NewDocumentRoute(nav, entry.toRoute()) }
    modal<Import>(motion) { entry -> ImportRoute(nav, entry.toRoute()) }
    screen<Trash> { entry -> TrashRoute(nav, entry.toRoute()) }
}

private fun NavController.open(doc: DocumentSummary) = navigate(if (doc.isLetter) Letter(doc.id) else Builder(doc.id))
private fun DocumentType.kind() = if (this == DocumentType.Letter) DocumentKind.Letter else DocumentKind.Resume

@Composable
private fun LibraryRoute(nav: NavController, entry: NavBackStackEntry) {
    val repos = LocalRepositories.current
    val vm = viewModel { LibraryViewModel(repos.documents, repos.account) }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()
    val res = LocalResources.current

    val select by entry.savedStateHandle.getStateFlow<String?>(SELECT_KEY, null).collectAsStateWithLifecycle()
    LaunchedEffect(select) {
        select?.let { vm.select(it); entry.savedStateHandle[SELECT_KEY] = null }
    }

    LibraryScreen(
        state,
        repos.time.now(),
        LibraryActions(
            onSearch = { nav.navigate(Search("documents")) },
            onNew = { nav.navigate(NewDocument()) },
            onSettings = { nav.navigate(Settings) },
            onRefresh = { scope.launch { runCatching { vm.refresh() } } },
            onRetry = { scope.launch { runCatching { vm.refresh() } } },
            onType = vm::setType,
            onTag = vm::setTag,
            onSort = vm::setSort,
            onGrid = vm::setGrid,
            onClearFilters = vm::clearFilters,
            onOpen = { nav.open(it) },
            onActions = { nav.navigate(DocumentActions(it.id, it.type.kind())) },
            onToggle = vm::toggle,
            onTrash = { doc -> scope.launch { trashWithUndo(doc, toasts, res, { vm.trash(doc) }, { vm.restore(doc) }) } },
            onClearSelection = vm::clearSelection,
            onTrashSelection = {
                scope.launch {
                    val wanted = state.selected.size
                    val moved = vm.trashSelection()
                    val message = if (moved.size < wanted) res.getString(R.string.docs_moved_some, moved.size.toString(), wanted.toString())
                    else res.getString(R.string.docs_moved_many, moved.size.toString())
                    if (moved.isNotEmpty()) toasts.post(message, res.getString(R.string.docs_undo)) {
                        if (it == RrToastResult.ActionPerformed) moved.forEach { doc -> runCatching { vm.restore(doc) } }
                    }
                }
            },
            onTagSelection = { add, remove ->
                scope.launch {
                    runCatching { vm.setTags(state.selected, add, remove) }.onFailure { toasts.post(res.getString(R.string.docs_tags_failed), tone = RrToastTone.Danger) }
                }
            },
            onOpenTrash = { nav.navigate(Trash()) },
        ),
    )
}

/** Moves to Trash and offers Undo ("“Product designer” moved to Trash"); the toast outlives the caller. */
private suspend fun trashWithUndo(
    doc: DocumentSummary,
    toasts: RrToastHostState,
    res: android.content.res.Resources,
    trash: suspend () -> Unit,
    restore: suspend () -> Unit,
) {
    try {
        trash()
    } catch (e: Exception) {
        toasts.post(res.getString(R.string.docs_trash_failed), tone = RrToastTone.Danger)
        return
    }
    toasts.post(res.getString(R.string.docs_moved_to_trash, doc.name), res.getString(R.string.docs_undo)) {
        if (it == RrToastResult.ActionPerformed) runCatching { restore() }.onFailure { toasts.show(res.getString(R.string.docs_nothing_to_undo)) }
    }
}

@Composable
private fun DocumentActionsRoute(nav: NavController, route: DocumentActions) {
    val repos = LocalRepositories.current
    val vm = viewModel { DocumentActionsViewModel(repos, route.id) }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()
    val haptics = rememberRrHaptics()
    val context = LocalContext.current
    val res = LocalResources.current
    var preparing by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    fun failed(message: Int) = toasts.post(res.getString(message), tone = RrToastTone.Danger)
    fun withDoc(block: (DocumentSummary) -> Unit) { state.document?.let(block) }

    DocumentActionsSheet(
        state,
        repos.time.now(),
        DocumentActionsCallbacks(
            onClose = { nav.popBackStack() },
            onSharePdf = {
                withDoc { doc ->
                    preparing = true
                    scope.launch {
                        try {
                            sharePdf(context, doc.name, vm.pdf(doc))
                        } catch (e: Exception) {
                            failed(R.string.docs_share_failed)
                        } finally {
                            preparing = false
                        }
                    }
                }
            },
            onCopyLink = {
                state.publicUrl?.let { url ->
                    context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText(state.document?.name, url))
                    haptics(RrHaptic.Success)
                    toasts.post(res.getString(R.string.docs_link_copied))
                }
            },
            onDuplicate = {
                withDoc { doc ->
                    scope.launch {
                        val id = try { vm.duplicate(doc) } catch (e: Exception) { failed(R.string.docs_duplicate_failed); return@launch }
                        nav.popBackStack()
                        toasts.post(res.getString(R.string.docs_duplicated, doc.name), res.getString(R.string.docs_open)) {
                            if (it == RrToastResult.ActionPerformed) nav.navigate(if (doc.isLetter) Letter(id) else Builder(id))
                        }
                    }
                }
            },
            onRename = { name -> withDoc { doc -> scope.launch { runCatching { vm.rename(doc, name) }.onFailure { failed(R.string.docs_rename_failed) } } } },
            onWriteLetter = {
                withDoc { doc ->
                    scope.launch {
                        val id = try {
                            vm.newLetter(res.getString(R.string.docs_untitled_letter), resumeId = doc.id, applicationId = doc.application?.id)
                        } catch (e: Exception) { failed(R.string.docs_create_failed); return@launch }
                        haptics(RrHaptic.Success)
                        nav.popBackStack()
                        nav.navigate(Letter(id))
                    }
                }
            },
            onLink = { appId -> withDoc { doc -> scope.launch { runCatching { vm.link(doc, appId) }.onFailure { failed(R.string.docs_link_failed) } } } },
            onTags = { add, remove -> withDoc { doc -> scope.launch { runCatching { vm.setTags(doc, add, remove) }.onFailure { failed(R.string.docs_tags_failed) } } } },
            onToggleLock = {
                withDoc { doc ->
                    scope.launch {
                        runCatching { vm.setLocked(doc, !doc.isLocked) }.onFailure { failed(if (doc.isLocked) R.string.docs_unlock_failed else R.string.docs_lock_failed) }
                    }
                }
            },
            onSelect = {
                nav.previousBackStackEntry?.savedStateHandle?.set(SELECT_KEY, route.id)
                nav.popBackStack()
            },
            onTrash = {
                // Trash first, then close: a failure keeps the sheet open under its toast.
                withDoc { doc -> scope.launch { trashWithUndo(doc, toasts, res, { vm.trash(doc); nav.popBackStack() }, { vm.restore(doc) }) } }
            },
            onCopyForJob = { resumeId, job, name -> scope.launch { copyForJob(vm, state, resumeId, job, name, nav, toasts, res, haptics) { busy = it } } },
        ),
        preparing = preparing,
        busy = busy,
    )
}

/** Copies, opens the copy and says what happened; a failure keeps the sheet and its fields. */
private suspend fun copyForJob(
    vm: DocumentActionsViewModel,
    state: DocumentActionsUiState,
    resumeId: String,
    job: JobChoice,
    name: String,
    nav: NavController,
    toasts: RrToastHostState,
    res: android.content.res.Resources,
    haptics: (RrHaptic) -> Unit,
    busy: (Boolean) -> Unit,
) {
    busy(true)
    val id = try {
        vm.copyForJob(resumeId, job, name)
    } catch (e: Exception) {
        toasts.post(res.getString(R.string.docs_copy_failed), tone = RrToastTone.Danger)
        return
    } finally {
        busy(false)
    }
    haptics(RrHaptic.Success)
    nav.popBackStack()
    nav.navigate(Builder(id))
    val company = when (job) {
        is JobChoice.Existing -> state.applications.firstOrNull { it.id == job.id }?.company
        is JobChoice.New -> job.company.trim()
    }
    if (company != null) toasts.post(res.getString(R.string.docs_copy_made, company))
}

/** Writes the PDF where the share sheet can read it and opens the system share sheet. */
private suspend fun sharePdf(context: Context, name: String, pdf: File) {
    val shared = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "shared").apply { mkdirs() }
        File(dir, name.replace(Regex("[^\\p{L}\\p{N} ._-]"), "_").trim().ifEmpty { "document" } + ".pdf").also { pdf.copyTo(it, overwrite = true) }
    }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.documents.files", shared)
    val send = Intent(Intent.ACTION_SEND).setType("application/pdf").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(Intent.createChooser(send, name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

@Composable
private fun NewDocumentRoute(nav: NavController, route: NewDocument) {
    val repos = LocalRepositories.current
    val vm = viewModel { DocumentActionsViewModel(repos, null) }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()
    val haptics = rememberRrHaptics()
    val res = LocalResources.current
    var busy by remember { mutableStateOf(false) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            nav.popBackStack()
            nav.navigate(Import(uri.toString()))
        }
    }

    NewDocumentSheet(
        state,
        NewDocumentCallbacks(
            onClose = { nav.popBackStack() },
            onImport = { picker.launch(ImportTypes) },
            onBlank = {
                scope.launch {
                    val id = createResume(repos, res.getString(R.string.docs_untitled_resume), sample = false) ?: run { toasts.post(res.getString(R.string.docs_create_failed), tone = RrToastTone.Danger); return@launch }
                    haptics(RrHaptic.Success)
                    nav.popBackStack()
                    // Basics over the builder, so Back from the name lands in the editor ("Opens the editor on your name").
                    nav.navigate(Builder(id))
                    nav.navigate(BuilderBasics(id))
                }
            },
            onSaveJob = { nav.popBackStack(); nav.navigate(SaveJob()) },
            onSample = {
                scope.launch {
                    val id = createResume(repos, res.getString(R.string.docs_sample_name), sample = true) ?: run { toasts.post(res.getString(R.string.docs_create_failed), tone = RrToastTone.Danger); return@launch }
                    haptics(RrHaptic.Success)
                    nav.popBackStack()
                    nav.navigate(Builder(id))
                    toasts.post(res.getString(R.string.docs_sample_added))
                }
            },
            onCopyForJob = { resumeId, job, name -> scope.launch { copyForJob(vm, state, resumeId, job, name, nav, toasts, res, haptics) { busy = it } } },
            onLetter = { resumeId, letterId ->
                scope.launch {
                    val id = try {
                        vm.newLetter(res.getString(R.string.docs_untitled_letter), resumeId = resumeId, sourceLetterId = letterId)
                    } catch (e: Exception) {
                        toasts.post(res.getString(R.string.docs_create_failed), tone = RrToastTone.Danger)
                        return@launch
                    }
                    haptics(RrHaptic.Success)
                    nav.popBackStack()
                    nav.navigate(Letter(id))
                }
            },
        ),
        busy = busy,
        initialStep = if (route.copyForApplicationId != null) NewStep.CopyForJob else NewStep.Main,
        initialApplicationId = route.copyForApplicationId,
    )
}

private suspend fun createResume(repos: RrRepositories, name: String, sample: Boolean): String? = runCatching {
    repos.resumes.createResume(CreateResumeRequest(name = name, tags = emptyList(), withSampleData = sample.takeIf { it }))
}.getOrNull()

@Composable
private fun ImportRoute(nav: NavController, route: Import) {
    val repos = LocalRepositories.current
    val vm = viewModel { ImportViewModel(repos.resumes, repos.ai) }
    val state by vm.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val haptics = rememberRrHaptics()
    val context = LocalContext.current
    val res = LocalResources.current
    val toasts = LocalToasts.current
    var uri by rememberSaveable { mutableStateOf(route.fileUri) }
    var asked by rememberSaveable { mutableStateOf(false) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { picked ->
        when {
            picked != null -> uri = picked.toString()
            state.file == null -> nav.popBackStack()
        }
    }
    LaunchedEffect(uri) {
        val current = uri
        if (current == null) {
            if (!asked) { asked = true; picker.launch(ImportTypes) }
        } else {
            runCatching { readFile(context, current.toUri()) }
                .onSuccess(vm::start)
                .onFailure { haptics(RrHaptic.Error); toasts.show(res.getString(if (it is ImportTooLarge) R.string.import_too_large else R.string.import_unreadable), tone = RrToastTone.Danger) }
        }
    }
    LaunchedEffect(state.summary != null) { if (state.summary != null) haptics(RrHaptic.Success) }
    LaunchedEffect(state.problem) { if (state.problem == ImportProblem.Unreadable) haptics(RrHaptic.Error) }

    ImportScreen(
        state,
        ImportCallbacks(
            onClose = { nav.popBackStack() },
            onChangeFile = { picker.launch(ImportTypes) },
            onMethod = vm::setMethod,
            onReadWithAi = vm::read,
            onLocale = vm::setLocale,
            onCreate = {
                scope.launch {
                    val id = try { vm.create() } catch (e: Exception) { haptics(RrHaptic.Error); return@launch }
                    haptics(RrHaptic.Success)
                    nav.navigate(Builder(id)) { popUpTo<Import> { inclusive = true } }
                }
            },
            onStartBlank = {
                scope.launch {
                    val id = createResume(repos, res.getString(R.string.docs_untitled_resume), sample = false) ?: return@launch
                    nav.navigate(Builder(id)) { popUpTo<Import> { inclusive = true } }
                    nav.navigate(BuilderBasics(id))
                }
            },
            onSetUpAi = { nav.navigate(SettingsAi) },
        ),
    )
}

/** Name, size, type, bytes and (for PDFs) page count of a picked or shared file. */
private suspend fun readFile(context: Context, uri: Uri): PickedFile = withContext(Dispatchers.IO) {
    val resolver = context.contentResolver
    var name = uri.lastPathSegment ?: "file"
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
            c.getString(0)?.let { name = it }
        }
    }
    val mime = resolver.getType(uri)
    val bytes = requireNotNull(resolver.openInputStream(uri)) { "Unreadable" }.use { it.readImportBytes() }
    val pages = if (mime == "application/pdf" || name.endsWith(".pdf", true)) {
        runCatching { resolver.openFileDescriptor(uri, "r")?.use { fd -> PdfRenderer(fd).use { it.pageCount } } }.getOrNull()
    } else null
    PickedFile(name, bytes.size.toLong(), mime, bytes, pages)
}

@Composable
private fun TrashRoute(nav: NavController, route: Trash) {
    val repos = LocalRepositories.current
    val vm = viewModel { TrashViewModel(repos.documents, repos.applications) }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()
    val haptics = rememberRrHaptics()
    val res = LocalResources.current
    var tab by rememberSaveable { mutableStateOf(route.tab) }
    var confirm by remember { mutableStateOf<TrashConfirm?>(null) }

    fun failed(message: Int) = toasts.post(res.getString(message), tone = RrToastTone.Danger)

    TrashScreen(
        state,
        tab,
        confirm,
        repos.time.now(),
        TrashCallbacks(
            onBack = { nav.popBackStack() },
            onTab = { tab = it; vm.clearSelection() },
            onRestore = { doc ->
                scope.launch {
                    try { vm.restore(doc) } catch (e: Exception) { failed(R.string.trash_restore_failed); return@launch }
                    haptics(RrHaptic.Success)
                    toasts.post(res.getString(R.string.trash_restored, doc.name), res.getString(R.string.docs_open)) { if (it == RrToastResult.ActionPerformed) nav.open(doc) }
                }
            },
            onRestoreApplication = { app ->
                scope.launch {
                    try { vm.restore(app) } catch (e: Exception) { failed(R.string.trash_restore_failed); return@launch }
                    haptics(RrHaptic.Success)
                    toasts.post(res.getString(R.string.trash_restored, app.company))
                }
            },
            onConfirm = { confirm = it },
            onDismissConfirm = { confirm = null },
            onDelete = { what ->
                confirm = null
                scope.launch {
                    try {
                        when (what) {
                            is TrashConfirm.Document -> { vm.purge(what.doc); toasts.post(res.getString(R.string.trash_deleted, what.doc.name)) }
                            is TrashConfirm.Application -> { vm.purge(what.app); toasts.post(res.getString(R.string.trash_deleted, what.app.company)) }
                            is TrashConfirm.Selection -> vm.applyToSelection(restore = false)
                            TrashConfirm.Empty -> { vm.empty(); toasts.post(res.getString(R.string.trash_emptied)) }
                        }
                    } catch (e: Exception) {
                        failed(if (what == TrashConfirm.Empty) R.string.trash_empty_failed else R.string.trash_delete_failed)
                    }
                }
            },
            onToggle = vm::toggle,
            onClearSelection = vm::clearSelection,
            onRestoreSelection = {
                scope.launch {
                    runCatching { vm.applyToSelection(restore = true) }.onSuccess { haptics(RrHaptic.Success) }.onFailure { failed(R.string.trash_restore_failed) }
                }
            },
        ),
    )
}
