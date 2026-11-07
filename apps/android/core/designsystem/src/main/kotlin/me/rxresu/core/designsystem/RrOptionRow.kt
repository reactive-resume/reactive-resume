package me.rxresu.core.designsystem

import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

/**
 * A radio choice as a list row (B14 formats, D4 reading method): radio, a semibold label with an optional inline badge
 * ("Best for applying"), a helper line in ink-3. Top-aligned, 14 dp padding, accent-soft while selected. The whole row is
 * one radio button for TalkBack; plays `selection` when picked. Put rows in an [RrListGroup].
 */
@Composable
fun RrOptionRow(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    helper: String? = null,
    enabled: Boolean = true,
    badge: (@Composable () -> Unit)? = null,
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    Row(
        modifier
            .fillMaxWidth()
            .background(if (selected) c.accentSoft else c.surface)
            .selectable(selected, remember { MutableInteractionSource() }, LocalIndication.current, enabled, Role.RadioButton) {
                if (!selected) haptics(RrHaptic.Selection)
                onClick()
            }
            .alpha(if (enabled) 1f else 0.45f)
            .padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        RrRadio(selected, null)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                RrText(label, style = RrType.label, color = c.ink)
                badge?.invoke()
            }
            if (helper != null) RrText(helper, style = RrType.small, color = c.ink3)
        }
    }
}

@RrPreviews
@Composable
internal fun RrOptionRowPreview() = RrPreviewSurface {
    RrListGroup {
        RrOptionRow("PDF", true, {}, helper = "Looks exactly like the page. Use it for applications and email.") {
            RrBadge("Best for applying", tone = RrBadgeTone.Accent)
        }
        RrOptionRow("Word", false, {}, helper = "For portals or recruiters who ask for Word. Layout is simplified.")
    }
}
