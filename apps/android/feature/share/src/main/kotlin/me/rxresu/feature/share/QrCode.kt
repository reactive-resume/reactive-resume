package me.rxresu.feature.share

import android.graphics.Bitmap
import androidx.core.graphics.createBitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.common.BitMatrix
import com.google.zxing.qrcode.QRCodeWriter
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow
import me.rxresu.core.designsystem.*
import me.rxresu.core.strings.R as CoreR

internal fun qrMatrix(url: String): BitMatrix {
    val uri = java.net.URI(url)
    require(uri.scheme in setOf("https", "http") && !uri.host.isNullOrBlank() && uri.userInfo == null)
    return QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, 256, 256, mapOf(EncodeHintType.CHARACTER_SET to "UTF-8", EncodeHintType.MARGIN to 4))
}
internal fun qrSvg(matrix: BitMatrix): String = buildString {
    append("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 ${matrix.width} ${matrix.height}\" shape-rendering=\"crispEdges\">")
    val paper = "#%06x".format(RrFixedColors.paper.toArgb() and 0xffffff)
    val ink = "#%06x".format(RrFixedColors.thumbLockInk.toArgb() and 0xffffff)
    append("<path fill=\"$paper\" d=\"M0 0h${matrix.width}v${matrix.height}H0z\"/><path fill=\"$ink\" d=\"")
    for (y in 0 until matrix.height) for (x in 0 until matrix.width) if (matrix[x, y]) append("M$x ${y}h1v1h-1z")
    append("\"/></svg>")
}
private fun qrPng(matrix: BitMatrix): ByteArray {
    val bitmap = createBitmap(matrix.width, matrix.height)
    try {
        val pixels = IntArray(matrix.width * matrix.height) { index -> if (matrix[index % matrix.width, index / matrix.width]) RrFixedColors.thumbLockInk.toArgb() else RrFixedColors.paper.toArgb() }
        bitmap.setPixels(pixels, 0, matrix.width, 0, 0, matrix.width, matrix.height)
        return ByteArrayOutputStream().use { output -> check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)); output.toByteArray() }
    } finally { bitmap.recycle() }
}
@Composable internal fun QrSheet(url: String, dismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val channel = remember { Channel<Delivery>(Channel.BUFFERED) }
    val deliveries = remember { channel.receiveAsFlow() }
    val busy = fileDeliveries(deliveries)
    var matrix by remember { mutableStateOf<BitMatrix?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(url) { try { matrix = withContext(Dispatchers.Default) { qrMatrix(url) } } catch (e: CancellationException) { throw e } catch (_: Exception) { failed = true } }
    fun export(svg: Boolean, save: Boolean) { scope.launch {
        try {
            val code = requireNotNull(matrix)
            val file = withContext(Dispatchers.Default) { if (svg) ExportFile("Resume QR.svg", "image/svg+xml", qrSvg(code).toByteArray()) else ExportFile("Resume QR.png", "image/png", qrPng(code)) }
            channel.send(Delivery(listOf(file), save))
        } catch (e: CancellationException) { throw e } catch (_: Exception) { failed = true }
    } }
    RrBottomSheet(dismiss, title = stringResource(CoreR.string.qr_code), fitContent = true) {
        Column(Modifier.fillMaxWidth().padding(RrSpace.s4), verticalArrangement = Arrangement.spacedBy(RrSpace.s3)) {
            matrix?.let { code ->
                // TODO(lead): move QR preview to designsystem.
                val description = stringResource(CoreR.string.qr_code) + ": " + url
                Canvas(Modifier.size(RrSpace.s16 * 4).background(RrFixedColors.paper).semantics { contentDescription = description }) {
                    val cell = size.width / code.width
                    for (y in 0 until code.height) for (x in 0 until code.width) if (code[x, y]) drawRect(RrFixedColors.thumbLockInk, Offset(x * cell, y * cell), Size(cell, cell))
                }
            }
            RrText(url, style = RrType.mono.copy(textDirection = androidx.compose.ui.text.style.TextDirection.Ltr))
            Row(horizontalArrangement = Arrangement.spacedBy(RrSpace.s2)) {
                RrButton(stringResource(R.string.p4_save_png), { export(false, true) }, variant = RrButtonVariant.Secondary, enabled = matrix != null && !busy)
                RrButton(stringResource(R.string.p4_save_svg), { export(true, true) }, variant = RrButtonVariant.Secondary, enabled = matrix != null && !busy)
                RrButton(stringResource(CoreR.string.share), { export(false, false) }, enabled = matrix != null && !busy)
            }
            if (failed) RrCallout(stringResource(CoreR.string.download_failed_try_again), tone = RrTone.Danger)
        }
    }
}
