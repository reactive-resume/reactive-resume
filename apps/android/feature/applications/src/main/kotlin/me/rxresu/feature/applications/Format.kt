package me.rxresu.feature.applications

import android.content.res.Resources
import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import me.rxresu.core.data.ApplicationNextStep
import me.rxresu.core.data.NextStepKind
import me.rxresu.core.network.generated.AddApplicationInterviewRequestKind
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.strings.CatalogPlurals
import me.rxresu.core.strings.R as S

/** Locale-aware formatters from CLDR skeletons ("EEEdMMM" → "Tue 10 Nov" in en-GB, "Tue, Nov 10" in en-US). */
internal class Dates(val locale: Locale, val zone: ZoneId, private val is24: Boolean) {
    private fun f(skeleton: String) = DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, skeleton), locale).withZone(zone)
    private val time = f(if (is24) "Hm" else "hm")
    private val dayMonth = f("dMMM")
    private val weekdayDayMonth = f("EEEdMMM")
    private val weekday = f("EEE")
    private val weekdayLong = f("EEEEdMMMM")
    private val monthYear = f("MMMMy")
    private val fullDate = f("EEEdMMMy")

    fun time(at: Instant): String = time.format(at)
    fun dayMonth(at: Instant): String = dayMonth.format(at)
    fun weekdayDayMonth(at: Instant): String = weekdayDayMonth.format(at)
    fun weekday(at: Instant): String = weekday.format(at)
    fun weekday(date: LocalDate): String = weekday.format(date.atStartOfDay(zone))
    fun weekdayLong(date: LocalDate): String = weekdayLong.format(date.atStartOfDay(zone))
    fun monthYear(date: LocalDate): String = monthYear.format(date.atStartOfDay(zone))
    fun fullDate(date: LocalDate): String = fullDate.format(date.atStartOfDay(zone))
    /** "Tue 10 Nov, 10:00". */
    fun whenWithTime(at: Instant): String = "${weekdayDayMonth(at)}, ${time(at)}"
    fun date(at: Instant): LocalDate = at.atZone(zone).toLocalDate()
}

@Composable
internal fun rememberDates(zone: ZoneId): Dates {
    val locale = LocalConfiguration.current.locales[0]
    val is24 = DateFormat.is24HourFormat(LocalContext.current)
    return androidx.compose.runtime.remember(locale, zone, is24) { Dates(locale, zone, is24) }
}

@Composable
@ReadOnlyComposable
internal fun plural(id: Int, count: Int, vararg args: Any): String =
    CatalogPlurals.get(LocalContext.current.resources, id, count, *args)

internal fun plural(resources: Resources, id: Int, count: Int, vararg args: Any): String = CatalogPlurals.get(resources, id, count, *args)

@Composable
internal fun interviewKindLabel(kind: AddApplicationInterviewRequestKind): String = stringResource(
    when (kind) {
        AddApplicationInterviewRequestKind.Screening -> S.string.screening
        AddApplicationInterviewRequestKind.Technical -> S.string.technical
        AddApplicationInterviewRequestKind.Behavioral -> S.string.behavioral
        AddApplicationInterviewRequestKind.Onsite -> S.string.onsite
        AddApplicationInterviewRequestKind.Other, AddApplicationInterviewRequestKind.Unknown -> S.string.other
    },
)

internal enum class StepTone { Normal, Warn, Muted }
internal data class NextStepText(val title: String, val sub: String, val tone: StepTone)

/** How a next step reads in the detail card (web describeNextStep). */
@Composable
internal fun describeNextStep(step: ApplicationNextStep, app: Application, dates: Dates): NextStepText = when (step.kind) {
    NextStepKind.Interview -> {
        val interview = step.interview
        val kind = interview?.let { interviewKindLabel(it.kind) } ?: stringResource(S.string.interview)
        val where = interview?.location?.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty()
        NextStepText(stringResource(S.string.kind_interview, kind), step.at?.let(dates::whenWithTime).orEmpty() + where, StepTone.Normal)
    }
    NextStepKind.Offer -> when {
        step.at != null -> NextStepText(stringResource(S.string.reply_to_the_offer), stringResource(S.string.by_0, dates.whenWithTime(step.at!!)), if (step.overdue) StepTone.Warn else StepTone.Normal)
        step.terms -> NextStepText(stringResource(S.string.decide_on_the_offer), stringResource(S.string.compare_it_with_your_other_offers), StepTone.Normal)
        else -> NextStepText(stringResource(S.string.add_the_offer_s_terms), stringResource(S.string.pay_deadline_and_conditions_so_you_can_compare_and_decide), StepTone.Normal)
    }
    NextStepKind.FollowUp -> NextStepText(step.note.ifBlank { stringResource(S.string.follow_up) }, step.at?.let(dates::weekdayDayMonth).orEmpty(), if (step.overdue) StepTone.Warn else StepTone.Normal)
    NextStepKind.NoReply -> NextStepText(
        if (step.afterInterview) plural(S.plurals.message_0_plural_one_no_word_since_your_interview_day_ago_other_no_word_since_your_interview_days_ago, (step.days ?: 0).toInt(), (step.days ?: 0).toString())
        else plural(S.plurals.message_0_plural_one_no_reply_in_day_other_no_reply_in_days, (step.days ?: 0).toInt(), (step.days ?: 0).toString()),
        stringResource(S.string.a_short_follow_up_is_usually_fine_now),
        StepTone.Warn,
    )
    NextStepKind.Waiting -> if (app.status == ApplicationStage.Applied) {
        NextStepText(
            when (val d = step.days) {
                null -> stringResource(S.string.waiting_to_hear_back)
                0L -> stringResource(S.string.applied_today)
                else -> plural(S.plurals.message_0_plural_one_applied_day_ago_other_applied_days_ago, d.toInt(), d.toString())
            },
            "",
            StepTone.Normal,
        )
    } else NextStepText(stringResource(S.string.waiting_to_hear_back), sinceText(step.days), StepTone.Normal)
    NextStepKind.InterviewFeedback -> NextStepText(stringResource(S.string.waiting_for_interview_feedback), sinceText(step.days), StepTone.Normal)
    NextStepKind.NoInterview -> NextStepText(stringResource(S.string.no_interview_scheduled), stringResource(S.string.add_the_date_when_you_have_it), StepTone.Normal)
    NextStepKind.NotApplied -> NextStepText(stringResource(S.string.not_applied_yet), "", StepTone.Muted)
    NextStepKind.Closed -> NextStepText(app.closedReason?.let { closedReasonLabel(it) } ?: stringResource(S.string.closed), "", StepTone.Muted)
}

@Composable
private fun sinceText(days: Long?): String = when (days) {
    null -> ""
    0L -> stringResource(S.string.since_today)
    else -> plural(S.plurals.message_0_plural_one_for_day_other_for_days, days.toInt(), days.toString())
}

/** True when a next step needs the person now (packages/schema needsAttention). */
internal fun needsAttention(step: ApplicationNextStep, now: Instant): Boolean = when (step.kind) {
    NextStepKind.Interview -> step.at?.let { it.toEpochMilli() - now.toEpochMilli() <= 7 * DAY_MS } == true
    NextStepKind.FollowUp -> step.at?.let { it.toEpochMilli() - now.toEpochMilli() <= DAY_MS } == true
    NextStepKind.NoReply, NextStepKind.Offer -> true
    else -> false
}

internal const val DAY_MS = 86_400_000L

/** "lumen.jobs" from a posting URL. */
internal fun hostOf(url: String?): String? = url?.let { runCatching { java.net.URI(it.trim()).host?.removePrefix("www.") }.getOrNull() }
