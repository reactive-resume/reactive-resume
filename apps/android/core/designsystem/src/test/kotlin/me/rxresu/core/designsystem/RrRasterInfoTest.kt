package me.rxresu.core.designsystem

import android.graphics.Bitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.security.MessageDigest
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class RrRasterInfoTest : RrScreenshotTest() {
    @Test fun decodedRgbaMatchesCanonicalBytesAcrossChunkBoundary() {
        val bitmap = Bitmap.createBitmap(2, 65, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(android.graphics.Color.RED)
        bitmap.setPixel(1, 64, android.graphics.Color.BLUE)
        val bytes = ByteArray(2 * 65 * 4) { index ->
            when (index % 4) { 0, 3 -> 255.toByte(); else -> 0 }
        }
        bytes[bytes.size - 4] = 0
        bytes[bytes.size - 2] = 255.toByte()
        val expected = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val info = rasterInfo(bitmap.asImageBitmap())
        assertEquals(RasterInfo(2, 65, expected), info)
        bitmap.setPixel(0, 0, android.graphics.Color.GREEN)
        assertNotEquals(info.rgbaSha256, rasterInfo(bitmap.asImageBitmap()).rgbaSha256)
    }
}
