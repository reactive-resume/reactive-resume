package me.rxresu.core.designsystem

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.platform.LocalInspectionMode
import java.security.MessageDigest

/** Evidence from actual decoded pixels; never an asset name supplied by a screenshot fixture. */
data class RasterInfo(val width: Int, val height: Int, val rgbaSha256: String)

@Composable
internal fun rememberRasterInfo(image: ImageBitmap?): RasterInfo? {
    val enabled = LocalRrDesignTags.current || LocalInspectionMode.current
    return remember(image, enabled) { if (enabled && image != null) rasterInfo(image) else null }
}

internal fun rasterInfo(image: ImageBitmap): RasterInfo {
    val hash = MessageDigest.getInstance("SHA-256")
    val pixels = IntArray(image.width * 64)
    val rgba = ByteArray(pixels.size * 4)
    for (top in 0 until image.height step 64) {
        val rows = minOf(64, image.height - top)
        image.readPixels(pixels, startY = top, width = image.width, height = rows, stride = image.width)
        for (index in 0 until image.width * rows) {
            val pixel = pixels[index]
            rgba[index * 4] = (pixel ushr 16).toByte()
            rgba[index * 4 + 1] = (pixel ushr 8).toByte()
            rgba[index * 4 + 2] = pixel.toByte()
            rgba[index * 4 + 3] = (pixel ushr 24).toByte()
        }
        hash.update(rgba, 0, image.width * rows * 4)
    }
    return RasterInfo(image.width, image.height, hash.digest().joinToString("") { "%02x".format(it) })
}
