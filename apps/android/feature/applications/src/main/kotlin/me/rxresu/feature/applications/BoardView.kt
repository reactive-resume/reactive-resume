package me.rxresu.feature.applications

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PageSize
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import me.rxresu.core.data.NextStepKind
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.designsystem.RrCard
import me.rxresu.core.designsystem.RrElevation
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrRadius
import me.rxresu.core.designsystem.RrShape
import me.rxresu.core.designsystem.RrStageDot
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.designsystem.rrDashedBorder
import me.rxresu.core.designsystem.rrShadow
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.strings.R as S
import java.time.Instant

/** One board column: an open lane (or a stage on servers without lanes) and its rows. */
internal data class BoardColumn(val lane: Lane?, val stage: ApplicationStage, val rows: List<Row>)

internal fun boardColumns(state: ApplicationsState): List<BoardColumn> {
    val rows = state.rows.orEmpty()
    val lanes = activeLanes(state.lanes).filter { it.category != ApplicationStage.Closed || state.filters.showClosed }
        .filter { it.category != ApplicationStage.Closed || it == categoryLane(state.lanes, ApplicationStage.Closed) }
    if (lanes.isEmpty()) return (Pipeline + listOfNotNull(ApplicationStage.Closed.takeIf { state.filters.showClosed }))
        .map { stage -> BoardColumn(null, stage, rows.filter { it.app.status == stage }) }
    return lanes.map { lane ->
        BoardColumn(lane, lane.category, rows.filter { r -> if (lane.category == ApplicationStage.Closed) r.app.status == ApplicationStage.Closed else displayLane(state.lanes, r.app)?.id == lane.id }
            .sortedWith(compareBy<Row>({ sortKey(it).first }, { sortKey(it).second }, { it.app.id })))
    }
}

private data class Drag(val row: Row, val from: Int, val origin: Offset, val delta: Offset, val width: Int, val moved: Float)

private val ColumnWidth = 296.dp
private val ColumnGap = 10.dp
private val EdgeZone = 48.dp

/**
 * J2: one 296 dp column at a time with the next peeking; page dots above. Long-press a card to lift it, drag across
 * columns (hold near an edge for 400 ms to page), drop to move. A long-press released in place opens the card's
 * actions (Move to…), the non-drag path; TalkBack gets "Move to…" as a custom action.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun BoardView(
    state: ApplicationsState,
    dates: Dates,
    actions: RowActions,
    onDrop: (Row, Lane?, ApplicationStage) -> Unit,
    onMoveSheet: (Row) -> Unit,
    initialPage: Int = 0,
) {
    val c = RrTheme.colors
    val columns = boardColumns(state)
    val pager = rememberPagerState { columns.size }
    // Open on the first stage with something in it, once the columns have loaded.
    var opened by remember { mutableStateOf(false) }
    LaunchedEffect(columns.isNotEmpty() && state.rows != null) {
        if (!opened && columns.isNotEmpty() && state.rows != null) { pager.scrollToPage(initialPage.coerceIn(0, columns.lastIndex)); opened = true }
    }
    val haptics = rememberRrHaptics()
    val reduced = LocalReducedMotion.current
    val density = LocalDensity.current
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val scope = rememberCoroutineScope()
    var drag by remember { mutableStateOf<Drag?>(null) }
    var boardOrigin by remember { mutableStateOf(Offset.Zero) }
    var boardWidth by remember { androidx.compose.runtime.mutableFloatStateOf(0f) }
    val colPx = with(density) { (ColumnWidth + ColumnGap).toPx() }
    val padPx = with(density) { 16.dp.toPx() }
    val edgePx = with(density) { EdgeZone.toPx() }
    val moveTo = stringResource(S.string.move_to_6ffcfca36b)

    fun fingerX(d: Drag) = d.origin.x + d.delta.x - boardOrigin.x
    fun target(d: Drag): Int {
        val x = fingerX(d).let { if (rtl) boardWidth - it else it }
        return (pager.currentPage + ((x - padPx) / colPx).toInt().coerceAtLeast(0)).coerceIn(0, columns.lastIndex)
    }
    // Holding near an edge pages the board under the card.
    val edge = drag?.let { d -> val x = fingerX(d); when { x > boardWidth - edgePx -> if (rtl) -1 else 1; x < edgePx -> if (rtl) 1 else -1; else -> 0 } } ?: 0
    LaunchedEffect(edge, drag != null) {
        if (edge == 0 || drag == null) return@LaunchedEffect
        while (true) {
            delay(400)
            val next = (pager.currentPage + edge).coerceIn(0, columns.lastIndex)
            if (next == pager.currentPage) break
            haptics(RrHaptic.Selection)
            if (reduced) pager.scrollToPage(next) else pager.animateScrollToPage(next, animationSpec = androidx.compose.animation.core.tween(RrMotion.D3, easing = RrMotion.easeInOutStrong))
        }
    }

    Column(Modifier.fillMaxSize()) {
        PageDots(pager.currentPage, columns.size)
        Box(
            Modifier.weight(1f).fillMaxWidth().onGloballyPositioned { boardOrigin = it.positionInRoot(); boardWidth = it.size.width.toFloat() },
        ) {
            HorizontalPager(
                pager,
                Modifier.fillMaxSize(),
                pageSize = PageSize.Fixed(ColumnWidth),
                pageSpacing = ColumnGap,
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp),
                userScrollEnabled = drag == null,
                key = { columns[it].lane?.id ?: columns[it].stage.wireValue },
            ) { page ->
                val column = columns[page]
                val over = drag?.let { target(it) == page && it.from != page } == true
                val label = column.lane?.let { laneLabel(it) } ?: stageLabel(column.stage)
                Column(
                    Modifier.fillMaxSize().clip(RrShape.lg).background(if (over) c.accentSoft else c.sunken).padding(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 4.dp, bottom = 2.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        RrStageDot(column.stage.rr())
                        RrText(label, Modifier.weight(1f), style = RrType.ui.copy(fontWeight = FontWeight.SemiBold), color = c.ink)
                        RrText(column.rows.size.toString(), style = RrType.mono, color = c.ink3)
                    }
                    Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        column.rows.forEach { row ->
                            val lifted = drag?.row?.app?.id == row.app.id
                            var bounds by remember { mutableStateOf(Offset.Zero) }
                            var width by remember { androidx.compose.runtime.mutableIntStateOf(0) }
                            Box(
                                Modifier.fillMaxWidth()
                                    .onGloballyPositioned { bounds = it.boundsInRoot().topLeft; width = it.size.width }
                                    .semantics { customActions = listOf(CustomAccessibilityAction(moveTo) { onMoveSheet(row); true }) }
                                    .pointerInput(row.app.id) {
                                        detectDragGesturesAfterLongPress(
                                            onDragStart = { haptics(RrHaptic.Medium); drag = Drag(row, page, bounds, Offset.Zero, width, 0f) },
                                            onDrag = { change, amount ->
                                                change.consume()
                                                drag = drag?.let { it.copy(delta = it.delta + amount, moved = it.moved + amount.getDistance()) }
                                            },
                                            onDragEnd = {
                                                val d = drag ?: return@detectDragGesturesAfterLongPress
                                                drag = null
                                                val to = target(d.copy())
                                                when {
                                                    d.moved < 12f -> onMoveSheet(d.row)
                                                    to != d.from -> {
                                                        haptics(RrHaptic.Rigid)
                                                        val col = columns[to]
                                                        if (col.stage == ApplicationStage.Offer) scope.launch { delay(RrMotion.D2.toLong()); haptics(RrHaptic.Success) }
                                                        if (col.stage == ApplicationStage.Closed) onMoveSheet(d.row) else onDrop(d.row, col.lane, col.stage)
                                                    }
                                                    else -> haptics(RrHaptic.Rigid)
                                                }
                                            },
                                            onDragCancel = { drag = null },
                                        )
                                    },
                            ) {
                                if (lifted) Box(Modifier.fillMaxWidth().height(84.dp).rrDashedBorder(c.line2, RrRadius.lg))
                                else BoardCard(row, state, dates) { actions.open(row.app.id) }
                            }
                        }
                        if (column.rows.isEmpty() && drag == null) {
                            Box(Modifier.fillMaxWidth().height(84.dp).rrDashedBorder(c.line2, RrRadius.lg), contentAlignment = Alignment.Center) {
                                RrText(stringResource(R.string.app_drag_here), style = RrType.small, color = c.ink3)
                            }
                        }
                    }
                }
            }
            // The lifted card follows the finger: tilted 2°, scaled 1.02, shadow-3 with an accent edge.
            drag?.let { d ->
                val x = d.origin.x + d.delta.x - boardOrigin.x
                val y = d.origin.y + d.delta.y - boardOrigin.y
                Box(
                    Modifier.offset { IntOffset(x.roundToInt(), y.roundToInt()) }
                        .width(with(density) { d.width.toDp() })
                        .graphicsLayer { if (!reduced) { rotationZ = -2f; scaleX = 1.02f; scaleY = 1.02f } }
                        .rrShadow(RrElevation.Level3, RrShape.lg)
                        .border(2.dp, c.accent, RrShape.lg),
                ) { BoardCard(d.row, state, dates) {} }
            }
        }
    }
}

/** Card: company, role, next step and the resume sent. */
@Composable
internal fun BoardCard(row: Row, state: ApplicationsState, dates: Dates, onClick: () -> Unit) {
    val c = RrTheme.colors
    val app = row.app
    val step = row.step
    RrCard(Modifier.fillMaxWidth(), raised = true, onClick = onClick, contentPadding = PaddingValues(12.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            RrText(app.company, style = RrType.label, color = c.ink)
            RrText(app.role, style = RrType.small, color = c.ink2)
            val applied = runCatching { Instant.parse(app.appliedAt) }.getOrNull()?.let(dates::dayMonth)
            when {
                (step.kind == NextStepKind.FollowUp || step.kind == NextStepKind.NoReply) && row.attention -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    WarnDot()
                    RrText(listOfNotNull(step.note.ifBlank { stringResource(S.string.follow_up) }, applied?.let { stringResource(R.string.app_applied_on_lower, it) }).joinToString(" · "), style = RrType.small, color = c.ink)
                }
                step.kind == NextStepKind.Interview && step.at != null -> RrText(dates.whenWithTime(step.at!!), style = RrType.small, color = c.ink3)
                step.kind == NextStepKind.Offer && step.at != null -> RrText(stringResource(S.string.by_0, dates.weekdayDayMonth(step.at!!)), style = RrType.small, color = c.warnText)
                step.kind == NextStepKind.NotApplied -> RrText(stringResource(S.string.not_applied_yet), style = RrType.small, color = c.ink3)
                step.kind == NextStepKind.Closed -> RrText(app.closedReason?.let { closedReasonLabel(it) } ?: stringResource(S.string.closed), style = RrType.small, color = c.ink3)
                applied != null -> RrText(stringResource(S.string.applied_0, applied), style = RrType.small, color = c.ink3)
            }
            state.resumes[app.resumeId]?.let { resume ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    RrIcon(D.drawable.ic_ph_file_text, null, size = 14.dp, tint = c.ink3)
                    RrText(resume.name, style = RrType.caption.copy(fontWeight = FontWeight.Normal), color = c.ink3, maxLines = 1)
                }
            }
        }
    }
}

/** Page dots: the current column's dot widens (d2). Decorative; the column header names the stage. */
@Composable
private fun PageDots(current: Int, count: Int) {
    val c = RrTheme.colors
    val reduced = LocalReducedMotion.current
    val position = stringResource(R.string.app_page_of, current + 1, count)
    Row(
        Modifier.fillMaxWidth().padding(vertical = 10.dp).semantics { contentDescription = position },
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
    ) {
        repeat(count) { i ->
            val w by animateDpAsState(if (i == current) 16.dp else 6.dp, RrMotion.spec(RrMotion.D2, reduced), label = "dot")
            Box(Modifier.size(w, 6.dp).clip(RrShape.xs).background(if (i == current) c.ink2 else c.line2))
        }
    }
}
