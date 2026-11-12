package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.platform.ViewConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp

/** 32 dp colour square; Compose expands its touch area to 44 dp and arbitrates adjacent expanded targets. */
@Composable
fun RrColourSwatch(color: Color, label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val c = RrTheme.colors
    val configuration = LocalViewConfiguration.current
    val touch = remember(configuration) { object : ViewConfiguration by configuration { override val minimumTouchTargetSize = DpSize(44.dp, 44.dp) } }
    CompositionLocalProvider(LocalViewConfiguration provides touch) {
        Box(modifier.size(42.dp, 32.dp).clickable(enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .semantics { this.selected = selected; contentDescription = label }, contentAlignment = Alignment.Center) {
            Box(Modifier.size(32.dp).rrDesignTag(DesignTag(component = "ColourSwatch", radius = RrRadius.sm, bgName = c.tokenName(color)))
                .drawBehind {
                    if (selected) {
                        drawRoundRect(c.bg, Offset(-2.dp.toPx(), -2.dp.toPx()), Size(size.width + 4.dp.toPx(), size.height + 4.dp.toPx()), CornerRadius(10.dp.toPx()), style = Stroke(2.dp.toPx()))
                        drawRoundRect(c.accent, Offset(-3.dp.toPx(), -3.dp.toPx()), Size(size.width + 6.dp.toPx(), size.height + 6.dp.toPx()), CornerRadius(11.dp.toPx()), style = Stroke(2.dp.toPx()))
                    }
                }.clip(RrShape.sm).background(color), contentAlignment = Alignment.Center) {
                if (selected) RrIcon(R.drawable.ic_ph_check, null, size = 16.dp, tint = RrFixedColors.paper, colorName = "#ffffff")
            }
        }
    }
}
