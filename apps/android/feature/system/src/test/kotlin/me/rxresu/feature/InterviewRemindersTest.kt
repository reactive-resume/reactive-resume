package me.rxresu.feature.system

import android.Manifest
import android.app.NotificationManager
import androidx.test.core.app.ApplicationProvider
import androidx.work.*
import androidx.work.testing.*
import java.io.File
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.*
import me.rxresu.core.network.generated.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = RepositoryTestApp::class)
class InterviewRemindersTest {
    private val context get() = ApplicationProvider.getApplicationContext<RepositoryTestApp>()
    private class DeviceClock(var now: Instant = Instant.parse("2026-11-07T09:00:00Z")) : Clock() {
        override fun instant() = now
        override fun getZone(): ZoneId = ZoneId.of("Europe/Lisbon")
        override fun withZone(zone: ZoneId): Clock = this
    }
    @Before fun setup() {
        File(context.noBackupFilesDir, "notifications").deleteRecursively()
        WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        context.getSystemService(NotificationManager::class.java).cancelAll()
    }
    private suspend fun worker(receipt: String) = TestListenableWorkerBuilder<InterviewReminderWorker>(context)
        .setInputData(workDataOf("receipt" to receipt)).build().doWork()
    private suspend fun entry(repositories: RrRepositories) = repositories.applications.getApplication(StoryboardIds.lumen)
        .activity.filterIsInstance<Interview>().first()
    private suspend fun enable(repositories: RrRepositories): InterviewReminder {
        val app = repositories.applications.getApplication(StoryboardIds.lumen)
        repositories.preferences.setNotification(NotificationCategory.InterviewsAndBriefings, true)
        assertEquals(InterviewReminderResult.Scheduled, updateInterviewReminder(context, repositories, app, entry(repositories), true, "storyboard-alex", "https://example.invalid"))
        return repositories.preferences.values.first().interviewReminders.single()
    }

    @Test fun confirmedWorkPersistsOneDeviceReceiptAndDeliveryIsDeduplicated() = runTest {
        val clock = DeviceClock()
        val repos = FakeRepositories(time = TimeSource(clock) { clock.zone }, coroutineScope = backgroundScope)
        context.repositories = repos
        val reminder = enable(repos)
        assertEquals(interviewReminderDevice(context), reminder.device)
        assertEquals(1440L, reminder.leadMinutes)
        assertEquals(1, WorkManager.getInstance(context).getWorkInfosByTag("rr-interview-reminder").get().size)
        clock.now = reminder.fireAt()
        assertEquals(ListenableWorker.Result.success(), worker(reminder.receipt))
        assertEquals(1, shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications.size)
        assertEquals(ListenableWorker.Result.success(), worker(reminder.receipt))
        assertEquals(1, shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications.size)
        repos.close()
    }

    @Test fun deniedAndPassedNeverClaimAScheduledReminder() = runTest {
        val clock = DeviceClock()
        val repos = FakeRepositories(time = TimeSource(clock) { clock.zone }, coroutineScope = backgroundScope)
        context.repositories = repos
        val app = repos.applications.getApplication(StoryboardIds.lumen)
        val interview = entry(repos)
        shadowOf(context).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)
        assertEquals(InterviewReminderResult.Denied, updateInterviewReminder(context, repos, app, interview, true, "storyboard-alex", "https://example.invalid"))
        assertTrue(repos.preferences.values.first().interviewReminders.isEmpty())
        clock.now = Instant.parse(interview.at)
        assertEquals(InterviewReminderResult.Passed, updateInterviewReminder(context, repos, app, interview, true, "storyboard-alex", "https://example.invalid"))
        assertTrue(repos.preferences.values.first().interviewReminders.isEmpty())
        repos.close()
    }

    @Test fun wrongAccountOriginDeviceCategoryAndPermissionNeverPost() = runTest {
        val clock = DeviceClock()
        val session = FakeAuthSession()
        val repos = FakeRepositories(time = TimeSource(clock) { clock.zone }, authSession = session, coroutineScope = backgroundScope)
        context.repositories = repos
        val reminder = enable(repos)
        clock.now = reminder.fireAt()
        session.state.value = SessionState.SignedOut
        worker(reminder.receipt)
        session.state.value = SessionState.SignedIn(session.origin.value, "other-account")
        worker(reminder.receipt)
        session.state.value = SessionState.SignedIn(session.origin.value, "storyboard-alex")
        session.origin.value = "https://other.invalid"
        worker(reminder.receipt)
        session.origin.value = reminder.origin
        repos.preferences.setNotification(NotificationCategory.InterviewsAndBriefings, false)
        worker(reminder.receipt)
        repos.preferences.setNotification(NotificationCategory.InterviewsAndBriefings, true)
        shadowOf(context).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)
        worker(reminder.receipt)
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        repos.preferences.setInterviewReminder(reminder.copy(device = "different-device"), true)
        repos.preferences.setInterviewReminder(reminder, false)
        worker(reminder.receipt)
        assertTrue(shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications.isEmpty())
        repos.close()
    }

    @Test fun canonicalMoveReplacesReceiptAndCommittedDeleteCancelsIt() = runTest {
        val clock = DeviceClock()
        val repos = FakeRepositories(time = TimeSource(clock) { clock.zone }, coroutineScope = backgroundScope)
        context.repositories = repos
        val reminder = enable(repos)
        val moved = Instant.parse(reminder.at).plusSeconds(86400).toString()
        repos.applications.updateApplicationInterview(reminder.applicationId, reminder.entryId, PatchApplicationInterviewRequest(at = moved, timezone = "America/New_York"))
        syncInterviewReminders(context, repos, reminder.owner, reminder.origin)
        val replacement = repos.preferences.values.first().interviewReminders.single()
        assertEquals(moved, replacement.at)
        assertNotEquals(reminder.receipt, replacement.receipt)
        clock.now = reminder.fireAt()
        worker(reminder.receipt)
        assertTrue(shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications.isEmpty())
        repos.applications.deleteApplicationTimelineEntry(reminder.applicationId, reminder.entryId)
        syncInterviewReminders(context, repos, reminder.owner, reminder.origin)
        assertTrue(repos.preferences.values.first().interviewReminders.isEmpty())
        clock.now = replacement.fireAt()
        worker(replacement.receipt)
        assertTrue(shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications.isEmpty())
        repos.close()
    }
    @Test fun categoryOffAndSignOutCancelPendingWorkWithoutReenablingIt() = runTest {
        val session = FakeAuthSession()
        val repos = FakeRepositories(authSession = session, coroutineScope = backgroundScope)
        context.repositories = repos
        val reminder = enable(repos)
        repos.preferences.setNotification(NotificationCategory.InterviewsAndBriefings, false)
        reconcileInterviewReminderJobs(context, repos)
        assertTrue(WorkManager.getInstance(context).getWorkInfosByTag("rr-interview-reminder").get().all { it.state == WorkInfo.State.CANCELLED })
        val app = repos.applications.getApplication(reminder.applicationId)
        assertEquals(InterviewReminderResult.Denied, updateInterviewReminder(context, repos, app, entry(repos), true, reminder.owner, reminder.origin))
        assertFalse(NotificationCategory.InterviewsAndBriefings in repos.preferences.values.first().notifications)
        session.signOut()
        reconcileInterviewReminderJobs(context, repos)
        assertTrue(repos.preferences.values.first().interviewReminders.isEmpty())
        repos.close()
    }

    @Test fun trashedAndMissingApplicationsClearLocalIntentAndNeverPost() = runTest {
        val clock = DeviceClock()
        val controls = FakeControls()
        val repos = FakeRepositories(controls, time = TimeSource(clock) { clock.zone }, coroutineScope = backgroundScope)
        context.repositories = repos
        val reminder = enable(repos)
        repos.applications.trashApplication(reminder.applicationId)
        clock.now = reminder.fireAt()
        assertEquals(ListenableWorker.Result.success(), worker(reminder.receipt))
        assertTrue(repos.preferences.values.first().interviewReminders.isEmpty())
        assertTrue(shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications.isEmpty())
        val restoredIntent = reminder.copy(receipt = "missing-application")
        repos.preferences.setInterviewReminder(restoredIntent, true)
        controls.set("getApplication", FakeMode.Error(me.rxresu.core.network.ApiException(404, "NOT_FOUND", "Missing")))
        assertEquals(ListenableWorker.Result.success(), worker(restoredIntent.receipt))
        assertTrue(repos.preferences.values.first().interviewReminders.isEmpty())
        assertTrue(shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications.isEmpty())
        repos.close()
    }

    @Test fun aWorkerWithAnOldCanonicalReadCannotPostAcrossALocalDelete() = runTest {
        val clock = DeviceClock()
        val base = FakeRepositories(time = TimeSource(clock) { clock.zone }, coroutineScope = backgroundScope)
        context.repositories = base
        val reminder = enable(base)
        val app = base.applications.getApplication(reminder.applicationId)
        val interview = entry(base)
        val fetched = CompletableDeferred<Unit>()
        val resumeRead = CompletableDeferred<Unit>()
        var pause = true
        val applications = object : ApplicationsRepository by base.applications {
            override suspend fun getApplication(id: String, options: me.rxresu.core.network.RequestOptions): me.rxresu.core.network.generated.Application {
                val canonical = base.applications.getApplication(id, options)
                if (pause) { pause = false; fetched.complete(Unit); resumeRead.await() }
                return canonical
            }
        }
        val repositories = RrRepositories(base.account, base.documents, base.resumes, base.letters, applications,
            base.checks, base.ai, base.assistant, base.workspace, base.career, base.search, base.publicResume,
            base.platform, base.preferences, base.today, base.drafts, base.pages, base.authSession, base.time)
        context.repositories = repositories
        clock.now = reminder.fireAt()
        val delivery = async { worker(reminder.receipt) }
        fetched.await()
        withInterviewReminderChange(reminder.owner, reminder.origin, reminder.applicationId, reminder.entryId) {
            base.applications.deleteApplicationTimelineEntry(reminder.applicationId, reminder.entryId)
            resumeRead.complete(Unit)
            assertEquals(ListenableWorker.Result.retry(), delivery.await())
            assertTrue(shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications.isEmpty())
            updateInterviewReminder(context, repositories, app, interview, false, reminder.owner, reminder.origin)
        }
        assertEquals(ListenableWorker.Result.success(), worker(reminder.receipt))
        assertTrue(repositories.preferences.values.first().interviewReminders.isEmpty())
        assertTrue(shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications.isEmpty())
        base.close()
    }

}
