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
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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
 * @param repeatOnHold press and hold repeats the step (B7): one step on press, then every 120 ms after 400 ms,
 *   `selection` per step, until release or the end of the range.
 * @param onPressStart called once at the start of each press (or TalkBack activation), before its first step, so a
 *   held press can be grouped (one undo step).
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
    repeatOnHold: Boolean = false,
    onPressStart: () -> Unit = {},
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    @Composable
    fun Button(icon: Int, description: String, enabled: Boolean, onStep: () -> Unit) =
        if (repeatOnHold) {
            HoldStepButton(icon, description, enabled, onPressStart) { haptics(RrHaptic.Selection); onStep() }
        } else {
            StepButton(icon, description, enabled) { onPressStart(); haptics(RrHaptic.Selection); onStep() }
        }
    Row(
        modifier.height(36.dp).clip(RrShape.md).background(c.raised).border(1.dp, c.controlBorder, RrShape.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(R.drawable.ic_ph_minus, "${stringResource(R.string.ds_decrease)} $label", canDecrease, onDecrease)
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
        Button(R.drawable.ic_ph_plus, "${stringResource(R.string.ds_increase)} $label", canIncrease, onIncrease)
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

/** Steps on press, then repeats while held; TalkBack activation is one step. */
@Composable
private fun HoldStepButton(icon: Int, description: String, enabled: Boolean, onPressStart: () -> Unit, onStep: () -> Unit) {
    val canStep by rememberUpdatedState(enabled)
    val start by rememberUpdatedState(onPressStart)
    val step by rememberUpdatedState(onStep)
    Box(
        Modifier
            .size(40.dp, 36.dp)
            .pointerInput(Unit) {
                coroutineScope {
                    awaitEachGesture {
                        awaitFirstDown()
                        if (!canStep) return@awaitEachGesture
                        start()
                        val repeat = launch {
                            var wait = RrStepperRepeat.FIRST_MS
                            while (canStep) { step(); delay(wait); wait = RrStepperRepeat.NEXT_MS }
                        }
                        waitForUpOrCancellation()
                        repeat.cancel()
                    }
                }
            }
            .semantics {
                role = Role.Button
                contentDescription = description
                if (!enabled) disabled()
                onClick { if (enabled) { start(); step(); true } else false }
            }
            .alpha(if (enabled) 1f else 0.4f),
        contentAlignment = Alignment.Center,
    ) { RrIcon(icon, null, size = 20.dp, tint = RrTheme.colors.ink2) }
}

/** Press-and-hold timing (B7 Haptics: repeated steps tick at most every 120 ms). */
internal object RrStepperRepeat {
    const val FIRST_MS = 400L
    const val NEXT_MS = 120L
}

@RrPreviews
@Composable
internal fun RrStepperPreview() = RrPreviewSurface {
    RrStepper("10.5", {}, {}, label = "Font size", modifier = Modifier.padding(0.dp))
}
