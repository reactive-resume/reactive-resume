package me.rxresu.core.designsystem

import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

/**
 * Card: `surface` (or `raised`), line edge, 16 dp corners, 20 dp padding. Pass [onClick] to make the whole card
 * one target (press wash and 0.97 press scale).
 */
@Composable
fun RrCard(
    modifier: Modifier = Modifier,
    raised: Boolean = false,
    onClick: (() -> Unit)? = null,
    contentPadding: PaddingValues = PaddingValues(20.dp),
    focused: Boolean = false,
    infoSoft: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = RrTheme.colors
    val interaction = remember { MutableInteractionSource() }
    Column(
        modifier
            .fillMaxWidth()
            .rrDesignTag(DesignTag(component = "Card", radius = RrRadius.xl, bgName = if (infoSoft) "info-soft" else if (raised) "raised" else "surface"))
            .then(if (onClick != null) Modifier.rrPressScale(interaction) else Modifier)
            .drawBehind {
                if (focused) {
                    val ring = 2.dp.toPx()
                    drawRoundRect(c.accent, Offset(-ring / 2, -ring / 2), Size(size.width + ring, size.height + ring), CornerRadius(RrRadius.xl.toPx() + ring / 2), style = Stroke(ring))
                }
            }
            .clip(RrShape.xl)
            .background(if (infoSoft) c.infoSoft else if (raised) c.raised else c.surface)
            .then(if (infoSoft) Modifier else Modifier.border(1.dp, c.line, RrShape.xl))
            .then(if (onClick != null) Modifier.clickable(interaction, LocalIndication.current, role = Role.Button, onClick = onClick) else Modifier)
            .padding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        content = content,
    )
}

@RrPreviews
@Composable
internal fun RrCardPreview() = RrPreviewSurface {
    RrCard(onClick = {}, focused = true) {
        RrText("Senior product designer · Kiln Studio", style = RrType.label)
        RrText("Lisbon · Hybrid · Found today", style = RrType.small, color = RrTheme.colors.ink3)
    }
}
