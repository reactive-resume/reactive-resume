package me.rxresu.core.testing

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.LocalRrDesignTags
import me.rxresu.core.designsystem.LocalRrInsets
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.StoryboardInsets

/** Exact test frame; the app supplies real system insets through the same local. */
@Composable
fun StoryboardFrame(dark: Boolean, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalRrInsets provides StoryboardInsets, LocalRrDesignTags provides true) {
        RrTheme(darkTheme = dark, reducedMotion = true) {
            Box(Modifier.size(390.dp, 844.dp).background(RrTheme.colors.bg)) { content() }
        }
    }
}
