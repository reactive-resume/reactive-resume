package me.rxresu.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun RrIconTile(@DrawableRes icon: Int, modifier: Modifier = Modifier, accent: Boolean = false, danger: Boolean = false) {
    val c = RrTheme.colors
    Box(modifier.size(40.dp).rrDesignTag(DesignTag(component = "IconTile", radius = RrRadius.md, bgName = if (accent) "accent-soft" else "sunken")).clip(RrShape.md).background(if (accent) c.accentSoft else c.sunken), contentAlignment = Alignment.Center) {
        RrIcon(icon, null, size = 22.dp, tint = if (danger) c.dangerText else if (accent) c.accentText else c.ink2)
    }
}

@Composable
fun RrIssueMarker(number: Int, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    Box(modifier.size(16.dp).rrDesignTag(DesignTag(component = "IssueMarker", radius = RrRadius.xs, bgName = "warn")).clip(RrShape.xs).background(c.warn), contentAlignment = Alignment.Center) {
        RrText(number.toString(), style = RrType.mono.copy(fontSize = 10.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold), color = c.warnInk)
    }
}

@Composable
fun RrNumberTag(number: Int, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    Box(modifier.size(20.dp).rrDesignTag(DesignTag(component = "NumberTag", radius = RrRadius.xs, bgName = "accent")).clip(RrShape.xs).background(c.accent), contentAlignment = Alignment.Center) {
        RrText(number.toString(), style = RrType.mono.copy(lineHeight = 20.sp, fontWeight = FontWeight.SemiBold), color = c.onAccent)
    }
}

@Composable
fun RrBoardCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val c = RrTheme.colors
    Column(modifier.rrDesignTag(DesignTag(component = "BoardCard", radius = RrRadius.xl, bgName = "surface")).clip(RrShape.xl).background(c.surface).border(1.dp, c.line, RrShape.xl).padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp), content = content)
}

@RrPreviews
@Composable
internal fun RrDetailsPreview() = RrPreviewSurface {
    RrIconTile(R.drawable.ic_ph_file_text)
    RrIssueMarker(1)
    RrNumberTag(1)
    RrBoardCard {
        RrText("Lumen", style = RrType.rowTitle.copy(fontWeight = FontWeight.SemiBold))
        RrText("Senior product designer", style = RrType.ui, color = RrTheme.colors.ink3)
    }
}
