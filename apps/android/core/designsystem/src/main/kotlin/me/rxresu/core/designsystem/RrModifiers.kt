package me.rxresu.core.designsystem

import androidx.compose.ui.graphics.graphicsLayer

import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** 1 dp dashed edge (empty states, "+ Tag", the "left out" context chip), dashes 3 dp on 3 dp. */
fun Modifier.rrDashedBorder(color: Color, radius: Dp, width: Dp = 1.dp): Modifier = drawBehind {
    val w = width.toPx()
    val d = 3.dp.toPx()
    drawRoundRect(
        color = color,
        topLeft = Offset(w / 2, w / 2),
        size = Size(size.width - w, size.height - w),
        cornerRadius = CornerRadius(radius.toPx()),
        style = Stroke(width = w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(d, d))),
    )
}

/** The text cursor: accent, hidden in previews and screenshot captures, where its blink would make goldens flaky. */
@androidx.compose.runtime.Composable
internal fun rrCursorBrush(color: androidx.compose.ui.graphics.Color): androidx.compose.ui.graphics.Brush =
    androidx.compose.ui.graphics.SolidColor(
        if (androidx.compose.ui.platform.LocalInspectionMode.current) androidx.compose.ui.graphics.Color.Transparent else color,
    )

/**
 * Fades a control while [enabled] is false. One layer in both states, never `Modifier.alpha`: that drops its layer at
 * 1f, and on devices the changed chain could stop drawing the control's fill once it was enabled again.
 */
fun Modifier.rrEnabledAlpha(enabled: Boolean, disabledAlpha: Float = 0.45f): Modifier =
    graphicsLayer { alpha = if (enabled) 1f else disabledAlpha }
