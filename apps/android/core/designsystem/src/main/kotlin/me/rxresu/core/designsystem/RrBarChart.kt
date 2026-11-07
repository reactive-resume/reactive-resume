package me.rxresu.core.designsystem

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

/**
 * Daily bars (B13 views over 30 days): 48 dp tall, 3 dp gaps, accent at 85% with 1 dp top corners; oldest at the start
 * (mirrored in RTL). Bars grow in d3 on first show (still under reduced motion and in captures). With [onSelect], a tap
 * picks a day and the others dim; TalkBack reads [contentDescription] ("Daily views over 30 days, peak 14") and gets
 * previous and next day actions.
 *
 * @param values one value per bar, 0 or more.
 * @param previousLabel, nextLabel the TalkBack action names; both are needed for the actions to appear.
 */
@Composable
fun RrBarChart(
    values: List<Float>,
    contentDescription: String,
    modifier: Modifier = Modifier,
    selected: Int? = null,
    onSelect: ((Int) -> Unit)? = null,
    previousLabel: String? = null,
    nextLabel: String? = null,
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val still = LocalInspectionMode.current || RrTheme.reducedMotion
    var shown by remember { mutableStateOf(still) }
    LaunchedEffect(Unit) { shown = true }
    val progress by animateFloatAsState(if (shown) 1f else 0f, tween(if (still) 0 else RrMotion.D3, easing = RrMotion.ease), label = "bars")
    val peak = (values.maxOrNull() ?: 0f).coerceAtLeast(1f)
    fun choose(index: Int) {
        if (values.isEmpty() || onSelect == null) return
        val i = index.coerceIn(values.indices)
        if (i != selected) haptics(RrHaptic.Selection)
        onSelect(i)
    }
    Canvas(
        modifier
            .fillMaxWidth()
            .height(48.dp)
            .then(
                if (onSelect == null) Modifier else Modifier.pointerInput(values.size, rtl) {
                    detectTapGestures { p ->
                        val i = (p.x / size.width * values.size).toInt().coerceIn(0, (values.size - 1).coerceAtLeast(0))
                        choose(if (rtl) values.lastIndex - i else i)
                    }
                },
            )
            .clearAndSetSemantics {
                this.contentDescription = contentDescription
                if (onSelect != null && previousLabel != null && nextLabel != null) {
                    customActions = listOf(
                        CustomAccessibilityAction(previousLabel) { choose((selected ?: values.size) - 1); true },
                        CustomAccessibilityAction(nextLabel) { choose((selected ?: -1) + 1); true },
                    )
                }
            },
    ) {
        if (values.isEmpty()) return@Canvas
        val gap = 3.dp.toPx()
        val corner = CornerRadius(1.dp.toPx())
        val w = (size.width - gap * (values.size - 1)) / values.size
        values.forEachIndexed { i, v ->
            val h = (size.height * v / peak * progress).coerceAtLeast(1f)
            val x = (if (rtl) values.lastIndex - i else i) * (w + gap)
            val alpha = when {
                selected == null -> 0.85f
                selected == i -> 1f
                else -> 0.35f
            }
            val path = Path().apply {
                addRoundRect(RoundRect(x, size.height - h, x + w, size.height, topLeftCornerRadius = corner, topRightCornerRadius = corner))
            }
            drawPath(path, c.accent.copy(alpha = alpha))
        }
    }
}

@RrPreviews
@Composable
internal fun RrBarChartPreview() = RrPreviewSurface {
    val views = listOf(20, 15, 30, 25, 10, 5, 35, 45, 30, 20, 15, 25, 55, 100, 70, 40, 30, 20, 10, 15, 35, 25, 20, 45, 30, 15, 10, 20, 30, 40)
    RrBarChart(views.map { it.toFloat() }, "Daily views over 30 days, peak 14")
    RrBarChart(views.map { it.toFloat() }, "Daily views over 30 days, peak 14", selected = 13, onSelect = {})
}
