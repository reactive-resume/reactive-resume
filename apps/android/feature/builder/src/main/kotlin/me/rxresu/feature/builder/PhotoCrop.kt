package me.rxresu.feature.builder

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.Rect
import androidx.exifinterface.media.ExifInterface
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.ClipOp
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLocale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrSlider
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTopBar
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.strings.R as S
import me.rxresu.core.designsystem.R as D

/** A picked photo waiting to be cropped: decoded and upright, with its file name and type. */
internal data class PhotoCrop(val bitmap: Bitmap, val name: String, val type: String)

/**
 * Crop photo geometry (react-easy-crop on the web): the photo covers the frame at zoom 1, zoom goes to 3, and the pan
 * never shows a gap inside the frame. Pure, so tests pin it.
 */
internal object CropMath {
    const val MAX_ZOOM = 3f

    /** The largest [aspect] (width ÷ height) frame inside [area], less [inset] on every side. */
    fun frame(area: Size, aspect: Float, inset: Float): Size {
        val width = (area.width - inset * 2).coerceAtLeast(1f)
        val height = (area.height - inset * 2).coerceAtLeast(1f)
        return if (width / height > aspect) Size(height * aspect, height) else Size(width, width / aspect)
    }

    /** Screen pixels per photo pixel. */
    fun scale(image: Size, frame: Size, zoom: Float) = max(frame.width / image.width, frame.height / image.height) * zoom

    /** [pan] (the photo centre's offset from the frame centre) held where the photo still covers the frame. */
    fun clamp(pan: Offset, image: Size, frame: Size, zoom: Float): Offset {
        val s = scale(image, frame, zoom)
        val x = ((image.width * s - frame.width) / 2).coerceAtLeast(0f)
        val y = ((image.height * s - frame.height) / 2).coerceAtLeast(0f)
        return Offset(pan.x.coerceIn(-x, x), pan.y.coerceIn(-y, y))
    }

    /** The photo pixels inside the frame. */
    fun area(image: Size, frame: Size, zoom: Float, pan: Offset): Rect {
        val s = scale(image, frame, zoom)
        val p = clamp(pan, image, frame, zoom)
        val left = ((image.width * s - frame.width) / 2 - p.x) / s
        val top = ((image.height * s - frame.height) / 2 - p.y) / s
        val w = image.width.toInt(); val h = image.height.toInt()
        val l = left.roundToInt().coerceIn(0, w - 1)
        val t = top.roundToInt().coerceIn(0, h - 1)
        return Rect(l, t, (l + (frame.width / s).roundToInt()).coerceIn(l + 1, w), (t + (frame.height / s).roundToInt()).coerceIn(t + 1, h))
    }

    /** How much to shrink an encoded photo of [bytes] toward [limit], as the web does: at most 0.9 per pass. */
    fun shrink(bytes: Int, limit: Int) = min(0.9, sqrt(limit.toDouble() / bytes) * 0.95)
}

/** Decoding and encoding for Crop photo (web picture-settings.tsx `getCroppedImageBlob`). */
internal object PhotoCrops {
    private const val MAX_BYTES = 10 * 1024 * 1024
    private const val MAX_SIDE = 4096

    /** Decodes [bytes] upright (EXIF orientation), sampled down to at most 4096 px a side; null when unreadable. */
    // androidx.exifinterface isn't a dependency of this module (requested from the lead); this only reads orientation.
    fun decode(bytes: ByteArray): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > MAX_SIDE) sample *= 2
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val degrees = runCatching {
            when (ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        }.getOrDefault(0f)
        if (degrees == 0f) return bitmap
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(degrees) }, true)
    }

    @Suppress("DEPRECATION") // WEBP_LOSSY needs API 30; minSdk is 26.
    private fun webp() = if (android.os.Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.WEBP

    /**
     * The [area] of [bitmap], encoded as JPEG or WebP for those photos and PNG otherwise, shrunk from the crop itself
     * until it fits 10 MB.
     */
    fun encode(bitmap: Bitmap, area: Rect, type: String, name: String): PickedPhoto {
        val cropped = Bitmap.createBitmap(bitmap, area.left, area.top, area.width(), area.height())
        val (format, outType) = when (type) {
            "image/jpeg" -> Bitmap.CompressFormat.JPEG to type
            "image/webp" -> webp() to type
            else -> Bitmap.CompressFormat.PNG to "image/png"
        }
        var width = cropped.width; var height = cropped.height
        while (true) {
            val frame = if (width == cropped.width) cropped else Bitmap.createScaledBitmap(cropped, width, height, true)
            val bytes = ByteArrayOutputStream().also { frame.compress(format, 90, it) }.toByteArray()
            if (bytes.size <= MAX_BYTES) return PickedPhoto(bytes, name, outType)
            check(width > 1 || height > 1) { "Cropped photo exceeds the upload limit." }
            val scale = CropMath.shrink(bytes.size, MAX_BYTES)
            width = max(1, floor(width * scale).toInt()); height = max(1, floor(height * scale).toInt())
        }
    }
}

/**
 * B5 Crop photo: full screen, the photo under a frame of the picture's aspect ratio. Drag to reposition, pinch or the
 * slider to zoom (1–3×), then Crop and upload.
 */
@Composable
internal fun PhotoCropScreen(crop: PhotoCrop, aspect: Float, onCancel: () -> Unit, onCrop: (Rect) -> Unit) {
    val c = RrTheme.colors
    val image = remember(crop) { crop.bitmap.asImageBitmap() }
    val photo = Size(crop.bitmap.width.toFloat(), crop.bitmap.height.toFloat())
    var zoom by remember(crop) { mutableFloatStateOf(1f) }
    var pan by remember(crop) { mutableStateOf(Offset.Zero) }
    var frame by remember { mutableStateOf(Size(1f, 1f)) }
    BackHandler(onBack = onCancel)
    Column(Modifier.fillMaxSize().background(c.bg)) {
        RrTopBar(stringResource(R.string.builder_crop_photo), onBack = onCancel)
        RrText(stringResource(R.string.builder_crop_hint), color = c.ink2, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        BoxWithConstraints(
            Modifier.weight(1f).fillMaxWidth().background(c.sunken).pointerInput(crop) {
                detectTransformGestures { _, move, scaleBy, _ ->
                    zoom = (zoom * scaleBy).coerceIn(1f, CropMath.MAX_ZOOM)
                    pan = CropMath.clamp(pan + move, photo, frame, zoom)
                }
            },
        ) {
            val density = LocalDensity.current
            val area = with(density) { Size(maxWidth.toPx(), maxHeight.toPx()) }
            frame = CropMath.frame(area, aspect, with(density) { 24.dp.toPx() })
            val shown = CropMath.clamp(pan, photo, frame, zoom)
            Canvas(Modifier.fillMaxSize()) {
                val s = CropMath.scale(photo, frame, zoom)
                val topLeft = Offset((size.width - photo.width * s) / 2 + shown.x, (size.height - photo.height * s) / 2 + shown.y)
                withTransform({ translate(topLeft.x, topLeft.y); scale(s, s, Offset.Zero) }) { drawImage(image) }
                val frameTopLeft = Offset((size.width - frame.width) / 2, (size.height - frame.height) / 2)
                // Dim everything outside the frame.
                clipRect(frameTopLeft.x, frameTopLeft.y, frameTopLeft.x + frame.width, frameTopLeft.y + frame.height, ClipOp.Difference) { drawRect(c.scrim) }
            }
            with(density) {
                Box(
                    Modifier.align(Alignment.Center).size(frame.width.toDp(), frame.height.toDp()).border(1.dp, c.onAccent),
                )
            }
        }
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val zoomText = stringResource(R.string.builder_zoom_value, String.format(LocalLocale.current.platformLocale, "%.1f", zoom))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                RrText(stringResource(R.string.builder_zoom), style = RrType.fieldLabel, color = c.ink2, modifier = Modifier.weight(1f))
                RrText(zoomText, style = RrType.small, color = c.ink3)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                RrIcon(D.drawable.ic_ph_minus, stringResource(S.string.zoom_out), size = 16.dp, tint = c.ink3)
                RrSlider(zoom, { zoom = it; pan = CropMath.clamp(pan, photo, frame, it) }, Modifier.weight(1f), 1f..CropMath.MAX_ZOOM, valueDescription = zoomText)
                RrIcon(D.drawable.ic_ph_plus, stringResource(S.string.zoom_in), size = 16.dp, tint = c.ink3)
            }
            RrButton(stringResource(R.string.builder_crop_and_upload), { onCrop(CropMath.area(photo, frame, zoom, pan)) }, Modifier.fillMaxWidth())
        }
    }
}
