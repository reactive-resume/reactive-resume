package me.rxresu.core.designsystem

import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.time.temporal.WeekFields
import java.util.Locale

/** Month-grid arithmetic, kept pure for tests. */
object RrCalendarMath {
    /** The month's days in week rows starting on [firstDayOfWeek]; nulls pad the first and last weeks. */
    fun monthGrid(month: YearMonth, firstDayOfWeek: DayOfWeek): List<LocalDate?> {
        val first = month.atDay(1)
        val lead = (first.dayOfWeek.value - firstDayOfWeek.value + 7) % 7
        val days = (1..month.lengthOfMonth()).map { month.atDay(it) }
        val cells = List<LocalDate?>(lead) { null } + days
        return cells + List((7 - cells.size % 7) % 7) { null }
    }

    /** Weekdays in display order. */
    fun weekdays(firstDayOfWeek: DayOfWeek): List<DayOfWeek> = (0 until 7).map { firstDayOfWeek.plus(it.toLong()) }
}

/**
 * Month grid date picker (the boards forbid native date wheels): month title with previous and next buttons, weekday
 * initials, 44 dp day cells. Today's number is accent text; the selected day is accent-filled. Days outside [min]..[max]
 * are dimmed and inert. Plays `selection` when a day is picked. Used inside the interview and schedule sheets.
 */
@Composable
fun RrDatePicker(
    selected: LocalDate?,
    onSelect: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
    today: LocalDate = LocalDate.now(),
    min: LocalDate? = null,
    max: LocalDate? = null,
    locale: Locale = LocalConfiguration.current.locales[0],
    firstDayOfWeek: DayOfWeek = WeekFields.of(locale).firstDayOfWeek,
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    var month by remember { mutableStateOf(YearMonth.from(selected ?: today)) }
    val titleFormat = remember(locale) { DateTimeFormatter.ofPattern("LLLL yyyy", locale) }
    val dayFormat = remember(locale) { DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(locale) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            RrText(
                month.format(titleFormat).replaceFirstChar { it.titlecase(locale) },
                style = RrType.label,
                color = c.ink,
                modifier = Modifier.weight(1f).padding(start = 4.dp).semantics { heading() },
            )
            RrIconButton(R.drawable.ic_ph_caret_left, stringResource(R.string.ds_previous_month), { month = month.minusMonths(1) }, mirrorInRtl = true)
            RrIconButton(R.drawable.ic_ph_caret_right, stringResource(R.string.ds_next_month), { month = month.plusMonths(1) }, mirrorInRtl = true)
        }
        Row(Modifier.fillMaxWidth().clearAndSetSemantics { }) {
            RrCalendarMath.weekdays(firstDayOfWeek).forEach { d ->
                RrText(
                    d.getDisplayName(TextStyle.NARROW, locale),
                    style = RrType.caption,
                    color = c.ink3,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        RrCalendarMath.monthGrid(month, firstDayOfWeek).chunked(7).forEach { week ->
            Row(Modifier.fillMaxWidth().selectableGroup(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                week.forEach { day ->
                    Box(Modifier.weight(1f).heightIn(min = 44.dp), contentAlignment = Alignment.Center) {
                        if (day != null) {
                            val isSelected = day == selected
                            val isToday = day == today
                            val allowed = (min == null || !day.isBefore(min)) && (max == null || !day.isAfter(max))
                            val label = day.format(dayFormat)
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .heightIn(min = 44.dp)
                                    .clip(RrShape.md)
                                    .background(if (isSelected) c.accent else Color.Transparent)
                                    .then(if (isToday && !isSelected) Modifier.border(1.dp, c.line2, RrShape.md) else Modifier)
                                    .selectable(isSelected, remember { MutableInteractionSource() }, LocalIndication.current, allowed, Role.Button) {
                                        if (!isSelected) haptics(RrHaptic.Selection)
                                        onSelect(day)
                                    }
                                    .semantics { contentDescription = label }
                                    .alpha(if (allowed) 1f else 0.35f),
                                contentAlignment = Alignment.Center,
                            ) {
                                RrText(
                                    "${day.dayOfMonth}",
                                    style = RrType.ui.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
                                    color = when {
                                        isSelected -> c.onAccent
                                        isToday -> c.accentText
                                        else -> c.ink
                                    },
                                    modifier = Modifier.clearAndSetSemantics { },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@RrPreviews
@Composable
internal fun RrDatePickerPreview() = RrPreviewSurface {
    RrDatePicker(LocalDate.of(2026, 11, 10), {}, today = LocalDate.of(2026, 11, 7), locale = Locale.UK)
}
