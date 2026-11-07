package me.rxresu.core.page

import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadow.api.Shadow

/**
 * Robolectric 4.17 provides no PdfRenderer shadow/native PDF engine (API 34 returns zero pages;
 * API 35 calls a JVM-missing FileDescriptor method). Model only our bundled one-page A4 fixture.
 * These tests prove HTTP/cache/bitmap ownership, NOT Android PDF parsing or glyph rasterization.
 */
@Implements(PdfRenderer::class)
class FixturePdfRendererShadow {
    @Implementation fun __constructor__(descriptor: ParcelFileDescriptor) {
        val bytes = ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes() }
        val fixture = String(bytes, Charsets.ISO_8859_1)
        require(fixture.startsWith("%PDF-1.4") && fixture.contains("/MediaBox [0 0 595 842]") && fixture.contains("/Count 1"))
    }
    @Implementation fun getPageCount() = 1
    @Implementation fun openPage(index: Int): PdfRenderer.Page {
        require(index == 0)
        return Shadow.newInstanceOf(PdfRenderer.Page::class.java)
    }
    @Implementation fun close() = Unit
}

@Implements(PdfRenderer.Page::class)
class FixturePdfPageShadow {
    @Implementation fun getWidth() = 595
    @Implementation fun getHeight() = 842
    @Implementation fun render(destination: Bitmap, clip: Rect?, transform: Matrix?, mode: Int) = Unit
    @Implementation fun close() = Unit
}
