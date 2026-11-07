package me.rxresu.feature.share

import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import me.rxresu.core.network.ApiJson
import android.print.PageRange
import kotlinx.coroutines.test.*
import me.rxresu.core.data.*
import me.rxresu.core.navigation.DocumentKind
import me.rxresu.core.network.generated.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class) @Config(sdk = [36])
class ShareViewModelTest {
    @Before fun setup() { Dispatchers.setMain(StandardTestDispatcher()) }
    @After fun teardown() { Dispatchers.resetMain() }
    @Test fun sharingUsesSelectedServerAndThirtyDayWindow() {
        val days = (0..30).map { GetResumeDailyStatisticsResponseItem("2026-11-07", if (it == 0) 500.0 else 1.0, if (it == 0) 500.0 else 2.0) }
        val state = ShareState(username = "alex", origin = "https://example.invalid", daily = days)
        assertEquals("https://example.invalid/alex", state.shortUrl); assertEquals(60L, state.views); assertEquals(30L, state.downloads)
    }
    @Test fun slugValidation() { assertTrue(validSlug("product-designer")); listOf("a--b", "-a", "a-", "A", "a/b", "", "a".repeat(65)).forEach { assertFalse(it, validSlug(it)) } }
    @Test fun fileNameCannotEscapeExportDirectory() { assertFalse(safeFileName("../../x\\y").contains('/')); assertFalse(safeFileName("../../x\\y").contains('\\')); assertEquals("Document", safeFileName("..")) }
    @Test fun metadataKeepsAuthoredContent() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val vm = ShareViewModel(repositories, StoryboardIds.resume); runCurrent()
            val draft = repositories.resumes.openDraft(StoryboardIds.resume); val before = draft.state.value.document!!
            draft.update(before.copy(data = before.data.copy(summary = before.data.summary.copy(content = "<p>My words</p>"))))
            vm.write({ UpdateResumeRequest(isPublic = false) }); runCurrent()
            val after = repositories.resumes.getResume(before.id)
            assertEquals("<p>My words</p>", after.data.summary.content); assertFalse(after.isPublic)
        } finally { repositories.close() }
    }
    @Test fun failedWriteKeepsSavedSwitchAndWords() = runTest {
        val controls = FakeControls(); val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        try {
            val vm = ShareViewModel(repositories, StoryboardIds.resume); runCurrent(); val before = vm.state.value.resume!!
            controls.set("updateResume", FakeMode.Error()); vm.write({ UpdateResumeRequest(isPublic = !before.isPublic) }); runCurrent()
            assertTrue(vm.state.value.failed); assertEquals(before.isPublic, vm.state.value.resume!!.isPublic)
        } finally { repositories.close() }
    }
    @Test fun newerSlugWinsDebounce() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val vm = ShareViewModel(repositories, StoryboardIds.resume); runCurrent()
            vm.slug("first"); advanceTimeBy(150); vm.slug("second"); advanceTimeBy(301); runCurrent()
            assertEquals("second", repositories.resumes.getResume(StoryboardIds.resume).slug)
        } finally { repositories.close() }
    }
    @Test fun failedSaveCannotExportOlderServerDocument() = runTest {
        val controls = FakeControls(); val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        try {
            val vm = ExportViewModel(repositories, StoryboardIds.resume, DocumentKind.Resume); runCurrent()
            val draft = repositories.resumes.openDraft(StoryboardIds.resume); val before = draft.state.value.document!!
            controls.set("updateResume", FakeMode.Error())
            draft.update(before.copy(data = before.data.copy(summary = before.data.summary.copy(content = "<p>Unsaved</p>"))))
            vm.format(FileFormat.Word); var result: Delivery? = null
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.deliveries.collect { result = it } }
            vm.export(false); runCurrent()
            assertNull(result); assertTrue(vm.state.value.failed)
        } finally { repositories.close() }
    }
    @Test fun jsonExportsLocalWordsOffline() = runTest {
        val controls = FakeControls(); val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        try {
            val vm = ExportViewModel(repositories, StoryboardIds.resume, DocumentKind.Resume); runCurrent()
            val draft = repositories.resumes.openDraft(StoryboardIds.resume); val before = draft.state.value.document!!
            controls.online.value = false
            draft.update(before.copy(data = before.data.copy(summary = before.data.summary.copy(content = "<p>Kept offline</p>"))))
            vm.format(FileFormat.Json); var result: Delivery? = null
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.deliveries.collect { result = it } }
            vm.export(true); runCurrent()
            assertTrue(result!!.files.single().bytes.decodeToString().contains("Kept offline"))
        } finally { repositories.close() }
    }
    @Test fun scrubbingClampsAndMirrorsDays() {
        assertEquals(0, visitorDayAt(-20f, 300f, 30, false)); assertEquals(29, visitorDayAt(300f, 300f, 30, false)); assertEquals(0, visitorDayAt(300f, 300f, 30, true)); assertEquals(14, visitorDayAt(150f, 300f, 30, true))
    }
    @Test fun printingIncludesOnlyRequestedPagesWithoutDuplicates() {
        assertEquals(listOf(1, 2, 4), selectedPrintPages(arrayOf(PageRange(1, 2), PageRange(2, 2), PageRange(4, 9)), 5))
        assertEquals(listOf(0, 1, 2), selectedPrintPages(arrayOf(PageRange.ALL_PAGES), 3)); assertTrue(selectedPrintPages(arrayOf(PageRange(9, 10)), 2).isEmpty())
    }
    @Test fun domainFlagBlocksMutationsOnUnsupportedServer() = runTest {
        val controls = FakeControls(); val flags = ApiSamples.response("getFeatureFlags").jsonObject
        controls.responses.value = mapOf("getFeatureFlags" to JsonObject(flags + ("customDomains" to JsonPrimitive(false))))
        val base = FakeRepositories(controls, coroutineScope = backgroundScope)
        try { val vm = ShareViewModel(base, StoryboardIds.resume); runCurrent(); assertFalse(vm.state.value.customDomains); vm.domain("resume.example.invalid"); runCurrent(); assertTrue(vm.state.value.failed); assertNull(vm.state.value.domain) } finally { base.close() }
    }
    @Test fun translationCopiesDocumentAndPrefillsWithoutSending() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val vm = ShareViewModel(base, StoryboardIds.resume); runCurrent(); val original = base.resumes.getResume(StoryboardIds.resume)
            val locale = ImportResumeFileLocale.entries.first { it != ImportResumeFileLocale.Unknown && it.wireValue != original.data.metadata.page.locale }
            var copy: String? = null; var prompt = ""; vm.languageCopy(locale) { id, text -> copy = id; prompt = text }; runCurrent()
            assertNotNull(copy); assertNotEquals(original.id, copy); assertEquals(original, base.resumes.getResume(original.id)); assertTrue(prompt.contains(locale.wireValue)); assertTrue(prompt.contains("Keep hidden content unchanged")); assertEquals(original.data.summary, base.resumes.getResume(copy!!).data.summary)
        } finally { base.close() }
    }
}
