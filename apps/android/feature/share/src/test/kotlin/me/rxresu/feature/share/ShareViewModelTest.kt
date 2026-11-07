package me.rxresu.feature.share

import kotlinx.coroutines.*
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
}
