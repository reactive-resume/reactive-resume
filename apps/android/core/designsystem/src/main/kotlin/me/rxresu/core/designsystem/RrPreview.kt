package me.rxresu.core.designsystem

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp

/** Light and dark previews at the storyboard width (390 dp). */
@Preview(name = "Light", widthDp = 390, showBackground = true, backgroundColor = 0xFFF8F7F3)
@Preview(name = "Dark", widthDp = 390, showBackground = true, backgroundColor = 0xFF100F0C, uiMode = Configuration.UI_MODE_NIGHT_YES)
annotation class RrPreviews

/** Theme and `bg` desk for previews; follows the preview's night mode. */
@Composable
fun RrPreviewSurface(content: @Composable ColumnScope.() -> Unit) {
    RrTheme(darkTheme = isSystemInDarkTheme()) {
        Column(
            Modifier.background(RrTheme.colors.bg).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}
