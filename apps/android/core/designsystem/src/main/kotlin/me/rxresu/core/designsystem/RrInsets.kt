package me.rxresu.core.designsystem

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

@Immutable
data class RrInsets(val top: Dp, val bottom: Dp, val start: Dp = 0.dp, val end: Dp = 0.dp)

val LocalRrInsets = staticCompositionLocalOf { RrInsets(0.dp, 0.dp) }
val StoryboardInsets = RrInsets(47.dp, 34.dp)

@Composable
fun ProvideSystemInsets(content: @Composable () -> Unit) {
    val density = LocalDensity.current
    val direction = LocalLayoutDirection.current
    val insets = WindowInsets.safeDrawing
    val value = with(density) {
        val left = insets.getLeft(this, direction).toDp()
        val right = insets.getRight(this, direction).toDp()
        RrInsets(insets.getTop(this).toDp(), insets.getBottom(this).toDp(),
            if (direction == LayoutDirection.Ltr) left else right,
            if (direction == LayoutDirection.Ltr) right else left)
    }
    CompositionLocalProvider(LocalRrInsets provides value, content = content)
}

@Composable
fun Modifier.rrStatusBarsPadding() = padding(top = LocalRrInsets.current.top)

@Composable
fun Modifier.rrNavigationBarsPadding() = padding(bottom = LocalRrInsets.current.bottom)
