package me.rxresu.feature.today

import android.text.format.DateFormat
import android.text.format.DateUtils
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Dates in the person's locale and account timezone. Skeletons follow Android's best pattern for the locale. */
internal class TodayFormat(private val locale: Locale, val zone: ZoneId, private val is24Hour: Boolean) {
    private fun pattern(skeleton: String) = DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, skeleton), locale)
    private val header = DateTimeFormatter.ofPattern("EEEE, d MMMM", locale)
    private val shortDay = pattern("EEEdMMM")
    private val dayMonth = DateTimeFormatter.ofPattern("d MMM", locale)
    private val weekday = pattern("EEE")
    private val clock = pattern(if (is24Hour) "Hm" else "hm")

    fun parse(value: String?): ZonedDateTime? = value?.let { runCatching { Instant.parse(it).atZone(zone) }.getOrNull() }

    /** "Saturday, 7 November". */
    fun header(date: LocalDate): String = header.format(date)
    /** "Tue 10 Nov". */
    fun shortDay(at: ZonedDateTime): String = shortDay.format(at)
    /** "28 Oct". */
    fun dayMonth(at: ZonedDateTime): String = dayMonth.format(at)
    fun fullDay(at: ZonedDateTime): String = DateTimeFormatter.ofPattern("EEEE d MMM", locale).format(at)
    fun deadline(at: ZonedDateTime): String = DateTimeFormatter.ofPattern("EEEE d MMM", locale).format(at)
    fun weekday(at: ZonedDateTime): String = weekday.format(at)
    /** "10:00". */
    fun time(at: ZonedDateTime): String = clock.format(at)

    /** "12 min ago", "Yesterday", "3 Oct". */
    fun relative(value: String, now: Instant): String {
        val at = runCatching { Instant.parse(value) }.getOrNull() ?: return value
        val days = java.time.temporal.ChronoUnit.DAYS.between(at.atZone(zone).toLocalDate(), now.atZone(zone).toLocalDate())
        val resolution = if (days == 0L) DateUtils.MINUTE_IN_MILLIS else DateUtils.DAY_IN_MILLIS
        return DateUtils.getRelativeTimeSpanString(at.toEpochMilli(), now.toEpochMilli(), resolution, DateUtils.FORMAT_ABBREV_RELATIVE or DateUtils.FORMAT_ABBREV_MONTH).toString()
    }
}
