package me.rxresu.core.designsystem

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalView

/**
 * Haptic vocabulary (boards/Motion.png).
 *
 * - [Selection]: segment, mode or view switch; picker detent; sheet snapping to a detent; reorder passing a slot; chip
 *   filter toggled.
 * - [ToggleOn] / [ToggleOff]: switches and checkboxes that save at once.
 * - [Light]: long-press opens an actions sheet; a swipe action crosses its threshold; a proposal is accepted or rejected;
 *   recording starts or stops.
 * - [Medium]: lifting a section, entry, stage or board card to drag it.
 * - [Rigid]: dropping into a new position, column or page.
 * - [Soft]: pull to refresh arms; Hold to delete begins filling.
 * - [Success]: web page published, job saved, PDF or import ready, all edits accepted, marked applied, offer recorded.
 * - [Warning]: Hold to delete completes; a permanent action lands; a recording hits its 2-minute limit.
 * - [Error]: save, export, upload or AI request fails and its danger card appears; a wrong two-step code.
 */
enum class RrHaptic { Selection, ToggleOn, ToggleOff, Light, Medium, Rigid, Soft, Success, Warning, Error }

/**
 * Plays [h] unless [enabled] is false. `performHapticFeedback` already respects the system haptics setting.
 */
fun View.rrHaptic(h: RrHaptic, enabled: Boolean = true) {
    if (!enabled) return
    val api34 = Build.VERSION.SDK_INT >= 34
    val api30 = Build.VERSION.SDK_INT >= 30
    val constant = when (h) {
        RrHaptic.Selection -> if (api34) HapticFeedbackConstants.SEGMENT_TICK else HapticFeedbackConstants.CLOCK_TICK
        RrHaptic.ToggleOn -> if (api34) HapticFeedbackConstants.TOGGLE_ON else HapticFeedbackConstants.CONTEXT_CLICK
        RrHaptic.ToggleOff -> if (api34) HapticFeedbackConstants.TOGGLE_OFF else HapticFeedbackConstants.CONTEXT_CLICK
        RrHaptic.Light -> HapticFeedbackConstants.CONTEXT_CLICK
        RrHaptic.Medium -> if (api34) HapticFeedbackConstants.DRAG_START else HapticFeedbackConstants.LONG_PRESS
        RrHaptic.Rigid -> if (api30) HapticFeedbackConstants.GESTURE_END else HapticFeedbackConstants.VIRTUAL_KEY
        RrHaptic.Soft -> if (api30) HapticFeedbackConstants.GESTURE_START else HapticFeedbackConstants.KEYBOARD_TAP
        RrHaptic.Success -> if (api30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
        RrHaptic.Warning -> HapticFeedbackConstants.LONG_PRESS
        RrHaptic.Error -> if (api30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
    }
    performHapticFeedback(constant)
}

/**
 * Haptic performer bound to the current view, gated by [LocalRrHapticsEnabled] (the in-app switch) and the system
 * setting.
 *
 * Rules: one haptic per gesture, at the moment the state changes, never on press-down of an ordinary button. Never for
 * scrolling, typing, plain navigation (tab switch, push, back), streaming AI text or background syncs. Haptics never
 * replace words: every state they mark is also shown in text and announced. Design-system components already play
 * their own haptics (switches, segments, sheets, swipe rows, Hold to delete); call this only for screen-level moments
 * such as `Success` when a job is saved.
 */
@Composable
fun rememberRrHaptics(): (RrHaptic) -> Unit {
    val view = LocalView.current
    val enabled = LocalRrHapticsEnabled.current
    return remember(view, enabled) { { h: RrHaptic -> view.rrHaptic(h, enabled) } }
}
