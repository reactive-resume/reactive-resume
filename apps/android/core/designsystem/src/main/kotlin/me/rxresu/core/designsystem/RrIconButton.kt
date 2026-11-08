package me.rxresu.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.LocalIndication
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** 44 dp ([Regular]) or 36 dp ([Small], inside composers and sheet headers) icon buttons. */
enum class RrIconButtonSize { Regular, Small }

/**
 * Icon-only button. [contentDescription] is required: it is what TalkBack reads ("Back", "Undo", "Check, 3 issues").
 *
 * @param selected accent-soft fill (the assistant sparkle while its sheet is open).
 * @param dot a warn mark at the top end (Check with open issues); put the count in [contentDescription].
 * @param containerColor solid fill, used by the composer's Send button (accent).
 * @param iconSize 24 dp by default; 20 dp in small buttons.
 */
@Composable
fun RrIconButton(
    @DrawableRes icon: Int,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: RrIconButtonSize = RrIconButtonSize.Regular,
    enabled: Boolean = true,
    selected: Boolean = false,
    dot: Boolean = false,
    tint: Color? = null,
    containerColor: Color? = null,
    mirrorInRtl: Boolean = false,
) {
    val c = RrTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val box = if (size == RrIconButtonSize.Regular) 44.dp else 36.dp
    val fill = containerColor ?: if (selected) c.accentSoft else Color.Transparent
    val color = tint ?: if (selected || icon == R.drawable.ic_ph_sparkle) c.accentText else c.ink2
    Box(
        modifier = modifier
            .size(box)
            .rrDesignTag(DesignTag(component = "IconButton", radius = RrRadius.md, bgName = if (selected) "accent-soft" else c.tokenName(fill)))
            .rrPressScale(interaction)
            .rrEnabledAlpha(enabled, 0.45f)
            .clip(RrShape.md)
            .background(fill)
            .clickable(interaction, LocalIndication.current, enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics(mergeDescendants = true) { this.contentDescription = contentDescription },
        contentAlignment = Alignment.Center,
    ) {
        RrIcon(icon, null, size = if (size == RrIconButtonSize.Regular) 24.dp else 20.dp, tint = color, mirrorInRtl = mirrorInRtl)
        if (dot) {
            Box(
                Modifier.align(Alignment.TopEnd)
                    .offset(x = (-9).dp, y = 9.dp)
                    .size(8.dp)
                    .clip(androidx.compose.foundation.shape.RoundedCornerShape(2.dp))
                    .background(c.warn),
            )
        }
    }
}

@RrPreviews
@Composable
internal fun RrIconButtonPreview() = RrPreviewSurface {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        RrIconButton(R.drawable.ic_ph_caret_left, "Back", {}, mirrorInRtl = true)
        RrIconButton(R.drawable.ic_ph_arrow_counter_clockwise, "Undo", {})
        RrIconButton(R.drawable.ic_ph_sparkle, "Assistant", {}, selected = true)
        RrIconButton(R.drawable.ic_ph_dots_three, "More", {})
        RrIconButton(R.drawable.ic_ph_seal_check, "Check, 3 issues", {}, dot = true)
        RrIconButton(R.drawable.ic_ph_arrow_clockwise, "Redo", {}, enabled = false)
        RrIconButton(R.drawable.ic_ph_arrow_up, "Send", {}, size = RrIconButtonSize.Small, containerColor = RrTheme.colors.accent, tint = RrTheme.colors.onAccent)
    }
}
