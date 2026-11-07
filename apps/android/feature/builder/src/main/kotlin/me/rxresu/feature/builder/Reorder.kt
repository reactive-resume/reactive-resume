package me.rxresu.feature.builder

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.zIndex
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.RrElevation
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.designsystem.rrShadow

/** Where the dragged row lands: past half of a neighbour's height it swaps with that neighbour. Pure for tests. */
internal object ReorderMath {
    fun target(from: Int, offset: Float, heights: List<Int>): Int {
        var index = from
        var rest = offset
        if (offset > 0) while (index < heights.lastIndex && rest > heights[index + 1] / 2f) { rest -= heights[index + 1]; index++ }
        else while (index > 0 && -rest > heights[index - 1] / 2f) { rest += heights[index - 1]; index-- }
        return index
    }
}

/**
 * A column whose rows lift on long-press and drag to reorder (`medium` on lift, `selection` per slot, `rigid` on
 * drop). Commits once with [onMove] on drop. A long-press released in place calls [onActions] (the row's menu, the
 * non-drag path). Rows also expose Move up / Move down to accessibility through [row]'s own semantics.
 */
@Composable
internal fun <T> ReorderColumn(
    items: List<T>,
    key: (T) -> Any,
    onMove: (from: Int, to: Int) -> Unit,
    onActions: (T) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    row: @Composable (item: T, lifted: Boolean) -> Unit,
) {
    val haptics = rememberRrHaptics()
    val reduced = LocalReducedMotion.current
    val heights = remember(items.size) { mutableStateListOf(*Array(items.size) { 0 }) }
    var dragging by remember { mutableIntStateOf(-1) }
    var offset by remember { mutableFloatStateOf(0f) }
    var slot by remember { mutableIntStateOf(-1) }
    Column(modifier) {
        items.forEachIndexed { index, item ->
            val lifted = index == dragging
            // Rows between the lifted row and its slot shift by the lifted row's height.
            val shift = when {
                dragging < 0 || lifted -> 0f
                index in (dragging + 1)..slot -> -heights.getOrElse(dragging) { 0 }.toFloat()
                index in slot until dragging -> heights.getOrElse(dragging) { 0 }.toFloat()
                else -> 0f
            }
            val animatedShift by animateFloatAsState(shift, label = "reorder-shift")
            val scale by animateFloatAsState(if (lifted && !reduced) 1.02f else 1f, label = "reorder-lift")
            Box(
                Modifier
                    .zIndex(if (lifted) 1f else 0f)
                    .onSizeChanged { if (index < heights.size) heights[index] = it.height }
                    .graphicsLayer { translationY = if (lifted) offset else animatedShift; scaleX = scale; scaleY = scale }
                    .then(if (lifted) Modifier.rrShadow(RrElevation.Level2) else Modifier)
                    .then(if (!enabled) Modifier else Modifier.pointerInput(key(item), items.size) {
                        var moved = false
                        detectDragGesturesAfterLongPress(
                            onDragStart = { dragging = index; slot = index; offset = 0f; moved = false; haptics(RrHaptic.Medium) },
                            onDrag = { change, amount ->
                                change.consume(); offset += amount.y; moved = true
                                val next = ReorderMath.target(dragging, offset, heights)
                                if (next != slot) { slot = next; haptics(RrHaptic.Selection) }
                            },
                            onDragEnd = {
                                val from = dragging; val to = slot
                                dragging = -1; offset = 0f; slot = -1
                                if (!moved) onActions(item) else { haptics(RrHaptic.Rigid); if (from != to) onMove(from, to) }
                            },
                            onDragCancel = { dragging = -1; offset = 0f; slot = -1 },
                        )
                    }),
            ) { row(item, lifted) }
        }
    }
}

internal fun <T> List<T>.moved(from: Int, to: Int): List<T> = toMutableList().apply { add(to, removeAt(from)) }
