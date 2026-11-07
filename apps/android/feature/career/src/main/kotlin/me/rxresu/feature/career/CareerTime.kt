package me.rxresu.feature.career

import android.icu.text.DisplayContext
import android.icu.text.RelativeDateTimeFormatter
import android.icu.util.ULocale
import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import me.rxresu.core.data.LocalRepositories

/**
 * Dates and times as the web's `useCareerTime` shows them: the account's timezone, the interface locale, CLDR skeletons
 * ("EEEdMMM" is "Fri 13 Nov" in en-GB and "Fri, Nov 13" in en-US). Values arrive as ISO instants or date-only strings.
 */
internal class CareerTime(private val locale: Locale, val zone: ZoneId, is24Hour: Boolean, private val now: Instant) {
    private fun pattern(skeleton: String) = DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, skeleton), locale)
    private val day = pattern("EEEdMMM")
    private val dateWithYear = pattern("dMMMy")
    private val clock = pattern(if (is24Hour) "Hm" else "hm")
    private val relative by lazy {
        RelativeDateTimeFormatter.getInstance(ULocale.forLocale(locale), null, RelativeDateTimeFormatter.Style.LONG, DisplayContext.CAPITALIZATION_FOR_BEGINNING_OF_SENTENCE)
    }

    val today: LocalDate get() = now.atZone(zone).toLocalDate()

    /** The calendar day a value falls on in the account's timezone. Date-only values are taken as written. */
    fun date(value: String?): LocalDate? = value?.let { text ->
        runCatching { Instant.parse(text).atZone(zone).toLocalDate() }.getOrNull() ?: runCatching { LocalDate.parse(text.take(10)) }.getOrNull()
    }
    fun at(value: String?): ZonedDateTime? = value?.let { runCatching { Instant.parse(it).atZone(zone) }.getOrNull() }

    /** "Fri 13 Nov". */
    fun day(value: String?): String? = date(value)?.let(day::format)
    fun day(date: LocalDate): String = day.format(date)
    /** "4 Jan 2027", for dates that may fall in another year. */
    fun dateWithYear(value: String?): String? = date(value)?.let(dateWithYear::format)
    /** "07:00". */
    fun time(time: LocalTime): String = clock.format(time)
    fun time(value: String?): String? = at(value)?.let(clock::format)
    /** "Fri 13 Nov, 07:00". A date-only value has no clock time. */
    fun dayTime(value: String?): String? = at(value)?.let { "${day.format(it)}, ${clock.format(it)}" } ?: day(value)

    /** "Today", "Yesterday", "Tomorrow", otherwise "Fri 13 Nov". */
    fun relativeDay(value: String?): String? {
        val date = date(value) ?: return null
        val direction = when (ChronoUnit.DAYS.between(today, date)) {
            0L -> RelativeDateTimeFormatter.Direction.THIS
            -1L -> RelativeDateTimeFormatter.Direction.LAST
            1L -> RelativeDateTimeFormatter.Direction.NEXT
            else -> return day.format(date)
        }
        return relative.format(direction, RelativeDateTimeFormatter.AbsoluteUnit.DAY)
    }

    /** Hours until a deadline; date-only deadlines end with their day. */
    fun hoursUntil(value: String?): Long? {
        val at = at(value)?.toInstant() ?: date(value)?.plusDays(1)?.atStartOfDay(zone)?.toInstant() ?: return null
        return ChronoUnit.HOURS.between(now, at)
    }
}

/** [CareerTime] for this account's timezone and the interface locale, fixed at the current instant. */
@Composable
internal fun rememberCareerTime(): CareerTime {
    val time = LocalRepositories.current.time
    val locale = LocalConfiguration.current.locales[0]
    val is24 = DateFormat.is24HourFormat(LocalContext.current)
    val zone = time.timezone()
    return remember(locale, zone, is24) { CareerTime(locale, zone, is24, time.now()) }
}
