package me.rxresu.feature.system

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import androidx.work.*
import java.io.File
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.withLock
import me.rxresu.core.data.*
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.ApiException
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.Interview
import me.rxresu.core.navigation.WorkspaceTab

private const val REMINDER_WORK = "rr-interview-reminder"
private val pendingInterviewWrites = mutableMapOf<String, Int>()
private fun reminderEventKey(owner: String, origin: String, applicationId: String, entryId: String) = fingerprint("$origin:$owner:$applicationId:$entryId")
private fun InterviewReminder.eventKey() = reminderEventKey(owner, origin, applicationId, entryId)

/** A worker that already read the old event must retry until its local write and receipt transition settle. */
suspend fun <T> withInterviewReminderChange(owner: String, origin: String, applicationId: String, entryId: String?, change: suspend () -> T): T {
    if (entryId == null) return change()
    val key = reminderEventKey(owner, origin, applicationId, entryId)
    notificationGate.withLock { pendingInterviewWrites[key] = (pendingInterviewWrites[key] ?: 0) + 1 }
    try { return change() } finally {
        kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) {
            notificationGate.withLock {
                val remaining = pendingInterviewWrites.getValue(key) - 1
                if (remaining == 0) pendingInterviewWrites.remove(key) else pendingInterviewWrites[key] = remaining
            }
        }
    }
}
enum class InterviewReminderResult { Scheduled, Off, Denied, Passed }

/** Backup restoration must not opt a second device into reminders. */
fun interviewReminderDevice(context: Context): String = synchronized(InterviewReminderWorker::class.java) {
    val file = File(context.noBackupFilesDir, "interview-reminder-device")
    if (!file.exists()) file.writeText(UUID.randomUUID().toString())
    file.readText()
}
private fun InterviewReminder.workName() = "$REMINDER_WORK:${eventKey()}:$receipt"
private fun InterviewReminder.notificationKey() = "$REMINDER_WORK:$receipt"
internal fun InterviewReminder.fireAt(): Instant = Instant.parse(at).minusSeconds(leadMinutes * 60)
private fun RrRepositories.owns(reminder: InterviewReminder) = signedInOwner() == reminder.owner && authSession.origin.value == reminder.origin
private fun InterviewReminder.onDevice(context: Context) = device == interviewReminderDevice(context)
private fun reminderPermission(context: Context): Boolean = notificationsPermitted(context) &&
    context.getSystemService(android.app.NotificationManager::class.java).getNotificationChannel(NotificationCategory.InterviewsAndBriefings.name)?.importance != android.app.NotificationManager.IMPORTANCE_NONE
private fun canonicalInterview(app: Application, id: String): Interview? =
    app.takeIf { it.status != ApplicationStage.Closed && it.trashedAt == null }?.activity?.filterIsInstance<Interview>()?.firstOrNull { it.id == id }

private suspend fun RrRepositories.reminderApplication(reminder: InterviewReminder): Application? = try {
    applications.getApplication(reminder.applicationId, RequestOptions(accountScope = reminder.owner))
} catch (e: ApiException) { if (e.status == 404) null else throw e }

private suspend fun enqueue(context: Context, reminder: InterviewReminder, now: Instant) {
    WorkManager.getInstance(context).enqueueUniqueWork(reminder.workName(), ExistingWorkPolicy.KEEP,
        OneTimeWorkRequestBuilder<InterviewReminderWorker>()
            .setInitialDelay(Duration.between(now, reminder.fireAt()).toMillis().coerceAtLeast(0), TimeUnit.MILLISECONDS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .addTag(REMINDER_WORK)
            .setInputData(workDataOf("receipt" to reminder.receipt)).build()).await()
}

/** Called only after a confirmed interview save. The gate also protects delivery from an in-flight replacement. */
suspend fun updateInterviewReminder(context: Context, repositories: RrRepositories, app: Application, entry: Interview,
    enabled: Boolean, owner: String, origin: String): InterviewReminderResult = notificationGate.withLock {
    check(repositories.signedInOwner() == owner && repositories.authSession.origin.value == origin)
    val previous = repositories.preferences.values.first().interviewReminders.firstOrNull {
        it.owner == owner && it.origin == origin && it.onDevice(context) && it.applicationId == app.id && it.entryId == entry.id
    }
    val reminder = InterviewReminder(owner, origin, interviewReminderDevice(context), app.id, entry.id, entry.at,
        previous?.leadMinutes ?: 1440, UUID.randomUUID().toString())
    if (!enabled || canonicalInterview(app, entry.id) == null || !reminder.fireAt().isAfter(repositories.time.now())) {
        previous?.let { removeReminder(context, repositories, it) }
        return@withLock if (enabled) InterviewReminderResult.Passed else InterviewReminderResult.Off
    }
    if (!reminderPermission(context) || NotificationCategory.InterviewsAndBriefings !in repositories.preferences.values.first().notifications)
        return@withLock InterviewReminderResult.Denied
    enqueue(context, reminder, repositories.time.now())
    check(repositories.owns(reminder))
    repositories.preferences.setInterviewReminder(reminder, true)
    previous?.let { WorkManager.getInstance(context).cancelUniqueWork(it.workName()); NotificationManagerCompat.from(context).cancel(notificationId(it.notificationKey())) }
    InterviewReminderResult.Scheduled
}

private suspend fun removeReminder(context: Context, repositories: RrRepositories, reminder: InterviewReminder) {
    repositories.preferences.setInterviewReminder(reminder, false)
    WorkManager.getInstance(context).cancelUniqueWork(reminder.workName())
    NotificationManagerCompat.from(context).cancel(notificationId(reminder.notificationKey()))
}

/** Scope/category cleanup uses the same gate as notification delivery. */
internal suspend fun reconcileInterviewReminderJobs(context: Context, repositories: RrRepositories) = notificationGate.withLock {
    val prefs = repositories.preferences.values.first()
    prefs.interviewReminders.forEach { reminder ->
        if (!repositories.owns(reminder) || !reminder.onDevice(context)) removeReminder(context, repositories, reminder)
        else if (NotificationCategory.InterviewsAndBriefings !in prefs.notifications || !reminderPermission(context)) {
            WorkManager.getInstance(context).cancelUniqueWork(reminder.workName())
            NotificationManagerCompat.from(context).cancel(notificationId(reminder.notificationKey()))
        } else if (reminder.fireAt().isAfter(repositories.time.now())) enqueue(context, reminder, repositories.time.now())
    }
}

/** Re-fetch each canonical event, so web edits and committed deletes move/cancel this device reminder too. */
suspend fun syncInterviewReminders(context: Context, repositories: RrRepositories, owner: String, origin: String) {
    for (reminder in repositories.preferences.values.first().interviewReminders.filter { it.owner == owner && it.origin == origin && it.onDevice(context) }) {
        val app = repositories.reminderApplication(reminder)
        notificationGate.withLock {
            if (!repositories.owns(reminder) || reminder.eventKey() in pendingInterviewWrites || repositories.preferences.values.first().interviewReminders.none { it == reminder }) return@withLock
            val entry = app?.let { canonicalInterview(it, reminder.entryId) }
            if (entry == null) removeReminder(context, repositories, reminder)
            else if (entry.at != reminder.at) {
                val replacement = reminder.copy(at = entry.at, receipt = UUID.randomUUID().toString())
                if (replacement.fireAt().isAfter(repositories.time.now())) {
                    enqueue(context, replacement, repositories.time.now())
                    repositories.preferences.setInterviewReminder(replacement, true)
                    WorkManager.getInstance(context).cancelUniqueWork(reminder.workName())
                    NotificationManagerCompat.from(context).cancel(notificationId(reminder.notificationKey()))
                } else removeReminder(context, repositories, reminder)
            }
        }
    }
}

/** WorkManager may deliver late; canonical account data is required before posting anything private. */
class InterviewReminderWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val repositories = (applicationContext as RepositoriesProvider).repositories
        val receipt = inputData.getString("receipt") ?: return Result.failure()
        val reminder = notificationGate.withLock {
            repositories.preferences.values.first().interviewReminders.firstOrNull { it.receipt == receipt }?.also {
                if (it.eventKey() in pendingInterviewWrites) return Result.retry()
            }
        } ?: return Result.success()
        if (!repositories.owns(reminder) || !reminder.onDevice(applicationContext)) return Result.success()
        return try {
            val app = repositories.reminderApplication(reminder)
            notificationGate.withLock { if (reminder.eventKey() in pendingInterviewWrites) return Result.retry() }
            val entry = app?.let { canonicalInterview(it, reminder.entryId) }
            if (entry == null || entry.at != reminder.at) {
                syncInterviewReminders(applicationContext, repositories, reminder.owner, reminder.origin)
                return Result.success()
            }
            notificationGate.withLock {
                val prefs = repositories.preferences.values.first()
                if (reminder.eventKey() in pendingInterviewWrites) return Result.retry()
                if (!repositories.owns(reminder) || reminder !in prefs.interviewReminders || NotificationCategory.InterviewsAndBriefings !in prefs.notifications || !reminderPermission(applicationContext)) return@withLock
                val now = repositories.time.now()
                if (!Instant.parse(entry.at).isAfter(now) || reminder.fireAt().isAfter(now)) return@withLock
                val ledger = NotificationLedger(applicationContext, "interview:${reminder.origin}:${reminder.owner}")
                val key = fingerprint(reminder.notificationKey())
                val currentApp = checkNotNull(app)
                if (!ledger.contains(key)) {
                    createChannels(applicationContext)
                    postNotification(applicationContext, NotificationSpec(reminder.notificationKey(), NotificationCategory.InterviewsAndBriefings,
                        applicationContext.getString(R.string.system_upcoming_interview_with_1_s_c05c80, currentApp.company),
                        listOf(currentApp.role, entry.at).joinToString(" · "), SystemTarget("application", currentApp.id, WorkspaceTab.Prepare)), reminder.owner)
                    ledger.add(key)
                }
            }
            Result.success()
        } catch (e: CancellationException) { throw e } catch (_: Exception) { if (runAttemptCount < 3) Result.retry() else Result.failure() }
    }
}
