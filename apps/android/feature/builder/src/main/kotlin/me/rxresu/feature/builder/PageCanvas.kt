package me.rxresu.feature.builder

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrPageCanvas
import me.rxresu.core.designsystem.RrPageFocus
import me.rxresu.core.designsystem.RrPageZoomState
import me.rxresu.core.designsystem.RrShape
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.strings.R as S

/**
 * The page view (B1): [RrPageCanvas] with the builder's blocks. [highlight] draws the accent outline (with
 * [highlightLabel] above it) and, with [sheetCover], stays in the space above the entry sheet; [markers] number Check's
 * issues on their blocks.
 */
@Composable
internal fun PageCanvas(
    pages: List<ImageBitmap>,
    blocks: List<PageBlock>?,
    onTap: (page: Int, x: Float, y: Float) -> Unit,
    modifier: Modifier = Modifier,
    highlight: BlockTarget? = null,
    highlightLabel: String? = null,
    markers: List<Pair<BlockTarget, Int>> = emptyList(),
    /** The entry sheet's live height in px, read every frame; see [RrPageCanvas]. */
    sheetCover: (() -> Float)? = null,
    zoom: RrPageZoomState = remember { RrPageZoomState() },
    onZoomChange: (Float) -> Unit = {},
    pageCountHint: Int = 1,
    hint: String? = null,
    rasterIssueMarkers: List<me.rxresu.core.page.RasterIssueMarker> = emptyList(),
) {
    val reduced = LocalReducedMotion.current
    val focus = blocks?.firstOrNull { it.target == highlight }?.let { RrPageFocus(it.page, it.top, it.bottom) }
    RrPageCanvas(pages, onTap, modifier, pageCount = pageCountHint, focus = focus, sheetCover = sheetCover, zoom = zoom, onZoomChange = onZoomChange, hint = hint) { index ->
        if (highlight != null) blocks?.filter { it.page == index && it.target == highlight }?.forEach { Highlight(it, highlightLabel, reduced) }
        markers.forEach { (target, number) ->
            blocks?.firstOrNull { it.page == index && it.target == target }?.let { Marker(it, number) }
        }
        rasterIssueMarkers.filter { it.page == index }.forEach { marker ->
            // Visible overlay supplies the current theme's token over the renderer's baked marker.
            BoxWithConstraints(Modifier.matchParentSize()) {
                me.rxresu.core.designsystem.RrIssueMarker(marker.number,
                    Modifier.offset(x = maxWidth * marker.x - 8.dp, y = maxHeight * marker.y - 8.dp))
            }
        }
    }
}

/** The accent outline (2 dp, 3 dp outside the block) and its label tab, fading in over d1. */
@Composable
private fun BoxScope.Highlight(block: PageBlock, label: String?, reduced: Boolean) {
    val alpha = remember(block) { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(block) { alpha.animateTo(1f, tween(RrMotion.D1)) }
    val c = RrTheme.colors
    BoxWithConstraints(Modifier.matchParentSize().alpha(alpha.value)) {
        val w = maxWidth
        val h = maxHeight
        val outset = 3.dp
        Canvas(Modifier.matchParentSize()) {
            val o = outset.toPx()
            drawRoundRect(
                c.accent,
                topLeft = Offset(block.left * size.width - o, block.top * size.height - o),
                size = Size((block.right - block.left) * size.width + 2 * o, (block.bottom - block.top) * size.height + 2 * o),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(1.dp.toPx()),
                style = Stroke(2.dp.toPx()),
            )
        }
        if (label != null) {
            RrText(
                label,
                style = RrType.caption,
                color = c.onAccent,
                maxLines = 1,
                modifier = Modifier.offset(x = w * block.left - 5.dp, y = h * block.top - 22.dp)
                    .background(c.accent, RrShape.sm).padding(horizontal = 6.dp, vertical = 1.dp),
            )
        }
    }
}

/** Check issue marker: the issue number on a warn square at the block's top start. */
@Composable
private fun BoxScope.Marker(block: PageBlock, number: Int) {
    val c = RrTheme.colors
    BoxWithConstraints(Modifier.matchParentSize()) {
        Box(
            Modifier.offset(x = maxWidth * block.left - 20.dp, y = maxHeight * block.top).size(16.dp).background(c.warn, RrShape.sm),
            contentAlignment = Alignment.Center,
        ) { RrText("$number", style = RrType.caption, color = c.warnInk) }
    }
}

/** "Page 1 of 2 · 100%" in Geist Mono. */
@Composable
internal fun PagePosition(page: Int, count: Int, scale: Float, modifier: Modifier = Modifier) {
    RrText(
        stringResource(S.string.page_0_of_1, "$page", "$count") + " · ${(scale * 100).toInt()}%",
        style = RrType.mono,
        color = RrTheme.colors.ink3,
        modifier = modifier,
    )
}

