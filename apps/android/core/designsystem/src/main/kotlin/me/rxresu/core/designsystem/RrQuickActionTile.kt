package me.rxresu.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.padding

/**
 * Quick action tile (D2's Share PDF · Copy link · Duplicate · Rename): 68 dp, `surface` with a line edge, a 24 dp icon
 * over a 12 sp ink-2 label; press wash and 0.97 press scale. Lay four out in a row with `Modifier.weight(1f)` and 8 dp
 * gaps. While [busy] the icon is a spinner and taps are ignored (put "Preparing…" in [label]).
 */
@Composable
fun RrQuickActionTile(
    label: String,
    @DrawableRes icon: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
) {
    val c = RrTheme.colors
    val interaction = remember { MutableInteractionSource() }
    Column(
        modifier
            .rrPressScale(interaction)
            .heightIn(min = 68.dp)
            .clip(RrShape.lg)
            .background(c.surface)
            .border(1.dp, c.line, RrShape.lg)
            .clickable(interaction, LocalIndication.current, enabled = enabled && !busy, role = Role.Button, onClick = onClick)
            .alpha(if (enabled) 1f else 0.45f)
            .padding(horizontal = 4.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
    ) {
        if (busy) RrSpinner(size = 24.dp, tint = c.ink2) else RrIcon(icon, null, tint = c.ink2)
        RrText(label, style = RrType.caption, color = c.ink2, textAlign = TextAlign.Center)
    }
}

@RrPreviews
@Composable
internal fun RrQuickActionTilePreview() = RrPreviewSurface {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RrQuickActionTile("Preparing…", R.drawable.ic_ph_share_network, {}, Modifier.weight(1f), busy = true)
        RrQuickActionTile("Copy link", R.drawable.ic_ph_link_simple, {}, Modifier.weight(1f))
        RrQuickActionTile("Duplicate", R.drawable.ic_ph_copy, {}, Modifier.weight(1f))
        RrQuickActionTile("Rename", R.drawable.ic_ph_pencil_simple, {}, Modifier.weight(1f), enabled = false)
    }
}
