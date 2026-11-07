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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

/**
 * Card: `surface` (or `raised`), line edge, 4 dp corners, shadow-1, 16 dp padding. Pass [onClick] to make the whole card
 * one target (press wash and 0.97 press scale).
 */
@Composable
fun RrCard(
    modifier: Modifier = Modifier,
    raised: Boolean = false,
    onClick: (() -> Unit)? = null,
    contentPadding: PaddingValues = PaddingValues(16.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = RrTheme.colors
    val interaction = remember { MutableInteractionSource() }
    Column(
        modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.rrPressScale(interaction) else Modifier)
            .rrShadow(RrElevation.Level1, RrShape.lg)
            .clip(RrShape.lg)
            .background(if (raised) c.raised else c.surface)
            .border(1.dp, c.line, RrShape.lg)
            .then(if (onClick != null) Modifier.clickable(interaction, LocalIndication.current, role = Role.Button, onClick = onClick) else Modifier)
            .padding(contentPadding),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

@RrPreviews
@Composable
internal fun RrCardPreview() = RrPreviewSurface {
    RrCard(onClick = {}) {
        RrText("Senior product designer · Kiln Studio", style = RrType.label)
        RrText("Lisbon · Hybrid · Found today", style = RrType.small, color = RrTheme.colors.ink3)
    }
}
