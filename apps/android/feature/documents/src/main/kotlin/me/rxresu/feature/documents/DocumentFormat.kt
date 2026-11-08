package me.rxresu.feature.documents

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
    return when {
        days == 0L -> {
            val hours = java.time.Duration.between(at, now).toHours()
            if (hours > 0) "$hours h ago" else "${java.time.Duration.between(at, now).toMinutes().coerceAtLeast(0)} min ago"
        }
        days == 1L -> "yesterday"
        else -> java.time.format.DateTimeFormatter.ofPattern("d MMM", java.util.Locale.getDefault()).format(at.atZone(zone))
    }
}

internal val DocumentSummary.isLetter get() = type == DocumentType.Letter

/** Documents stay in Trash for 30 days (web trash-page.tsx). Days left, at least 0. */
internal fun daysLeft(trashedAt: String?, now: Instant): Int {
    val at = parseInstant(trashedAt) ?: return 30
    val left = 30 - java.time.Duration.between(at, now).toDays()
    return left.toInt().coerceAtLeast(0)
}
