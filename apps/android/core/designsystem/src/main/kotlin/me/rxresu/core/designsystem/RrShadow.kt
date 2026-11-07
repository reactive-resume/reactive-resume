package me.rxresu.core.designsystem

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp

/** Elevation levels from the design system. */
enum class RrElevation {
    /** e1: cards, the selected segment, switch thumbs. */
    Level1,

    /** e2: menus, popovers, tooltips. */
    Level2,

    /** e3: dialogs, sheets, toasts. */
    Level3,

    /** The paper page on the canvas. */
    Page,
}

private data class Layer(val y: Dp, val blur: Dp, val spread: Dp, val color: Color)

private fun layers(level: RrElevation, dark: Boolean): List<Layer> = when (level) {
    RrElevation.Level1 -> if (dark) listOf(Layer(1.dp, 2.dp, 0.dp, Color(0x66000000)))
    else listOf(Layer(1.dp, 2.dp, 0.dp, Color(0x12171611)))
    RrElevation.Level2 -> if (dark) listOf(Layer(1.dp, 2.dp, 0.dp, Color(0x66000000)), Layer(12.dp, 32.dp, (-8).dp, Color(0x8C000000)))
    else listOf(Layer(1.dp, 2.dp, 0.dp, Color(0x0F171611)), Layer(10.dp, 28.dp, (-8).dp, Color(0x2E171611)))
    RrElevation.Level3 -> if (dark) listOf(Layer(2.dp, 6.dp, 0.dp, Color(0x66000000)), Layer(28.dp, 64.dp, (-12).dp, Color(0xB2000000)))
    else listOf(Layer(2.dp, 6.dp, 0.dp, Color(0x14171611)), Layer(28.dp, 64.dp, (-16).dp, Color(0x4C171611)))
    RrElevation.Page -> if (dark) listOf(Layer(1.dp, 2.dp, 0.dp, Color(0x66000000)), Layer(12.dp, 36.dp, (-12).dp, Color(0x99000000)))
    else listOf(Layer(1.dp, 2.dp, 0.dp, Color(0x14171611)), Layer(12.dp, 36.dp, (-12).dp, Color(0x40171611)))
}

/**
 * Design-system drop shadow ([level]) for the current theme, drawn behind [shape]. Apply before `background` and `clip`.
 * CSS blur values map to the shadow radius one to one.
 */
@Composable
fun Modifier.rrShadow(level: RrElevation, shape: Shape = RectangleShape): Modifier {
    var m: Modifier = this
    for (l in layers(level, LocalRrColors.current.isDark)) {
        m = m.dropShadow(shape, Shadow(radius = l.blur, color = l.color, spread = l.spread, offset = DpOffset(0.dp, l.y)))
    }
    return m
}
