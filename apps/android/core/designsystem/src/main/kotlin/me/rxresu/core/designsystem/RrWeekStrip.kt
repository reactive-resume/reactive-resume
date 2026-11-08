package me.rxresu.core.designsystem

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate

/**
 * One day of [RrWeekStrip].
 *
 * @param weekday the short weekday in the caller's format ("Tue").
 * @param markers up to three marker colours under the number: an interview's stage colour, `warn` for a follow-up.
 *   Colour never carries meaning alone, so describe the day's items in [contentDescription] ("Tuesday 10 November,
 *   1 interview").
 */
@Immutable
data class RrWeekDay(val date: LocalDate, val weekday: String, val markers: List<Color> = emptyList(), val contentDescription: String? = null)

/**
 * Week strip (J3 calendar): seven 56 dp day cells 4 dp apart with the weekday in caption ink-3, the number in 16/600, and
 * 4 dp markers below. Today's number is accent-text; the selected day fills with accent (d2; instant under reduced
 * motion). Plays `selection` when a day is picked.
 *
 * @param onWeekChange swipe sideways for the next (+1) or previous (-1) week; also offered to TalkBack as "Previous
 *   week" and "Next week" actions. Null turns the swipe off.
 */
@Composable
fun RrWeekStrip(
    days: List<RrWeekDay>,
    selected: LocalDate,
    onSelect: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
    today: LocalDate = LocalDate.now(),
    onWeekChange: ((Int) -> Unit)? = null,
) {
    val c = RrTheme.colors
    val reduced = LocalReducedMotion.current
    val haptics = rememberRrHaptics()
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val change by rememberUpdatedState(onWeekChange)
    val previous = stringResource(R.string.ds_previous_week)
    val next = stringResource(R.string.ds_next_week)
    var dragged by remember { mutableFloatStateOf(0f) }
    Row(
        modifier
            .fillMaxWidth().padding(horizontal = 16.dp).padding(top = 20.dp)
            .rrDesignTag(DesignTag(component = "WeekStrip"))
            .selectableGroup()
            .then(
                if (onWeekChange == null) Modifier
                else Modifier
                    .semantics {
                        customActions = listOf(
                            CustomAccessibilityAction(previous) { change?.invoke(-1); true },
                            CustomAccessibilityAction(next) { change?.invoke(1); true },
                        )
                    }
                    .pointerInput(rtl) {
                        val threshold = 40.dp.toPx()
                        detectHorizontalDragGestures(
                            onDragEnd = {
                                // Swiping toward the start edge moves forward in time (left in LTR, right in RTL).
                                val forward = if (rtl) dragged else -dragged
                                if (forward > threshold) change?.invoke(1) else if (forward < -threshold) change?.invoke(-1)
                                dragged = 0f
                            },
                            onDragCancel = { dragged = 0f },
                        ) { _, amount -> dragged += amount }
                    },
            ),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        days.forEach { day ->
            val on = day.date == selected
            val fill by animateFloatAsState(if (on) 1f else 0f, RrMotion.spec(RrMotion.D2, reduced), label = "day")
            Column(
                Modifier
                    .weight(1f)
                    .heightIn(min = 56.dp)
                    .clip(RrShape.lg)
                    .background(c.accent.copy(alpha = fill))
                    .selectable(on, role = Role.Tab) {
                        if (!on) haptics(RrHaptic.Selection)
                        onSelect(day.date)
                    }
                    .then(if (day.contentDescription != null) Modifier.rrClearAndSetSemantics { contentDescription = day.contentDescription } else Modifier),
                verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                RrText(day.weekday, style = RrType.caption, color = if (on) c.onAccent else c.ink3, maxLines = 1)
                RrText(
                    day.date.dayOfMonth.toString(),
                    style = RrType.sheetTitle.copy(lineHeight = 26.sp),
                    color = when {
                        on -> c.onAccent
                        day.date == today -> c.accentText
                        else -> c.ink
                    },
                    maxLines = 1,
                )
                Row(Modifier.height(5.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    day.markers.take(3).forEach { color ->
                        Box(Modifier.size(5.dp).clip(RrShape.full).background(if (on) c.onAccent else color))
                    }
                }
            }
        }
    }
}

@RrPreviews
@Composable
internal fun RrWeekStripPreview() = RrPreviewSurface {
    val monday = LocalDate.of(2026, 11, 9)
    val names = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
    val markers = mapOf(1 to listOf(RrStage.Interview.color), 3 to listOf(RrTheme.colors.warn), 4 to listOf(RrStage.Offer.color, RrStage.Screening.color))
    RrWeekStrip(
        days = names.mapIndexed { i, n -> RrWeekDay(monday.plusDays(i.toLong()), n, markers[i].orEmpty()) },
        selected = monday.plusDays(1),
        onSelect = {},
        today = monday,
        onWeekChange = {},
    )
}
