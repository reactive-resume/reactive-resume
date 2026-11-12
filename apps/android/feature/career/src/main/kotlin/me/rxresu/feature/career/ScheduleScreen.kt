package me.rxresu.feature.career

import androidx.compose.ui.res.stringResource
import me.rxresu.core.strings.R as CoreStrings


import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.ui.Alignment
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.Locale
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as Icons
import me.rxresu.core.network.generated.*

@Composable internal fun ScheduleScreen(state: ScheduleState, today: LocalDate, zone: ZoneId, close: () -> Unit, retry: () -> Unit, save: (SaveCareerScheduleRequest) -> Unit, delete: () -> Unit) {
    val interfaceLocale = androidx.compose.ui.platform.LocalConfiguration.current.locales[0]
    val format = rememberCareerTime()
    val existing = state.existing
    var kind by remember(existing) { mutableStateOf(SaveCareerScheduleRequestKind.entries.firstOrNull { it.wireValue == existing?.kind } ?: SaveCareerScheduleRequestKind.Discovery) }
    var query by remember(state.profile, existing) { mutableStateOf(existing?.query ?: (state.profile?.targetRoles.orEmpty() + state.profile?.locations.orEmpty()).joinToString(", ")) }
    var interval by remember(existing) { mutableIntStateOf(existing?.intervalDays?.toInt() ?: 1) }
    val existingTime = existing?.nextRunAt?.let { runCatching { Instant.parse(it).atZone(zone) }.getOrNull() }
    var date by remember(existing) { mutableStateOf(existingTime?.toLocalDate() ?: today.plusDays(1)) }
    var time by remember(existing) { mutableStateOf(existingTime?.toLocalTime() ?: LocalTime.of(7, 0)) }
    var provider by remember(existing) { mutableStateOf(existing?.aiProviderId ?: state.providers.firstOrNull()?.id) }
    var application by remember(existing) { mutableStateOf(existing?.applicationId) }
    var interview by remember(existing) { mutableStateOf(existing?.interviewId) }
    var lead by remember(existing) { mutableStateOf(SaveCareerScheduleRequestLead.entries.firstOrNull { it.wireValue == existing?.lead } ?: SaveCareerScheduleRequestLead.Value24h) }
    var enabled by remember(existing) { mutableStateOf(existing?.enabled ?: true) }
    var email by remember(existing) { mutableStateOf(existing?.email ?: false) }
    var dirty by remember { mutableStateOf(false) }; var timePicker by remember { mutableStateOf(false) }
    var review by remember { mutableStateOf<SaveCareerScheduleRequest?>(null) }
    var details by remember(existing) { mutableStateOf(existing != null && existing.kind != "discovery") }; var pause by remember { mutableStateOf(false) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val chosen = state.providers.firstOrNull { it.id == provider }
    val needsAi = kind == SaveCareerScheduleRequestKind.Prepare
    val instant = zonedScheduleInstant(date, time, zone)
    val valid = (kind != SaveCareerScheduleRequestKind.Discovery || !enabled || state.web?.search == true) && instant != null && (!enabled || !needsAi || chosen != null) &&
        (kind == SaveCareerScheduleRequestKind.Discovery && query.isNotBlank() || kind == SaveCareerScheduleRequestKind.FollowUp && application != null || kind == SaveCareerScheduleRequestKind.Prepare && interview != null)
    RrBottomSheet(close, title = if (kind == SaveCareerScheduleRequestKind.Discovery) stringResource(R.string.career_discovery) else scheduleTitle(kind.wireValue), fixedHeight = 520.dp, closeIconSize = 24.dp, confirmDiscard = dirty, footer = { RrFooterBar(inSheet = true, applyBottomInset = false) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (existing != null) RrButton(stringResource(R.string.career_delete_f6fdbe), delete, variant = RrButtonVariant.DangerGhost, size = RrButtonSize.Large)
            RrButton(stringResource(R.string.career_save_efc007), {
                val request = SaveCareerScheduleRequest(aiProviderId = if (needsAi) provider else null, applicationId = if (kind == SaveCareerScheduleRequestKind.Discovery) null else application,
                    email = email && state.emailVerified, enabled = enabled, id = existing?.id, intervalDays = if (kind == SaveCareerScheduleRequestKind.Discovery) interval.toLong() else null,
                    interviewId = if (kind == SaveCareerScheduleRequestKind.Prepare) interview else null, kind = kind, lead = if (kind == SaveCareerScheduleRequestKind.Prepare) lead else null,
                    locale = interfaceLocale.toLanguageTag(), nextRunAt = requireNotNull(instant), query = query, timezone = zone.id)
                if (kind == SaveCareerScheduleRequestKind.Discovery && enabled) review = request else save(request)
            }, Modifier.weight(1f), size = RrButtonSize.Large, enabled = valid && state.available && !state.busy, loading = state.busy)
        }
    } }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(0.dp)) {
            if (state.loading) CareerLoading() else if (!state.available) RrCallout(stringResource(R.string.career_scheduled_work_is_not_available_on_this_server_ask_your_serv_89dc73), tone = RrTone.Warn) else {
                if (state.error) CareerError(retry)
                RrText(stringResource(when (kind) { SaveCareerScheduleRequestKind.Discovery -> R.string.career_discovery_intro; SaveCareerScheduleRequestKind.Prepare -> R.string.career_prepare_a_briefing_a8598c; else -> R.string.career_follow_up_note_d7c0fd }), Modifier.padding(horizontal = 24.dp), style = RrType.body, color = RrTheme.colors.ink3)
                if (kind == SaveCareerScheduleRequestKind.Discovery) RrSegmentedControl(listOf(RrSegment(stringResource(R.string.career_daily)), RrSegment(stringResource(R.string.career_every_3_days_8c5bdf)), RrSegment(stringResource(R.string.career_weekly))), listOf(1, 3, 7).indexOf(interval).coerceAtLeast(0), { interval = listOf(1, 3, 7)[it]; dirty = true }, Modifier.padding(start = 24.dp, end = 24.dp, top = 20.dp))
                Spacer(Modifier.height(12.dp))
                RrListGroup {
                    RrListRow(stringResource(R.string.career_time_6c82e6), onClick = { timePicker = true }, divider = true, trailing = { RrRowValue(format.time(time), caret = false); Spacer(Modifier.width(4.dp)); RrRowCaret() })
                    RrSwitchRow(stringResource(R.string.career_turn_this_schedule_on_503930), enabled, { enabled = it; dirty = true }, divider = true)
                    RrListRow(stringResource(R.string.career_pause), onClick = { pause = true }, trailing = { RrRowValue(if (enabled) stringResource(R.string.career_not_paused) else stringResource(CoreStrings.string.paused), caret = false); Spacer(Modifier.width(4.dp)); RrRowCaret() })
                }
                RrButton(stringResource(R.string.career_schedule_details), { details = !details }, Modifier.padding(horizontal = 24.dp), variant = RrButtonVariant.Ghost)
                if (details) Column(Modifier.padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    val modes = listOf(SaveCareerScheduleRequestKind.Discovery, SaveCareerScheduleRequestKind.Prepare, SaveCareerScheduleRequestKind.FollowUp)
                    RrSegmentedControl(listOf(RrSegment(stringResource(R.string.career_find_roles_48a2e1)), RrSegment(stringResource(R.string.career_interview_prep_8a58c6)), RrSegment(stringResource(R.string.career_remind_me_25df3f))), modes.indexOf(kind), { kind = modes[it]; dirty = true })
                // Fields crossfade (d2) while everything below follows the new height with ease-drawer.
                Crossfade(kind, Modifier.animateContentSize(tween(if (RrTheme.reducedMotion) 0 else RrMotion.D3, easing = RrMotion.easeDrawer)), animationSpec = tween(if (RrTheme.reducedMotion) 0 else RrMotion.D2), label = "schedule-mode") { mode ->
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        when (mode) {
                            SaveCareerScheduleRequestKind.Discovery -> {
                                // One query string on the wire; terms read as chips like the storyboard.
                                ChipList(stringResource(R.string.career_look_for_394162), queryTerms(query), stringResource(CoreStrings.string.add), { query = it.joinToString(", "); dirty = true }, helper = stringResource(R.string.career_roles_places_and_companies_starts_from_your_preferences_1c6aa4))
                            }
                            SaveCareerScheduleRequestKind.Prepare -> {
                                val interviews = state.applications.flatMap { app -> app.activity.filterIsInstance<Interview>().map { app to it } }
                                ChoicePicker(interviews.firstOrNull { it.second.id == interview }?.let { it.first.company + " · " + format.dayTime(it.second.at) } ?: stringResource(R.string.career_choose_interview_56ae59), stringResource(R.string.career_interview_19ad8e), interviews.map { it.second.id to (it.first.company + " · " + format.dayTime(it.second.at)) }, { id -> interview = id; application = interviews.first { it.second.id == id }.first.id; dirty = true })
                                ChoicePicker(when (lead) { SaveCareerScheduleRequestLead.Value2h -> stringResource(R.string.career_2_hours_before_3f722f); SaveCareerScheduleRequestLead.Morning -> stringResource(R.string.career_morning_of_af4500); else -> stringResource(R.string.career_24_hours_before_d90471) }, stringResource(R.string.career_prepare_a_briefing_a8598c), listOf("24h" to stringResource(R.string.career_24_hours_before_d90471), "2h" to stringResource(R.string.career_2_hours_before_3f722f), "morning" to stringResource(R.string.career_morning_of_af4500)), { value -> lead = SaveCareerScheduleRequestLead.entries.first { it.wireValue == value }; dirty = true })
                            }
                            else -> {
                                ChoicePicker(state.applications.firstOrNull { it.id == application }?.company ?: stringResource(R.string.career_choose_application_76fe06), stringResource(R.string.career_application_b291be), state.applications.map { it.id to (it.company + " · " + it.role) }, { application = it; dirty = true })
                                RrTextField(query, { query = it; dirty = true }, label = stringResource(R.string.career_follow_up_note_d7c0fd), singleLine = false, minLines = 2)
                            }
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.weight(1f)) { DateEntry(if (kind == SaveCareerScheduleRequestKind.FollowUp) stringResource(R.string.career_remind_me_on_e99267) else stringResource(R.string.career_first_run_23ea05), date.toString(), { date = LocalDate.parse(it); dirty = true }) }
                    RrPickerField(format.time(time), { timePicker = true }, Modifier.weight(1f), label = stringResource(R.string.career_time_1_s_549524, zone.id.substringAfter('/').replace('_', ' ')))
                }
                if (instant == null) RrCallout(stringResource(R.string.career_choose_another_time_this_time_changes_with_daylight_saving_0c004a), tone = RrTone.Warn)
                if (needsAi) {
                    ChoicePicker(chosen?.label ?: stringResource(R.string.career_choose_a_connection_428239), stringResource(R.string.career_ai_connection_6497f8), state.providers.map { it.id to it.label }, { provider = it; dirty = true })
                    if (enabled && chosen == null) RrText(stringResource(R.string.career_its_connection_is_unavailable_choose_and_approve_a_connectio_47e677), style = RrType.small, color = RrTheme.colors.warnText)
                }
                RrListGroup {
                    RrText(stringResource(R.string.career_paused_schedules_keep_their_settings_292e9a), style = RrType.small, color = RrTheme.colors.ink3)
                    RrSwitchRow(stringResource(R.string.career_also_email_1_s_d635f4, state.email), email, { email = it; dirty = true }, enabled = state.emailVerified, subtitle = if (state.emailVerified) stringResource(R.string.career_you_ll_always_see_it_in_today_985781) else stringResource(R.string.career_verify_your_email_in_settings_first_03abb7))
                }
                if (kind == SaveCareerScheduleRequestKind.Discovery) {
                    RrCallout(stringResource(R.string.career_only_the_search_query_and_search_countries_go_to_your_server_c6f9a8), Modifier.padding(horizontal = 24.dp, vertical = 12.dp), tone = RrTone.Warn, icon = Icons.drawable.ic_ph_key)
                }
                if (needsAi) RrCallout(stringResource(R.string.career_each_run_sends_your_preferences_to_1_s_with_your_key_and_you_0c84a2, chosen?.label ?: stringResource(R.string.career_the_connection_you_choose_462a19)), tone = RrTone.Warn, icon = Icons.drawable.ic_ph_key)
                }
                if (kind == SaveCareerScheduleRequestKind.Discovery && enabled && state.web?.search != true) RrText(stringResource(R.string.career_set_up_web_search_in_settings_before_enabling_discovery_ai_i_5961d8), Modifier.padding(horizontal = 24.dp), style = RrType.small, color = RrTheme.colors.warnText)
            }
        }
    }
    review?.let { request ->
        RrAlertDialog(
            title = stringResource(R.string.career_discovery),
            text = stringResource(R.string.career_only_the_search_query_and_search_countries_go_to_your_server_c6f9a8),
            confirmLabel = stringResource(R.string.career_save_efc007),
            onConfirm = { review = null; save(request) },
            onDismissRequest = { review = null },
            confirm = RrDialogConfirm.Primary,
        )
    }
    if (timePicker) DisposableEffect(Unit) {
        val picker = android.app.TimePickerDialog(context, { _, hour, minute -> time = LocalTime.of(hour, minute); dirty = true; timePicker = false }, time.hour, time.minute, android.text.format.DateFormat.is24HourFormat(context))
        picker.setOnDismissListener { timePicker = false }; picker.show()
        onDispose { picker.dismiss() }
    }
    if (pause) RrBottomSheet({ pause = false }, title = stringResource(R.string.career_pause), fitContent = true) {
        if (kind == SaveCareerScheduleRequestKind.Discovery) listOf(7L, 14L).forEach { days ->
            RrListRow(stringResource(if (days == 7L) R.string.career_one_week else R.string.career_two_weeks), onClick = { date = today.plusDays(days); enabled = true; dirty = true; pause = false })
        }
        RrListRow(stringResource(R.string.career_until_on), onClick = { enabled = false; dirty = true; pause = false })
        if (!enabled) RrListRow(stringResource(R.string.career_resume_schedule), onClick = { enabled = true; dirty = true; pause = false })
    }
}

@Composable internal fun scheduleTitle(kind: String): String = stringResource(when (kind) {
    "discovery" -> R.string.career_find_roles_48a2e1
    "follow-up" -> R.string.career_remind_me_25df3f
    else -> R.string.career_interview_prep_8a58c6
})
@Composable private fun leadLabel(lead: String?): String = stringResource(when (lead) {
    "2h" -> R.string.career_2_hours_before_3f722f
    "morning" -> R.string.career_morning_of_af4500
    else -> R.string.career_24_hours_before_d90471
})

/** The web's schedule status line (career/today.tsx): "Daily at 07:00 · next Mon 9 Nov", "Paused · …", a one-off's outcome. */
@Composable internal fun scheduleStatus(row: CareerSchedule, time: CareerTime): String {
    val day = time.day(row.nextRunAt).orEmpty()
    if (row.intervalDays == null && row.lastQueuedAt != null) return when (row.lastRun?.status) {
        ListCareerSchedulesResponseItemLastRunStatus.Failed -> stringResource(R.string.career_run_failed_on, day)
        ListCareerSchedulesResponseItemLastRunStatus.Queued, ListCareerSchedulesResponseItemLastRunStatus.Running -> stringResource(R.string.career_running_on, day)
        else -> if (row.kind == "discovery" || row.kind == "follow-up") stringResource(R.string.career_done_on, day) else stringResource(R.string.career_ran_on, day)
    }
    if (row.lastRun?.status == ListCareerSchedulesResponseItemLastRunStatus.Failed) return stringResource(R.string.career_last_run_failed)
    val line = when (row.kind) {
        "discovery" -> {
            val clock = time.time(row.nextRunAt).orEmpty()
            when (val days = row.intervalDays ?: 1L) {
                1L -> stringResource(R.string.career_daily_at, clock, day)
                7L -> stringResource(R.string.career_weekly_at, clock, day)
                else -> stringResource(R.string.career_every_days_at, days.toString(), clock, day)
            }
        }
        "follow-up" -> time.dayTime(row.nextRunAt).orEmpty()
        else -> leadLabel(row.lead) + " · " + time.dayTime(row.nextRunAt).orEmpty()
    }
    return if (row.enabled) line else stringResource(R.string.career_paused_line, line)
}

@Composable internal fun discoverySummary(row: CareerSchedule, time: CareerTime): String {
    val at = time.at(row.nextRunAt)
    return if (row.enabled && row.intervalDays == 1L && at != null && at.hour in 5..11 && row.lastRun?.status != ListCareerSchedulesResponseItemLastRunStatus.Failed) stringResource(R.string.career_every_morning, time.time(row.nextRunAt).orEmpty()) else scheduleStatus(row, time)
}

@Composable internal fun discoveryRootSummary(row: CareerSchedule, time: CareerTime): String {
    val at = time.at(row.nextRunAt)
    return if (row.enabled && row.intervalDays == 1L && at != null && at.hour in 5..11 && row.lastRun?.status != ListCareerSchedulesResponseItemLastRunStatus.Failed)
        stringResource(R.string.career_finds_roles_every_morning, time.time(row.nextRunAt).orEmpty())
    else scheduleStatus(row, time)
}

/** "Senior product designer, Lisbon" → its terms, for chips. */
internal fun queryTerms(query: String): List<String> = query.split(',').map { it.trim() }.filter { it.isNotEmpty() }.distinct()
