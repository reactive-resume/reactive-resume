package me.rxresu.core.designsystem

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.withContext

/**
 * One Phosphor `circle-notch`, 14 dp, turning once a second. Always placed beside words (Saving…, Working…); it keeps
 * turning under reduced motion and when the system animator scale is 0. Decorative: the words carry the meaning.
 * Still in inspection mode (previews, screenshot tests).
 */
@Composable
fun RrSpinner(modifier: Modifier = Modifier, size: Dp = 14.dp, tint: Color = LocalRrContentColor.current) {
    val angle = remember { Animatable(0f) }
    // Still in previews and screenshot tests (inspection mode), where an endless animation never lets the UI idle.
    if (!LocalInspectionMode.current) {
        LaunchedEffect(Unit) {
            withContext(RrMotion.Unscaled) {
                angle.animateTo(360f, infiniteRepeatable(tween(1000, easing = LinearEasing), RepeatMode.Restart))
            }
        }
    }
    RrIcon(
        R.drawable.ic_ph_circle_notch,
        contentDescription = null,
        modifier = modifier.graphicsLayer { rotationZ = angle.value },
        size = size,
        tint = tint,
    )
}

@RrPreviews
@Composable
internal fun RrSpinnerPreview() = RrPreviewSurface {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        RrSpinner(tint = RrTheme.colors.ink3)
        RrText("Saving…", style = RrType.small, color = RrTheme.colors.ink3)
    }
}
