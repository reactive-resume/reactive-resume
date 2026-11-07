package me.rxresu.feature.settings

import android.text.format.DateFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Dates in the interface locale and account timezone, from CLDR skeletons like the rest of the app. */
internal class SettingsDates(private val locale: Locale, private val zone: ZoneId, is24Hour: Boolean) {
    private fun pattern(skeleton: String) = DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, skeleton), locale).withZone(zone)
    private val date = pattern("dMMMy")
    private val dayMonth = pattern("dMMM")
    private val clock = pattern(if (is24Hour) "Hm" else "hm")
    private fun parse(value: String?) = value?.let { runCatching { Instant.parse(it) }.getOrNull() }
    /** "13 Nov 2026" (web api-keys `shortDate`). */
    fun date(value: String?): String? = parse(value)?.let(date::format)
    /** "13 Nov, 07:00". */
    fun dayTime(value: String?): String? = parse(value)?.let { "${dayMonth.format(it)}, ${clock.format(it)}" }
}
