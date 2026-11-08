package me.rxresu.feature.applications

import java.time.LocalDate
import java.time.LocalTime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.*
import me.rxresu.core.data.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class InterviewReminderTest {
    @Before fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())
    @After fun reset() = Dispatchers.resetMain()
    private fun vm(repos: RrRepositories, id: String?) = InterviewViewModel(repos.applications, repos.career, repos.time,
        StoryboardIds.lumen, id, repos.preferences, { "storyboard-alex" to "https://example.invalid" }, "device")

    @Test fun existingDeviceChoiceLoadsAndDraftChangesDoNotCommitIt() = runTest {
        val repos = FakeRepositories(coroutineScope = backgroundScope)
        repos.preferences.setNotification(NotificationCategory.InterviewsAndBriefings, true)
        val entry = repos.applications.getApplication(StoryboardIds.lumen).activity.filterIsInstance<me.rxresu.core.network.generated.Interview>().first()
        val reminder = InterviewReminder("storyboard-alex", "https://example.invalid", "device", StoryboardIds.lumen, entry.id, entry.at, receipt = "original")
        repos.preferences.setInterviewReminder(reminder, true)
        val model = vm(repos, entry.id)
        val original = model.state.first { it.original != null }.original!!
        assertTrue(original.remind)
        original.copy(remind = false)
        assertEquals(listOf(reminder), repos.preferences.values.first().interviewReminders)
        assertFalse(vm(repos, null).state.first { it.original != null }.original!!.remind)
        repos.close()
    }

    @Test fun newSaveUsesCanonicalCreatedEntryId() = runTest {
        val repos = FakeRepositories(coroutineScope = backgroundScope)
        val model = vm(repos, null)
        val draft = model.state.first { it.original != null }.original!!.copy(date = LocalDate.of(2026, 11, 12), time = LocalTime.of(14, 0), remind = true)
        val saved = model.save(draft, "Interview")!!
        assertEquals(saved.interview.id, saved.event!!.uid)
        assertTrue(saved.interview.id.startsWith("interview-"))
        assertEquals(draft.at().toString(), saved.interview.at)
        assertNull(model.save(draft, "Interview"))
        assertTrue(repos.preferences.values.first().interviewReminders.isEmpty())
        repos.close()
    }

    @Test fun uncertainNewSaveBlocksDuplicateRetryAndKeepsDraft() = runTest {
        val controls = FakeControls()
        val repos = FakeRepositories(controls, coroutineScope = backgroundScope)
        val model = vm(repos, null)
        val draft = model.state.first { it.original != null }.original!!.copy(date = LocalDate.of(2026, 11, 12), time = LocalTime.of(14, 0), remind = true)
        controls.set("addApplicationInterview", FakeMode.Error())
        assertNull(model.save(draft, "Interview"))
        assertTrue(model.state.value.uncertain)
        controls.set("addApplicationInterview", FakeMode.Ready)
        assertNull(model.save(draft, "Interview"))
        assertEquals(LocalTime.of(14, 0), draft.time)
        assertTrue(repos.preferences.values.first().interviewReminders.isEmpty())
        repos.close()
    }
}
