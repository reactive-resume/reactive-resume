package me.rxresu.core.designsystem

import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

/**
 * Selectable choice card (B7 font pairings): 56 dp min, 3 dp corners, a line-2 edge; selected is accent-soft with an
 * accent edge. Content is centred with 2 dp gaps and inherits a 12 sp label style in ink-2 (accent text when
 * selected); put a larger sample ("Aa" in the pairing's font) above the label. One radio-button control for TalkBack;
 * plays `selection` when picked. Put several in a `selectableGroup()` row.
 */
@Composable
fun RrChoiceCard(
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    Column(
        modifier
            .heightIn(min = 56.dp)
            .clip(RrShape.md)
            .background(if (selected) c.accentSoft else c.raised)
            .border(1.dp, if (selected) c.accent else c.line2, RrShape.md)
            .selectable(selected, remember { MutableInteractionSource() }, LocalIndication.current, enabled, Role.RadioButton) {
                if (!selected) haptics(RrHaptic.Selection)
                onClick()
            }
            .alpha(if (enabled) 1f else 0.45f)
            .padding(horizontal = 8.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
    ) {
        ProvideRrContent(if (selected) c.accentText else c.ink2, RrType.caption) { content() }
    }
}

@RrPreviews
@Composable
internal fun RrChoiceCardPreview() = RrPreviewSurface {
    Row(Modifier.selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("Classic" to true, "Modern" to false, "Editorial" to false).forEach { (name, on) ->
            RrChoiceCard(on, {}, Modifier.width(114.dp)) {
                RrText("Aa", style = RrType.sheetTitle.copy(fontSize = RrType.heading.fontSize), color = RrTheme.colors.ink)
                RrText(name)
            }
        }
    }
}
