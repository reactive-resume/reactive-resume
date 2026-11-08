package me.rxresu.core.designsystem

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * A resume or letter page: white paper in both themes (paper never inverts), page shadow, A4 210:297. Shows the
 * rendered [page] bitmap, or [placeholder] (abstract text lines by default) while it renders.
 *
 * @param overlay drawn over the page in its coordinates (block outlines, Check markers).
 */
@Composable
fun RrPaperPage(
    page: ImageBitmap?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    placeholder: @Composable BoxScope.() -> Unit = { PaperLines(Modifier.fillMaxSize().padding(24.dp)) },
    overlay: (@Composable BoxScope.() -> Unit)? = null,
) {
    Box(
        modifier
            .fillMaxWidth()
            .aspectRatio(RrLayout.PAGE_ASPECT)
            .rrShadow(RrElevation.Page)
            .background(RrFixedColors.paper)
            .semantics { if (contentDescription != null) this.contentDescription = contentDescription },
    ) {
        if (page != null) Image(page, null, Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds) else placeholder()
        overlay?.invoke(this)
    }
}

/**
 * Page thumbnail for lists and grids: paper with shadow-1 and a line edge, 2 dp corners, A4. Without a bitmap it draws
 * abstract text lines. [locked] adds the lock mark at the top end.
 */
@Composable
fun RrPageThumbnail(
    page: ImageBitmap?,
    modifier: Modifier = Modifier,
    letter: Boolean = false,
    locked: Boolean = false,
    contentDescription: String? = null,
) {
    Box(
        modifier
            .aspectRatio(RrLayout.PAGE_ASPECT)
            .rrShadow(RrElevation.Level1, RrShape.xs)
            .clip(RrShape.xs)
            .background(RrFixedColors.paper)
            .border(1.dp, RrTheme.colors.line, RrShape.xs)
            .semantics { if (contentDescription != null) this.contentDescription = contentDescription },
    ) {
        if (page != null) {
            // Full width, top aligned: a Letter page is wider than the A4 frame, and cropping it would cut the margins and text.
            Image(page, null, Modifier.fillMaxSize(), alignment = Alignment.TopCenter, contentScale = ContentScale.FillWidth)
        } else {
            Canvas(Modifier.fillMaxSize()) { thumbLines(letter) }
        }
        if (locked) {
            Box(
                Modifier.align(Alignment.TopEnd).padding(6.dp).size(24.dp).clip(RrShape.xs).background(RrFixedColors.paper.copy(alpha = 0.92f)),
                contentAlignment = Alignment.Center,
            ) { RrIcon(R.drawable.ic_ph_lock_simple, null, size = 16.dp, tint = RrFixedColors.thumbLockInk) }
        }
    }
}

/** Abstract heading and text lines (the storyboard's thumbnail treatment). */
@Composable
fun PaperLines(modifier: Modifier = Modifier) {
    Canvas(modifier) { thumbLines(letter = false) }
}

private fun DrawScope.thumbLines(letter: Boolean) {
    val w = size.width
    val h = size.height
    if (letter) {
        drawRect(RrFixedColors.thumbLetterHeading, Offset(w * 0.12f, h * 0.10f), Size(w * 0.30f, h * 0.03f))
    } else {
        drawRect(RrFixedColors.thumbHeading, Offset(w * 0.12f, h * 0.08f), Size(w * 0.46f, h * 0.05f))
    }
    val top = if (letter) 0.28f else 0.18f
    val line = if (letter) 0.018f else 0.022f
    val pitch = if (letter) 0.046f else 0.054f
    var y = h * top
    val color = if (letter) RrFixedColors.thumbLetterLine else RrFixedColors.thumbLine
    while (y < h * 0.92f) {
        drawRect(color, Offset(w * 0.12f, y), Size(w * 0.76f, h * line))
        y += h * pitch
    }
}

@RrPreviews
@Composable
internal fun RrPaperPagePreview() = RrPreviewSurface {
    androidx.compose.foundation.layout.Row(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(16.dp)) {
        RrPaperPage(null, "Page 1", Modifier.size(160.dp, 226.dp))
        RrPageThumbnail(null, Modifier.size(84.dp, 119.dp))
        RrPageThumbnail(null, Modifier.size(84.dp, 119.dp), letter = true, locked = true)
    }
}
