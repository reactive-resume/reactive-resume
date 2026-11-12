package me.rxresu.feature.applications

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.Duration
import java.time.Instant
import me.rxresu.core.data.NextStepKind
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.designsystem.RrBadge
import me.rxresu.core.designsystem.RrBadgeTone
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCheckbox
import me.rxresu.core.designsystem.RrCompanyTile
import me.rxresu.core.designsystem.RrEmptyState
import me.rxresu.core.designsystem.RrLargeTitleState
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrRowCaret
import me.rxresu.core.designsystem.RrRowValue
import me.rxresu.core.designsystem.RrShape
import me.rxresu.core.designsystem.RrSkeleton
import me.rxresu.core.designsystem.RrSkeletonText
import me.rxresu.core.designsystem.RrSectionHeader
import me.rxresu.core.designsystem.RrStageLabel
import me.rxresu.core.designsystem.RrSwipeAction
import me.rxresu.core.designsystem.RrSwipeRow
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rrLargeTitleScroll
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.strings.R as S

/** Row callbacks shared by List and Board. */
internal class RowActions(
    val open: (String) -> Unit,
    val actions: (Row) -> Unit,
    val trash: (Row) -> Unit,
    val advance: (Row, Lane?, ApplicationStage) -> Unit,
    val toggleSelect: (String) -> Unit,
)

@Composable
internal fun ListView(
    state: ApplicationsState,
    dates: Dates,
    title: RrLargeTitleState,
    selected: Set<String>?,
    actions: RowActions,
    onSaveJob: () -> Unit,
    onImport: () -> Unit,
    onShowClosed: () -> Unit,
    onClearFilters: () -> Unit,
) {
    val rows = state.rows
    when {
        rows == null && state.loading -> ListSkeleton()
        rows == null -> Unit
        state.all.isEmpty() -> EmptyBox {
            RrEmptyState(
                title = stringResource(S.string.track_your_first_job),
                body = stringResource(S.string.paste_a_job_link_we_ll_save_the_posting_so_check_the_assistant_and_your_letter_can_use_it),
                actionLabel = stringResource(S.string.save_job),
                onAction = onSaveJob,
            )
            RrButton(stringResource(S.string.import_from_csv), onImport, variant = RrButtonVariant.Ghost)
        }
        state.allClosed -> EmptyBox {
            RrEmptyState(
                title = stringResource(S.string.all_your_applications_are_closed),
                body = stringResource(S.string.show_closed_applications_to_see_your_past_job_searches),
                actionLabel = stringResource(S.string.show_closed_applications),
                onAction = onShowClosed,
            )
        }
        rows.isEmpty() -> EmptyBox {
            RrEmptyState(
                title = stringResource(R.string.app_no_matches),
                body = stringResource(S.string.try_different_words_or_clear_your_filters),
                actionLabel = stringResource(S.string.clear_filters),
                onAction = onClearFilters,
            )
        }
        else -> {
            var expandedGroups by rememberSaveable { mutableStateOf(emptyList<String>()) }
            val groups = groupRows(rows, state.lanes)
            val reduced = LocalReducedMotion.current
            LazyColumn(Modifier.fillMaxSize().rrLargeTitleScroll(title), contentPadding = PaddingValues(bottom = 24.dp)) {
                items(groups, key = { (lane, rs) -> lane?.id ?: ("stage:" + rs.first().app.status.wireValue) }) { (lane, rs) ->
                    val stage = rs.first().app.status
                    val key = lane?.id ?: "stage:${stage.wireValue}"
                    val expanded = key in expandedGroups || selected != null || state.filters.stage != null
                    val shownRows = if (expanded) rs else rs.take(2)
                    val expandable = rs.size > 2 && selected == null && state.filters.stage == null
                    val action = stringResource(if (expanded) S.string.show_less else S.string.show_all)
                    val description = stringResource(if (expanded) R.string.app_group_expanded else R.string.app_group_collapsed)
                    Column(
                        Modifier.animateItem(placementSpec = if (reduced) null else tween(RrMotion.D2, easing = RrMotion.easeInOutStrong))
                            .then(if (reduced) Modifier else Modifier.animateContentSize(tween(RrMotion.D2, easing = RrMotion.easeInOutStrong))),
                    ) {
                        RrSectionHeader(lane?.let { laneLabel(it) } ?: stageLabel(stage), count = rs.size.toString(),
                            modifier = if (expandable) Modifier.clickable(role = Role.Button, onClickLabel = action) {
                                expandedGroups = if (key in expandedGroups) expandedGroups - key else expandedGroups + key
                            }.semantics { stateDescription = description } else Modifier,
                            topPadding = if (rs === groups.first().second) 20.dp else 32.dp)
                        RrListGroup {
                            shownRows.forEachIndexed { i, row -> ApplicationRow(row, state, dates, selected, actions, i < shownRows.lastIndex) }
                        }
                    }
                }
                val closedCount = state.all.count { it.status == ApplicationStage.Closed }
                if (!state.filters.showClosed && state.filters.stage != ApplicationStage.Closed && closedCount > 0) {
                    item(key = "closed") {
                        RrListRow("${stageLabel(ApplicationStage.Closed)} · $closedCount", Modifier.padding(top = 32.dp), onClick = onShowClosed, trailing = { RrRowCaret() })
                    }
                }
            }
        }
    }
}

@Composable
private fun EmptyBox(content: @Composable () -> Unit) = Column(
    Modifier.fillMaxWidth().padding(16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
) { content() }

@Composable
internal fun StageHeader(stage: ApplicationStage, label: String, count: Int) {
    Row(
        Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RrStageLabel(stage.rr(), label, Modifier.weight(1f), style = RrType.small.copy(fontWeight = FontWeight.Medium))
        RrText(count.toString(), style = RrType.mono, color = RrTheme.colors.ink3)
    }
}

@Composable
private fun ApplicationRow(row: Row, state: ApplicationsState, dates: Dates, selected: Set<String>?, actions: RowActions, divider: Boolean = false) {
    val app = row.app
    val current = displayLane(state.lanes, app)
    val next = if (app.status == ApplicationStage.Closed) null else nextLane(state.lanes, current)
    val nextStageValue = next?.category ?: if (state.lanes.isEmpty() && app.status != ApplicationStage.Closed) nextStage(app.status) else null
    val nextLabel = next?.let { laneLabel(it) } ?: nextStageValue?.let { stageLabel(it) }
    val trashLabel = stringResource(S.string.move_to_trash)
    val moveLabel = nextLabel?.let { stringResource(R.string.app_move_to_stage, it) }
    val content: @Composable () -> Unit = {
        RrListRow(
            title = app.company,
            subtitle = rowSubtitle(row, dates),
            divider = divider,
            onClick = { if (selected != null) actions.toggleSelect(app.id) else actions.open(app.id) },
            onLongClick = { actions.actions(row) },
            onLongClickLabel = stringResource(S.string.actions_for_0_at_1, app.role, app.company),
            selected = selected?.contains(app.id) == true,
            leading = {
                if (selected != null) RrCheckbox(app.id in selected, { actions.toggleSelect(app.id) })
                else RrCompanyTile(app.company, content = row.companyInitials ?: companyMonogram(app.company))
            },
            trailing = { RrRowCaret() },
        )
    }
    if (selected != null) content()
    else RrSwipeRow(
        startAction = RrSwipeAction(trashLabel, D.drawable.ic_ph_trash, danger = true) { actions.trash(row) },
        endAction = if (nextStageValue != null && moveLabel != null) RrSwipeAction(moveLabel, D.drawable.ic_ph_check) { actions.advance(row, next, nextStageValue) } else null,
        content = content,
    )
}

/** The one next step a row shows: an offer deadline badge, a due follow-up with its warn dot, a date, or a time. */
@Composable
private fun RowTrailing(row: Row, dates: Dates, now: Instant) {
    val c = RrTheme.colors
    val step = row.step
    when {
        step.kind == NextStepKind.Offer && step.at != null -> RrBadge(stringResource(S.string.by_0, dates.weekdayDayMonth(step.at!!)), tone = if (step.overdue) RrBadgeTone.Danger else RrBadgeTone.Warn)
        (step.kind == NextStepKind.FollowUp || step.kind == NextStepKind.NoReply) && row.attention -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            WarnDot()
            RrText(step.note.ifBlank { stringResource(S.string.follow_up) }, style = RrType.small, color = c.ink2)
        }
        step.kind == NextStepKind.Interview && step.at != null -> RrRowValue(
            if (Duration.between(now, step.at).toDays() < 6) "${dates.weekday(step.at!!)} ${dates.time(step.at!!)}" else dates.dayMonth(step.at!!),
        )
        step.kind == NextStepKind.FollowUp && step.at != null -> RrRowValue(dates.dayMonth(step.at!!))
        step.kind == NextStepKind.NotApplied -> RrRowValue(stringResource(S.string.not_applied_yet))
        step.kind == NextStepKind.Closed -> RrRowValue(row.app.closedReason?.let { closedReasonLabel(it) } ?: stringResource(S.string.closed))
        else -> runCatching { Instant.parse(row.app.appliedAt) }.getOrNull()?.let { RrRowValue(dates.dayMonth(it)) } ?: RrRowCaret()
    }
}

/** 6 dp warn mark beside "Follow up" words; never alone. */
@Composable
internal fun WarnDot() = Box(Modifier.size(6.dp).clip(RrShape.xs).background(RrTheme.colors.warn))

@Composable
private fun ListSkeleton() {
    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        repeat(3) {
            RrSkeletonText(Modifier.fillMaxWidth(0.3f), lines = 1)
            RrSkeleton(Modifier.fillMaxWidth().height(60.dp))
        }
    }
}

@Composable
private fun rowSubtitle(row: Row, dates: Dates): String {
    val step = row.step
    return when {
        step.kind == NextStepKind.Interview && step.interview != null -> stringResource(if (step.interview!!.kind == me.rxresu.core.network.generated.AddApplicationInterviewRequestKind.Screening) R.string.app_screening_day else R.string.app_interview_day, dates.weekdayDayMonth(Instant.parse(step.interview!!.at)))
        step.kind == NextStepKind.Offer && step.at != null -> stringResource(R.string.app_offer_weekday, step.at!!.atZone(dates.zone).dayOfWeek.getDisplayName(java.time.format.TextStyle.FULL, dates.locale))
        row.app.appliedAt.isNotBlank() && row.app.status != ApplicationStage.Saved -> {
            val date = runCatching { dates.dayMonth(Instant.parse(row.app.appliedAt)) }.getOrNull()
            if (date == null) row.app.role else stringResource(if (step.kind == NextStepKind.NoReply || step.kind == NextStepKind.FollowUp) R.string.app_applied_no_reply else R.string.app_applied_date, date)
        }
        else -> row.app.role
    }
}

/** Multiword companies use initials; a single word uses its opening two letters. */
internal fun companyMonogram(name: String): String {
    val words = name.split(Regex("[^\\p{L}\\p{N}]+" )).filter(String::isNotEmpty)
    return if (words.size > 1) words.take(2).joinToString("") { it.take(1) }.uppercase() else words.firstOrNull()?.take(2)?.uppercase().orEmpty()
}
