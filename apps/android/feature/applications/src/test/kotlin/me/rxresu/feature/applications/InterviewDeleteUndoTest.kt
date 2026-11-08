package me.rxresu.feature.applications

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import android.os.Looper
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.navigation.NavHostController
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.ListenableWorker
import androidx.work.workDataOf
import androidx.work.testing.*
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import me.rxresu.core.data.*
import me.rxresu.core.designsystem.*
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.RrNavMotion
import me.rxresu.core.navigation.InterviewSheet
import me.rxresu.core.network.generated.Interview
import me.rxresu.core.testing.RrScreenshotTest
import me.rxresu.feature.system.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import me.rxresu.core.navigation.Application as ApplicationRoute

class InterviewDeleteTestApp : Application(), RepositoriesProvider {
    override lateinit var repositories: RrRepositories
}

@Config(application = InterviewDeleteTestApp::class)
class InterviewDeleteUndoTest : RrScreenshotTest() {
    @get:Rule val rule = createComposeRule()
    private class DeviceClock(var now: Instant) : Clock() {
        override fun instant() = now
        override fun getZone(): ZoneId = ZoneId.of("Europe/Lisbon")
        override fun withZone(zone: ZoneId): Clock = this
    }

    @Test fun queuedDeleteUndoKeepsWorkerHeldAfterSheetDisposalAndPreservesCanonicalReminder() {
        val context = ApplicationProvider.getApplicationContext<InterviewDeleteTestApp>()
        WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancelAll()
        val clock = DeviceClock(Instant.parse("2026-11-07T09:00:00Z"))
        val repos = FakeRepositories(time = TimeSource(clock) { clock.zone })
        context.repositories = repos
        val app = runBlocking { repos.applications.getApplication(StoryboardIds.lumen) }
        val interview = app.activity.filterIsInstance<Interview>().first()
        val receipt = runBlocking {
            repos.preferences.setNotification(NotificationCategory.InterviewsAndBriefings, true)
            assertEquals(InterviewReminderResult.Scheduled, updateInterviewReminder(context, repos, app, interview, true, "storyboard-alex", "https://example.invalid"))
            repos.preferences.values.first().interviewReminders.single()
        }
        clock.now = Instant.parse(interview.at).minusSeconds(30 * 60)
        val toasts = RrToastHostState()
        lateinit var nav: NavHostController
        lateinit var typeDescription: String
        rule.setContent {
            CompositionLocalProvider(LocalRepositories provides repos, LocalToasts provides toasts) {
                RrTheme(reducedMotion = true) {
                    val label = stringResource(me.rxresu.core.strings.R.string.type)
                    val value = stringResource(me.rxresu.core.strings.R.string.kind_interview, interviewKindLabel(interview.kind))
                    typeDescription = "$label, $value"
                    nav = rememberNavController()
                    NavHost(nav, startDestination = ApplicationRoute(app.id)) { applicationsGraph(nav, RrNavMotion(true)) }
                    RrToastHost(toasts)
                }
            }
        }
        try {
            rule.runOnIdle {
                toasts.post("Earlier change", actionLabel = "Done")
                nav.navigate(InterviewSheet(app.id, interview.id))
            }
            val type = hasContentDescription(typeDescription) and hasClickAction()
            rule.waitUntil { rule.onAllNodes(type).fetchSemanticsNodes().isNotEmpty() }
            rule.onNode(type).performClick()
            rule.waitUntil { rule.onAllNodes(hasText("Delete interview") and hasClickAction()).fetchSemanticsNodes().isNotEmpty() }
            rule.onNode(hasText("Delete interview") and hasClickAction()).assertIsDisplayed().performClick()
            rule.onAllNodes(hasText("Delete interview") and hasClickAction()).onLast().performSemanticsAction(SemanticsActions.OnClick) { it() }
            rule.waitUntil { rule.runOnIdle { nav.currentDestination?.hasRoute<ApplicationRoute>() == true } }
            fun worker() = runBlocking {
                TestListenableWorkerBuilder<InterviewReminderWorker>(context).setInputData(workDataOf("receipt" to receipt.receipt)).build().doWork()
            }
            assertEquals("Earlier change", toasts.current?.message)
            assertEquals(ListenableWorker.Result.retry(), worker())
            assertEquals(0, shadowOf(manager).allNotifications.size)
            rule.onNode(hasText("Done") and hasClickAction()).performClick()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(RrMotion.D2 + 1L))
            rule.waitUntil { rule.runOnIdle { toasts.current?.message == "Interview deleted" } }
            assertEquals(ListenableWorker.Result.retry(), worker())
            rule.onNode(hasText("Undo") and hasClickAction()).performClick()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(RrMotion.D2 + 1L))
            rule.waitForIdle()
            assertEquals(interview.id, runBlocking { repos.applications.getApplication(app.id) }.activity.filterIsInstance<Interview>().single().id)
            assertEquals(listOf(receipt), runBlocking { repos.preferences.values.first() }.interviewReminders)
            assertEquals(ListenableWorker.Result.success(), worker())
            assertEquals(1, shadowOf(manager).allNotifications.size)
        } finally { repos.close() }
    }
}
