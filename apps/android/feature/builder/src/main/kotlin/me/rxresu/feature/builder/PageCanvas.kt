package me.rxresu.feature.builder

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlinx.coroutines.launch
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrLayout
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrPaperPage
import me.rxresu.core.designsystem.RrShape
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.strings.R as S

private val Gutter = 16.dp
private val PageGap = 16.dp

/** Zoom limits (boards/Motion.png "The page"): 60–300%, rubber band a little past both, double tap fit ↔ 200%. */
internal object PageZoom {
    const val MIN = 0.6f
    const val MAX = 3f
    const val DOUBLE = 2f

    /** Resistance past the limits while pinching: a third of the overshoot. */
    fun rubber(scale: Float) = when {
        scale < MIN -> MIN - (MIN - scale) / 3f
        scale > MAX -> MAX + (scale - MAX) / 3f
        else -> scale
    }

    /**
     * The page's vertical offset that puts a block ([top], [bottom]: px from the content's top at the current scale)
     * [clearance] above a sheet covering [cover] px of a [windowHeight] window, for a canvas starting [viewTop] down the
     * window. The block's top never goes above the [gutter]; the page never moves down past its start.
     */
    fun clearOfSheet(top: Float, bottom: Float, viewTop: Float, windowHeight: Float, cover: Float, clearance: Float, gutter: Float): Float {
        val bottomLimit = windowHeight - cover - viewTop - clearance
        return (bottomLimit - bottom).coerceAtLeast(gutter - top).coerceAtMost(0f)
    }

    /** Offset that keeps content of [content] px inside [viewport] px (centred when smaller). */
    fun clamp(offset: Float, content: Float, viewport: Float) =
        if (content <= viewport) (viewport - content) / 2f else offset.coerceIn(viewport - content, 0f)
}

/** Scale (1 = fit to width) and pan of the page stack, in px. */
@Stable
internal class PageZoomState {
    val scale = Animatable(1f)
    val x = Animatable(0f)
    val y = Animatable(0f)
}

/**
 * The page view: rendered pages on the sunken canvas, fit to width, pinch zoom with rubber band, double tap fit and
 * 200%, pan between pages. A tap reports the page and its position in fractions of the page. [highlight] draws the
 * accent outline (with [highlightLabel] above it); [sheetCover] scrolls it into the space above a sheet.
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
    /**
     * The window height a sheet covers from the bottom, in px, read every frame (the entry sheet's live height, keyboard
     * included); the highlight stays in the space above it. Null when no sheet covers the page.
     */
    sheetCover: (() -> Float)? = null,
    zoom: PageZoomState = remember { PageZoomState() },
    onZoomChange: (Float) -> Unit = {},
    pageCountHint: Int = 1,
) {
    val density = LocalDensity.current
    val reduced = LocalReducedMotion.current
    val inspection = androidx.compose.ui.platform.LocalInspectionMode.current
    val haptics = rememberRrHaptics()
    val scope = rememberCoroutineScope()
    val slop = LocalViewConfiguration.current.touchSlop
    var topInWindow by remember { mutableFloatStateOf(0f) }
    val windowHeight = androidx.compose.ui.platform.LocalWindowInfo.current.containerSize.height.toFloat()
    BoxWithConstraints(modifier.fillMaxSize().background(RrTheme.colors.sunken).onGloballyPositioned { topInWindow = it.positionInWindow().y }) {
        val viewW = constraints.maxWidth.toFloat()
        val viewH = constraints.maxHeight.toFloat()
        val gutter = with(density) { Gutter.toPx() }
        val gap = with(density) { PageGap.toPx() }
        val pageW = viewW - 2 * gutter
        val pageH = pageW / RrLayout.PAGE_ASPECT
        val count = pages.size.coerceAtLeast(pageCountHint)
        val contentH = gutter * 2 + count * pageH + (count - 1).coerceAtLeast(0) * gap

        fun settle(scale: Float = zoom.scale.value, animate: Boolean = true) = scope.launch {
            val s = scale.coerceIn(PageZoom.MIN, PageZoom.MAX)
            val tx = PageZoom.clamp(zoom.x.value, viewW * s, viewW)
            val ty = if (contentH * s <= viewH) 0f else zoom.y.value.coerceIn(viewH - contentH * s, 0f)
            val spec = tween<Float>(if (animate && !reduced) RrMotion.D2 else 0, easing = RrMotion.ease)
            launch { zoom.scale.animateTo(s, spec) }; launch { zoom.x.animateTo(tx, spec) }; zoom.y.animateTo(ty, spec)
            onZoomChange(s)
        }

        // Keep the picked block in the space above the sheet: its bottom 16 dp above the sheet's current top, its top
        // never hidden. A newly picked block glides there (d3); while the sheet moves (detent, drag, keyboard) the page
        // follows it in the same frame.
        LaunchedEffect(highlight, blocks, sheetCover != null) {
            val block = blocks?.firstOrNull { it.target == highlight } ?: return@LaunchedEffect
            val cover = sheetCover ?: return@LaunchedEffect
            var first = true
            snapshotFlow { cover() }.collect { covered ->
                val s = zoom.scale.value
                val top = (gutter + block.page * (pageH + gap) + block.top * pageH) * s
                val bottom = (gutter + block.page * (pageH + gap) + block.bottom * pageH) * s
                val target = PageZoom.clearOfSheet(top, bottom, topInWindow, windowHeight, covered, with(density) { 16.dp.toPx() }, gutter)
                if (first && !inspection && !reduced) zoom.y.animateTo(target, tween(RrMotion.D3, easing = RrMotion.ease)) else zoom.y.snapTo(target)
                first = false
            }
        }

        Box(
            Modifier.fillMaxSize()
                .pointerInput(viewW, viewH, count) {
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false)
                        var transforming = false
                        var moved = Offset.Zero
                        do {
                            val event = awaitPointerEvent()
                            val zoomChange = event.calculateZoom()
                            val pan = event.calculatePan()
                            if (!transforming) {
                                moved += pan
                                transforming = abs(moved.getDistance()) > slop || abs(zoomChange - 1f) > 0.02f || event.changes.size > 1
                            }
                            if (transforming) {
                                val centroid = event.calculateCentroid(useCurrent = false)
                                val old = zoom.scale.value
                                val next = PageZoom.rubber((old * zoomChange).coerceIn(PageZoom.MIN / 1.5f, PageZoom.MAX * 1.3f))
                                val ratio = next / old
                                scope.launch {
                                    zoom.scale.snapTo(next)
                                    zoom.x.snapTo(centroid.x - (centroid.x - zoom.x.value) * ratio + pan.x)
                                    zoom.y.snapTo(centroid.y - (centroid.y - zoom.y.value) * ratio + pan.y)
                                }
                                event.changes.forEach { if (it.positionChanged()) it.consume() }
                            }
                        } while (event.changes.any { it.pressed })
                        if (transforming) settle()
                    }
                }
                .pointerInput(viewW, count, blocks) {
                    detectTapGestures(
                        onDoubleTap = { at ->
                            val target = if (zoom.scale.value > 1.05f) 1f else PageZoom.DOUBLE
                            val ratio = target / zoom.scale.value
                            scope.launch { zoom.x.snapTo(at.x - (at.x - zoom.x.value) * ratio); zoom.y.snapTo(at.y - (at.y - zoom.y.value) * ratio) }
                            settle(target)
                        },
                        onTap = { at ->
                            val s = zoom.scale.value
                            val cx = (at.x - zoom.x.value) / s - gutter
                            val cy = (at.y - zoom.y.value) / s - gutter
                            val page = (cy / (pageH + gap)).toInt()
                            val py = cy - page * (pageH + gap)
                            if (page in 0 until count && cx in 0f..pageW && py in 0f..pageH) {
                                haptics(RrHaptic.Light)
                                onTap(page, cx / pageW, py / pageH)
                            }
                        },
                    )
                },
        ) {
            Column(
                Modifier.fillMaxWidth()
                    .graphicsLayer {
                        transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 0f)
                        scaleX = zoom.scale.value; scaleY = zoom.scale.value
                        translationX = zoom.x.value; translationY = zoom.y.value
                    }
                    .padding(Gutter),
                verticalArrangement = Arrangement.spacedBy(PageGap),
            ) {
                repeat(count) { index ->
                    val description = stringResource(S.string.page_0_of_1, "${index + 1}", "$count")
                    RrPaperPage(pages.getOrNull(index), description, Modifier.fillMaxWidth()) {
                        if (highlight != null) blocks?.filter { it.page == index && it.target == highlight }?.forEach { Highlight(it, highlightLabel, reduced) }
                        markers.forEach { (target, number) ->
                            blocks?.firstOrNull { it.page == index && it.target == target }?.let { Marker(it, number) }
                        }
                    }
                }
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

