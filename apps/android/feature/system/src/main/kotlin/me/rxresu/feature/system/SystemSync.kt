package me.rxresu.feature.system


import androidx.compose.ui.res.stringResource
import me.rxresu.core.strings.R as CoreStrings

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.work.*
import androidx.glance.appwidget.updateAll
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.*
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.designsystem.R as Icons

private const val SYNC_WORK = "rr-system-sync"
private val notificationGate = Mutex()
internal fun RrRepositories.signedInOwner(): String? = (account.session.value as? SessionState.SignedIn)?.accountScope

/** Lead calls once with the application scope. Session/category changes clear old notifications and refresh widgets. */
fun startSystemIntegrations(context: Context, scope: CoroutineScope): Job = scope.launch {
    val app = context.applicationContext
    val repositories = (app as RepositoriesProvider).repositories
    installLauncherShortcuts(app)
    createChannels(app)
    var previousOwner: String? = null
    combine(repositories.account.session, repositories.preferences.values, repositories.authSession.origin) { session, preferences, origin -> Triple(session, preferences, origin) }.collect { (session, preferences, origin) ->
        val owner = (session as? SessionState.SignedIn)?.accountScope
        notificationGate.withLock {
            val manager = NotificationManagerCompat.from(app)
            val identity = owner?.let { "$origin:$it" }
            if (identity != previousOwner) { manager.cancelAll(); previousOwner = identity }
            else app.getSystemService(android.app.NotificationManager::class.java).activeNotifications
                .filter { item -> preferences.notifications.none { it.name == item.notification.channelId } }.forEach { manager.cancel(it.id) }
        }
        if (owner == null) {
            WorkManager.getInstance(app).cancelUniqueWork(SYNC_WORK)
            WorkManager.getInstance(app).cancelUniqueWork("$SYNC_WORK-now")
        } else {
            scheduleSystemSync(app, owner, repositories.authSession.origin.value)
            WorkManager.getInstance(app).enqueueUniqueWork("$SYNC_WORK-now", ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<SystemSyncWorker>().setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .setInputData(workDataOf("owner" to owner, "origin" to repositories.authSession.origin.value)).build())
        }
        // Widget content reads the current session, including expired guest sessions.
        TodayWidget().updateAll(app)
        NextInterviewWidget().updateAll(app)
    }
}

/** One unique 15-minute sync. UPDATE retains timing and never interrupts a running sync. */
fun scheduleSystemSync(context: Context, owner: String, origin: String) {
    WorkManager.getInstance(context).enqueueUniquePeriodicWork(SYNC_WORK, ExistingPeriodicWorkPolicy.UPDATE,
        PeriodicWorkRequestBuilder<SystemSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(workDataOf("owner" to owner, "origin" to origin)).build())
}

/** Plain constructor works with the draft-sync factory's null -> default reflection fallback. */
class SystemSyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    companion object { private val syncMutex = Mutex() }
    override suspend fun doWork(): Result = syncMutex.withLock { sync() }
    private suspend fun sync(): Result {
        val repositories = (applicationContext as RepositoriesProvider).repositories
        val owner = inputData.getString("owner") ?: return Result.failure()
        val origin = inputData.getString("origin") ?: return Result.failure()
        fun current() = repositories.signedInOwner() == owner && repositories.authSession.origin.value == origin
        if (!current()) return Result.success()
        return try {
            val prefs = repositories.preferences.values.first()
            repositories.today.refresh()
            val resource = withTimeout(60_000) { repositories.today.observe(prefs.notifications.isNotEmpty()).first { !it.loading } }
            val today = resource.data?.takeIf { !resource.offline && resource.error == null } ?: return Result.retry()
            val options = RequestOptions(accountScope = owner)
            val notices = repositories.career.listCareerNotifications(options)
            val feedback = if (NotificationCategory.FeedbackComments in prefs.notifications) repositories.resumes.listFeedbackLinks(options = options)
                .filter { it.status.wireValue == "active" && it.commentCount > 0 }.map { link ->
                    FeedbackUpdate(link.resumeId, repositories.resumes.getFeedbackLink(link.id, options).comments)
                } else emptyList()
            if (!current()) return Result.success()
            val enabled = repositories.preferences.values.first().notifications
            val specs = notificationSpecs(applicationContext, today, notices, feedback).filter { it.category in enabled }
            val ledger = NotificationLedger(applicationContext, "$origin:$owner")
            val active = specs.map { notificationId(it.key) }.toSet()
            ledger.active().filter { it !in active }.forEach { NotificationManagerCompat.from(applicationContext).cancel(it) }
            createChannels(applicationContext)
            for (spec in specs) {
                if (!current()) return Result.success()
                if (!notificationsPermitted(applicationContext)) break
                val key = fingerprint(spec.key)
                notificationGate.withLock {
                    if (current() && spec.category in repositories.preferences.values.first().notifications && !ledger.contains(key)) { postNotification(applicationContext, spec, owner); ledger.add(key) }
                }
            }
            ledger.active(active)
            if (current()) { TodayWidget().updateAll(applicationContext); NextInterviewWidget().updateAll(applicationContext) }
            Result.success()
        } catch (e: CancellationException) { throw e } catch (_: Exception) { if (runAttemptCount < 3) Result.retry() else Result.failure() }
    }
}

/** Account-scoped, backup-excluded hashes; never stores notification bodies or personal data. */
internal class NotificationLedger(context: Context, owner: String) {
    private val file = File(context.noBackupFilesDir, "notifications/${fingerprint(owner)}").apply { parentFile?.mkdirs() }
    private fun read(): LinkedHashSet<String> = if (file.isFile) file.readLines().toCollection(linkedSetOf()) else linkedSetOf()
    fun contains(key: String): Boolean = key in read()
    fun add(key: String) { val entries = read(); entries += key; write(entries.toList().takeLast(2000)) }
    private fun write(values: List<String>) {
        val temp = File(file.parentFile, file.name + ".part")
        temp.outputStream().use { it.write(values.joinToString("\n").toByteArray()); it.fd.sync() }
        check(temp.renameTo(file))
    }
    fun active(): Set<Int> = read().filter { it.startsWith("active:") }.mapNotNull { it.substringAfter(':').toIntOrNull() }.toSet()
    fun active(ids: Set<Int>) { write(read().filterNot { it.startsWith("active:") } + ids.map { "active:$it" }) }
}

fun installLauncherShortcuts(context: Context) {
    fun shortcut(rank: Int, id: String, label: String, action: String, icon: Int) = ShortcutInfoCompat.Builder(context, id).setShortLabel(label).setRank(rank)
        .setIcon(IconCompat.createWithResource(context, icon)).setIntent(Intent(action).setClassName(context.packageName, "me.rxresu.MainActivity")).build()
    ShortcutManagerCompat.setDynamicShortcuts(context, listOf(
        shortcut(0, "save-job", context.getString(R.string.system_save_a_job_aacbba), ACTION_SAVE_JOB, Icons.drawable.ic_ph_briefcase),
        shortcut(1, "new-resume", context.getString(R.string.system_new_resume_8b70e5), ACTION_NEW_RESUME, Icons.drawable.ic_ph_file_plus),
        shortcut(2, "search", context.getString(R.string.system_search_bce064), ACTION_SEARCH, Icons.drawable.ic_ph_magnifying_glass),
    ))
}

class LogFollowUpReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val owner = intent.getStringExtra("owner") ?: return
        val application = intent.getStringExtra("applicationId") ?: return
        val key = intent.getStringExtra("key") ?: return
        val repositories = (context.applicationContext as RepositoriesProvider).repositories
        if (repositories.signedInOwner() != owner) return
        WorkManager.getInstance(context).enqueueUniqueWork("rr-log-followup:$key", ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<LogFollowUpWorker>().setInputData(workDataOf("owner" to owner, "origin" to repositories.authSession.origin.value, "application" to application, "key" to key, "notificationId" to intent.getIntExtra("notificationId", 0))).build())
    }
}
class LogFollowUpWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val repositories = (applicationContext as RepositoriesProvider).repositories
        val owner = inputData.getString("owner") ?: return Result.failure()
        val origin = inputData.getString("origin") ?: return Result.failure()
        val application = inputData.getString("application") ?: return Result.failure()
        val key = inputData.getString("key") ?: return Result.failure()
        if (repositories.signedInOwner() != owner || repositories.authSession.origin.value != origin) return Result.success()
        val ledger = NotificationLedger(applicationContext, "action:$origin:$owner")
        if (ledger.contains(key)) return Result.success()
        // The endpoint appends a timeline event. Claim before the request; a lost answer must never duplicate it.
        ledger.add(key)
        return try {
            repositories.applications.logApplicationFollowUp(application, RequestOptions(accountScope = owner))
            NotificationManagerCompat.from(applicationContext).cancel(inputData.getInt("notificationId", 0))
            repositories.today.refresh(); TodayWidget().updateAll(applicationContext)
            Result.success()
        } catch (e: CancellationException) { throw e } catch (_: Exception) {
            if (repositories.signedInOwner() == owner && repositories.authSession.origin.value == origin) {
                postNotification(applicationContext, NotificationSpec("log-failed:$key", NotificationCategory.FollowUps,
                    contextMessage(applicationContext), applicationContext.getString(R.string.system_open_the_application_to_check_its_timeline_before_trying_aga_7d37f3), SystemTarget("application", application, me.rxresu.core.navigation.WorkspaceTab.Messages)), owner)
            }
            Result.failure()
        }
    }
}

private fun contextMessage(context: Context) = context.getString(R.string.system_couldn_t_log_follow_up_check_the_application_65ab96)
