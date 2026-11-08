package me.rxresu.feature.applications

import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import me.rxresu.core.data.ApplicationQuery
import me.rxresu.core.data.ApplicationsRepository
import me.rxresu.core.data.CareerRepository
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.TimeSource
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.designsystem.RrAlertDialog
import me.rxresu.core.designsystem.RrAvatar
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrCheckbox
import me.rxresu.core.designsystem.RrDatePicker
import me.rxresu.core.designsystem.RrDialogConfirm
import me.rxresu.core.designsystem.RrFilterChip
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrIconButtonSize
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrPickerField
import me.rxresu.core.designsystem.RrSheetDetents
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTimePicker
import me.rxresu.core.designsystem.RrToastResult
import me.rxresu.core.designsystem.RrToastTone
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrBottomSheetState
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.network.generated.AddApplicationInterviewRequest
import me.rxresu.core.network.generated.AddApplicationInterviewRequestKind
import me.rxresu.core.network.generated.AddApplicationInterviewRequestParticipantsItem
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.Interview
import me.rxresu.core.network.generated.PatchApplicationInterviewRequest
import me.rxresu.core.strings.R as S

/** The form, kept whole on failure. */
@Immutable
internal data class InterviewDraft(
    val applicationId: String,
    val kind: AddApplicationInterviewRequestKind = AddApplicationInterviewRequestKind.Screening,
    val date: LocalDate? = null,
    val time: LocalTime? = null,
    val zone: ZoneId,
    val otherZone: Boolean = false,
    val zoneText: String = "",
    val minutes: String = "60",
    val location: String = "",
    val people: List<AddApplicationInterviewRequestParticipantsItem> = emptyList(),
    val notes: String = "",
) {
    /** The instant in the interview's timezone; null while incomplete or when the clock time doesn't exist there (DST gap). */
    fun at(): Instant? {
        val d = date ?: return null
        val t = time ?: return null
        val local = LocalDateTime.of(d, t)
        if (zone.rules.getValidOffsets(local).isEmpty()) return null
        return local.atZone(zone).toInstant()
    }

    fun timeMissingInZone(): Boolean = date != null && time != null && zone.rules.getValidOffsets(LocalDateTime.of(date, time)).isEmpty()

    companion object {
        fun from(app: Application?, interview: Interview?, home: ZoneId, applicationId: String): InterviewDraft {
            if (interview == null) return InterviewDraft(applicationId, zone = home)
            val zone = interview.timezone?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: home
            val at = Instant.parse(interview.at).atZone(zone)
            return InterviewDraft(
                applicationId = applicationId,
                kind = interview.kind,
                date = at.toLocalDate(),
                time = at.toLocalTime(),
                zone = zone,
                otherZone = zone != home,
                zoneText = zone.id,
                minutes = (interview.durationMinutes ?: 60).toString(),
                location = interview.location.orEmpty(),
                people = interview.participants.orEmpty(),
                notes = interview.notes.orEmpty(),
            )
        }
    }
}

internal data class InterviewState(
    val apps: List<Application> = emptyList(),
    val original: InterviewDraft? = null,
    val interview: Interview? = null,
    val saving: Boolean = false,
    val failed: Boolean = false,
)

/** What the sheet reports after a save, for its toast. */
internal data class InterviewSaved(val briefingAt: Instant?, val event: CalendarEvent?)

internal class InterviewViewModel(
    private val repo: ApplicationsRepository,
    private val career: CareerRepository,
    val time: TimeSource,
    private val applicationId: String,
    private val interviewId: String?,
) : ViewModel() {
    private val _state = MutableStateFlow(InterviewState())
    val state: StateFlow<InterviewState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            repo.observe(ApplicationQuery()).collect { res ->
                val apps = res.data ?: return@collect
                val app = apps.firstOrNull { it.id == applicationId }
                val interview = app?.activity?.filterIsInstance<Interview>()?.firstOrNull { it.id == interviewId }
                val first = _state.value.original == null
                _state.value = _state.value.copy(
                    apps = apps.filter { it.status != ApplicationStage.Closed },
                    interview = interview ?: _state.value.interview,
                    original = if (first) InterviewDraft.from(app, interview, time.timezone(), applicationId) else _state.value.original,
                )
            }
        }
    }

    suspend fun save(draft: InterviewDraft, title: String): InterviewSaved? {
        val at = draft.at() ?: return null
        _state.value = _state.value.copy(saving = true, failed = false)
        val minutes = draft.minutes.toLongOrNull()?.coerceIn(5, 24 * 60) ?: 60
        val people = draft.people.filter { it.name.isNotBlank() }
        val zone = draft.zone.id.takeIf { draft.otherZone || draft.zone != time.timezone() }
        return try {
            if (interviewId == null) repo.addApplicationInterview(
                draft.applicationId,
                AddApplicationInterviewRequest(at = at.toString(), kind = draft.kind, durationMinutes = minutes, location = draft.location.trim(), notes = draft.notes.trim(), participants = people, timezone = zone),
            ) else repo.updateApplicationInterview(
                draft.applicationId,
                interviewId,
                PatchApplicationInterviewRequest(at = at.toString(), kind = draft.kind, durationMinutes = minutes, location = draft.location.trim(), notes = draft.notes.trim(), participants = people, timezone = zone),
            )
            // The server moves this interview's briefing schedule with it; say where it went.
            val briefing = if (interviewId == null) null else runCatching {
                career.listCareerSchedules().firstOrNull { it.interviewId == interviewId && it.enabled && it.kind in setOf("prepare", "briefing") }?.nextRunAt?.let(Instant::parse)
            }.getOrNull()
            _state.value = _state.value.copy(saving = false)
            InterviewSaved(briefing, interviewId?.let { CalendarEvent(it, title, at, minutes, draft.location, draft.notes) })
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            _state.value = _state.value.copy(saving = false, failed = true)
            null
        }
    }

    suspend fun delete(): Boolean = try {
        repo.deleteApplicationTimelineEntry(applicationId, interviewId ?: return false); true
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        false
    }
}

@Composable
internal fun InterviewRoute(applicationId: String, interviewId: String?, nav: NavController) {
    val repos = LocalRepositories.current
    val vm = viewModel(key = "interview:$applicationId:$interviewId") { InterviewViewModel(repos.applications, repos.career, repos.time, applicationId, interviewId) }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = LocalToasts.current
    val haptics = rememberRrHaptics()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val sheet = rememberRrBottomSheetState()
    val dates = rememberDates(vm.time.timezone())
    val savedText = stringResource(S.string.interview_saved)
    val addToCalendar = stringResource(S.string.add_to_calendar)
    val deletedText = stringResource(S.string.interview_deleted)
    val cancellation = stringResource(S.string.download_cancellation)
    val deleteFailed = stringResource(S.string.couldn_t_delete_the_interview_try_again)
    val company = state.apps.firstOrNull { it.id == applicationId }?.company.orEmpty()
    // The sheet rises at once; the form fills in when the application has loaded.
    var loaded by remember { mutableStateOf<InterviewDraft?>(null) }
    LaunchedEffect(state.original) { if (loaded == null) loaded = state.original }
    val draft = loaded ?: InterviewDraft(applicationId, zone = vm.time.timezone())
    val title = stringResource(S.string.kind_interview, interviewKindLabel(draft.kind)) + " · " + company
    val briefingMoves = stringResource(R.string.app_interview_saved_briefing)

    InterviewSheet(
        state = state,
        draft = draft,
        onDraft = { loaded = it },
        editing = interviewId != null,
        dates = dates,
        home = vm.time.timezone(),
        today = vm.time.today(),
        sheetState = sheet,
        onDismiss = { nav.popBackStack() },
        onSave = {
            scope.launch {
                val saved = vm.save(draft, title) ?: return@launch haptics(RrHaptic.Error)
                haptics(RrHaptic.Success)
                sheet.hide()
                nav.popBackStack()
                val message = saved.briefingAt?.let { savedText + " · " + briefingMoves.format(dates.whenWithTime(it)) } ?: savedText
                toasts.post(message, saved.event?.let { addToCalendar }) {
                    if (it == RrToastResult.ActionPerformed) saved.event?.let { event -> addToCalendar(context, event, vm.time.now()) }
                }
            }
        },
        onDelete = {
            scope.launch {
                val event = state.interview?.let { CalendarEvent(it.id, title, Instant.parse(it.at), it.durationMinutes ?: 60, it.location, it.notes) }
                if (!vm.delete()) { toasts.show(deleteFailed, tone = RrToastTone.Danger); return@launch }
                haptics(RrHaptic.Warning)
                sheet.hide()
                nav.popBackStack()
                toasts.post(deletedText, event?.let { cancellation }) {
                    if (it == RrToastResult.ActionPerformed) event?.let { e -> shareIcs(context, e, vm.time.now(), cancel = true) }
                }
            }
        },
    )
}

private enum class Picker { Date, Time }

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun InterviewSheet(
    state: InterviewState,
    draft: InterviewDraft,
    onDraft: (InterviewDraft) -> Unit,
    editing: Boolean,
    dates: Dates,
    home: ZoneId,
    today: LocalDate,
    onDismiss: () -> Unit,
    onSave: () -> Unit,
    onDelete: () -> Unit,
    sheetState: me.rxresu.core.designsystem.RrBottomSheetState = rememberRrBottomSheetState(),
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    var picker by remember { mutableStateOf<Picker?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf<AddApplicationInterviewRequestParticipantsItem?>(null) }
    val gap = draft.timeMissingInZone()
    val canSave = draft.at() != null && draft.applicationId.isNotBlank() && !state.saving
    val zoneName = draft.zone.id.substringAfterLast('/').replace('_', ' ')

    Box(Modifier.fillMaxSize()) {
        RrBottomSheet(
            onDismissRequest = onDismiss,
            state = sheetState,
            title = stringResource(if (editing) S.string.edit_interview else S.string.schedule_an_interview),
            detents = RrSheetDetents.Full,
            confirmDiscard = state.original != null && draft != state.original,
            footer = {
                SheetFooter(start = {
                    if (editing) RrButton(stringResource(S.string.delete), { confirmDelete = true }, variant = RrButtonVariant.DangerGhost, size = RrButtonSize.Large)
                }) {
                    RrButton(stringResource(S.string.save_interview), onSave, size = RrButtonSize.Large, enabled = canSave, loading = state.saving)
                }
            },
        ) {
            Column(
                Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (state.failed) RrCallout(stringResource(if (editing) S.string.couldn_t_update_the_interview_try_again else R.string.app_couldnt_schedule), tone = RrTone.Danger)
                if (!editing && draft.applicationId.isBlank()) {
                    Field(stringResource(S.string.application)) {
                        RrListGroup {
                            state.apps.forEach { app ->
                                RrListRow("${app.company} · ${app.role}", selected = draft.applicationId == app.id, onClick = { onDraft(draft.copy(applicationId = app.id)) })
                            }
                        }
                    }
                }
                Field(stringResource(S.string.type)) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        InterviewKinds.forEach { kind ->
                            RrFilterChip(interviewKindLabel(kind), draft.kind == kind, { onDraft(draft.copy(kind = kind)) })
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RrPickerField(
                        value = draft.date?.let(dates::fullDate).orEmpty(),
                        onClick = { picker = Picker.Date },
                        modifier = Modifier.weight(2f),
                        label = stringResource(S.string.date),
                        placeholder = stringResource(S.string.choose_a_date),
                        trailingIcon = D.drawable.ic_ph_calendar_blank,
                    )
                    RrPickerField(
                        value = draft.time?.let { dates.time(LocalDateTime.of(today, it).atZone(dates.zone).toInstant()) }.orEmpty(),
                        onClick = { picker = Picker.Time },
                        modifier = Modifier.weight(1f),
                        label = stringResource(S.string.time_0, zoneName),
                        placeholder = stringResource(S.string.time),
                        trailingIcon = null,
                        error = if (gap) " " else null,
                    )
                }
                if (gap) RrText(stringResource(S.string.this_time_does_not_exist_in_the_selected_timezone_choose_another_time), style = RrType.small, color = c.dangerText)
                // The whole row toggles, so the box lines up with the fields above instead of sitting in a 44 dp target.
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 44.dp).toggleable(draft.otherZone, role = Role.Checkbox) { on ->
                        haptics(if (on) RrHaptic.ToggleOn else RrHaptic.ToggleOff)
                        onDraft(draft.copy(otherZone = on, zone = if (on) draft.zone else home, zoneText = if (on) draft.zone.id else ""))
                    },
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                ) {
                    RrCheckbox(draft.otherZone, null)
                    RrText(stringResource(S.string.interview_is_in_another_timezone), style = RrType.ui)
                }
                if (draft.otherZone) {
                    val valid = runCatching { ZoneId.of(draft.zoneText.trim()) }.getOrNull()
                    RrTextField(
                        draft.zoneText,
                        { text -> onDraft(draft.copy(zoneText = text, zone = runCatching { ZoneId.of(text.trim()) }.getOrNull() ?: draft.zone)) },
                        label = stringResource(S.string.interview_timezone),
                        placeholder = "Europe/London",
                        ltr = true,
                        mono = true,
                        error = if (draft.zoneText.isNotBlank() && valid == null) stringResource(S.string.interview_timezone) else null,
                        helper = draft.at()?.let { at -> stringResource(S.string.shown_in_your_timezone) + " " + Dates(dates.locale, home, true).whenWithTime(at) },
                    )
                }
                RrTextField(
                    draft.minutes,
                    { onDraft(draft.copy(minutes = it.filter(Char::isDigit).take(4))) },
                    label = stringResource(S.string.length_minutes),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                RrTextField(
                    draft.location,
                    { onDraft(draft.copy(location = it)) },
                    label = stringResource(S.string.location),
                    leadingIcon = D.drawable.ic_ph_map_pin,
                    helper = stringResource(S.string.video_link_office_address_or_phone_number),
                )
                Field(stringResource(S.string.who_you_ll_meet)) {
                    if (draft.people.isNotEmpty()) RrListGroup {
                        draft.people.forEachIndexed { index, person ->
                            RrListRow(
                                person.name,
                                subtitle = person.role?.takeIf(String::isNotBlank),
                                leading = { RrAvatar(initials(person.name)) },
                                trailing = { RrIconButton(D.drawable.ic_ph_minus, stringResource(S.string.remove_person_0, (index + 1).toString()), { onDraft(draft.copy(people = draft.people.filterIndexed { i, _ -> i != index })) }, size = RrIconButtonSize.Small) },
                            )
                        }
                    }
                    val person = adding
                    if (person != null) {
                        val url = person.profileUrl.orEmpty()
                        val badUrl = url.isNotBlank() && !url.startsWith("https://")
                        RrTextField(person.name, { adding = person.copy(name = it) }, placeholder = stringResource(S.string.name))
                        RrTextField(person.role.orEmpty(), { adding = person.copy(role = it) }, placeholder = stringResource(S.string.role))
                        RrTextField(url, { adding = person.copy(profileUrl = it.ifBlank { null }) }, placeholder = stringResource(S.string.profile_link_optional), ltr = true, mono = true, error = if (badUrl) stringResource(S.string.profile_links_must_be_public_https_addresses) else null)
                        RrButton(stringResource(S.string.add), {
                            onDraft(draft.copy(people = draft.people + person.copy(name = person.name.trim(), role = person.role?.trim()?.ifEmpty { null })))
                            adding = null
                        }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small, enabled = person.name.isNotBlank() && !badUrl)
                    } else {
                        RrButton(stringResource(S.string.add_a_person), { adding = AddApplicationInterviewRequestParticipantsItem(name = "") }, variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Small, icon = D.drawable.ic_ph_plus)
                    }
                    if (adding != null || draft.people.any { it.profileUrl != null }) RrText(stringResource(R.string.app_profile_links_hint), style = RrType.small, color = c.ink3)
                }
                RrTextField(draft.notes, { onDraft(draft.copy(notes = it)) }, label = stringResource(S.string.what_they_asked_you_to_prepare), singleLine = false, minLines = 2)
            }
        }

        when (picker) {
            Picker.Date -> RrBottomSheet(onDismissRequest = { picker = null }, title = stringResource(S.string.choose_a_date), fitContent = true) {
                Box(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
                    RrDatePicker(draft.date, { haptics(RrHaptic.Selection); onDraft(draft.copy(date = it)); picker = null }, today = today)
                }
            }
            Picker.Time -> RrBottomSheet(onDismissRequest = { picker = null }, title = stringResource(S.string.choose_a_time)) {
                Box(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
                    RrTimePicker(draft.time, { haptics(RrHaptic.Selection); onDraft(draft.copy(time = it)); picker = null }, stepMinutes = 5)
                }
            }
            null -> Unit
        }
        if (confirmDelete) {
            val kind = interviewKindLabel(draft.kind)
            RrAlertDialog(
                title = stringResource(S.string.delete_the_0_interview_on_1, kind, draft.date?.let { dates.dayMonth(it.atStartOfDay(dates.zone).toInstant()) }.orEmpty()),
                text = stringResource(S.string.it_s_removed_from_this_application_download_a_cancellation_afterward_to_update_your_calendar),
                confirmLabel = stringResource(S.string.delete_interview),
                confirm = RrDialogConfirm.HoldToDelete,
                onConfirm = { confirmDelete = false; onDelete() },
                onDismissRequest = { confirmDelete = false },
            )
        }
    }
}

internal val InterviewKinds = listOf(
    AddApplicationInterviewRequestKind.Screening,
    AddApplicationInterviewRequestKind.Technical,
    AddApplicationInterviewRequestKind.Behavioral,
    AddApplicationInterviewRequestKind.Onsite,
    AddApplicationInterviewRequestKind.Other,
)

/** A field label above its control (6 dp). */
@Composable
internal fun Field(label: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        RrText(label, style = RrType.fieldLabel, color = RrTheme.colors.ink2)
        content()
    }
}
