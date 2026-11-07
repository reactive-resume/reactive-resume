package me.rxresu.feature.workspace

import java.time.Instant
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import me.rxresu.core.data.FakeControls
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.CreateCareerOfferResponseDataPracticeMode
import me.rxresu.core.network.generated.FitResult
import me.rxresu.core.network.generated.GenerateCareerWorkResponse
import me.rxresu.core.network.generated.PracticeAttempt
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** A microphone that returns [bytes] when stopped. */
private class FakeRecorder(var bytes: ByteArray = ByteArray(1_000), var fails: Boolean = false) : VoiceRecorder {
    var started = 0
    override fun start() { if (fails) error("busy"); started++ }
    override fun level() = 16_000
    override fun stop() = bytes
    override fun cancel() = Unit
}

@OptIn(ExperimentalCoroutinesApi::class)
class WorkspaceLogicTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun main() = Dispatchers.setMain(dispatcher)
    @After fun reset() = Dispatchers.resetMain()

    private fun TestScope.recording(recorder: VoiceRecorder, takes: MutableList<Take>) =
        Recording(backgroundScope, recorder, { testScheduler.currentTime }) { takes += it }

    @Test fun recordingStopsItselfAtTwoMinutes() = runTest(dispatcher) {
        val takes = mutableListOf<Take>()
        val r = recording(FakeRecorder(), takes)
        assertTrue(r.start())
        advanceTimeBy(119_000)
        assertTrue(r.state.value.recording)
        assertEquals(Recording.BARS, r.state.value.levels.size)
        advanceTimeBy(2_000)
        assertEquals(false, r.state.value.recording)
        assertTrue((takes.single() as Take.Audio).atLimit)
    }

    @Test fun earlyStopKeepsTheTakeAndItsLength() = runTest(dispatcher) {
        val takes = mutableListOf<Take>()
        val r = recording(FakeRecorder(), takes)
        r.start()
        advanceTimeBy(48_050)
        r.stop()
        assertEquals(false, takes.single().atLimit)
        assertTrue(r.state.value.elapsedMs in 47_000..48_100)
    }

    @Test fun emptyAndOversizedTakesAreUnusable() = runTest(dispatcher) {
        val takes = mutableListOf<Take>()
        val recorder = FakeRecorder(ByteArray(0))
        val r = recording(recorder, takes)
        r.start(); r.stop()
        recorder.bytes = ByteArray(Recording.MAX_BYTES + 1)
        r.start(); r.stop()
        recorder.bytes = ByteArray(Recording.MAX_BYTES)
        r.start(); r.stop()
        assertEquals(listOf(true, true, false), takes.map { it is Take.Unusable })
    }

    @Test fun aMicrophoneThatWontStartReportsIt() = runTest(dispatcher) {
        val r = recording(FakeRecorder(fails = true), mutableListOf())
        assertEquals(false, r.start())
        assertEquals(false, r.state.value.recording)
    }

    @Test fun clockReadsMinutesAndSeconds() {
        assertEquals("0:48", clock(48_900))
        assertEquals("2:00", clock(Recording.MAX_MS))
    }

    @Test fun transcriberPrefersTheDefaultCapableConnection() = runTest(dispatcher) {
        val providers = FakeRepositories().ai.listAiProviders()
        val t = chooseTranscriber(providers)!!
        assertEquals("provider-work", t.providerId)
        assertEquals("gpt-4o-mini-transcribe", t.model)
        assertNull(chooseTranscriber(providers.filter { it.provider.wireValue == "ollama" }))
    }

    @Test fun currentInterviewIsTheNextOrOneJustEnded() = runTest(dispatcher) {
        val app = FakeRepositories().applications.getApplication(StoryboardIds.lumen)
        assertEquals(StoryboardIds.interview, app.currentInterview(Instant.parse("2026-11-07T09:00:00Z"))?.id)
        assertEquals(StoryboardIds.interview, app.currentInterview(Instant.parse("2026-11-11T08:00:00Z"))?.id)
        assertNull(app.currentInterview(Instant.parse("2026-11-12T12:00:00Z")))
        assertEquals(StoryboardIds.interview, app.debriefRound(Instant.parse("2026-11-12T12:00:00Z"))?.id)
    }

    @Test fun fitCheckReturnsTheResult() = runTest(dispatcher) {
        val vm = FitViewModel(FakeRepositories(), StoryboardIds.lumen)
        advanceUntilIdle()
        vm.check(Locale.UK)
        advanceUntilIdle()
        val state = (vm.state.value as Load.Ready).value
        assertTrue(state.fit is FitResult)
        assertEquals(false, state.running)
        assertEquals(Outcome.Success, vm.outcome.first())
    }

    @Test fun practiceRecordsTranscribesAndGetsFeedback() = runTest(dispatcher) {
        val controls = FakeControls()
        val repos = FakeRepositories(controls)
        val attempt = repos.workspace.listCareerSavedItems(applicationId = StoryboardIds.lumen).first { it.data is PracticeAttempt }
        controls.responses.value = mapOf(
            "transcribeCareerAnswer" to buildJsonObject { put("id", "t1"); put("text", "I built tokens first.") },
            "generateCareerWork" to buildJsonObject {
                put("item", ApiJson.encodeToJsonElement(me.rxresu.core.network.generated.SavedItem.serializer(), attempt.copy(id = "practice-new", createdAt = "2026-11-07T09:30:00Z")))
            },
        )
        val vm = PractiseViewModel(repos, StoryboardIds.lumen, { listOf("Q") }, FakeRecorder(), { testScheduler.currentTime })
        advanceUntilIdle()
        val before = (vm.state.value as Load.Ready).value.attempts.size
        vm.record()
        advanceTimeBy(30_000)
        vm.stopRecording()
        advanceUntilIdle()
        val review = (vm.state.value as Load.Ready).value.phase as AnswerPhase.Review
        assertEquals("I built tokens first.", review.text)
        assertEquals(CreateCareerOfferResponseDataPracticeMode.Spoken, review.mode)
        vm.feedback(Locale.UK)
        advanceUntilIdle()
        val done = (vm.state.value as Load.Ready).value
        assertTrue(done.phase is AnswerPhase.Feedback)
        assertEquals(before + 1, done.attempts.size)
    }

    @Test fun practiceAtTheLimitWarnsAndAnEmptyTranscriptSaysNothingWasHeard() = runTest(dispatcher) {
        val controls = FakeControls().apply { responses.value = mapOf("transcribeCareerAnswer" to buildJsonObject { put("id", "t"); put("text", JsonPrimitive(" ")) }) }
        val vm = PractiseViewModel(FakeRepositories(controls), StoryboardIds.lumen, { listOf("Q") }, FakeRecorder(), { testScheduler.currentTime })
        advanceUntilIdle()
        vm.record()
        runCurrent()
        assertEquals(VoiceOutcome.Started, vm.outcome.first())
        advanceTimeBy(121_000)
        assertEquals(VoiceOutcome.Limit, vm.outcome.first())
        advanceUntilIdle()
        val state = (vm.state.value as Load.Ready).value
        assertEquals(VoiceNotice.NothingHeard, state.notice)
        assertEquals(AnswerPhase.Idle, state.phase)
    }

    @Test fun applySavesAnAnswerAgainstTheCurrentList() = runTest(dispatcher) {
        val vm = ApplyViewModel(FakeRepositories(), StoryboardIds.kiln)
        advanceUntilIdle()
        val before = (vm.state.value as Load.Ready).value.answers.size
        assertTrue(vm.saveAnswer(null, "Salary expectations", "Open to discussing", forOtherApplications = false))
        assertEquals(before + 1, (vm.state.value as Load.Ready).value.answers.size)
    }

    @Test fun messagesStartFromTheSavedFollowUp() = runTest(dispatcher) {
        val vm = MessagesViewModel(FakeRepositories(), StoryboardIds.fieldnote)
        advanceUntilIdle()
        val state = (vm.state.value as Load.Ready).value
        assertTrue(state.body.startsWith("Hi Joana"))
        assertEquals("Joana Reis", state.contact?.name)
    }
}
