package me.rxresu.feature.share

import com.google.zxing.*
import com.google.zxing.common.HybridBinarizer
import org.junit.Assert.*
import org.junit.Test

class QrCodeTest {
    @Test fun codeDecodesToExactPublicUrl() {
        val url = "https://example.invalid/alex/product-designer"
        val matrix = qrMatrix(url)
        val pixels = IntArray(matrix.width * matrix.height) { i -> if (matrix[i % matrix.width, i / matrix.width]) 0xff000000.toInt() else 0xffffffff.toInt() }
        val image = BinaryBitmap(HybridBinarizer(RGBLuminanceSource(matrix.width, matrix.height, pixels)))
        assertEquals(url, MultiFormatReader().decode(image).text)
        assertTrue(qrSvg(matrix).startsWith("<svg")); assertFalse(qrSvg(matrix).contains(url))
    }
    @Test fun refusesNonWebLinks() { assertTrue(runCatching { qrMatrix("javascript:alert(1)") }.isFailure) }
}
