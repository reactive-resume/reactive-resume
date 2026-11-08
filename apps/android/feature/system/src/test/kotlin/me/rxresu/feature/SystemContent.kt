package me.rxresu.feature.system

import androidx.compose.ui.res.stringResource
import me.rxresu.core.strings.R as CoreStrings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import me.rxresu.core.data.*
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as Icons

/** X1 shows content only. Android owns real notification and launcher chrome; Glance owns widget views. */
@Composable internal fun SystemContent(specs: List<NotificationSpec>, today: TodaySnapshot, time: TimeSource) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        RrText(stringResource(R.string.system_notifications_content_only_the_system_draws_the_frame_d23a73), style = RrType.eyebrow, color = RrTheme.colors.ink3)
        specs.take(3).forEach { spec ->
            RrCard(raised = true, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    RrText(stringResource(R.string.system_reactive_resume_e5b371) + " · " + when (spec.category) { NotificationCategory.InterviewsAndBriefings -> stringResource(R.string.system_interviews_9d20cd); NotificationCategory.FollowUpsAndOfferDeadlines -> stringResource(R.string.system_follow_ups_c0e67b); NotificationCategory.FollowUps -> stringResource(R.string.system_follow_ups_c0e67b); NotificationCategory.OfferDeadlines -> stringResource(R.string.system_offer_deadlines); NotificationCategory.NewRoles -> stringResource(R.string.system_new_roles_43b8bc); NotificationCategory.FeedbackComments -> stringResource(R.string.system_feedback_comments_723073) }, style = RrType.caption, color = RrTheme.colors.ink3)
                    RrText(spec.title, style = RrType.label)
                    RrText(spec.body, style = RrType.small, color = RrTheme.colors.ink2)
                    if (spec.actions.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { spec.actions.forEach { action -> RrButton(action.label, {}, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small) } }
                }
            }
        }
        RrText(stringResource(R.string.system_today_widget_medium_and_small_162f12), Modifier.padding(top = 6.dp), style = RrType.eyebrow, color = RrTheme.colors.ink3)
        RrCard(raised = true, contentPadding = PaddingValues(14.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) { RrText(stringResource(R.string.system_today_24345a), style = RrType.sheetTitle); RrText(stringResource(R.string.system_1_s_need_you_b08acb, today.needsYou.size.toString()), style = RrType.caption, color = RrTheme.colors.ink3) }
                today.needsYou.take(3).forEach { item -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    RrStageDot(when (item.kind) { TodayKind.Interview, TodayKind.Briefing -> RrStage.Interview; TodayKind.Offer -> RrStage.Offer; else -> RrStage.Saved })
                    RrText(listOf(item.company, item.title).filter(String::isNotBlank).joinToString(" · "), Modifier.weight(1f), style = RrType.ui)
                    RrText(widgetTime(item, time), style = RrType.mono)
                } }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val next = today.needsYou.firstOrNull { it.kind == TodayKind.Interview || it.kind == TodayKind.Briefing }
            RrCard(Modifier.width(150.dp).heightIn(min = 150.dp), raised = true, contentPadding = PaddingValues(14.dp)) {
                RrText(stringResource(R.string.system_next_interview_363cbe), style = RrType.caption, color = RrTheme.colors.ink3); Spacer(Modifier.weight(1f))
                if (next != null) { RrText(widgetTime(next, time), style = RrType.sheetTitle); RrText(next.company + " · " + next.title, style = RrType.small, color = RrTheme.colors.ink2) }
            }
            RrMenuSurface(Modifier.weight(1f).heightIn(max = 150.dp)) {
                RrMenuItem(stringResource(R.string.system_save_a_job_aacbba), {}, icon = Icons.drawable.ic_ph_briefcase)
                RrMenuItem(stringResource(R.string.system_new_resume_8b70e5), {}, icon = Icons.drawable.ic_ph_file_plus)
                RrMenuItem(stringResource(R.string.system_search_bce064), {}, icon = Icons.drawable.ic_ph_magnifying_glass)
            }
        }
    }
}
