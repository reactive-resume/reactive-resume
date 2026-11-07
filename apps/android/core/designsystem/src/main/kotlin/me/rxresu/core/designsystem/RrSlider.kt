package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * Slider: 4 dp sunken track with an accent value and a 20 dp round knob. Tap or drag anywhere on its 44 dp row. With
 * [steps] > 0 the value snaps and plays `selection` at each detent. TalkBack reads [valueDescription] and can set it.
 *
 * @param steps number of detents between the ends (0 = continuous).
 */
@Composable
fun RrSlider(
    value: Float,
    onValueChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
    valueRange: ClosedFloatingPointRange<Float> = 0f..1f,
    steps: Int = 0,
    enabled: Boolean = true,
    valueDescription: String? = null,
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val current by rememberUpdatedState(value)
    val span = valueRange.endInclusive - valueRange.start
    val fraction = if (span == 0f) 0f else ((value - valueRange.start) / span).coerceIn(0f, 1f)

    fun snap(f: Float): Float {
        val clamped = f.coerceIn(0f, 1f)
        val stepped = if (steps > 0) (clamped * (steps + 1)).roundToInt() / (steps + 1).toFloat() else clamped
        return valueRange.start + stepped * span
    }

    fun emit(v: Float) {
        if (v == current) return
        if (steps > 0) haptics(RrHaptic.Selection)
        onValueChange(v)
    }

    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .height(44.dp)
            .semantics {
                progressBarRangeInfo = ProgressBarRangeInfo(value, valueRange, steps)
                if (valueDescription != null) stateDescription = valueDescription
                if (enabled) setProgress { emit(snap((it - valueRange.start) / span)); true }
            }
            .then(
                if (!enabled) Modifier else Modifier
                    .pointerInput(span, steps, rtl) {
                        detectTapGestures { p -> emit(snap(position(p.x, size.width.toFloat(), rtl))) }
                    }
                    .pointerInput(span, steps, rtl) {
                        detectHorizontalDragGestures { change, _ ->
                            emit(snap(position(change.position.x, size.width.toFloat(), rtl)))
                        }
                    },
            ),
        contentAlignment = Alignment.CenterStart,
    ) {
        val knob = 20.dp
        val track = maxWidth - knob
        Box(
            Modifier.offset(x = knob / 2).size(track, 4.dp).clip(RrShape.sm).background(c.sunken).border(1.dp, c.controlBorder, RrShape.sm),
        ) {
            Box(Modifier.fillMaxWidth(fraction).height(4.dp).clip(RrShape.sm).background(c.accent))
        }
        Box(
            Modifier
                .offset(x = track * fraction)
                .rrShadow(RrElevation.Level1, RrShape.full)
                .size(knob)
                .clip(RrShape.full)
                .background(c.raised)
                .border(1.dp, c.controlBorder, RrShape.full),
        )
    }
}

/** Fraction along the track for a pointer at [x] (track inset by the knob radius). */
private fun androidx.compose.ui.unit.Density.position(x: Float, width: Float, rtl: Boolean): Float {
    val r = 10.dp.toPx()
    val f = ((x - r) / (width - 2 * r)).coerceIn(0f, 1f)
    return if (rtl) 1f - f else f
}

@RrPreviews
@Composable
internal fun RrSliderPreview() = RrPreviewSurface {
    RrSlider(0.45f, {})
    RrSlider(3f, {}, valueRange = 0f..10f, steps = 9, valueDescription = "3")
}
