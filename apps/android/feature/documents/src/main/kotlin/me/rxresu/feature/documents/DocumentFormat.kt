package me.rxresu.feature.documents

import android.text.format.DateUtils
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.network.generated.DocumentType

internal fun parseInstant(value: String?): Instant? = value?.let { runCatching { Instant.parse(it) }.getOrNull() }

/** "12 min ago" today, "Yesterday", "2 days ago", then "3 Oct" (web formatRelativeTime, short), in the device locale. */
internal fun relativeTime(value: String, now: Instant, zone: ZoneId = ZoneId.systemDefault()): String {
    val at = parseInstant(value) ?: return value
    val days = ChronoUnit.DAYS.between(at.atZone(zone).toLocalDate(), now.atZone(zone).toLocalDate())
    return DateUtils.getRelativeTimeSpanString(
        at.toEpochMilli(),
        now.toEpochMilli(),
        if (days == 0L) DateUtils.MINUTE_IN_MILLIS else DateUtils.DAY_IN_MILLIS,
        DateUtils.FORMAT_ABBREV_RELATIVE or DateUtils.FORMAT_ABBREV_MONTH,
    ).toString()
}

internal val DocumentSummary.isLetter get() = type == DocumentType.Letter

/** Documents stay in Trash for 30 days (web trash-page.tsx). Days left, at least 0. */
internal fun daysLeft(trashedAt: String?, now: Instant): Int {
    val at = parseInstant(trashedAt) ?: return 30
    val left = 30 - java.time.Duration.between(at, now).toDays()
    return left.toInt().coerceAtLeast(0)
}
