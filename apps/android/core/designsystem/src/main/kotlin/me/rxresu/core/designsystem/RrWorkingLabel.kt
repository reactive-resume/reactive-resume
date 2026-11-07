package me.rxresu.core.designsystem

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/** Working-label timing: a new step every 2.2 s, held on the last one ("Still working"). */
object RrWorkingSteps {
    const val STEP_MS = 2_200L

    /** Index shown after [elapsedMs] for [count] labels. */
    fun indexAt(elapsedMs: Long, count: Int): Int = if (count <= 0) 0 else (elapsedMs / STEP_MS).toInt().coerceIn(0, count - 1)
}

/**
 * Spinner plus a label that steps through [labels] every 2.2 s with a d2 crossfade, holding the last ("Reading the
 * posting", "Matching your facts", "Still working"). Put Stop beside it. The spinner keeps turning under reduced motion;
 * the crossfade becomes instant. Announced politely as it changes.
 */
@Composable
fun RrWorkingLabel(labels: List<String>, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    val reduced = LocalReducedMotion.current
    val still = LocalInspectionMode.current
    var index by remember(labels) { mutableIntStateOf(0) }
    if (!still) {
        LaunchedEffect(labels) {
            var elapsed = 0L
            while (index < labels.lastIndex) {
                delay(RrWorkingSteps.STEP_MS)
                elapsed += RrWorkingSteps.STEP_MS
                index = RrWorkingSteps.indexAt(elapsed, labels.size)
            }
        }
    }
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        RrSpinner(tint = c.ink2)
        AnimatedContent(
            targetState = labels.getOrElse(index) { "" },
            transitionSpec = {
                val d = if (reduced) 0 else RrMotion.D2
                fadeIn(tween(d)) togetherWith fadeOut(tween(d))
            },
            label = "working",
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        ) { label -> RrText(label, style = RrType.small, color = c.ink2) }
    }
}

@RrPreviews
@Composable
internal fun RrWorkingLabelPreview() = RrPreviewSurface {
    RrWorkingLabel(listOf("Reading the posting", "Matching your facts", "Still working"))
}
