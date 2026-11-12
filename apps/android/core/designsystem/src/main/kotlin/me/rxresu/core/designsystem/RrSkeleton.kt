package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Placeholder block in `sunken`, at the final size of what it stands for. Still: no shimmer, no pulse. Hidden from
 * TalkBack; announce loading with words elsewhere (a "Loading…" label or the screen title).
 */
@Composable
fun RrSkeleton(modifier: Modifier = Modifier, shape: Shape = RrShape.sm) {
    Box(modifier.clip(shape).background(RrTheme.colors.sunken).rrClearAndSetSemantics { })
}

/** Text-line placeholders: [lines] bars of [lineHeight], the last one shorter. */
@Composable
fun RrSkeletonText(modifier: Modifier = Modifier, lines: Int = 2, lineHeight: Dp = 12.dp) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        repeat(lines) { i -> RrSkeleton(Modifier.fillMaxWidth(if (i == lines - 1 && lines > 1) 0.6f else 1f).height(lineHeight)) }
    }
}

@RrPreviews
@Composable
internal fun RrSkeletonPreview() = RrPreviewSurface {
    RrSkeleton(Modifier.fillMaxWidth().height(52.dp), RrShape.lg)
    RrSkeletonText(lines = 3)
}
