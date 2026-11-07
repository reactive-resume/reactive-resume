package me.rxresu.feature.system

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.work.ListenableWorker
import androidx.work.workDataOf
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.test.core.app.ApplicationProvider
import java.io.File
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.flow.first
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.*
import me.rxresu.core.navigation.*
import me.rxresu.core.network.generated.*
import me.rxresu.core.network.generated.Application as ApplicationDto
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

class RepositoryTestApp : Application(), RepositoriesProvider { override lateinit var repositories: RrRepositories }

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = RepositoryTestApp::class)
class SystemTests {
    private val context get() = ApplicationProvider.getApplicationContext<RepositoryTestApp>()
    @Before fun setup() { File(context.noBackupFilesDir, "notifications").deleteRecursively() }
    @Test fun textShareFindsFirstUrlAndNeverSavesAnything() {
        assertEquals(SaveJob("https://example.invalid/job"), systemRouteFor(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "A role https://example.invalid/job). More https://else.invalid")))
        assertNull(systemRouteFor(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "No link here")))
        assertEquals(SaveJob("https://example.invalid/styled"), systemRouteFor(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, android.text.SpannableString("https://example.invalid/styled"))))
    }
    @Test fun twoPdfAliasesRouteIndependentlyWithContentUriOnly() {
        fun share(alias: String, uri: String) = Intent(Intent.ACTION_SEND).setType("application/pdf").setComponent(ComponentName("me.rxresu.debug", "me.rxresu.feature.system.$alias")).putExtra(Intent.EXTRA_STREAM, Uri.parse(uri))
        assertEquals(AtsChecker("content://documents/file"), systemRouteFor(share("CheckPdf", "content://documents/file")))
        assertEquals(Import("content://documents/file"), systemRouteFor(share("ImportResume", "content://documents/file")))
        assertNull(systemRouteFor(share("CheckPdf", "file:///private/file.pdf")))
        assertNull(systemRouteFor(share("Unknown", "content://documents/file")))
    }
    @Test fun clipDataGrantAndMalformedLinksAreHandled() {
        val send = Intent(Intent.ACTION_SEND).setType("application/pdf").setComponent(ComponentName("me.rxresu", "me.rxresu.feature.system.CheckPdf"))
        send.clipData = ClipData.newRawUri("PDF", Uri.parse("content://documents/file"))
        assertEquals(AtsChecker("content://documents/file"), systemRouteFor(send))
        assertNull(systemRouteFor(Intent(Intent.ACTION_VIEW, Uri.parse("https://rxresu.me/%ZZ/b"))))
        assertNull(systemRouteFor(Intent(Intent.ACTION_VIEW, Uri.parse("https://rxresu.me/auth/native-callback"))))
        assertEquals(Builder("abc"), systemRouteFor(Intent(Intent.ACTION_VIEW, Uri.parse("https://rxresu.me/builder/abc"))))
        assertEquals(PublicResume("https://rx.cv/alex"), systemRouteFor(Intent(Intent.ACTION_VIEW, Uri.parse("https://rx.cv/alex"))))
    }
    @Test fun shortcutsUseInstalledPackageIncludingDebugAndTargetCorrectRoutes() {
        installLauncherShortcuts(context)
        val shortcuts = ShortcutManagerCompat.getDynamicShortcuts(context)
        assertEquals(3, shortcuts.size)
        assertTrue(shortcuts.all { it.intent.component?.packageName == context.packageName })
        assertEquals(NewDocument, systemRouteFor(shortcuts.first { it.id == "new-resume" }.intent))
        assertEquals(Search(), systemRouteFor(shortcuts.first { it.id == "search" }.intent))
    }
    @Test fun notificationTargetsHaveCorrectWorkspaceAndCategories() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        val today = repositories.today.observe().firstReady()
        val feedback = FeedbackUpdate(StoryboardIds.resume, listOf(ResolveFeedbackCommentResponse("Reviewer", "Looks good", "2026-11-07T10:00:00Z", "comment-1", "link-1")))
        val specs = notificationSpecs(context, today, emptyList(), listOf(feedback))
        assertTrue(specs.any { it.category == NotificationCategory.InterviewsAndBriefings && it.target.tab == WorkspaceTab.Prepare })
        assertTrue(specs.any { it.category == NotificationCategory.FollowUpsAndOfferDeadlines && it.target.kind == "offers" })
        assertEquals(Visitors(StoryboardIds.resume), systemRouteFor(targetIntent(context, specs.first { it.category == NotificationCategory.FeedbackComments }.target)))
        assertTrue(specs.first { it.target.tab == WorkspaceTab.Messages }.actions.any { it.logFollowUp })
        assertEquals(specs.size, specs.distinctBy { it.key }.size); repositories.close()
    }
    @Test fun channelsMatchPreferencesAndNotificationsHideLockscreenDetails() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        createChannels(context)
        val manager = context.getSystemService(NotificationManager::class.java)
        NotificationCategory.entries.forEach { assertNotNull(manager.getNotificationChannel(it.name)) }
        val spec = notificationSpecs(context, repositories.today.observe().firstReady(), emptyList(), emptyList()).first()
        val notification = buildNotification(context, spec, "storyboard-alex")
        assertEquals(android.app.Notification.VISIBILITY_PRIVATE, notification.visibility)
        assertNotNull(notification.publicVersion)
        assertFalse(notification.publicVersion.extras.toString().contains(spec.body)); repositories.close()
    }
    @Test fun schedulingUpdatesOneConnectedPeriodicWorker() {
        androidx.work.testing.WorkManagerTestInitHelper.initializeTestWorkManager(context,
            androidx.work.Configuration.Builder().setExecutor(androidx.work.testing.SynchronousExecutor()).build())
        val manager = androidx.work.WorkManager.getInstance(context)
        scheduleSystemSync(context, "first", "https://example.invalid")
        val first = manager.getWorkInfosForUniqueWork("rr-system-sync").get().single()
        assertEquals(androidx.work.NetworkType.CONNECTED, first.constraints.requiredNetworkType)
        scheduleSystemSync(context, "second", "https://other.invalid")
        val updated = manager.getWorkInfosForUniqueWork("rr-system-sync").get().single()
        assertEquals(first.id, updated.id)
        assertEquals(androidx.work.WorkInfo.State.ENQUEUED, updated.state)
        manager.cancelAllWork().result.get()
    }
    @Test fun signedOutWorkerNeverReadsAccountData() = runTest {
        val controls = FakeControls(FakeMode.Loading); val session = FakeAuthSession().apply { state.value = SessionState.SignedOut }
        context.repositories = FakeRepositories(controls, authSession = session, coroutineScope = backgroundScope)
        val worker = TestListenableWorkerBuilder<SystemSyncWorker>(context).setInputData(workDataOf("owner" to "storyboard-alex", "origin" to "https://example.invalid")).build()
        assertEquals(ListenableWorker.Result.success(), worker.doWork()); context.repositories.close()
    }
    @Test fun enabledCategoryAndPersistentLedgerPreventDuplicateNotifications() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope); context.repositories = repositories
        NotificationCategory.entries.forEach { repositories.preferences.setNotification(it, true) }
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        suspend fun sync(): ListenableWorker.Result = TestListenableWorkerBuilder<SystemSyncWorker>(context).setInputData(workDataOf("owner" to "storyboard-alex", "origin" to "https://example.invalid")).build().doWork()
        assertEquals(ListenableWorker.Result.success(), sync())
        val manager = context.getSystemService(NotificationManager::class.java)
        val first = shadowOf(manager).allNotifications.toList()
        assertTrue(first.isNotEmpty())
        assertEquals(ListenableWorker.Result.success(), sync())
        assertEquals(first.size, shadowOf(manager).allNotifications.size)
        NotificationCategory.entries.forEach { repositories.preferences.setNotification(it, false) }
        sync(); assertTrue(shadowOf(manager).allNotifications.isEmpty()); repositories.close()
    }
    @Test fun followUpActionAppendsAtMostOnceAndAccountSwitchBlocksIt() = runTest {
        val session = FakeAuthSession(); val repositories = FakeRepositories(authSession = session, coroutineScope = backgroundScope); context.repositories = repositories
        val before = repositories.applications.getApplication(StoryboardIds.fieldnote).activity.size
        suspend fun log(key: String) = TestListenableWorkerBuilder<LogFollowUpWorker>(context).setInputData(workDataOf("owner" to "storyboard-alex", "origin" to "https://example.invalid", "application" to StoryboardIds.fieldnote, "key" to key)).build().doWork()
        assertEquals(ListenableWorker.Result.success(), log("action-1")); log("action-1")
        assertEquals(before + 1, repositories.applications.getApplication(StoryboardIds.fieldnote).activity.size)
        session.state.value = SessionState.SignedOut; log("action-2")
        assertEquals(before + 1, repositories.applications.getApplication(StoryboardIds.fieldnote).activity.size); repositories.close()
    }
}
private suspend fun kotlinx.coroutines.flow.Flow<Resource<TodaySnapshot>>.firstReady(): TodaySnapshot = first { !it.loading && it.data != null }.data!!
