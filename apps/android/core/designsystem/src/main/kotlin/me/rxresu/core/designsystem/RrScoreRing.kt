package me.rxresu.core.designsystem

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Score ring (readability, job match): a 64 dp circle, `sunken` track with the score's share in accent (or warn below
 * [warnBelow]), the number in Instrument Serif 26 on `bg`. Always pair it with a words label ("Mostly readable").
 */
@Composable
/**
 * [warnBelow] turns the arc warn; [dangerBelow] (optional) turns it danger below that score. The ATS checker uses the
 * web's bands: 80 and up accent, 50–79 warn, under 50 danger.
 */
fun RrScoreRing(score: Int, modifier: Modifier = Modifier, size: Dp = 64.dp, warnBelow: Int = 70, dangerBelow: Int? = null) {
    val c = RrTheme.colors
    val value = score.coerceIn(0, 100)
    val arc = if (dangerBelow != null && value < dangerBelow) c.danger else if (value < warnBelow) c.warn else c.accent
    val description = stringResource(R.string.ds_score, value)
    Box(modifier.size(size).semantics { contentDescription = description }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(size).clearAndSetSemantics { }) {
            val w = (6.dp).toPx()
            // Filled conic ring: track, then the score's sweep from 12 o'clock, then the inner disc.
            drawCircle(c.sunken)
            drawArc(arc, startAngle = -90f, sweepAngle = 360f * value / 100f, useCenter = true, topLeft = Offset.Zero, size = Size(this.size.width, this.size.height))
            drawCircle(c.bg, radius = this.size.minDimension / 2 - w)
        }
        RrText("$value", style = RrType.sheetTitle.copy(fontSize = 26.sp, lineHeight = 28.sp), color = c.ink, modifier = Modifier.clearAndSetSemantics { })
    }
}

@RrPreviews
@Composable
internal fun RrScoreRingPreview() = RrPreviewSurface {
    androidx.compose.foundation.layout.Row(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(16.dp)) {
        RrScoreRing(86)
        RrScoreRing(54)
    }
}
