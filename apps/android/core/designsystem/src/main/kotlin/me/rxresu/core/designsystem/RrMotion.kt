package me.rxresu.core.designsystem

import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.graphics.graphicsLayer

/**
 * Motion tokens (boards/Motion.png): durations d1 120, d2 200, d3 320 ms and the design-system curves.
 *
 * - d1: press (scale 0.97), toggles, checks, focus rings.
 * - d2: menus, popovers, expanding rows, content swaps, dialogs, mode panels.
 * - d3: sheets, toasts, stack push and pop, the assistant.
 * - Exits take 70% of the entry time ([exit]).
 *
 * Use [spec] for movement (it snaps under reduced motion) and [fade] for sheets, dialogs, menus and toasts (it keeps a
 * d1 fade under reduced motion). The system animator scale also scales Compose animations; run the few animations that
 * must keep going at that scale (spinner, Hold to delete, the reduced-motion d1 fade) in [Unscaled].
 */
object RrMotion {
    const val D1 = 120
    const val D2 = 200
    const val D3 = 320
    val ease = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
    val easeInOutStrong = CubicBezierEasing(0.77f, 0f, 0.175f, 1f)
    val easeOutStrong = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)
    val easeDrawer = CubicBezierEasing(0.32f, 0.72f, 0f, 1f)
    const val PRESS_SCALE = 0.97f
    const val POPUP_START_SCALE = 0.98f

    /** Exit duration: 70% of the entry. */
    fun exit(durationMs: Int) = (durationMs * 0.7f).toInt()

    /** Movement or state change; instant under reduced motion. */
    fun <T> spec(durationMs: Int, reducedMotion: Boolean, easing: Easing = ease): AnimationSpec<T> =
        if (reducedMotion) snap() else tween(durationMs, easing = easing)

    /** Opacity of sheets, dialogs, menus and toasts; becomes a d1 linear fade under reduced motion. */
    fun <T> fade(durationMs: Int, reducedMotion: Boolean, easing: Easing = ease): AnimationSpec<T> =
        if (reducedMotion) tween(D1, easing = LinearEasing) else tween(durationMs, easing = easing)

    /** Coroutine context element that ignores the system animator scale. */
    val Unscaled: MotionDurationScale = object : MotionDurationScale {
        override val scaleFactor: Float get() = 1f
    }
}

/** Press feedback: scales to 0.97 while [interactionSource] is pressed (d1). No movement under reduced motion. */
@Composable
fun Modifier.rrPressScale(interactionSource: InteractionSource): Modifier {
    val pressed by interactionSource.collectIsPressedAsState()
    val reduced = LocalReducedMotion.current
    val scale by animateFloatAsState(
        targetValue = if (pressed && !reduced) RrMotion.PRESS_SCALE else 1f,
        animationSpec = tween(RrMotion.D1, easing = RrMotion.ease),
        label = "press",
    )
    return graphicsLayer { scaleX = scale; scaleY = scale }
}
