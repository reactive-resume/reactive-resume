package me.rxresu.feature.applications

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import java.io.OutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import me.rxresu.core.data.ApplicationInsights
import me.rxresu.core.designsystem.*
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.network.generated.ApplicationStage

/** Same reached-stage counts as the funnel; sideways scroll keeps labels readable at large text sizes. */
@Composable
internal fun PipelineFlow(insights: ApplicationInsights) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val toasts = LocalToasts.current
    val colors = RrTheme.colors
    val rtl = androidx.compose.ui.platform.LocalLayoutDirection.current == androidx.compose.ui.unit.LayoutDirection.Rtl
    val layer = rememberGraphicsLayer()
    var pending by remember { mutableStateOf<ImageBitmap?>(null) }
    val saved = stringResource(R.string.app_pipeline_exported)
    val failed = stringResource(R.string.app_pipeline_export_failed)
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/png")) { uri ->
        val image = pending
        pending = null
        if (uri != null && image != null) scope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    requireNotNull(context.contentResolver.openOutputStream(uri)).use { it.writePipelinePng(image.asAndroidBitmap()) }
                }
            }
            toasts.post(if (result.isSuccess) saved else failed, tone = if (result.isSuccess) RrToastTone.Neutral else RrToastTone.Danger)
        }
    }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        RrButton(stringResource(R.string.app_save_image), {
            scope.launch {
                runCatching { layer.toImageBitmap() }.onSuccess { pending = it; picker.launch("pipeline-flow.png") }
                    .onFailure { toasts.post(failed, tone = RrToastTone.Danger) }
            }
        }, variant = RrButtonVariant.Secondary)
        val stages = Pipeline.drop(1)
        val labels = stages.map { stageLabel(it) }
        val counts = stages.map { insights.byStage[it] ?: 0 }
        val stageColors = stages.map { it.rr().color }
        val summary = labels.zip(counts).joinToString(", ") { (name, count) -> "$name $count" }
        Box(Modifier.horizontalScroll(rememberScrollState())) {
            RrCard(
                Modifier.width(600.dp).drawWithContent {
                    layer.record { this@drawWithContent.drawContent() }
                    drawLayer(layer)
                }.clearAndSetSemantics { contentDescription = summary },
            ) {
                RrText(stringResource(R.string.app_pipeline_title), style = RrType.label, color = colors.ink)
                RrText(stringResource(R.string.app_pipeline_closed, insights.closed), style = RrType.small, color = colors.ink3)
                val maximum = (counts.maxOrNull() ?: 1).coerceAtLeast(1)
                Canvas(Modifier.fillMaxWidth().height(150.dp)) {
                    val slot = size.width / stages.size
                    fun center(index: Int) = if (rtl) size.width - slot * (index + 0.5f) else slot * (index + 0.5f)
                    val bar = 16.dp.toPx()
                    val middle = size.height / 2
                    val heights = counts.map { (it / maximum.toFloat() * size.height).coerceAtLeast(2.dp.toPx()) }
                    for (i in 0 until stages.lastIndex) {
                        val x1 = center(i)
                        val x2 = center(i + 1)
                        val mid = (x1 + x2) / 2
                        val top1 = middle - heights[i] / 2
                        val top2 = middle - heights[i + 1] / 2
                        val bottom1 = middle + heights[i] / 2
                        val bottom2 = middle + heights[i + 1] / 2
                        drawPath(Path().apply {
                            moveTo(x1, top1); cubicTo(mid, top1, mid, top2, x2, top2)
                            lineTo(x2, bottom2); cubicTo(mid, bottom2, mid, bottom1, x1, bottom1); close()
                        }, stageColors[i].copy(alpha = 0.2f))
                    }
                    counts.indices.forEach { i ->
                        drawRect(stageColors[i], androidx.compose.ui.geometry.Offset(center(i) - bar / 2, middle - heights[i] / 2), androidx.compose.ui.geometry.Size(bar, heights[i]))
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    labels.forEachIndexed { i, label ->
                        Column(Modifier.weight(1f)) {
                            RrText(label, style = RrType.small, color = colors.ink2)
                            RrText(counts[i].toString(), style = RrType.mono, color = colors.ink)
                        }
                    }
                }
                RrText(stringResource(R.string.app_pipeline_watermark), style = RrType.caption, color = colors.ink3)
            }
        }
    }
}

internal fun OutputStream.writePipelinePng(bitmap: Bitmap) {
    check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, this)) { "PNG export failed" }
}
