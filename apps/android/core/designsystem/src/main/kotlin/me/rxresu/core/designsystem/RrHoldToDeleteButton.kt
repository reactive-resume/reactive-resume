package me.rxresu.core.designsystem

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Hold-to-delete timing (boards/Motion.png). */
object RrHoldToDelete {
    /** The fill sweeps from the leading edge, linearly, over 1.2 s of holding. */
    const val HOLD_MS = 1200

    /** Releasing early drains the fill in d2. */
    const val DRAIN_MS = RrMotion.D2

    /** Remaining hold time from [progress] (0–1), so a re-press continues from where the drain left it. */
    fun remainingMs(progress: Float): Int = ((1f - progress.coerceIn(0f, 1f)) * HOLD_MS).toInt()
}

/**
 * Destructive confirm for irreversible actions (Delete forever). Press and hold: the danger fill sweeps from the
 * leading edge, linear 1.2 s, then [onDelete] runs. Starting plays `soft`; completing plays `warning`; releasing early
 * drains the fill in d2. It still fills under reduced motion and at animator scale 0.
 *
 * TalkBack and switch access: the double-tap action deletes at once (the dialog around it is the confirmation), and
 * the label says "Hold to delete" so sighted users know to press and hold.
 */
@Composable
fun RrHoldToDeleteButton(
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
    text: String = stringResource(R.string.ds_hold_to_delete),
    enabled: Boolean = true,
) {
    val progress = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val haptics = rememberRrHaptics()
    val delete by rememberUpdatedState(onDelete)
    val deleteLabel = stringResource(R.string.ds_delete)
    HoldToDeleteSurface(
        progress = progress.value,
        text = text,
        enabled = enabled,
        modifier = modifier
            .semantics(mergeDescendants = true) {
                role = Role.Button
                contentDescription = text
                progressBarRangeInfo = ProgressBarRangeInfo(progress.value, 0f..1f)
                if (enabled) onClick(label = deleteLabel) { delete(); true }
            }
            .focusable(enabled)
            .then(
                if (!enabled) Modifier else Modifier.pointerInput(Unit) {
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false)
                        haptics(RrHaptic.Soft)
                        val fill: Job = scope.launch {
                            withContext(RrMotion.Unscaled) {
                                progress.animateTo(1f, tween(RrHoldToDelete.remainingMs(progress.value), easing = LinearEasing))
                            }
                            haptics(RrHaptic.Warning)
                            delete()
                            progress.snapTo(0f)
                        }
                        waitForUpOrCancellation()
                        if (fill.isActive) {
                            fill.cancel()
                            scope.launch {
                                withContext(RrMotion.Unscaled) { progress.animateTo(0f, tween(RrHoldToDelete.DRAIN_MS, easing = LinearEasing)) }
                            }
                        }
                    }
                },
            ),
    )
}

/** The drawn button at a given fill; [RrHoldToDeleteButton] animates it. */
@Composable
internal fun HoldToDeleteSurface(progress: Float, text: String, enabled: Boolean, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    Box(
        modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 44.dp)
            .rrDesignTag(DesignTag(component = "Button", radius = RrRadius.lg, bgName = "danger-soft"))
            .rrEnabledAlpha(enabled, 0.45f)
            .clip(RrShape.lg)
            .background(c.dangerSoft)
            .border(1.dp, c.danger, RrShape.lg),
        contentAlignment = Alignment.Center,
    ) {
        // Fill from the leading edge (start in RTL too); danger at 25% over danger-soft.
        Box(Modifier.matchParentSize()) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(progress.coerceIn(0f, 1f)).align(Alignment.CenterStart).background(c.danger.copy(alpha = 0.25f)))
        }
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            RrIcon(R.drawable.ic_ph_trash, null, size = 20.dp, tint = c.dangerText)
            RrText(text, style = RrType.ui.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium), color = c.dangerText)
        }
    }
}

@RrPreviews
@Composable
internal fun RrHoldToDeleteButtonPreview() = RrPreviewSurface {
    RrHoldToDeleteButton(onDelete = {})
    HoldToDeleteSurface(progress = 0.38f, text = stringResource(R.string.ds_hold_to_delete), enabled = true)
}
