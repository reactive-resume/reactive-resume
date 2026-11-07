package me.rxresu.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

/**
 * "Used" source chip under an AI reply (24 dp, line-2 edge): what the answer drew on ("Lumen posting", "3 facts").
 * With [onClick] it opens the exact facts or application.
 */
@Composable
fun RrUsedChip(text: String, @DrawableRes icon: Int, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    val c = RrTheme.colors
    Row(
        modifier
            .defaultMinSize(minHeight = 24.dp)
            .clip(RrShape.sm)
            .border(1.dp, c.line2, RrShape.sm)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(horizontal = 8.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RrIcon(icon, null, size = 14.dp, tint = c.ink2)
        RrText(text, style = RrType.caption, color = c.ink2)
    }
}

@RrPreviews
@Composable
internal fun RrUsedChipPreview() = RrPreviewSurface {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        RrUsedChip("Lumen posting", R.drawable.ic_ph_briefcase, onClick = {})
        RrUsedChip("3 facts", R.drawable.ic_ph_book_open)
    }
}
