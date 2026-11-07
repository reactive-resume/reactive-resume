package me.rxresu.feature.system

import androidx.compose.ui.res.stringResource
import me.rxresu.core.strings.R as CoreStrings

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import java.security.MessageDigest
import me.rxresu.core.data.*
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.*
import kotlinx.serialization.json.*
import me.rxresu.core.designsystem.R as Icons

/** S3 calls this only after the person enables a notification category. No prompt at startup. */
@Composable fun rememberNotificationPermissionRequest(onResult: (Boolean) -> Unit): () -> Unit {
    val context = androidx.compose.ui.platform.LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission(), onResult)
    return remember(context, launcher, onResult) { {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        else onResult(NotificationManagerCompat.from(context).areNotificationsEnabled())
    } }
}
fun notificationsPermitted(context: Context): Boolean = (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) && NotificationManagerCompat.from(context).areNotificationsEnabled()

internal data class NotificationAction(val label: String, val target: SystemTarget, val logFollowUp: Boolean = false)
internal data class NotificationSpec(val key: String, val category: NotificationCategory, val title: String, val body: String, val target: SystemTarget, val actions: List<NotificationAction> = emptyList())
internal data class FeedbackUpdate(val resumeId: String, val comments: List<ResolveFeedbackCommentResponse>)
internal fun fingerprint(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
internal fun notificationId(key: String): Int = key.hashCode() and Int.MAX_VALUE

/** Same Today inputs as T1 and the widget. No account data is fetched by the notification builder. */
internal fun notificationSpecs(context: Context, today: TodaySnapshot, notices: List<CareerNotification>, feedback: List<FeedbackUpdate>): List<NotificationSpec> = buildList {
    val seen = mutableSetOf<String>()
    notices.filter { it.readAt == null }.forEach { notice ->
        val type = ApiJson.encodeToJsonElement(notice.notice).jsonObject["type"]?.jsonPrimitive?.contentOrNull
        val target = when (type) {
            "briefing", "briefing-paused" -> notice.applicationId?.let { SystemTarget("application", it, WorkspaceTab.Prepare) }
            "followup" -> notice.applicationId?.let { SystemTarget("application", it, WorkspaceTab.Messages) }
            "opportunities" -> SystemTarget("today")
            else -> SystemTarget("today")
        } ?: SystemTarget("today")
        val category = when (type) { "opportunities" -> NotificationCategory.NewRoles; "briefing", "briefing-paused" -> NotificationCategory.InterviewsAndBriefings; else -> NotificationCategory.FollowUpsAndOfferDeadlines }
        add(NotificationSpec("notice:${notice.id}", category, notice.title, notice.body, target, notificationActions(context, type, target)))
        notice.applicationId?.let { seen += "$type:$it" }
    }
    today.needsYou.forEach { item ->
        val target: SystemTarget; val category: NotificationCategory; val title: String; val type: String
        when (item.kind) {
            TodayKind.Briefing -> { type = "briefing"; category = NotificationCategory.InterviewsAndBriefings; title = context.getString(R.string.system_briefing_ready_for_1_s_afbb73, item.company); target = SystemTarget("application", item.applicationId, WorkspaceTab.Prepare) }
            TodayKind.Interview -> { type = "interview"; category = NotificationCategory.InterviewsAndBriefings; title = context.getString(R.string.system_upcoming_interview_with_1_s_c05c80, item.company); target = SystemTarget("application", item.applicationId, WorkspaceTab.Prepare) }
            TodayKind.Offer -> { type = "offer"; category = NotificationCategory.FollowUpsAndOfferDeadlines; title = context.getString(R.string.system_reply_to_the_offer_from_1_s_6eed69, item.company); target = SystemTarget("offers") }
            TodayKind.FollowUp -> { type = "followup"; category = NotificationCategory.FollowUpsAndOfferDeadlines; title = context.getString(R.string.system_follow_up_with_1_s_35e9a9, item.company); target = SystemTarget("application", item.applicationId, WorkspaceTab.Messages) }
            TodayKind.Notification -> return@forEach
        }
        if ("$type:${item.applicationId}" in seen || item.notificationId != null) return@forEach
        val body = if (item.kind == TodayKind.FollowUp) context.getString(R.string.system_a_short_follow_up_is_usually_fine_now_c18ffa) else listOfNotNull(item.title, item.at).joinToString(" · ")
        add(NotificationSpec("${item.id}:${item.at.orEmpty()}", category, title, body, target, notificationActions(context, type, target)))
    }
    if (today.newRoles.isNotEmpty() && notices.none { it.readAt == null && it.notice is ExportAccountDataResponseCareerNotificationsItemNoticeOpportunities }) {
        add(NotificationSpec("roles:" + fingerprint(today.newRoles.map { it.id }.sorted().joinToString()), NotificationCategory.NewRoles,
            context.getString(R.string.system_1_s_new_roles_from_your_search_00db7b, today.newRoles.size.toString()), context.getString(R.string.system_nothing_is_applied_for_until_you_choose_f56046), SystemTarget("today")))
    }
    feedback.forEach { update -> update.comments.filter { it.resolvedAt == null }.forEach { comment ->
        add(NotificationSpec("comment:${comment.id}", NotificationCategory.FeedbackComments, context.getString(R.string.system_new_feedback_from_1_s_98af5c, comment.authorName), comment.body, SystemTarget("visitors", update.resumeId)))
    } }
}.distinctBy { it.key }

private fun notificationActions(context: Context, type: String?, target: SystemTarget): List<NotificationAction> = when (type) {
    "briefing" -> listOf(NotificationAction(context.getString(R.string.system_open_briefing_86356b), target), NotificationAction(context.getString(R.string.system_practice_3e15ac), target.copy(tab = WorkspaceTab.Practise)))
    "followup" -> listOf(NotificationAction(context.getString(R.string.system_draft_follow_up_d428c9), target), NotificationAction(context.getString(R.string.system_log_follow_up_8c2613), target, logFollowUp = true))
    else -> emptyList()
}
internal fun channelName(context: Context, category: NotificationCategory): String = when (category) {
    NotificationCategory.InterviewsAndBriefings -> context.getString(R.string.system_interviews_and_briefings_cac9e0)
    NotificationCategory.FollowUpsAndOfferDeadlines -> context.getString(R.string.system_follow_ups_and_offer_deadlines_92ed7f)
    NotificationCategory.NewRoles -> context.getString(R.string.system_new_roles_43b8bc)
    NotificationCategory.FeedbackComments -> context.getString(R.string.system_feedback_comments_723073)
}
internal fun createChannels(context: Context) {
    context.getSystemService(NotificationManager::class.java).createNotificationChannels(NotificationCategory.entries.map { category -> NotificationChannel(category.name, channelName(context, category), NotificationManager.IMPORTANCE_DEFAULT) })
}
internal fun buildNotification(context: Context, spec: NotificationSpec, owner: String): Notification {
    val id = notificationId(spec.key)
    val content = PendingIntent.getActivity(context, id, targetIntent(context, spec.target), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder = NotificationCompat.Builder(context, spec.category.name)
        .setSmallIcon(Icons.drawable.ic_ph_files).setContentTitle(spec.title).setContentText(spec.body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(spec.body)).setContentIntent(content).setAutoCancel(true)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setOnlyAlertOnce(true)
        .setPublicVersion(NotificationCompat.Builder(context, spec.category.name).setSmallIcon(Icons.drawable.ic_ph_files).setContentTitle(context.getString(R.string.system_reactive_resume_e5b371)).build())
    spec.actions.forEachIndexed { index, action ->
        val intent = if (action.logFollowUp) Intent(context, LogFollowUpReceiver::class.java).setAction("log:$id")
            .putExtra("owner", owner).putExtra("applicationId", action.target.id).putExtra("notificationId", id).putExtra("key", fingerprint(spec.key))
        else targetIntent(context, action.target)
        val pending = if (action.logFollowUp) PendingIntent.getBroadcast(context, id + index + 1, intent, PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE)
        else PendingIntent.getActivity(context, id + index + 1, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        builder.addAction(NotificationCompat.Action.Builder(0, action.label, pending).build())
    }
    return builder.build()
}
@SuppressLint("MissingPermission") // Checked immediately before posting; the caller also checks account identity.
internal fun postNotification(context: Context, spec: NotificationSpec, owner: String) {
    if (notificationsPermitted(context)) NotificationManagerCompat.from(context).notify(notificationId(spec.key), buildNotification(context, spec, owner))
}
