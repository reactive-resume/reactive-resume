package me.rxresu.feature.applications

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.CalendarContract
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/** One event to hand to the device calendar or share as an .ics file. */
internal data class CalendarEvent(
    val uid: String,
    val title: String,
    val start: Instant,
    val minutes: Long,
    val location: String? = null,
    val description: String? = null,
)

private val IcsStamp: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC)

private fun icsText(value: String) = value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")

/** RFC 5545 calendar text (web ics.ts): one VEVENT, or a CANCEL for a deleted interview. */
internal fun icsFor(event: CalendarEvent, now: Instant, cancel: Boolean = false): String = buildString {
    append("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Reactive Resume//Applications//EN\r\n")
    append(if (cancel) "METHOD:CANCEL\r\n" else "METHOD:PUBLISH\r\n")
    append("BEGIN:VEVENT\r\n")
    append("UID:${event.uid}@rxresu.me\r\n")
    append("DTSTAMP:${IcsStamp.format(now)}\r\n")
    append("DTSTART:${IcsStamp.format(event.start)}\r\n")
    append("DTEND:${IcsStamp.format(event.start.plusSeconds(event.minutes * 60))}\r\n")
    append("SUMMARY:${icsText(event.title)}\r\n")
    event.location?.takeIf { it.isNotBlank() }?.let { append("LOCATION:${icsText(it)}\r\n") }
    event.description?.takeIf { it.isNotBlank() }?.let { append("DESCRIPTION:${icsText(it)}\r\n") }
    if (cancel) append("STATUS:CANCELLED\r\nSEQUENCE:1\r\n")
    append("END:VEVENT\r\nEND:VCALENDAR\r\n")
}

/**
 * Adds the event through the calendar app's insert screen (no permission needed). When no calendar app handles it,
 * shares an .ics instead, without asking again.
 */
internal fun addToCalendar(context: Context, event: CalendarEvent, now: Instant) {
    val insert = Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, event.start.toEpochMilli())
        .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, event.start.plusSeconds(event.minutes * 60).toEpochMilli())
        .putExtra(CalendarContract.Events.TITLE, event.title)
        .putExtra(CalendarContract.Events.EVENT_LOCATION, event.location.orEmpty())
        .putExtra(CalendarContract.Events.DESCRIPTION, event.description.orEmpty())
    try {
        context.startActivity(insert)
    } catch (_: ActivityNotFoundException) {
        shareIcs(context, event, now)
    }
}

/** Shares the event as calendar text ("Share .ics"; also "Download cancellation" after a delete). */
internal fun shareIcs(context: Context, event: CalendarEvent, now: Instant, cancel: Boolean = false) {
    val send = Intent(Intent.ACTION_SEND).setType("text/calendar").putExtra(Intent.EXTRA_TEXT, icsFor(event, now, cancel))
        .putExtra(Intent.EXTRA_SUBJECT, event.title)
    runCatching { context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}
