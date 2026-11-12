package me.rxresu.core.designsystem

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.isSpecified
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlinx.coroutines.launch
import me.rxresu.core.strings.R as S

private val Gutter = 16.dp
private val PageGap = 16.dp

/** Zoom limits (boards/Motion.png "The page"): 60–300%, rubber band a little past both, double tap fit ↔ 200%. */
object RrPageZoom {
    const val MIN = 0.6f
    const val MAX = 3f
    const val DOUBLE = 2f

    /** Resistance past the limits while pinching: a third of the overshoot. */
    fun rubber(scale: Float) = when {
        scale < MIN -> MIN - (MIN - scale) / 3f
        scale > MAX -> MAX + (scale - MAX) / 3f
        else -> scale
    }

    /** Offset that keeps content of [content] px inside [viewport] px (centred when smaller). */
    fun clamp(offset: Float, content: Float, viewport: Float) =
        if (content <= viewport) (viewport - content) / 2f else offset.coerceIn(viewport - content, 0f)

    /**
     * The page's vertical offset that puts a block ([top], [bottom]: px from the content's top at the current scale)
     * [clearance] above a sheet covering [cover] px of a [windowHeight] window, for a canvas starting [viewTop] down the
     * window. The block's top never goes above the [gutter]; the page never moves down past its start.
     */
    fun clearOfSheet(top: Float, bottom: Float, viewTop: Float, windowHeight: Float, cover: Float, clearance: Float, gutter: Float): Float {
        val bottomLimit = windowHeight - cover - viewTop - clearance
        return (bottomLimit - bottom).coerceAtLeast(gutter - top).coerceAtMost(0f)
    }
}

/** Scale (1 = fit to width) and pan of the page stack, in px. */
@Stable
class RrPageZoomState {
    val scale = Animatable(1f)
    val x = Animatable(0f)
    val y = Animatable(0f)
}

/** A part of one page, in fractions of the page, that [RrPageCanvas] keeps clear of a sheet. */
data class RrPageFocus(val page: Int, val top: Float, val bottom: Float)

/**
 * The page view (B1 resume, L1 letter): rendered pages on the sunken canvas, fit to width, pinch zoom with rubber band,
 * double tap fit and 200%, pan between pages. A tap on a page plays `light` and reports the page and its position in
 * fractions of the page. [overlay] draws on each page in its coordinates (block outlines, markers).
 *
 * @param pageCount pages to lay out even before their images arrive (at least [pages]' size).
 * @param focus with [sheetCover], the part of a page kept 16 dp above the sheet's current top.
 * @param sheetCover the window height a sheet covers from the bottom, in px, read every frame (a sheet's live height,
 *   keyboard included). A new [focus] glides there (d3); while the sheet moves the page follows in the same frame.
 */
@Composable
fun RrPageCanvas(
    pages: List<ImageBitmap>,
    onTap: (page: Int, x: Float, y: Float) -> Unit,
    modifier: Modifier = Modifier,
    pageCount: Int = pages.size,
    focus: RrPageFocus? = null,
    sheetCover: (() -> Float)? = null,
    zoom: RrPageZoomState = remember { RrPageZoomState() },
    onZoomChange: (Float) -> Unit = {},
    hint: String? = null,
    overlay: @Composable BoxScope.(page: Int) -> Unit = {},
) {
    val density = LocalDensity.current
    val reduced = LocalReducedMotion.current
    val inspection = LocalInspectionMode.current
    val haptics = rememberRrHaptics()
    val scope = rememberCoroutineScope()
    val slop = LocalViewConfiguration.current.touchSlop
    var topInWindow by remember { mutableFloatStateOf(0f) }
    val windowHeight = LocalWindowInfo.current.containerSize.height.toFloat()
    val tap by rememberUpdatedState(onTap)
    BoxWithConstraints(modifier.fillMaxSize().background(RrTheme.colors.sunken).onGloballyPositioned { topInWindow = it.positionInWindow().y }) {
        val viewW = constraints.maxWidth.toFloat()
        val viewH = constraints.maxHeight.toFloat()
        val gutter = with(density) { Gutter.toPx() }
        val gap = with(density) { PageGap.toPx() }
        val pageW = viewW - 2 * gutter
        val pageH = pageW / RrLayout.PAGE_ASPECT
        val count = pages.size.coerceAtLeast(pageCount)
        val contentH = gutter * 2 + count * pageH + (count - 1).coerceAtLeast(0) * gap

        fun settle(scale: Float = zoom.scale.value, animate: Boolean = true) = scope.launch {
            // Animatable throws on NaN; anything non-finite settles back to fit-to-width at the top.
            fun Float.finite(fallback: Float) = if (isFinite()) this else fallback
            val s = scale.finite(1f).coerceIn(RrPageZoom.MIN, RrPageZoom.MAX)
            val tx = RrPageZoom.clamp(zoom.x.value.finite(0f), viewW * s, viewW)
            val ty = if (contentH * s <= viewH) 0f else zoom.y.value.finite(0f).coerceIn(viewH - contentH * s, 0f)
            val spec = tween<Float>(if (animate && !reduced) RrMotion.D2 else 0, easing = RrMotion.ease)
            // An animation from a non-finite value throws too, so that value jumps straight to its target.
            suspend fun Animatable<Float, AnimationVector1D>.glide(target: Float) = if (value.isFinite()) animateTo(target, spec) else snapTo(target)
            launch { zoom.scale.glide(s) }; launch { zoom.x.glide(tx) }; zoom.y.glide(ty)
            onZoomChange(s)
        }

        // Keep the focus in the space above the sheet: its bottom 16 dp above the sheet's current top, its top never
        // hidden.
        LaunchedEffect(focus, sheetCover != null) {
            val block = focus ?: return@LaunchedEffect
            val cover = sheetCover ?: return@LaunchedEffect
            var first = true
            snapshotFlow { cover() }.collect { covered ->
                val s = zoom.scale.value
                val top = (gutter + block.page * (pageH + gap) + block.top * pageH) * s
                val bottom = (gutter + block.page * (pageH + gap) + block.bottom * pageH) * s
                val target = RrPageZoom.clearOfSheet(top, bottom, topInWindow, windowHeight, covered, with(density) { 16.dp.toPx() }, gutter)
                if (first && !inspection && !reduced) zoom.y.animateTo(target, tween(RrMotion.D3, easing = RrMotion.ease)) else zoom.y.snapTo(target)
                first = false
            }
        }

        Box(
            // Pages panned or zoomed past the canvas never draw over the bars around it.
            Modifier.fillMaxSize().clipToBounds()
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
                                // Unspecified (NaN) when no finger was down in the previous event, as a finger lands or lifts.
                                val centroid = event.calculateCentroid(useCurrent = false)
                                if (centroid.isSpecified) {
                                    val old = zoom.scale.value
                                    val next = RrPageZoom.rubber((old * zoomChange).coerceIn(RrPageZoom.MIN / 1.5f, RrPageZoom.MAX * 1.3f))
                                    val ratio = next / old
                                    scope.launch {
                                        zoom.scale.snapTo(next)
                                        zoom.x.snapTo(centroid.x - (centroid.x - zoom.x.value) * ratio + pan.x)
                                        zoom.y.snapTo(centroid.y - (centroid.y - zoom.y.value) * ratio + pan.y)
                                    }
                                }
                                event.changes.forEach { if (it.positionChanged()) it.consume() }
                            }
                        } while (event.changes.any { it.pressed })
                        if (transforming) settle()
                    }
                }
                .pointerInput(viewW, count) {
                    detectTapGestures(
                        onDoubleTap = { at ->
                            val target = if (zoom.scale.value > 1.05f) 1f else RrPageZoom.DOUBLE
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
                                tap(page, cx / pageW, py / pageH)
                            }
                        },
                    )
                },
        ) {
            Column(
                // Laid out from the top even when taller than the canvas (a short canvas under a sheet or controls).
                Modifier.fillMaxWidth().wrapContentHeight(Alignment.Top, unbounded = true)
                    .graphicsLayer {
                        transformOrigin = TransformOrigin(0f, 0f)
                        scaleX = zoom.scale.value; scaleY = zoom.scale.value
                        translationX = zoom.x.value; translationY = zoom.y.value
                    }
                    .padding(Gutter),
                verticalArrangement = Arrangement.spacedBy(PageGap),
            ) {
                repeat(count) { index ->
                    val description = stringResource(S.string.page_0_of_1, "${index + 1}", "$count")
                    RrPaperPage(pages.getOrNull(index), description, Modifier.fillMaxWidth()) { overlay(index) }
                }
                if (hint != null && count > 0) RrText(hint, style = RrType.ui, color = RrTheme.colors.ink3,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
            }
        }
    }
}
