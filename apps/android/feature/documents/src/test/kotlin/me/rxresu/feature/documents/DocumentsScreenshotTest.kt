package me.rxresu.feature.documents

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import java.time.Duration
import androidx.compose.ui.draw.alpha
import me.rxresu.core.designsystem.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import me.rxresu.core.data.FakeControls
import me.rxresu.core.data.FakeMode
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.designsystem.RrTabBar
import me.rxresu.core.designsystem.rrAppTabs
import me.rxresu.core.navigation.TrashTab
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.network.generated.DocumentType
import me.rxresu.core.network.generated.ResumeData
import me.rxresu.core.strings.R as S
import me.rxresu.core.testing.RrScreenshotTest
import me.rxresu.core.testing.captureScreen
import org.junit.Test

class DocumentsScreenshotTest : RrScreenshotTest() {
    @Test fun rtl() = captureScreen("D1-Library-rtl", false, wrap = provide(repos())) {
        CompositionLocalProvider(androidx.compose.ui.platform.LocalLayoutDirection provides androidx.compose.ui.unit.LayoutDirection.Rtl) { Shell { Library() } }
    }
    @Test fun libraryLight() = library(false)
    @Test fun libraryDark() = library(true)
    @Test fun actionsLight() = actions(false)
    @Test fun actionsDark() = actions(true)
    @Test fun newLight() = new(false)
    @Test fun newDark() = new(true)
    @Test fun importLight() = import(false)
    @Test fun importDark() = import(true)
    @Test fun trashLight() = trash(false)
    @Test fun trashDark() = trash(true)

    @Test fun libraryEmpty() = captureScreen("D1-Library-empty", false, wrap = provide(repos(FakeControls(FakeMode.Empty)))) { Shell { Library() } }
    @Test fun libraryError() = captureScreen("D1-Library-error", false, wrap = provide(repos(FakeControls(FakeMode.Error())))) { Shell { Library() } }
    @Test fun libraryListOffline() = captureScreen("D1-Library-list-offline", false, wrap = provide(repos())) {
        Shell { Library { it.copy(offline = true, filters = it.filters.copy(grid = false)) } }
    }
    @Test fun libraryFontScale() = captureScreen("D1-Library", false, wrap = provide(repos()), fontScale = 2f) { Shell { Library() } }
    @Test fun actionsLocked() = captureScreen("D2-Actions-locked", false, wrap = provide(repos())) { Box { Library(); Actions(StoryboardIds.lockedResume) } }
    @Test fun trashEmpty() = captureScreen("D6-Trash-empty", false, wrap = provide(repos(FakeControls(FakeMode.Empty)))) { Trash(confirm = false) }

    @Test fun trashConfirmationLight() = captureScreen("D6-Trash-confirm", false, wrap = provide(trashRepos())) { Trash(confirm = true) }
    @Test fun trashConfirmationDark() = captureScreen("D6-Trash-confirm", true, wrap = provide(trashRepos())) { Trash(confirm = true) }
    @Test fun emptyImportLight() = emptyImport(false)
    @Test fun emptyImportDark() = emptyImport(true)
    @Test fun letterChoiceLight() = letterChoice(false)
    @Test fun letterChoiceDark() = letterChoice(true)
    @Test fun copyLight() = copy(false)
    @Test fun copyDark() = copy(true)
    @Test fun newFontScale() = captureScreen("D3-New", false, wrap = provide(repos()), fontScale = 2f) {
        val r = LocalRepositories.current
        val state = remember { runBlocking { DocumentActionsUiState(library = r.documents.listDocuments(), applications = r.applications.listApplications()) } }
        NewDocumentSheet(state, NewDocumentCallbacks())
    }

    private fun emptyImport(dark: Boolean) = captureScreen("D4-Import-empty", dark) { ImportScreen(ImportUiState(), ImportCallbacks()) }
    private fun letterChoice(dark: Boolean) = captureScreen("D3-New-letter", dark, wrap = provide(repos())) {
        val r = LocalRepositories.current
        val state = remember { runBlocking { DocumentActionsUiState(applications = r.applications.listApplications()) } }
        NewDocumentSheet(state, NewDocumentCallbacks(), initialStep = NewStep.Letter)
    }
    private fun copy(dark: Boolean) = captureScreen("D2-Actions-copy", dark, wrap = provide(repos())) {
        val r = LocalRepositories.current
        val state = remember { runBlocking {
            val docs = r.documents.listDocuments()
            DocumentActionsUiState(document = docs.first { it.id == StoryboardIds.resume }, library = docs, applications = r.applications.listApplications())
        } }
        DocumentActionsSheet(state, r.time.now(), DocumentActionsCallbacks(), initialStep = ActionsStep.CopyForJob)
    }

    private fun library(dark: Boolean) = captureScreen("D1-Library", dark, wrap = provide(repos())) { Shell { Library() } }
    private fun actions(dark: Boolean) = captureScreen("D2-Actions", dark, wrap = provide(repos())) { Box { SheetLibrary(); Actions(StoryboardIds.lockedResume, locked = false) } }
    private fun new(dark: Boolean) = captureScreen("D3-New", dark, wrap = provide(repos())) {
        Box {
            SheetLibrary()
            val r = LocalRepositories.current
            val vm = remember { DocumentActionsViewModel(r, null) }
            val state by vm.state.collectAsState()
            NewDocumentSheet(state, NewDocumentCallbacks())
        }
    }
    private fun import(dark: Boolean) = captureScreen("D4-Import", dark, wrap = provide(importRepos())) {
        ImportScreen(ImportUiState(file = PickedFile("alex-morgan-cv.pdf", 182L * 1024, "application/pdf", ByteArray(16), pages = 2), format = ImportFormat.Pdf, aiProvider = "Work OpenAI", progress = 3,
            summary = ImportSummary("Alex Morgan", "Product designer", "Lisbon", 4, 2, 12, 3, 1)), ImportCallbacks())
    }
    private fun trash(dark: Boolean) = captureScreen("D6-Trash", dark, wrap = provide(trashRepos())) { Trash(confirm = false) }

}

private fun provide(repos: RrRepositories): @Composable (@Composable () -> Unit) -> Unit = { content ->
    CompositionLocalProvider(LocalRepositories provides repos) { content() }
}

/** Fake repositories with first-page thumbnails already rendered, so captures don't race the renderer. */
private fun repos(controls: FakeControls = FakeControls()): RrRepositories = FakeRepositories(controls).also { warm(it) }

private fun warm(r: RrRepositories) = runBlocking {
    val docs = runCatching { r.documents.listDocuments() + r.documents.listDocuments(trashed = true) }.getOrDefault(emptyList())
    for (doc in docs) for (px in listOf(348, 80)) Thumbnails.load(r.pages, doc.pageSource(), px)
}

/** The PDF reader answers with the storyboard resume (Alex Morgan). */
private fun importRepos(): RrRepositories {
    val controls = FakeControls()
    val r = FakeRepositories(controls)
    val data = runBlocking { r.resumes.getResume(StoryboardIds.resume).data }
    controls.responses.value = mapOf(
        "previewPdfImport" to buildJsonObject {
            put("data", ApiJson.encodeToJsonElement(ResumeData.serializer(), data))
            putJsonObject("source") { put("lines", kotlinx.serialization.json.JsonArray(emptyList())); put("links", kotlinx.serialization.json.JsonArray(emptyList())); put("partial", false) }
        },
    )
    return r
}

/** D6 has two documents with 26 and 4 days left. */
private fun trashRepos(): RrRepositories {
    val controls = FakeControls()
    val r = FakeRepositories(controls)
    val now = r.time.now()
    val base = runBlocking { r.documents.listDocuments(trashed = true) }.first()
    val resume = runBlocking { r.documents.listDocuments() }.first { it.type == DocumentType.Resume }
    fun trashedDaysAgo(days: Long) = now.minus(Duration.ofDays(days)).toString()
    val docs = listOf(
        resume.copy(id = "resume-junior", name = "Junior designer 2021", trashedAt = trashedDaysAgo(4)),
        base.copy(name = "Letter for Brightside", trashedAt = trashedDaysAgo(26)),
    )
    controls.responses.value = mapOf("listDocuments" to ApiJson.encodeToJsonElement(ListSerializer(DocumentSummary.serializer()), docs))
    warm(r)
    return r
}

@Composable
private fun Shell(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) { content() }
        RrTabBar(
            rrAppTabs(stringResource(S.string.today), stringResource(S.string.documents), stringResource(S.string.applications), stringResource(S.string.career)),
            selectedIndex = 1,
            onSelect = {},
        )
    }
}

@Composable
private fun Library(adjust: (LibraryUiState) -> LibraryUiState = { it }) {
    val r = LocalRepositories.current
    val vm = remember { LibraryViewModel(r.documents, r.account) }
    val state by vm.state.collectAsState()
    LibraryScreen(adjust(state.copy(all = storyboardDocuments(state.all, r.time.now()), trashCount = 2)), r.time.now(), LibraryActions())
}

/** D2's state loaded before the first frame: the sheet sizes itself on its first layout. */
@Composable
private fun Actions(id: String, locked: Boolean? = null) {
    val r = LocalRepositories.current
    val state = remember {
        runBlocking {
            val docs = r.documents.listDocuments()
            DocumentActionsUiState(
                document = docs.first { it.id == id }.let { if (locked == null) it else it.copy(isLocked = locked) },
                library = docs,
                applications = r.applications.listApplications(),
                username = r.account.observeProfile().first { it.data != null }.data?.username,
                origin = r.authSession.origin.value,
            )
        }
    }
    DocumentActionsSheet(state, r.time.now(), DocumentActionsCallbacks())
}

@Composable
private fun Trash(confirm: Boolean) {
    val r = LocalRepositories.current
    val vm = remember { TrashViewModel(r.documents, r.applications) }
    val state by vm.state.collectAsState()
    val target = state.documents.lastOrNull()
    TrashScreen(
        state,
        TrashTab.Documents,
        if (confirm && target != null) TrashConfirm.Document(target) else null,
        r.time.now(),
        TrashCallbacks(),
        inlineDialog = true,
    )
}

/** Per-screen copy and dates differ from the common multi-feature seed. */
private fun storyboardDocuments(docs: List<DocumentSummary>, now: java.time.Instant) = docs.map { doc ->
    when (doc.id) {
        StoryboardIds.resume -> doc.copy(editedAt = now.minus(Duration.ofHours(2)).toString())
        StoryboardIds.lumenLetter -> doc.copy(name = "Letter for Lumen")
        "letter-kiln" -> doc.copy(name = "Letter for Orbital Health", editedAt = "2026-10-30T10:00:00Z")
        else -> doc
    }
}

/** The storyboard sheets show a bare, dimmed three-resume library behind the modal. */
@Composable
private fun SheetLibrary() {
    val r = LocalRepositories.current
    val docs = remember { runBlocking { storyboardDocuments(r.documents.listDocuments(), r.time.now()).filter { !it.isLetter } } }
    Column {
        RrTopBar()
        Column(Modifier.alpha(0.5f)) {
            RrSectionHeading("Resumes", first = true)
            RrListGroup {
                docs.forEachIndexed { index, doc ->
                    RrListRow(doc.name, subtitle = listOfNotNull("Edited ${relativeTime(doc.editedAt, r.time.now())}", if (doc.isPublic) "Public" else doc.application?.let { "For ${it.company}" }).joinToString(" · "), leading = { RrDocumentThumbnail() }, divider = index < docs.lastIndex, trailing = { RrRowCaret() })
                }
            }
        }
    }
}
