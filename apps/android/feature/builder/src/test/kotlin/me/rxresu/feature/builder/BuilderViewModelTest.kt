package me.rxresu.feature.builder

import android.graphics.Bitmap
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import me.rxresu.core.data.FakeControls
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.database.SaveStatus
import me.rxresu.core.page.PageRenderer
import me.rxresu.core.page.PageSource
import me.rxresu.core.page.RenderedDocument
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import me.rxresu.core.data.OutsideChange
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.ServerEvent
import me.rxresu.core.network.generated.PatchResumeRequest
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** The builder's view model against the fake repositories and draft queue, on virtual time. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class BuilderViewModelTest {
    /** Counts renders; reports [pagesFor] pages for the nth render. */
    private class Renderer(private val pagesFor: (Int) -> Int = { 1 }) : PageRenderer {
        val revisions = mutableListOf<String>()
        override suspend fun render(source: PageSource): RenderedDocument {
            revisions += source.revision
            return RenderedDocument(source, File.createTempFile("page", ".pdf"), pagesFor(revisions.size))
        }
        override suspend fun lastGood(source: PageSource): RenderedDocument? = null
        override suspend fun page(document: RenderedDocument, index: Int, widthPx: Int): Bitmap = Bitmap.createBitmap(10, 14, Bitmap.Config.ARGB_8888)
    }

    private fun TestScope.builder(renderer: Renderer = Renderer(), id: String = StoryboardIds.resume, controls: FakeControls = FakeControls()): BuilderViewModel {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        val repositories = FakeRepositories(controls, pageRenderer = renderer, coroutineScope = backgroundScope)
        return BuilderViewModel(id, repositories, readText = { listOf(emptyList()) }, io = dispatcher).also { repositoriesByVm[it] = repositories }
    }

    @After fun tearDown() = Dispatchers.resetMain()

    /** Lets autosave (500 ms), the save and the debounced render (350 ms) run on virtual time. */
    private fun TestScope.settle() { advanceUntilIdle(); advanceTimeBy(5_000); runCurrent(); advanceUntilIdle() }

    private val name = listOf("data", "basics", "name")

    @Test fun editsAutosaveAndThePageRerendersAfterTheSave() = runTest {
        val renderer = Renderer()
        val vm = builder(renderer)
        settle()
        assertEquals(1, renderer.revisions.size)
        assertEquals(1, vm.state.value.pages.size)

        vm.edit { it.set(name, JsonPrimitive("Alex M.")) as JsonObject }
        settle()
        assertEquals("Alex M.", vm.state.value.resume!!.data.basics.name)
        assertEquals(SaveStatus.Saved, vm.state.value.status)
        assertTrue(vm.state.value.canUndo)
        // One debounced render for the saved revision, keyed by the new updatedAt.
        assertEquals(2, renderer.revisions.size)
        assertEquals(vm.state.value.resume!!.updatedAt, renderer.revisions.last())
    }

    @Test fun undoAndRedoStepThroughEdits() = runTest {
        val vm = builder()
        settle()
        vm.edit { it.set(name, JsonPrimitive("A")) as JsonObject }
        settle()
        vm.undo(); settle()
        assertEquals("Alex Morgan", vm.state.value.resume!!.data.basics.name)
        vm.redo(); settle()
        assertEquals("A", vm.state.value.resume!!.data.basics.name)
    }

    @Test fun lockedResumesRefuseEdits() = runTest {
        val vm = builder(id = StoryboardIds.lockedResume)
        settle()
        assertTrue(vm.state.value.locked)
        val before = vm.state.value.resume!!.data.basics.name
        assertFalse(vm.editNow { it.set(name, JsonPrimitive("Changed")) as JsonObject })
        assertEquals(before, vm.state.value.resume!!.data.basics.name)
    }

    @Test fun ignoringAnIssueWritesItsKeyAndOffersUndo() = runTest {
        val vm = builder()
        val toasts = mutableListOf<BuilderToast>()
        backgroundScope.launch { vm.toastEvents.collect { toasts += it } }
        settle()
        val key = vm.state.value.checks!!.findings.first().key
        vm.ignoreIssue(key)
        settle()
        val ignored = vm.state.value.doc!!.metadata["check"].obj()["ignored"].arr().map { it.str() }
        assertEquals(listOf(key), ignored)
        assertTrue(toasts.single().undo)
    }

    @Test fun deletingAnEntryRemovesItWithUndo() = runTest {
        val vm = builder()
        settle()
        vm.deleteItem("experience", "experience-harbour")
        settle()
        val doc = vm.state.value.doc!!
        assertEquals(listOf("experience-northwind"), doc.items(doc.section("experience")!!).map { it["id"].str() })
        vm.undo(); settle()
        assertEquals(2, vm.state.value.doc!!.let { it.items(it.section("experience")!!) }.size)
    }

    @Test fun fitStepsUntilThePageCountIsOne() = runTest {
        // Two pages until the third render (after two Fit steps), then one.
        val vm = builder(Renderer { n -> if (n < 3) 2 else 1 })
        val toasts = mutableListOf<BuilderToast>()
        backgroundScope.launch { vm.toastEvents.collect { toasts += it } }
        settle()
        vm.fitToOnePage()
        settle()
        assertEquals(R.string.builder_fit_done, toasts.last().text)
        assertEquals(Density.Compact, Density.of(vm.state.value.doc!!.json))
        assertEquals(Margins.Narrow, Margins.of(vm.state.value.doc!!.json))
        assertFalse(vm.state.value.fitting)
    }

    @Test fun addToSkillsMovesTheTermAndWritesTheSkill() = runTest {
        val controls = FakeControls()
        controls.responses.value = mapOf(
            "createResumeJobMatch" to me.rxresu.core.network.ApiJson.parseToJsonElement(
                """{"found":[{"term":"figma","label":"Figma","jdCount":1,"resumeCount":1,"weight":1}],"missing":[{"term":"accessibility audits","label":"Accessibility audits","jdCount":3,"resumeCount":0,"weight":2}],"total":2}""",
            ),
        )
        val vm = builder(controls = controls)
        settle()
        vm.matchPosting("Accessibility audits for a product team that uses Figma.")
        settle()
        val term = (vm.state.value.match as MatchState.Ready).missing.single()
        assertEquals(3, term.postingCount)
        vm.addSkill(term.label)
        settle()
        val after = vm.state.value.match as MatchState.Ready
        assertTrue(term in after.found && after.missing.isEmpty())
        val skills = vm.state.value.doc!!.let { it.items(it.section("skills")!!) }
        assertEquals("Accessibility audits", skills.last()["name"].str())
    }

    @Test fun fitIsOneUndoStep() = runTest {
        val vm = builder(Renderer { n -> if (n < 4) 2 else 1 })
        settle()
        val before = vm.state.value.doc!!.json
        vm.fitToOnePage()
        settle()
        assertEquals(Margins.Narrow, Margins.of(vm.state.value.doc!!.json))
        vm.undo(); settle()
        val after = vm.state.value.doc!!.json
        assertEquals(before.at(listOf("data", "metadata")), after.at(listOf("data", "metadata")))
        assertFalse(vm.state.value.canUndo)
    }

    @Test fun fitThatCannotFitPutsTheDesignBack() = runTest {
        val vm = builder(Renderer { 2 })
        val toasts = mutableListOf<BuilderToast>()
        backgroundScope.launch { vm.toastEvents.collect { toasts += it } }
        settle()
        val before = vm.state.value.doc!!.json.at(listOf("data", "metadata"))
        vm.fitToOnePage()
        repeat(20) { settle() }
        assertEquals(R.string.builder_fit_failed, toasts.last().text)
        assertEquals(before, vm.state.value.doc!!.json.at(listOf("data", "metadata")))
    }

    @Test fun anAgentsChangeShowsTheStripAndUndoTakesItBack() = runTest {
        val controls = FakeControls()
        val vm = builder(controls = controls)
        settle()
        val repositories = repositoriesOf(vm)
        val body = buildJsonObject { putJsonArray("operations") { addJsonObject { put("op", "replace"); put("path", "/data/basics/name"); put("value", "Agent Alex") } } }
        repositories.resumes.patchResume(StoryboardIds.resume, ApiJson.decodeFromJsonElement(PatchResumeRequest.serializer(), body))
        controls.resumeUpdates.emit(ServerEvent(null, null, """{"mutation":"patch"}"""))
        settle()
        assertEquals(OutsideChange("patch"), vm.state.value.outsideChange)
        assertEquals("Agent Alex", vm.state.value.resume!!.data.basics.name)
        vm.undo(); settle()
        assertNull(vm.state.value.outsideChange)
        assertEquals("Alex Morgan", vm.state.value.resume!!.data.basics.name)
    }

    @Test fun linkingAnApplicationTakesTheNewRevisionAndMatchesItsPosting() = runTest {
        val vm = builder()
        settle()
        vm.linkApplication(StoryboardIds.lumen)
        settle()
        assertEquals(StoryboardIds.lumen, vm.state.value.resume!!.applicationId)
        assertEquals(StoryboardIds.lumen, vm.state.value.application!!.id)
        // The next autosave builds on the linked revision instead of conflicting with it.
        vm.edit { it.set(name, JsonPrimitive("Alex L.")) as JsonObject }
        settle()
        assertEquals(SaveStatus.Saved, vm.state.value.status)
        assertNull(vm.state.value.recoveredCopyName)
        assertEquals(StoryboardIds.lumen, repositoriesOf(vm).resumes.getResume(StoryboardIds.resume).applicationId)
    }

    @Test fun aCopyForAJobOpensTheCopy() = runTest {
        val controls = FakeControls()
        controls.responses.value = mapOf("copyResumeForJob" to JsonPrimitive(StoryboardIds.lumenResume))
        val vm = builder(controls = controls)
        val opened = mutableListOf<String>()
        backgroundScope.launch { vm.openCopyEvents.collect { opened += it } }
        settle()
        vm.copyForJob(StoryboardIds.lumen)
        settle()
        assertEquals(listOf(StoryboardIds.lumenResume), opened)
    }

    private val repositoriesByVm = mutableMapOf<BuilderViewModel, me.rxresu.core.data.RrRepositories>()
    private fun repositoriesOf(vm: BuilderViewModel) = repositoriesByVm.getValue(vm)
}
