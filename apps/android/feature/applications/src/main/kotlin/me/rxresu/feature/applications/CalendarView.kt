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
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrRowCaret
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
    onOpen: (CalendarItem) -> Unit,
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
                Column {
                    RrSectionHeader(java.time.format.DateTimeFormatter.ofPattern("EEEE d MMMM", dates.locale).format(day), topPadding = 20.dp)
                    val dayItems = byDay[day].orEmpty()
                    if (dayItems.isEmpty()) RrText(stringResource(S.string.nothing_scheduled_yet_b76ac1b9fc), Modifier.padding(horizontal = 16.dp), style = RrType.small, color = c.ink3)
                    else RrListGroup {
                        dayItems.forEachIndexed { i, item -> EventRow(item, appsById[item.applicationId], dates, state.briefings, timeLabel = true, onOpen, onAddToCalendar, divider = i < dayItems.lastIndex) }
                    }
                    val upcoming = byDay.filterKeys { it > day }.values.flatten().take(10)
                    upcoming.groupBy { Instant.parse(it.at).atZone(dates.zone).toLocalDate() }.forEach { (nextDay, events) ->
                        RrSectionHeader(java.time.format.DateTimeFormatter.ofPattern("EEEE d MMMM", dates.locale).format(nextDay))
                        events.forEachIndexed { i, item -> EventRow(item, appsById[item.applicationId], dates, state.briefings, timeLabel = false, onOpen, onAddToCalendar, from = day, divider = i < events.lastIndex) }
                    }
                }
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
        modifier = Modifier,
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
    onOpen: (CalendarItem) -> Unit,
    onAddToCalendar: (CalendarEvent) -> Unit,
    from: LocalDate? = null,
    divider: Boolean = false,
) {
    val c = RrTheme.colors
    val at = runCatching { Instant.parse(item.at) }.getOrNull() ?: return
    val interview = app?.activity?.filterIsInstance<Interview>()?.firstOrNull { it.id == item.id }
    val day = at.atZone(dates.zone).toLocalDate()
    val left = when {
        item.kind != "offer" -> dates.time(at)
        item.kind == "offer" -> stringResource(R.string.app_all_day)
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
            sub = listOfNotNull(if (interview?.location?.startsWith("http") == true) stringResource(R.string.app_video_call) else interview?.location?.takeIf(String::isNotBlank), interview?.participants?.firstOrNull()?.name?.let { stringResource(R.string.app_with_person, it) }, other).joinToString(" · ")
        }
        "offer" -> { title = stringResource(R.string.app_offer_deadline, item.company); sub = stringResource(R.string.app_reply_end_day) }
        else -> { title = stringResource(R.string.app_follow_company, item.company); sub = stringResource(R.string.app_reminder) }
    }
    val largeText = androidx.compose.ui.platform.LocalDensity.current.fontScale >= 1.5f
    val event = if (item.kind == "interview") CalendarEvent(item.id, title, at, item.durationMinutes ?: 60, interview?.location, interview?.notes) else null
    RrListRow(title, subtitle = sub, leading = { RrText(left, Modifier.width(60.dp), style = RrType.ui.copy(fontFamily = me.rxresu.core.designsystem.GeistMono, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium), color = c.ink2) },
        onClick = if (app != null) ({ onOpen(item) }) else null,
        onLongClick = event?.let { { onAddToCalendar(it) } }, onLongClickLabel = stringResource(S.string.add_to_calendar), divider = divider,
        trailing = { RrRowCaret() })
}
