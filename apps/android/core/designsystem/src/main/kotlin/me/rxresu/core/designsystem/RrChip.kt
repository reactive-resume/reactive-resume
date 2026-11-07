package me.rxresu.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val ChipText = RrType.small.copy(fontWeight = FontWeight.Medium)
private val ContextChipText = RrType.small.copy(fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp)

/**
 * Filter chip (32 dp): line-2 edge, accent-soft fill when selected. Plays `selection` when toggled.
 *
 * @param count a Geist Mono count after the label ("Needs you 3"), ink-3 (accent-text when selected).
 */
@Composable
fun RrFilterChip(
    text: String,
    selected: Boolean,
    onSelectedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    @DrawableRes icon: Int? = null,
    count: String? = null,
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val interaction = remember { MutableInteractionSource() }
    ChipFrame(
        modifier = modifier
            .rrPressScale(interaction)
            .clip(RrShape.sm)
            .background(if (selected) c.accentSoft else Color.Transparent)
            .then(if (selected) Modifier else Modifier.border(1.dp, c.line2, RrShape.sm))
            .toggleable(selected, interaction, LocalIndication.current, role = Role.Checkbox) {
                haptics(RrHaptic.Selection)
                onSelectedChange(it)
            },
    ) {
        val fg = if (selected) c.accentText else c.ink2
        if (icon != null) RrIcon(icon, null, size = 16.dp, tint = fg)
        RrText(text, style = ChipText, color = fg)
        if (count != null) RrText(count, style = RrType.mono, color = if (selected) c.accentText else c.ink3)
    }
}

/** Dashed "+ Tag" chip that adds an item. */
@Composable
fun RrAddChip(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, @DrawableRes icon: Int = R.drawable.ic_ph_plus) {
    val c = RrTheme.colors
    val interaction = remember { MutableInteractionSource() }
    ChipFrame(
        modifier = modifier
            .rrPressScale(interaction)
            .clip(RrShape.sm)
            .rrDashedBorder(c.line2, RrRadius.sm)
            .clickable(interaction, LocalIndication.current, role = Role.Button, onClick = onClick),
    ) {
        RrIcon(icon, null, size = 16.dp, tint = c.ink3)
        RrText(text, style = ChipText, color = c.ink3)
    }
}

@Composable
private fun ChipFrame(modifier: Modifier, content: @Composable () -> Unit) {
    Row(
        modifier.defaultMinSize(minHeight = 32.dp).padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) { content() }
}

/**
 * Context chip (26 dp) in AI composers: what goes with the message ("Product designer", "Lumen posting").
 *
 * @param onRemove shows the × button ("Remove Product designer"); null for fixed context.
 * @param leftOut dashed, no fill: context that is available but will not be sent.
 */
@Composable
fun RrContextChip(
    text: String,
    modifier: Modifier = Modifier,
    @DrawableRes icon: Int? = null,
    onRemove: (() -> Unit)? = null,
    leftOut: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    val c = RrTheme.colors
    val leftOutLabel = stringResource(R.string.ds_left_out, text)
    Row(
        modifier
            .defaultMinSize(minHeight = 26.dp)
            .clip(RrShape.sm)
            .then(if (leftOut) Modifier.rrDashedBorder(c.line2, RrRadius.sm) else Modifier.background(c.sunken))
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .then(if (leftOut) Modifier.semantics { contentDescription = leftOutLabel } else Modifier)
            .padding(start = 8.dp, end = if (onRemove != null) 0.dp else 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) RrIcon(icon, null, size = 14.dp, tint = c.ink2)
        RrText(text, style = ContextChipText, color = c.ink2, modifier = Modifier.padding(vertical = 4.dp))
        if (onRemove != null) {
            val label = stringResource(R.string.ds_remove_item, text)
            Box(
                Modifier
                    .size(26.dp)
                    .clickable(role = Role.Button, onClickLabel = label, onClick = onRemove)
                    .semantics { contentDescription = label },
                contentAlignment = Alignment.Center,
            ) { RrIcon(R.drawable.ic_ph_x, null, size = 16.dp, tint = c.ink2) }
        }
    }
}

@RrPreviews
@Composable
internal fun RrChipPreview() = RrPreviewSurface {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RrFilterChip("Needs you", selected = false, onSelectedChange = {}, count = "3")
        RrFilterChip("All", selected = true, onSelectedChange = {}, count = "12")
        RrFilterChip("Resumes", selected = false, onSelectedChange = {})
        RrFilterChip("Letters", selected = false, onSelectedChange = {})
        RrFilterChip("Design", selected = false, onSelectedChange = {}, icon = R.drawable.ic_ph_tag)
        RrAddChip("Tag", onClick = {})
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RrContextChip("Product designer", icon = R.drawable.ic_ph_file_text, onRemove = {})
        RrContextChip("Lumen posting", leftOut = true)
    }
}
