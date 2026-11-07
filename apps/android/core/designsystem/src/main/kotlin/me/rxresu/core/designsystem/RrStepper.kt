package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Stepper (− value +), 36 dp: font size, margins, line height in Design. The value is mono and announced politely
 * when it changes. Plays `selection` per step.
 *
 * @param value the formatted value ("10.5", "0.75 in").
 * @param label names the setting for TalkBack ("Font size").
 */
@Composable
fun RrStepper(
    value: String,
    onDecrease: () -> Unit,
    onIncrease: () -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    canDecrease: Boolean = true,
    canIncrease: Boolean = true,
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    Row(
        modifier.height(36.dp).clip(RrShape.md).background(c.raised).border(1.dp, c.controlBorder, RrShape.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StepButton(R.drawable.ic_ph_minus, "${stringResource(R.string.ds_decrease)} $label", canDecrease) { haptics(RrHaptic.Selection); onDecrease() }
        RrText(
            value,
            style = RrType.mono.copy(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium),
            color = c.ink,
            textAlign = TextAlign.Center,
            modifier = Modifier.defaultMinSize(minWidth = 64.dp).semantics {
                contentDescription = "$label, $value"
                liveRegion = LiveRegionMode.Polite
            },
        )
        StepButton(R.drawable.ic_ph_plus, "${stringResource(R.string.ds_increase)} $label", canIncrease) { haptics(RrHaptic.Selection); onIncrease() }
    }
}

@Composable
private fun StepButton(icon: Int, description: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .size(40.dp, 36.dp)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description }
            .alpha(if (enabled) 1f else 0.4f),
        contentAlignment = Alignment.Center,
    ) { RrIcon(icon, null, size = 20.dp, tint = RrTheme.colors.ink2) }
}

@RrPreviews
@Composable
internal fun RrStepperPreview() = RrPreviewSurface {
    RrStepper("10.5", {}, {}, label = "Font size", modifier = Modifier.padding(0.dp))
}
