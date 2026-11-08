package me.rxresu.core.designsystem

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

/*
 * Switch, checkbox and radio. Each control has a 44 dp touch target when it handles taps itself; inside a list row,
 * pass a null callback and let the row own the toggle (see RrSwitchRow), so TalkBack reads one control.
 */

/**
 * Switch, 40×24 with round corners. Plays `toggle` (on or off) when it changes. The thumb slides in d1 (no movement under
 * reduced motion).
 *
 * @param onCheckedChange null when a parent row handles the toggle; the switch is then drawn only.
 */
@Composable
fun RrSwitch(checked: Boolean, onCheckedChange: ((Boolean) -> Unit)?, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val reduced = LocalReducedMotion.current
    val thumb by animateDpAsState(if (checked) 19.dp else 3.dp, RrMotion.spec(RrMotion.D1, reduced), label = "thumb")
    val toggle = if (onCheckedChange == null) Modifier else Modifier
        .size(44.dp)
        .toggleable(checked, remember { MutableInteractionSource() }, null, enabled, Role.Switch) {
            haptics(if (it) RrHaptic.ToggleOn else RrHaptic.ToggleOff)
            onCheckedChange(it)
        }
    Box(modifier.then(toggle).rrEnabledAlpha(enabled, 0.45f), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(40.dp, 24.dp)
                .rrDesignTag(DesignTag(component = "Switch", radius = RrRadius.full, bgName = if (checked) "accent" else "sunken"))
                .clip(RrShape.full)
                .background(if (checked) c.accent else c.sunken)
                .then(if (checked) Modifier else Modifier.border(1.dp, c.controlBorder, RrShape.full)),
        ) {
            Box(
                Modifier
                    .offset { androidx.compose.ui.unit.IntOffset(thumb.roundToPx(), 3.dp.roundToPx()) }
                    .then(if (checked) Modifier.rrShadow(RrElevation.Level1, RrShape.full) else Modifier)
                    .size(18.dp)
                    .clip(RrShape.full)
                    .background(if (checked) c.onAccent else c.controlBorder),
            )
        }
    }
}

/** Checkbox, 20 dp with 6 dp corners; accent with a check when on. Plays `toggle`. */
@Composable
fun RrCheckbox(checked: Boolean, onCheckedChange: ((Boolean) -> Unit)?, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val toggle = if (onCheckedChange == null) Modifier else Modifier
        .size(44.dp)
        .toggleable(checked, remember { MutableInteractionSource() }, null, enabled, Role.Checkbox) {
            haptics(if (it) RrHaptic.ToggleOn else RrHaptic.ToggleOff)
            onCheckedChange(it)
        }
    Box(modifier.then(toggle).rrEnabledAlpha(enabled, 0.45f), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(20.dp)
                .rrDesignTag(DesignTag(component = "Checkbox", radius = RrRadius.xs, bgName = if (checked) "accent" else "raised"))
                .clip(RrShape.xs)
                .background(if (checked) c.accent else c.raised)
                .then(if (checked) Modifier else Modifier.border(1.dp, c.controlBorder, RrShape.xs)),
            contentAlignment = Alignment.Center,
        ) {
            if (checked) RrIcon(R.drawable.ic_ph_check, null, size = 14.dp, tint = c.onAccent)
        }
    }
}

/** Radio, 20 dp circle with an accent ring and dot when selected. Plays `selection` when picked. */
@Composable
fun RrRadio(selected: Boolean, onClick: (() -> Unit)?, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val select = if (onClick == null) Modifier else Modifier
        .size(44.dp)
        .selectable(selected, remember { MutableInteractionSource() }, null, enabled, Role.RadioButton) {
            if (!selected) haptics(RrHaptic.Selection)
            onClick()
        }
    Box(modifier.then(select).rrEnabledAlpha(enabled, 0.45f), contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(20.dp).rrDesignTag(DesignTag(component = "Radio", radius = RrRadius.full, bgName = "raised")).clip(RrShape.full).background(c.raised).border(1.dp, if (selected) c.accent else c.controlBorder, RrShape.full),
            contentAlignment = Alignment.Center,
        ) {
            if (selected) Box(Modifier.size(10.dp).clip(RrShape.full).background(c.accent))
        }
    }
}

/**
 * A checkbox or radio with its label as one tappable row (44 dp min), so the words are the target. Use for choice lists
 * in sheets; settings rows use [RrSwitchRow].
 */
@Composable
fun RrChoiceRow(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    radio: Boolean = true,
    enabled: Boolean = true,
) {
    val haptics = rememberRrHaptics()
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier
            .clip(RrShape.md)
            .then(
                if (radio) Modifier.selectable(selected, interaction, LocalIndication.current, enabled, Role.RadioButton) {
                    if (!selected) haptics(RrHaptic.Selection)
                    onClick()
                } else Modifier.toggleable(selected, interaction, LocalIndication.current, enabled, Role.Checkbox) {
                    haptics(if (it) RrHaptic.ToggleOn else RrHaptic.ToggleOff)
                    onClick()
                },
            )
            .padding(vertical = 12.dp, horizontal = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (radio) RrRadio(selected, null) else RrCheckbox(selected, null)
        RrText(label, style = RrType.ui.copy(fontSize = RrType.body.fontSize), color = RrTheme.colors.ink)
    }
}

@RrPreviews
@Composable
internal fun RrControlsPreview() = RrPreviewSurface {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        RrSwitch(true, {})
        RrSwitch(false, {})
        RrCheckbox(true, {})
        RrCheckbox(false, {})
        RrRadio(true, {})
        RrRadio(false, {})
        RrSwitch(true, {}, enabled = false)
    }
    RrChoiceRow("Best for applying", selected = true, onClick = {})
    RrChoiceRow("Include a cover letter", selected = false, onClick = {}, radio = false)
}
