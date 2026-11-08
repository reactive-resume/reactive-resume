package me.rxresu.core.designsystem

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import me.rxresu.core.strings.R as S

/**
 * Live mic level while recording (W4): [bars] equal-width accent bars fill the row with 4 dp gaps, up to 56 dp tall
 * for normalized levels 0 to 1 (newest last). Unrecorded bars sit dim at 6%. Feed real levels about 15 times a second. Reduced motion
 * shows one static 200 dp level meter of the newest level instead. Decorative: the timer beside it carries the state.
 */
@Composable
fun RrWaveform(levels: List<Float>, modifier: Modifier = Modifier, bars: Int = 24) {
    val c = RrTheme.colors
    if (LocalReducedMotion.current) {
        Box(modifier.rrClearAndSetSemantics {}.width(200.dp).height(4.dp).clip(RrShape.xs).background(c.sunken)) {
            Box(Modifier.fillMaxWidth((levels.lastOrNull() ?: 0f).coerceIn(0f, 1f)).height(4.dp).background(c.accent))
        }
        return
    }
    Row(
        modifier.rrClearAndSetSemantics {}.fillMaxWidth().height(56.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        repeat(bars) { i ->
            val level = levels.getOrNull(i)?.coerceIn(0f, 1f)
            Box(
                Modifier.weight(1f).height(if (level == null) 56.dp * 0.06f else 56.dp * level)
                    .then(if (level == null) Modifier.alpha(0.4f) else Modifier)
                    .clip(androidx.compose.foundation.shape.RoundedCornerShape(topStart = 1.dp, topEnd = 1.dp)).background(c.accent),
            )
        }
    }
}

/**
 * The record control (W4 and Debrief: 72 dp, 20 dp corners). Idle it is accent with a
 * microphone ("Record your answer"); while [recording] it is danger with stop ("Stop recording"). The fill morphs at d1
 * (instant under reduced motion). The icon is 4/9 of [size] (32 dp at 72).
 */
@Composable
fun RrRecordButton(recording: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, size: Dp = 72.dp) {
    val c = RrTheme.colors
    val reduced = LocalReducedMotion.current
    val fill by animateColorAsState(if (recording) c.danger else c.accent, RrMotion.spec(RrMotion.D1, reduced), label = "record")
    val label = stringResource(if (recording) S.string.stop_recording else S.string.record_your_answer)
    Box(
        modifier.size(size.coerceAtLeast(RrLayout.minTouch)).rrDesignTag(DesignTag(component = "RecordButton", radius = RrRadius.record, bgName = if (recording) "danger" else "accent")).clip(androidx.compose.foundation.shape.RoundedCornerShape(RrRadius.record)).background(fill)
            .clickable(role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        if (recording) RrIcon(R.drawable.ic_ph_stop_fill, null, size = size * 4 / 9, tint = RrFixedColors.onDanger, colorName = "#ffffff")
        else RrIcon(R.drawable.ic_ph_microphone, null, size = size * 4 / 9, tint = c.onAccent)
    }
}

@RrPreviews
@Composable
internal fun RrRecorderPreview() = RrPreviewSurface {
    RrWaveform(listOf(0.08f, 0.33f, 0.67f, 0.42f, 0.92f, 0.58f, 0.25f, 0.75f, 0.46f, 0.17f, 0.63f, 0.83f, 0.38f, 0.13f, 0.5f, 0.29f, 0.04f))
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        RrRecordButton(recording = false, onClick = {})
        RrRecordButton(recording = true, onClick = {})
        RrRecordButton(recording = false, onClick = {}, size = 44.dp)
    }
}
