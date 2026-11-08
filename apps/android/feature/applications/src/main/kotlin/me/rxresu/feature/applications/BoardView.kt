package me.rxresu.feature.applications

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.fillMaxHeight
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
import me.rxresu.core.designsystem.DesignTag
import me.rxresu.core.designsystem.rrDesignTag
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
            )
    }
}

private data class Drag(val row: Row, val from: Int, val origin: Offset, val delta: Offset, val width: Int, val moved: Float)

private val ColumnWidth = 300.dp
private val ColumnGap = 16.dp
private val EdgeZone = 48.dp

/**
 * J2: horizontally scrolling 300 dp columns with the next peeking. Long-press a card to lift it, drag across
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
    val scroll = rememberScrollState()
    var opened by remember { mutableStateOf(false) }
    val haptics = rememberRrHaptics()
    val reduced = LocalReducedMotion.current
    val density = LocalDensity.current
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val scope = rememberCoroutineScope()
    var drag by remember { mutableStateOf<Drag?>(null) }
    var boardOrigin by remember { mutableStateOf(Offset.Zero) }
    var boardWidth by remember { androidx.compose.runtime.mutableFloatStateOf(0f) }
    val colPx = with(density) { (ColumnWidth + ColumnGap).toPx() }
    val padPx = with(density) { 24.dp.toPx() }
    val edgePx = with(density) { EdgeZone.toPx() }
    LaunchedEffect(columns.isNotEmpty() && state.rows != null) {
        if (!opened && columns.isNotEmpty() && state.rows != null) {
            scroll.scrollTo((initialPage.coerceIn(0, columns.lastIndex) * colPx).roundToInt())
            opened = true
        }
    }
    val moveTo = stringResource(S.string.move_to_6ffcfca36b)

    fun fingerX(d: Drag) = d.origin.x + d.delta.x - boardOrigin.x
    fun target(d: Drag): Int {
        val x = fingerX(d).let { if (rtl) boardWidth - it else it }
        return ((scroll.value + x - padPx) / colPx).toInt().coerceIn(0, columns.lastIndex)
    }
    // Holding near an edge pages the board under the card.
    val edge = drag?.let { d -> val x = fingerX(d); when { x > boardWidth - edgePx -> if (rtl) -1 else 1; x < edgePx -> if (rtl) 1 else -1; else -> 0 } } ?: 0
    LaunchedEffect(edge, drag != null) {
        if (edge == 0 || drag == null) return@LaunchedEffect
        while (true) {
            delay(400)
            val page = (scroll.value / colPx).roundToInt()
            val next = (page + edge).coerceIn(0, columns.lastIndex)
            if (next == page) break
            haptics(RrHaptic.Selection)
            if (reduced) scroll.scrollTo((next * colPx).roundToInt()) else scroll.animateScrollTo((next * colPx).roundToInt(), animationSpec = androidx.compose.animation.core.tween(RrMotion.D3, easing = RrMotion.easeInOutStrong))
        }
    }

    Column(Modifier.fillMaxSize()) {
        androidx.compose.foundation.layout.Spacer(Modifier.height(40.dp))
        Box(
            Modifier.weight(1f).fillMaxWidth().onGloballyPositioned { boardOrigin = it.positionInRoot(); boardWidth = it.size.width.toFloat() },
        ) {
            Row(Modifier.fillMaxSize().horizontalScroll(scroll, enabled = drag == null).padding(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(ColumnGap)) {
                columns.forEachIndexed { page, column ->
                val over = drag?.let { target(it) == page && it.from != page } == true
                val label = column.lane?.let { laneLabel(it) } ?: stageLabel(column.stage)
                Column(
                    Modifier.width(ColumnWidth).fillMaxHeight().background(if (over) c.accentSoft else c.bg),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        RrText(label, Modifier.alignByBaseline(), style = RrType.sheetTitle, color = c.ink)
                        RrText(column.rows.size.toString(), Modifier.alignByBaseline(), style = RrType.ui, color = c.ink3)
                    }
                    Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
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
    Box(Modifier.rrDesignTag(DesignTag(component = "BoardCard", radius = 16.dp, bgName = "surface"))) {
        RrCard(Modifier.fillMaxWidth().rrShadow(RrElevation.Level1, RrShape.xl), onClick = onClick, contentPadding = PaddingValues(17.dp)) {
            Column {
                RrText(app.company, style = RrType.rowTitle.copy(fontWeight = FontWeight.SemiBold), color = c.ink)
                RrText(app.role, Modifier.padding(top = 4.dp), style = RrType.ui, color = c.ink3)
                val line = when {
                    step.kind == NextStepKind.Interview && step.at != null -> "${dates.weekdayDayMonth(step.at!!)} · ${step.interview?.let { interviewKindLabel(it.kind).lowercase(dates.locale) }.orEmpty()}"
                    step.kind == NextStepKind.Offer && step.at != null -> stringResource(R.string.app_reply_by, dates.weekdayDayMonth(step.at!!))
                    step.kind == NextStepKind.FollowUp || step.kind == NextStepKind.NoReply -> stringResource(S.string.follow_up)
                    step.kind == NextStepKind.NotApplied -> stringResource(S.string.not_applied_yet)
                    else -> app.appliedAt.let { runCatching { dates.dayMonth(Instant.parse(it)) }.getOrDefault("") }
                }
                Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    RrIcon(D.drawable.ic_ph_calendar_blank, null, size = 16.dp, tint = c.ink2)
                    RrText(line, style = RrType.keyLine, color = c.ink2)
                }
            }
        }
}
}
