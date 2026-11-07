package me.rxresu.core.data

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.ServerEvent
import me.rxresu.core.network.generated.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DocumentDraftTest {
    /** Autosave and the draft's collectors run in backgroundScope, which advanceUntilIdle skips. */
    private fun TestScope.settle() { advanceTimeBy(5_000); runCurrent() }
    private fun Resume.named(name: String) = copy(data = data.copy(basics = data.basics.copy(name = name)))
    private fun Resume.headline(text: String) = copy(data = data.copy(basics = data.basics.copy(headline = text)))

    /** Someone else's write: a JSON Patch to the fake server's resume, as an agent's would be. */
    private suspend fun RrRepositories.writeElsewhere(name: String) {
        val body = buildJsonObject { putJsonArray("operations") { addJsonObject { put("op", "replace"); put("path", "/data/basics/name"); put("value", name) } } }
        resumes.patchResume(StoryboardIds.resume, ApiJson.decodeFromJsonElement(PatchResumeRequest.serializer(), body))
    }

    @Test fun updatesSharingAnUndoStepUndoAtOnce() = runTest {
        FakeRepositories(coroutineScope = backgroundScope).use { r ->
            val draft = r.resumes.openDraft(StoryboardIds.resume)
            val original = draft.state.value.document!!
            draft.update(original.named("One"), undoStep = "fit")
            draft.update(original.named("Two"), undoStep = "fit")
            draft.update(original.named("Three"), undoStep = "fit")
            draft.undo(); runCurrent()
            assertEquals(original.data.basics.name, draft.state.value.document!!.data.basics.name)
            assertFalse(draft.state.value.canUndo)
            draft.redo(); runCurrent()
            assertEquals("Three", draft.state.value.document!!.data.basics.name)
            draft.close()
        }
    }

    @Test fun anotherEditBetweenStepsStartsItsOwnUndoStep() = runTest {
        FakeRepositories(coroutineScope = backgroundScope).use { r ->
            val draft = r.resumes.openDraft(StoryboardIds.resume)
            val original = draft.state.value.document!!
            draft.update(original.named("One"), undoStep = "fit")
            draft.update(draft.state.value.document!!.headline("Typed"))
            draft.update(draft.state.value.document!!.named("Two"), undoStep = "fit")
            draft.undo(); runCurrent()
            assertEquals("One", draft.state.value.document!!.data.basics.name)
            assertEquals("Typed", draft.state.value.document!!.data.basics.headline)
            draft.undo(); runCurrent()
            assertEquals(original.data.basics.headline, draft.state.value.document!!.data.basics.headline)
            draft.undo(); runCurrent()
            assertEquals(original.data.basics.name, draft.state.value.document!!.data.basics.name)
            draft.close()
        }
    }

    @Test fun agentUpdateEventTakesTheChangeAsOneUndoStep() = runTest {
        val controls = FakeControls()
        FakeRepositories(controls = controls, coroutineScope = backgroundScope).use { r ->
            val draft = r.resumes.openDraft(StoryboardIds.resume)
            runCurrent()
            val original = draft.state.value.document!!
            val change = async { draft.outsideChanges.first() }
            runCurrent()
            r.writeElsewhere("Agent Alex")
            controls.resumeUpdates.emit(ServerEvent(null, null, """{"type":"resume.updated","mutation":"patch"}"""))
            settle()
            assertEquals(OutsideChange("patch"), change.await())
            assertEquals("Agent Alex", draft.state.value.document!!.data.basics.name)
            assertTrue(draft.state.value.canUndo)
            draft.undo(); settle()
            assertEquals(original.data.basics.name, draft.state.value.document!!.data.basics.name)
            assertEquals(original.data.basics.name, r.resumes.getResume(StoryboardIds.resume).data.basics.name)
            draft.close()
        }
    }

    @Test fun ownSaveEchoAndRenamesAreNotOutsideChanges() = runTest {
        FakeRepositories(coroutineScope = backgroundScope).use { r ->
            val draft = r.resumes.openDraft(StoryboardIds.resume)
            val seen = mutableListOf<OutsideChange>()
            backgroundScope.launchCollect(draft) { seen += it }
            draft.update(draft.state.value.document!!.named("Mine")); settle()
            draft.refresh(); settle()
            r.resumes.updateResume(StoryboardIds.resume, UpdateResumeRequest(name = "Renamed elsewhere"))
            draft.refresh(); settle()
            assertTrue(seen.isEmpty())
            assertEquals("Mine", draft.state.value.document!!.data.basics.name)
            draft.close()
        }
    }

    @Test fun refetchWhileTypingWaitsForBlurThenAnnouncesTheChange() = runTest {
        FakeRepositories(coroutineScope = backgroundScope).use { r ->
            val draft = r.resumes.openDraft(StoryboardIds.resume)
            val seen = mutableListOf<OutsideChange>()
            backgroundScope.launchCollect(draft) { seen += it }
            draft.setEditing(true)
            r.writeElsewhere("Other device")
            draft.refresh(); settle()
            assertTrue(seen.isEmpty())
            assertNotEquals("Other device", draft.state.value.document!!.data.basics.name)
            draft.setEditing(false); settle()
            assertEquals(listOf(OutsideChange(null)), seen)
            assertEquals("Other device", draft.state.value.document!!.data.basics.name)
            draft.close()
        }
    }

    private fun kotlinx.coroutines.CoroutineScope.launchCollect(draft: DocumentDraft<Resume>, each: (OutsideChange) -> Unit) =
        launch(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) { draft.outsideChanges.collect(each) }
}
