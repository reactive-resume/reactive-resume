package me.rxresu.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

/** An action revealed by swiping a row; also offered to TalkBack as a custom action with [label]. */
data class RrSwipeAction(
    val label: String,
    @DrawableRes val icon: Int,
    val danger: Boolean = false,
    val onCommit: () -> Unit,
)

/** Swipe decisions, kept pure for tests. Offsets are logical: negative = toward the start edge. */
object RrSwipeMath {
    /** Crossing 40% of the row width arms the action (plays `light`); releasing past it commits. */
    const val THRESHOLD = 0.4f

    fun armed(offset: Float, width: Float): Boolean = width > 0f && abs(offset) >= width * THRESHOLD

    /** Where the row goes on release: fully off toward the swipe (commit) or back to 0. */
    fun settleTarget(offset: Float, width: Float): Float = if (armed(offset, width)) (if (offset < 0) -width else width) else 0f
}

/**
 * Row with swipe actions. Swipe toward the start for [startAction] (usually Move to Trash, danger), toward the end for
 * [endAction] (Move to the next stage). The action shows behind the row; crossing 40% plays `light`; releasing past it
 * slides the row away and calls the action (the caller shows the Undo toast). The same actions must also exist in the
 * row's actions sheet; TalkBack gets them as custom actions here.
 */
@Composable
fun RrSwipeRow(
    modifier: Modifier = Modifier,
    startAction: RrSwipeAction? = null,
    endAction: RrSwipeAction? = null,
    content: @Composable () -> Unit,
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val scope = rememberCoroutineScope()
    val reduced = LocalReducedMotion.current
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val offset = remember { Animatable(0f) }
    var width by remember { mutableIntStateOf(0) }
    val start by rememberUpdatedState(startAction)
    val end by rememberUpdatedState(endAction)
    var wasArmed by remember { mutableIntStateOf(0) }

    val drag = rememberDraggableState { delta ->
        // Logical delta: toward start is negative in both directions.
        val logical = if (rtl) -delta else delta
        val next = (offset.value + logical).coerceIn(if (start != null) -width.toFloat() else 0f, if (end != null) width.toFloat() else 0f)
        scope.launch { offset.snapTo(next) }
        val armed = RrSwipeMath.armed(next, width.toFloat())
        if (armed && wasArmed == 0) haptics(RrHaptic.Light)
        wasArmed = if (armed) 1 else 0
    }
    val revealed = when {
        offset.value < 0 -> startAction
        offset.value > 0 -> endAction
        else -> null
    }
    Box(
        modifier
            .onSizeChanged { width = it.width }
            .semantics {
                customActions = listOfNotNull(startAction, endAction).map { a -> CustomAccessibilityAction(a.label) { a.onCommit(); true } }
            },
    ) {
        if (revealed != null) {
            val bg = if (revealed.danger) c.danger else c.accent
            val fg = if (revealed.danger) RrFixedColors.onDanger else c.onAccent
            Box(Modifier.matchParentSize().background(bg), contentAlignment = if (offset.value < 0) Alignment.CenterEnd else Alignment.CenterStart) {
                Column(
                    Modifier.width(96.dp).fillMaxHeight(),
                    verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    RrIcon(revealed.icon, null, tint = fg)
                    RrText(revealed.label, style = RrType.caption, color = fg)
                }
            }
        }
        Box(
            Modifier
                .offset { IntOffset(offset.value.roundToInt(), 0) }
                .draggable(
                    drag,
                    Orientation.Horizontal,
                    enabled = startAction != null || endAction != null,
                    onDragStopped = {
                        val target = RrSwipeMath.settleTarget(offset.value, width.toFloat())
                        val action = if (target < 0) start else if (target > 0) end else null
                        offset.animateTo(target, if (reduced) tween(0) else tween(RrMotion.D2, easing = RrMotion.easeOutStrong))
                        wasArmed = 0
                        if (action != null) {
                            action.onCommit()
                            offset.snapTo(0f)
                        }
                    },
                ),
        ) { content() }
    }
}

@RrPreviews
@Composable
internal fun RrSwipeRowPreview() = RrPreviewSurface {
    RrListGroup {
        RrSwipeRow(startAction = RrSwipeAction("Move to Trash", R.drawable.ic_ph_trash, danger = true) {}) {
            RrListRow("Lumen letter", subtitle = "Cover letter · Edited today", icon = R.drawable.ic_ph_file_text, onClick = {})
        }
    }
}
