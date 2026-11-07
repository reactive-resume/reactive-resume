package me.rxresu.feature.applications

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.Instant
import java.time.LocalDate
import me.rxresu.core.data.ApplicationInsights
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.designsystem.RrBarChart
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrCard
import me.rxresu.core.designsystem.RrEmptyState
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrLargeTitleState
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrRowCaret
import me.rxresu.core.designsystem.RrShape
import me.rxresu.core.designsystem.RrStageLabel
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.designsystem.rrLargeTitleScroll
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.network.generated.PatchApplicationClosedReason
import me.rxresu.core.network.generated.StageTimelineEntry
import me.rxresu.core.strings.R as S

/** Sent applications with a linked resume made for them, against those sent with another resume (packages/schema outcomes). */
internal data class Comparison(val tailoredSent: Int, val tailoredReplied: Int, val baseSent: Int, val baseReplied: Int) {
    val enough get() = tailoredSent >= 3 && baseSent >= 3
    val any get() = tailoredSent + baseSent > 0
}

private val ReplyStages = setOf(ApplicationStage.Screening, ApplicationStage.Interview, ApplicationStage.Offer)

/** True when the application ever got a reply after it was sent: moving on to screening or beyond, or being turned down. */
internal fun repliedTo(app: Application): Boolean {
    val stages = app.activity.filterIsInstance<StageTimelineEntry>()
    val canonical = stages.filter { it.canonicalTransition != false }
    val since = canonical.filter { it.dateUnknown != true && it.stage == ApplicationStage.Applied }.minByOrNull { it.at }?.at
        ?.let { runCatching { Instant.parse(it) }.getOrNull() }
    return stages.any { e ->
        val at = runCatching { Instant.parse(e.at) }.getOrNull()
        (e.dateUnknown == true || since == null || (at != null && at >= since)) &&
            ((e.canonicalTransition != false && e.stage in ReplyStages) ||
                (e.stage == ApplicationStage.Closed && (e.closedReason ?: app.closedReason) == PatchApplicationClosedReason.NotSelected))
    }
}

/** Ever reached Applied or beyond. */
internal fun wasSent(app: Application): Boolean =
    (app.activity.filterIsInstance<StageTimelineEntry>().filter { it.canonicalTransition != false }.map { it.stage } + app.status)
        .any { it in Pipeline.drop(1) }

internal fun compareTailored(apps: List<Application>, resumes: Map<String, DocumentSummary>): Comparison {
    val sent = apps.filter { wasSent(it) && it.resumeId != null }
    val tailored = sent.filter { resumes[it.resumeId]?.application?.id == it.id }
    val base = sent - tailored.toSet()
    return Comparison(tailored.size, tailored.count(::repliedTo), base.size, base.count(::repliedTo))
}

private enum class Chart { OverTime, Sources }

@Composable
internal fun InsightsView(
    state: ApplicationsState,
    dates: Dates,
    title: RrLargeTitleState,
    onStage: (ApplicationStage) -> Unit,
    onSaveJob: () -> Unit,
) {
    val c = RrTheme.colors
    val insights = state.insights
    var chart by remember { mutableStateOf<Chart?>(null) }
    if (insights == null) return
    val sent = insights.byStage[ApplicationStage.Applied] ?: 0
    if (sent == 0) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            RrEmptyState(
                title = stringResource(S.string.no_replies_to_chart_yet),
                body = stringResource(S.string.once_you_ve_sent_a_few_applications_this_shows_how_far_they_get_and_how_quickly_people_reply),
                actionLabel = stringResource(S.string.save_job),
                onAction = onSaveJob,
            )
        }
        return
    }
    val comparison = remember(state.all, state.resumes) { compareTailored(state.all, state.resumes) }
    Column(
        Modifier.fillMaxSize().rrLargeTitleScroll(title).verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Stat(Modifier.weight(1f), "${Math.round(insights.heardBack * 100.0 / sent)}%", stringResource(S.string.heard_back))
            Stat(
                Modifier.weight(1f),
                insights.medianDaysToReply?.let { d -> plural(S.plurals.message_0_plural_one_day_other_days, d.toInt(), formatDays(d)) } ?: "—",
                stringResource(S.string.median_to_first_reply),
            )
        }
        Funnel(insights, onStage)
        if (comparison.any) RrCard(Modifier.fillMaxWidth()) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                RrText(stringResource(S.string.tailored_vs_base_resume), style = RrType.label, color = c.ink)
                if (comparison.enough) {
                    RrText(
                        stringResource(
                            S.string.message_0_of_1_tailored_applications_got_a_reply_2_of_3_sent_with_another_resume,
                            comparison.tailoredReplied.toString(), comparison.tailoredSent.toString(), comparison.baseReplied.toString(), comparison.baseSent.toString(),
                        ),
                        style = RrType.small,
                        color = c.ink2,
                    )
                    if (comparison.tailoredSent + comparison.baseSent < 10) RrText(stringResource(S.string.small_numbers_but_worth_noticing), style = RrType.small, color = c.ink3)
                } else RrText(stringResource(S.string.not_enough_applications_to_compare_yet_this_needs_3_of_each), style = RrType.small, color = c.ink3)
            }
        }
        RrListGroup {
            RrListRow(stringResource(S.string.applications_over_time), subtitle = stringResource(S.string.applications_sent_per_week_last_8_weeks), icon = D.drawable.ic_ph_chart_bar, onClick = { chart = Chart.OverTime }, trailing = { RrRowCaret() })
            RrListRow(stringResource(S.string.where_applications_come_from), icon = D.drawable.ic_ph_globe_simple, onClick = { chart = Chart.Sources }, trailing = { RrRowCaret() })
        }
    }
    when (chart) {
        Chart.OverTime -> RrBottomSheet(onDismissRequest = { chart = null }, title = stringResource(S.string.applications_over_time), fitContent = true) {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                RrText(stringResource(S.string.applications_sent_per_week_last_8_weeks), style = RrType.small, color = c.ink3)
                WeekBars(insights, dates)
            }
        }
        Chart.Sources -> RrBottomSheet(onDismissRequest = { chart = null }, title = stringResource(S.string.where_applications_come_from), fitContent = true) {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                RrText(stringResource(S.string.count_by_source), style = RrType.small, color = c.ink3)
                if (insights.bySource.isEmpty()) RrText(stringResource(S.string.no_source_data_yet), style = RrType.small, color = c.ink3)
                val max = insights.bySource.values.maxOrNull() ?: 1
                insights.bySource.entries.sortedByDescending { it.value }.forEach { (source, count) ->
                    BarRow(source, count, count / max.toFloat(), c.accent, null)
                }
            }
        }
        null -> Unit
    }
}

private fun formatDays(d: Double) = if (d % 1.0 == 0.0) d.toInt().toString() else "%.1f".format(d)

@Composable
private fun Stat(modifier: Modifier, value: String, label: String) {
    val c = RrTheme.colors
    RrCard(modifier) {
        Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            RrText(value, style = RrType.title.copy(fontSize = 32.sp), color = c.ink)
            RrText(label, style = RrType.small, color = c.ink2)
        }
    }
}

/** Stage funnel: each bar grows from zero once per visit (d3 ease); reduced motion draws it at once. */
@Composable
private fun Funnel(insights: ApplicationInsights, onStage: (ApplicationStage) -> Unit) {
    val c = RrTheme.colors
    val reduced = LocalReducedMotion.current
    val grow = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) { if (!reduced) grow.animateTo(1f, tween(RrMotion.D3, easing = RrMotion.ease)) }
    val stages = Pipeline.drop(1)
    val max = (stages.maxOfOrNull { insights.byStage[it] ?: 0 } ?: 1).coerceAtLeast(1)
    val names = stages.map { stageLabel(it) }
    val summary = stages.mapIndexed { i, s -> "${names[i]} ${insights.byStage[s] ?: 0}" }.joinToString(", ")
    RrCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Column {
                RrText(stringResource(S.string.how_far_applications_get), style = RrType.label, color = c.ink)
                RrText(stringResource(S.string.counts_every_application_that_reached_each_stage_including_ones_now_closed), style = RrType.small, color = c.ink3)
            }
            Column(Modifier.semantics(mergeDescendants = false) { contentDescription = summary }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                stages.forEachIndexed { i, stage ->
                    val count = insights.byStage[stage] ?: 0
                    BarRow(names[i], count, grow.value * count / max.toFloat(), stage.rr().color, stage) { onStage(stage) }
                }
            }
        }
    }
}

@Composable
private fun BarRow(label: String, count: Int, fraction: Float, color: androidx.compose.ui.graphics.Color, stage: ApplicationStage?, onClick: (() -> Unit)? = null) {
    val c = RrTheme.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 18.dp)
            .then(if (onClick != null) Modifier.clip(RrShape.sm).selectable(false, role = Role.Button, onClick = onClick) else Modifier),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(84.dp)) {
            if (stage != null) RrStageLabel(stage.rr(), label, style = RrType.small.copy(color = c.ink2)) else RrText(label, style = RrType.small, color = c.ink2, maxLines = 2)
        }
        Box(Modifier.weight(1f).height(14.dp)) {
            if (fraction > 0f) Box(Modifier.fillMaxWidth(fraction.coerceIn(0.02f, 1f)).fillMaxHeight().clip(RrShape.sm).background(color))
        }
        RrText(count.toString(), Modifier.width(28.dp), style = RrType.mono.copy(fontSize = 13.sp, lineHeight = 18.sp), color = c.ink, textAlign = TextAlign.End)
    }
}

/** Eight weeks of sent applications as bars; tap a bar for its value (`selection`). */
@Composable
private fun WeekBars(insights: ApplicationInsights, dates: Dates) {
    val c = RrTheme.colors
    val weeks = insights.byWeek.entries.sortedBy { it.key }
    var picked by rememberSaveable { androidx.compose.runtime.mutableIntStateOf(weeks.lastIndex) }
    fun label(week: String) = dates.dayMonth(LocalDate.parse(week).atStartOfDay(dates.zone).toInstant())
    val summary = weeks.joinToString(", ") { (week, n) -> "${label(week)} $n" }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        weeks.getOrNull(picked)?.let { (week, n) -> RrText("${label(week)} · $n", style = RrType.mono, color = c.ink2) }
        RrBarChart(
            weeks.map { it.value.toFloat() },
            summary,
            selected = picked,
            onSelect = { picked = it },
            previousLabel = stringResource(D.string.ds_previous_week),
            nextLabel = stringResource(D.string.ds_next_week),
        )
    }
}
