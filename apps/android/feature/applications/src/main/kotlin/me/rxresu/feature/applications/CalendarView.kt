package me.rxresu.feature.applications

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.selection.selectable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters
import java.time.temporal.WeekFields
import java.util.Locale
import me.rxresu.core.data.CalendarItem
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.designsystem.RrBadge
import me.rxresu.core.designsystem.RrBadgeTone
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrDatePicker
import me.rxresu.core.designsystem.RrEmptyState
import me.rxresu.core.designsystem.RrFixedColors
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrIconButtonSize
import me.rxresu.core.designsystem.RrLargeTitleState
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrSectionHeader
import me.rxresu.core.designsystem.RrShape
import me.rxresu.core.designsystem.RrStageDot
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.RrWeekDay
import me.rxresu.core.designsystem.RrWeekStrip
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.designsystem.rrLargeTitleScroll
import me.rxresu.core.network.generated.AddApplicationInterviewRequestKind
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.Interview
import me.rxresu.core.strings.R as S

/** Calendar items grouped by local day, soonest first (web calendar.ts groups by the account's timezone). */
internal fun itemsByDay(items: List<CalendarItem>, zone: ZoneId): Map<LocalDate, List<CalendarItem>> =
    items.mapNotNull { item -> runCatching { Instant.parse(item.at) }.getOrNull()?.let { it.atZone(zone).toLocalDate() to item } }
        .sortedBy { it.second.at }
        .groupBy({ it.first }, { it.second })

/** The day the calendar opens on: today, else the next day with something on it, else today. */
internal fun initialDay(byDay: Map<LocalDate, List<CalendarItem>>, today: LocalDate): LocalDate =
    if (byDay.containsKey(today)) today else byDay.keys.filter { it > today }.minOrNull() ?: today

/** The week (first day per the locale) containing [day]. */
internal fun weekOf(day: LocalDate, locale: Locale): List<LocalDate> {
    val start = day.with(TemporalAdjusters.previousOrSame(WeekFields.of(locale).firstDayOfWeek))
    return (0L until 7L).map { start.plusDays(it) }
}

@Composable
internal fun CalendarView(
    state: ApplicationsState,
    dates: Dates,
    today: LocalDate,
    title: RrLargeTitleState,
    onOpen: (String) -> Unit,
    onSchedule: () -> Unit,
    onAddToCalendar: (CalendarEvent) -> Unit,
) {
    val c = RrTheme.colors
    val locale = LocalConfiguration.current.locales[0]
    val reduced = LocalReducedMotion.current
    val haptics = rememberRrHaptics()
    val byDay = remember(state.calendar, dates.zone) { itemsByDay(state.calendar, dates.zone) }
    var selected by rememberSaveable(state.calendar.isEmpty()) { mutableStateOf(initialDay(byDay, today)) }
    var monthSheet by remember { mutableStateOf(false) }
    val week = weekOf(selected, locale)
    val appsById = state.all.associateBy { it.id }

    fun select(day: LocalDate) {
        if (day != selected) haptics(RrHaptic.Selection)
        selected = day
    }

    if (state.calendar.isEmpty() && !state.loading) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            RrEmptyState(
                title = stringResource(S.string.nothing_scheduled_yet),
                body = stringResource(S.string.add_screening_calls_and_technical_interviews_to_see_them_here_and_on_the_calendar),
                actionLabel = stringResource(S.string.schedule_interview),
                onAction = onSchedule,
            )
        }
        return
    }

    LazyColumn(Modifier.fillMaxSize().rrLargeTitleScroll(title), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Row(Modifier.fillMaxWidth().heightIn(min = 36.dp).padding(start = 16.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                RrText(
                    dates.monthYear(selected),
                    Modifier.weight(1f).clip(RrShape.md).selectable(false, role = Role.Button) { monthSheet = true }.padding(vertical = 4.dp),
                    style = RrType.sectionHeading,
                    color = c.ink,
                )
                RrIconButton(D.drawable.ic_ph_caret_left, stringResource(R.string.app_prev_week), { select(selected.minusWeeks(1)) }, size = RrIconButtonSize.Small, mirrorInRtl = true)
                RrIconButton(D.drawable.ic_ph_caret_right, stringResource(R.string.app_next_week), { select(selected.plusWeeks(1)) }, size = RrIconButtonSize.Small, mirrorInRtl = true)
            }
        }
        item {
            AnimatedContent(
                week.first(),
                transitionSpec = {
                    val dir = if (targetState > initialState) 1 else -1
                    if (reduced) fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                    else slideInHorizontally(tween(RrMotion.D3, easing = RrMotion.easeInOutStrong)) { it * dir } togetherWith
                        slideOutHorizontally(tween(RrMotion.D3, easing = RrMotion.easeInOutStrong)) { -it * dir }
                },
                label = "week",
            ) { start ->
                WeekStrip((0L until 7L).map { start.plusDays(it) }, selected, today, dates, byDay, appsById, onTap = { selected = it }, onWeek = ::select)
            }
        }
        item {
            Crossfade(selected, animationSpec = if (reduced) tween(0) else tween(RrMotion.D2), label = "agenda") { day ->
                Column(Modifier.padding(top = 8.dp)) {
                    RrSectionHeader(dates.weekdayLong(day))
                    val dayItems = byDay[day].orEmpty()
                    if (dayItems.isEmpty()) RrText(stringResource(S.string.nothing_scheduled_yet_b76ac1b9fc), Modifier.padding(horizontal = 16.dp), style = RrType.small, color = c.ink3)
                    else RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                        dayItems.forEach { item -> EventRow(item, appsById[item.applicationId], dates, state.briefings, timeLabel = true, onOpen, onAddToCalendar) }
                    }
                    val upcoming = byDay.filterKeys { it > day }.values.flatten().take(10)
                    if (upcoming.isNotEmpty()) {
                        RrSectionHeader(stringResource(R.string.app_upcoming))
                        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                            upcoming.forEach { item -> EventRow(item, appsById[item.applicationId], dates, state.briefings, timeLabel = false, onOpen, onAddToCalendar, from = day) }
                        }
                    }
                }
            }
        }
        item {
            Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp)) {
                RrButton(stringResource(S.string.schedule_interview), onSchedule, Modifier.fillMaxWidth(), variant = RrButtonVariant.Secondary, icon = D.drawable.ic_ph_calendar_plus)
            }
        }
    }

    if (monthSheet) {
        RrBottomSheet(onDismissRequest = { monthSheet = false }, title = dates.monthYear(selected), fitContent = true) {
            Box(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
                RrDatePicker(selected, { select(it); monthSheet = false }, today = today)
            }
        }
    }
}

/** Marker colour beside a day: the interview's stage, warn for a follow-up, the offer stage for an offer deadline. */
private fun markerColor(item: CalendarItem, app: Application?, warn: Color): Color = when (item.kind) {
    "interview" -> (app?.status ?: ApplicationStage.Interview).rr().color
    "offer" -> RrFixedColors.stageOffer
    else -> warn
}

/** Seven day cells with markers for the day's interviews, follow-ups and offer deadlines; swipe sideways for weeks. */
@Composable
private fun WeekStrip(
    days: List<LocalDate>,
    selected: LocalDate,
    today: LocalDate,
    dates: Dates,
    byDay: Map<LocalDate, List<CalendarItem>>,
    apps: Map<String, Application>,
    onTap: (LocalDate) -> Unit,
    onWeek: (LocalDate) -> Unit,
) {
    // The strip plays `selection` for taps itself; week swipes go through onWeek, which plays it.
    val warn = RrTheme.colors.warn
    RrWeekStrip(
        days = days.map { day ->
            val markers = byDay[day].orEmpty().distinctBy { it.kind + (apps[it.applicationId]?.status) }.map { markerColor(it, apps[it.applicationId], warn) }
            RrWeekDay(day, dates.weekday(day), markers, contentDescription = dates.fullDate(day))
        },
        selected = selected,
        onSelect = onTap,
        modifier = Modifier.padding(horizontal = 16.dp),
        today = today,
        onWeekChange = { onWeek(selected.plusWeeks(it.toLong())) },
    )
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun EventRow(
    item: CalendarItem,
    app: Application?,
    dates: Dates,
    briefings: Set<String>,
    timeLabel: Boolean,
    onOpen: (String) -> Unit,
    onAddToCalendar: (CalendarEvent) -> Unit,
    from: LocalDate? = null,
) {
    val c = RrTheme.colors
    val at = runCatching { Instant.parse(item.at) }.getOrNull() ?: return
    val interview = app?.activity?.filterIsInstance<Interview>()?.firstOrNull { it.id == item.id }
    val day = at.atZone(dates.zone).toLocalDate()
    val left = when {
        timeLabel && item.kind == "interview" -> dates.time(at)
        timeLabel -> ""
        from != null && day.toEpochDay() - from.toEpochDay() < 7 -> dates.weekday(day)
        else -> dates.dayMonth(at)
    }
    val title: String
    val sub: String
    when (item.kind) {
        "interview" -> {
            val kind = interview?.let { interviewKindLabel(it.kind) } ?: interviewKindLabel(AddApplicationInterviewRequestKind.entries.firstOrNull { it.wireValue == item.title } ?: AddApplicationInterviewRequestKind.Other)
            title = "${item.company} · ${stringResource(S.string.kind_interview, kind)}"
            val zone = item.timezone?.let { runCatching { ZoneId.of(it) }.getOrNull() }
            val other = zone?.takeIf { it.rules != dates.zone.rules }?.let { stringResource(R.string.app_shown_in_zone, Dates(dates.locale, it, true).time(at), it.id.substringAfterLast('/').replace('_', ' ')) }
            sub = listOfNotNull(
                if (!timeLabel) dates.time(at) else null,
                item.durationMinutes?.let { stringResource(R.string.app_minutes_length, it.toInt()) },
                interview?.location?.takeIf(String::isNotBlank),
                other,
            ).joinToString(" · ")
        }
        "offer" -> { title = "${stringResource(S.string.reply_to_the_offer)} · ${item.company}"; sub = stringResource(R.string.app_respond_by_day) }
        else -> { title = "${stringResource(S.string.follow_up)} · ${item.company}"; sub = app?.followUpNote?.takeIf(String::isNotBlank) ?: stringResource(R.string.app_reminder_you_set) }
    }
    val event = if (item.kind == "interview") CalendarEvent(item.id, title, at, item.durationMinutes ?: 60, interview?.location, interview?.notes) else null
    Row(
        Modifier.fillMaxWidth()
            .then(if (app != null) Modifier.combinedClickable(onClick = { onOpen(item.applicationId) }, onLongClick = event?.let { { onAddToCalendar(it) } }, onLongClickLabel = stringResource(S.string.add_to_calendar)) else Modifier)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        RrText(left, Modifier.width(44.dp), style = RrType.mono.copy(fontSize = 13.sp, lineHeight = 18.sp), color = c.ink2)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                when (item.kind) {
                    "interview" -> RrStageDot((app?.status ?: ApplicationStage.Interview).rr())
                    "offer" -> RrStageDot(ApplicationStage.Offer.rr())
                    else -> WarnDot()
                }
                RrText(title, style = if (timeLabel) RrType.label else RrType.ui, color = c.ink)
            }
            if (sub.isNotBlank()) RrText(sub, style = RrType.small, color = c.ink3)
            if (item.kind == "interview" && item.id in briefings && timeLabel) Box(Modifier.padding(top = 4.dp)) { RrBadge(stringResource(S.string.briefing_ready), tone = RrBadgeTone.Accent) }
        }
    }
}
