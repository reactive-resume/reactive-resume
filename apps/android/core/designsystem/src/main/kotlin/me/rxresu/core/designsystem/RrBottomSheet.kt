package me.rxresu.core.designsystem

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.dismiss
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogWindowProvider
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Sheet geometry, kept pure for tests. Heights are the visible sheet height in px; detents ascend.
 */
object RrSheetMath {
    /** Pulling the sheet below its lowest detent by more than this share of that detent dismisses it. */
    const val DISMISS_FRACTION = 0.25f

    /** A release faster than this (dp per second) counts as a fling. */
    const val FLING_DP_PER_S = 1000f

    /** Index of the detent to settle on, or -1 to dismiss. [velocity] is the height change per second (+ = growing). */
    fun settle(height: Float, velocity: Float, detents: FloatArray, flingThreshold: Float): Int {
        if (detents.isEmpty()) return -1
        val eps = 1f
        return when {
            velocity <= -flingThreshold -> detents.indexOfLast { it < height - eps }
            velocity >= flingThreshold -> detents.indexOfFirst { it > height + eps }.let { if (it == -1) detents.lastIndex else it }
            height < detents.first() * (1f - DISMISS_FRACTION) -> -1
            else -> detents.indices.minBy { abs(detents[it] - height) }
        }
    }

    /** Release animation length: scales with the remaining distance over [travel], d1 at least, d3 at most. */
    fun settleDurationMs(distance: Float, travel: Float): Int =
        if (travel <= 0f) RrMotion.D1 else (RrMotion.D3 * abs(distance) / travel).toInt().coerceIn(RrMotion.D1, RrMotion.D3)
}

/** Detents as shares of the window height. */
object RrSheetDetents {
    val HalfAndFull = listOf(0.5f, 0.92f)
    val Full = listOf(0.92f)
}

/** Sheet state: which detent it rests on, plus [hide] for closing with the exit animation after a save. */
@Stable
class RrBottomSheetState internal constructor() {
    internal val height = Animatable(0f)
    internal var anchors: FloatArray = FloatArray(0)
    internal var target by mutableFloatStateOf(-1f)
    internal var hiding by mutableStateOf(false)
    internal var exit: (suspend () -> Unit)? = null

    /** Index of the detent the sheet rests on or is heading to; -1 while closed or closing. */
    val detentIndex: Int get() = if (hiding) -1 else anchors.indexOfFirst { abs(it - target) < 1f }

    /** Animates the sheet out. Call [onDismissRequest] (or navigate back) afterwards. */
    suspend fun hide() {
        exit?.invoke()
    }
}

@Composable
fun rememberRrBottomSheetState(): RrBottomSheetState = remember { RrBottomSheetState() }

/**
 * Bottom sheet drawn over a `scrim-sheet` backdrop, filling its parent (inline in a screen's Box or as the whole content
 * of a full-window dialog destination; inside a dialog window it clears the platform dim).
 *
 * - Detents 50% and 92% by default ([detents] as shares of the height), or [fitContent] for short action sheets.
 * - Grabber, optional header ([title] in Instrument Serif 22 with a Close button and [headerActions]).
 * - Drag the sheet or its scrolled-to-top content: release past 25% below the lowest detent, or fling down from it,
 *   dismisses; otherwise it snaps to the nearest detent (fling goes to the next) with `selection`.
 * - Rises d3 ease while the scrim fades; exits in 70%. Reduced motion: a d1 fade, no movement.
 * - IME-aware: the content stays above the keyboard and the sheet opens to its top detent while typing.
 * - Back, scrim taps, Close and drag-to-dismiss all go through [confirmDiscard]: when true, "Discard changes?" asks
 *   first (Keep editing · Discard changes).
 *
 * @param footer pinned under the scrolling content (sheet actions such as "Delete · Save interview").
 */
@Composable
fun RrBottomSheet(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    state: RrBottomSheetState = rememberRrBottomSheetState(),
    detents: List<Float> = RrSheetDetents.HalfAndFull,
    initialDetent: Int = 0,
    fitContent: Boolean = false,
    confirmDiscard: Boolean = false,
    title: String? = null,
    showClose: Boolean = title != null,
    headerActions: (@Composable RowScope.() -> Unit)? = null,
    footer: (@Composable ColumnScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = RrTheme.colors
    val density = LocalDensity.current
    val reduced = LocalReducedMotion.current
    val still = LocalInspectionMode.current
    val haptics = rememberRrHaptics()
    val scope = rememberCoroutineScope()
    val dismiss by rememberUpdatedState(onDismissRequest)
    val dirty by rememberUpdatedState(confirmDiscard)
    var askDiscard by remember { mutableStateOf(false) }
    val fade = remember { Animatable(if (reduced && !still) 0f else 1f) }
    val flingThreshold = with(density) { RrSheetMath.FLING_DP_PER_S.dp.toPx() }

    // Inside a dialog window (navigation dialog destination) the scrim is ours, not the platform dim.
    val dialogWindow = (LocalView.current.parent as? DialogWindowProvider)?.window
    SideEffect { dialogWindow?.setDimAmount(0f) }

    suspend fun animateHeight(to: Float, durationMs: Int, easing: androidx.compose.animation.core.Easing) {
        state.target = to
        if (reduced) state.height.snapTo(to) else state.height.animateTo(to, tween(durationMs, easing = easing))
    }

    suspend fun close() {
        state.hiding = true
        if (reduced) {
            withContext(RrMotion.Unscaled) { fade.animateTo(0f, tween(RrMotion.D1)) }
        } else {
            animateHeight(0f, RrMotion.exit(RrMotion.D3), RrMotion.ease)
        }
        dismiss()
    }
    state.exit = { close() }

    fun requestDismiss() {
        if (dirty) {
            askDiscard = true
            scope.launch { if (state.target > 0f) animateHeight(state.target, RrMotion.D2, RrMotion.easeDrawer) }
        } else {
            scope.launch { close() }
        }
    }

    suspend fun settle(velocity: Float) {
        val anchors = state.anchors
        val from = state.height.value
        val previous = state.target
        val index = RrSheetMath.settle(from, velocity, anchors, flingThreshold)
        if (index == -1) {
            requestDismiss()
            return
        }
        val to = anchors[index]
        if (abs(to - previous) > 1f) haptics(RrHaptic.Selection)
        animateHeight(to, RrSheetMath.settleDurationMs(to - from, anchors.last()), RrMotion.easeDrawer)
    }

    fun dragBy(delta: Float): Float {
        // delta: finger movement in px, + = down. Returns the part the sheet used.
        val top = state.anchors.lastOrNull() ?: return 0f
        val now = state.height.value
        val next = (now - delta).coerceIn(0f, top)
        scope.launch { state.height.snapTo(next) }
        return now - next
    }

    val nested = remember(state) {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                // Finger up while the sheet can still grow: grow the sheet before the content scrolls.
                if (available.y < 0 && source == NestedScrollSource.UserInput) {
                    val used = dragBy(available.y)
                    return Offset(0f, -used)
                }
                return Offset.Zero
            }

            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                // Content is at its top and the finger keeps pulling down: move the sheet.
                if (available.y > 0 && source == NestedScrollSource.UserInput) return Offset(0f, -dragBy(available.y))
                return Offset.Zero
            }

            override suspend fun onPreFling(available: Velocity): Velocity {
                val resting = state.anchors.any { abs(it - state.height.value) < 1f }
                if (!resting) {
                    settle(-available.y)
                    return available
                }
                return Velocity.Zero
            }

            override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
                if (available.y > 0) settle(-available.y)
                return Velocity.Zero
            }
        }
    }
    val drag = rememberDraggableState { dragBy(it) }

    val ime = WindowInsets.ime.getBottom(density)
    LaunchedEffect(ime > 0) {
        if (ime > 0 && state.anchors.isNotEmpty() && state.target > 0f && state.target < state.anchors.last()) {
            animateHeight(state.anchors.last(), RrMotion.D3, RrMotion.ease)
        }
    }
    LaunchedEffect(reduced) {
        if (reduced && !still) withContext(RrMotion.Unscaled) { fade.animateTo(1f, tween(RrMotion.D1)) }
    }
    BackHandler(enabled = !state.hiding) { requestDismiss() }

    val sheetTitle = title
    val closeLabel = stringResource(R.string.ds_close)
    Box(modifier.fillMaxSize()) {
        // Scrim: fades with the sheet's rise (d2 of the d3 rise reads as the board's timing).
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    val lowest = state.anchors.firstOrNull() ?: 1f
                    alpha = fade.value * (state.height.value / lowest).coerceIn(0f, 1f)
                }
                .background(c.scrimSheet)
                .clickable(remember { MutableInteractionSource() }, null) { requestDismiss() },
        )
        SheetLayout(
            state = state,
            detents = detents,
            fitContent = fitContent,
            initialDetent = initialDetent,
            onFirstLayout = { to ->
                scope.launch {
                    state.target = to
                    if (reduced || still) state.height.snapTo(to) else state.height.animateTo(to, tween(RrMotion.D3, easing = RrMotion.ease))
                }
            },
            modifier = Modifier
                .graphicsLayer { alpha = fade.value }
                .rrShadow(RrElevation.Level3, RrShape.sheetTop)
                .clip(RrShape.sheetTop)
                .background(c.raised)
                .semantics {
                    if (sheetTitle != null) paneTitle = sheetTitle
                    dismiss { requestDismiss(); true }
                    customActions = listOf(
                        CustomAccessibilityAction(closeLabel) { requestDismiss(); true },
                    )
                }
                .nestedScroll(nested)
                .draggable(
                    drag,
                    Orientation.Vertical,
                    onDragStopped = { velocity -> settle(-velocity) },
                ),
        ) {
            Column(Modifier.windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars))) {
                Box(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(36.dp, 4.dp).clip(RrShape.sm).background(c.line2))
                }
                if (title != null || headerActions != null || showClose) {
                    Row(
                        Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 4.dp, bottom = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RrText(title.orEmpty(), style = RrType.sheetTitle, color = c.ink, modifier = Modifier.weight(1f))
                        headerActions?.invoke(this)
                        if (showClose) RrIconButton(R.drawable.ic_ph_x, closeLabel, { requestDismiss() }, size = RrIconButtonSize.Small)
                    }
                }
                Column(Modifier.weight(1f, fill = !fitContent), content = content)
                if (footer != null) Column(content = footer)
            }
        }
    }

    if (askDiscard) {
        RrAlertDialog(
            title = stringResource(R.string.ds_discard_changes_title),
            text = stringResource(R.string.ds_discard_changes_body),
            confirmLabel = stringResource(R.string.ds_discard),
            onConfirm = {
                askDiscard = false
                scope.launch { close() }
            },
            onDismissRequest = { askDiscard = false },
            dismissLabel = stringResource(R.string.ds_keep_editing),
            confirm = RrDialogConfirm.Danger,
        )
    }
}

/**
 * Places the sheet at the bottom. Its layout height is max(visible height, resting detent), so it rises and falls by
 * translation without reflowing, and grows (reflowing) when dragged above its detent. Fit-content sheets keep their
 * natural height (capped at 92%).
 */
@Composable
private fun SheetLayout(
    state: RrBottomSheetState,
    detents: List<Float>,
    fitContent: Boolean,
    initialDetent: Int,
    onFirstLayout: (Float) -> Unit,
    modifier: Modifier,
    content: @Composable () -> Unit,
) {
    var started by remember { mutableStateOf(false) }
    Layout(content = { Box(modifier) { content() } }) { measurables, constraints ->
        val windowH = constraints.maxHeight.toFloat()
        val cap = (0.92f * windowH).toInt()
        val sheet = measurables.first()
        val placeable = if (fitContent) {
            val p = sheet.measure(Constraints(constraints.maxWidth, constraints.maxWidth, 0, cap))
            state.anchors = floatArrayOf(p.height.toFloat())
            p
        } else {
            state.anchors = detents.map { it * windowH }.toFloatArray()
            val visible = state.height.value
            val layoutH = max(visible, state.target).coerceIn(0f, windowH).toInt()
            sheet.measure(Constraints.fixed(constraints.maxWidth, layoutH))
        }
        if (!started) {
            started = true
            val anchors = state.anchors
            onFirstLayout(anchors[min(initialDetent, anchors.lastIndex)])
        }
        layout(constraints.maxWidth, constraints.maxHeight) {
            val y = (windowH - state.height.value).toInt()
            placeable.place(0, y)
        }
    }
}

@RrPreviews
@Composable
internal fun RrBottomSheetPreview() = RrPreviewSurface {
    Box(Modifier.fillMaxWidth().size(358.dp, 520.dp)) {
        RrBottomSheet(onDismissRequest = {}, title = "Edit interview", detents = RrSheetDetents.Full, footer = {
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                RrButton("Delete", {}, variant = RrButtonVariant.DangerGhost, size = RrButtonSize.Large)
                RrButton("Save interview", {}, size = RrButtonSize.Large)
            }
        }) {
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                RrTextField("60", {}, label = "Length · minutes")
                RrTextField("Lumen office, Rua do Alecrim 12", {}, label = "Location", leadingIcon = R.drawable.ic_ph_map_pin)
            }
        }
    }
}
