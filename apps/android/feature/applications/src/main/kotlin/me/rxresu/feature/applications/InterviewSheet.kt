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
import me.rxresu.core.data.PreferencesRepository
import me.rxresu.core.data.NotificationCategory
import me.rxresu.core.auth.SessionState
import me.rxresu.core.network.RequestOptions
import me.rxresu.feature.system.InterviewReminderResult
import me.rxresu.feature.system.interviewReminderDevice
import me.rxresu.feature.system.updateInterviewReminder
import me.rxresu.feature.system.withInterviewReminderChange
import me.rxresu.feature.system.rememberNotificationPermissionRequest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.designsystem.RrAlertDialog
import me.rxresu.core.designsystem.RrAvatar
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrFooterBar
import me.rxresu.core.designsystem.RrSwitchRow
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
    val addToCalendar: Boolean = false,
    val remind: Boolean = false,
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
    val uncertain: Boolean = false,
)

/** What the sheet reports after a save, for its toast. */
internal data class InterviewSaved(val briefingAt: Instant?, val event: CalendarEvent?, val application: Application, val interview: Interview)

internal class InterviewViewModel(
    private val repo: ApplicationsRepository,
    private val career: CareerRepository,
    val time: TimeSource,
    private val applicationId: String,
    private val interviewId: String?,
    private val preferences: PreferencesRepository,
    private val identity: () -> Pair<String, String>?,
    private val device: String,
) : ViewModel() {
    private val _state = MutableStateFlow(InterviewState())
    val state: StateFlow<InterviewState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            combine(repo.observe(ApplicationQuery()), preferences.values) { res, prefs -> res to prefs }.collect { (res, prefs) ->
                val apps = res.data ?: return@collect
                val app = apps.firstOrNull { it.id == applicationId }
                val interview = app?.activity?.filterIsInstance<Interview>()?.firstOrNull { it.id == interviewId }
                val first = _state.value.original == null
                _state.value = _state.value.copy(
                    apps = apps.filter { it.status != ApplicationStage.Closed },
                    interview = interview ?: _state.value.interview,
                    original = if (first) InterviewDraft.from(app, interview, time.timezone(), applicationId).copy(remind = prefs.interviewReminders.any {
                        val scope = identity()
                        NotificationCategory.InterviewsAndBriefings in prefs.notifications && it.applicationId == applicationId && it.entryId == interviewId && it.owner == scope?.first && it.origin == scope?.second && it.device == device
                    }) else _state.value.original,
                )
            }
        }
    }

    suspend fun save(draft: InterviewDraft, title: String): InterviewSaved? {
        val at = draft.at() ?: return null
        if (_state.value.saving || _state.value.uncertain) return null
        val owner = identity() ?: return null
        val options = RequestOptions(accountScope = owner.first)
        val known = _state.value.apps.firstOrNull { it.id == draft.applicationId }?.activity.orEmpty().filterIsInstance<Interview>().map { it.id }.toSet()
        _state.value = _state.value.copy(saving = true, failed = false)
        val minutes = draft.minutes.toLongOrNull()?.coerceIn(5, 24 * 60) ?: 60
        val people = draft.people.filter { it.name.isNotBlank() }
        val zone = draft.zone.id.takeIf { draft.otherZone || draft.zone != time.timezone() }
        return try {
            val saved = if (interviewId == null) repo.addApplicationInterview(
                draft.applicationId,
                AddApplicationInterviewRequest(at = at.toString(), kind = draft.kind, durationMinutes = minutes, location = draft.location.trim(), notes = draft.notes.trim(), participants = people, timezone = zone), options,
            ) else repo.updateApplicationInterview(
                draft.applicationId,
                interviewId,
                PatchApplicationInterviewRequest(at = at.toString(), kind = draft.kind, durationMinutes = minutes, location = draft.location.trim(), notes = draft.notes.trim(), participants = people, timezone = zone), options,
            )
            check(identity() == owner)
            val entry = saved.activity.filterIsInstance<Interview>().singleOrNull { if (interviewId == null) it.id !in known else it.id == interviewId }
                ?: error("Save confirmed without a unique interview identity")
            // The server moves this interview's briefing schedule with it; say where it went.
            val briefing = if (interviewId == null) null else runCatching {
                career.listCareerSchedules().firstOrNull { it.interviewId == interviewId && it.enabled && it.kind in setOf("prepare", "briefing") }?.nextRunAt?.let(Instant::parse)
            }.getOrNull()
            // Keep Save disabled through reminder confirmation and the sheet exit.
            InterviewSaved(briefing, CalendarEvent(entry.id, title, Instant.parse(entry.at), entry.durationMinutes ?: minutes, entry.location, entry.notes), saved, entry)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            _state.value = _state.value.copy(saving = false, failed = true, uncertain = interviewId == null)
            null
        }
    }

    suspend fun delete(): Boolean { return try {
        val owner = identity() ?: return false
        repo.deleteApplicationTimelineEntry(applicationId, interviewId ?: return false, RequestOptions(accountScope = owner.first)); identity() == owner
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        false
    }
    }
}

@Composable
internal fun InterviewRoute(applicationId: String, interviewId: String?, nav: NavController) {
    val repos = LocalRepositories.current
    val androidContext = LocalContext.current
    val device = remember { interviewReminderDevice(androidContext) }
    val identity = { (repos.account.session.value as? SessionState.SignedIn)?.let { it.accountScope to repos.authSession.origin.value } }
    val vm = viewModel(key = "interview:$applicationId:$interviewId") { InterviewViewModel(repos.applications, repos.career, repos.time, applicationId, interviewId, repos.preferences, identity, device) }
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
    val reminderDenied = stringResource(S.string.the_interview_is_saved_to_get_a_reminder_allow_notifications_in_your_device_settings)
    val reminderPassed = stringResource(S.string.interview_saved_the_reminder_time_has_already_passed)
    val reminderFailed = stringResource(S.string.interview_saved_couldn_t_update_its_reminder_edit_the_interview_to_try_again)
    var reminderOptIn by remember { mutableStateOf(false) }
    val undo = stringResource(S.string.undo)
    val permissionDenied = stringResource(S.string.to_get_a_reminder_allow_notifications_in_your_device_settings)
    val cancelReminderFailed = stringResource(S.string.interview_deleted_couldn_t_cancel_its_device_reminder)
    val requestPermission = rememberNotificationPermissionRequest { permitted ->
        if (permitted) { reminderOptIn = true; loaded = draft.copy(remind = true) }
        else toasts.post(permissionDenied)
    }

    InterviewSheet(
        state = state,
        draft = draft,
        onDraft = { next -> if (next.remind && !draft.remind) requestPermission() else loaded = next },
        editing = interviewId != null,
        dates = dates,
        home = vm.time.timezone(),
        today = vm.time.today(),
        sheetState = sheet,
        onDismiss = { nav.popBackStack() },
        onSave = {
            scope.launch {
                val owner = identity() ?: return@launch
                val result = withInterviewReminderChange(owner.first, owner.second, draft.applicationId, interviewId) {
                    val saved = vm.save(draft, title) ?: return@withInterviewReminderChange null
                    val reminder = try {
                        if (draft.remind && reminderOptIn && identity() == owner) repos.preferences.setNotification(NotificationCategory.InterviewsAndBriefings, true)
                        updateInterviewReminder(context, repos, saved.application, saved.interview, draft.remind, owner.first, owner.second)
                    } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
                    saved to reminder
                } ?: return@launch haptics(RrHaptic.Error)
                val (saved, reminder) = result
                if (identity() != owner) return@launch
                haptics(RrHaptic.Success)
                sheet.hide()
                nav.popBackStack()
                if (draft.addToCalendar) saved.event?.let { event -> addToCalendar(context, event, vm.time.now()) }
                val message = when (reminder) {
                    InterviewReminderResult.Denied -> reminderDenied
                    InterviewReminderResult.Passed -> reminderPassed
                    null -> reminderFailed
                    else -> saved.briefingAt?.let { savedText + " · " + briefingMoves.format(dates.whenWithTime(it)) } ?: savedText
                }
                toasts.post(message, saved.event?.let { addToCalendar }) {
                    if (it == RrToastResult.ActionPerformed) saved.event?.let { event -> addToCalendar(context, event, vm.time.now()) }
                }
            }
        },
        onDelete = {
            scope.launch {
                val owner = identity() ?: return@launch
                val application = state.apps.firstOrNull { it.id == applicationId } ?: return@launch
                val entry = state.interview ?: return@launch
                val event = CalendarEvent(entry.id, title, Instant.parse(entry.at), entry.durationMinutes ?: 60, entry.location, entry.notes)
                // The host owns the hold before closing the sheet, through the whole queued Undo decision.
                toasts.post(deletedText, undo, secondaryActionLabel = cancellation, around = { resolve ->
                    withInterviewReminderChange(owner.first, owner.second, applicationId, entry.id) {
                        if (identity() != owner) return@withInterviewReminderChange
                        kotlinx.coroutines.withContext(scope.coroutineContext.minusKey(kotlinx.coroutines.Job)) { sheet.hide() }
                        if (identity() != owner) return@withInterviewReminderChange
                        nav.popBackStack()
                        resolve()
                    }
                }) { result ->
                    if (result != RrToastResult.ActionPerformed && identity() == owner) {
                        val deleted = vm.delete()
                        if (!deleted) toasts.show(deleteFailed, tone = RrToastTone.Danger)
                        else {
                            try { updateInterviewReminder(context, repos, application, entry, false, owner.first, owner.second) }
                            catch (e: CancellationException) { throw e } catch (_: Exception) {
                                toasts.post(cancelReminderFailed, tone = RrToastTone.Danger)
                            }
                            if (result == RrToastResult.SecondaryActionPerformed) shareIcs(context, event, vm.time.now(), cancel = true)
                        }
                    }
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
    var typePicker by remember { mutableStateOf(false) }
    var peopleEditor by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf<AddApplicationInterviewRequestParticipantsItem?>(null) }
    val gap = draft.timeMissingInZone()
    val canSave = draft.at() != null && draft.applicationId.isNotBlank() && !state.saving && !state.uncertain && (!draft.otherZone || runCatching { ZoneId.of(draft.zoneText.trim()) }.isSuccess) && draft.people.none { !it.profileUrl.isNullOrBlank() && !it.profileUrl!!.startsWith("https://") }
    val zoneName = draft.zone.id.substringAfterLast('/').replace('_', ' ')

    Box(Modifier.fillMaxSize()) {
        RrBottomSheet(
            onDismissRequest = onDismiss,
            state = sheetState,
            title = stringResource(R.string.app_add_interview),
            fixedHeight = 700.dp,
            closeIconSize = 24.dp,
            detents = RrSheetDetents.Full,
            confirmDiscard = state.original != null && draft != state.original,
            footer = {
                RrFooterBar(inSheet = true) {
                    RrButton(stringResource(S.string.save_interview), onSave, Modifier.weight(1f), size = RrButtonSize.Large, enabled = canSave, loading = state.saving)
                }
            },
        ) {
            Column(
                Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(0.dp),
            ) {
                if (state.failed) RrCallout(stringResource(if (editing) S.string.couldn_t_update_the_interview_try_again else S.string.couldn_t_confirm_the_save_check_the_application_before_retrying_to_avoid_a_duplicate), tone = RrTone.Danger)
                if (!editing && draft.applicationId.isBlank()) {
                    Field(stringResource(S.string.application)) {
                        RrListGroup {
                            state.apps.forEach { app ->
                                RrListRow("${app.company} · ${app.role}", selected = draft.applicationId == app.id, onClick = { onDraft(draft.copy(applicationId = app.id)) })
                            }
                        }
                    }
                }
                Column(Modifier.padding(horizontal = 24.dp).padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    RrPickerField(stringResource(S.string.kind_interview, interviewKindLabel(draft.kind)), { typePicker = true }, label = stringResource(S.string.type), trailingIcon = D.drawable.ic_ph_caret_down)
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        RrPickerField(draft.date?.let { dates.weekdayDayMonth(it.atStartOfDay(dates.zone).toInstant()) }.orEmpty(), { picker = Picker.Date }, Modifier.weight(1f), label = stringResource(S.string.date), trailingIcon = null)
                        RrPickerField(draft.time?.let { dates.time(LocalDateTime.of(today, it).atZone(dates.zone).toInstant()) }.orEmpty(), { picker = Picker.Time }, Modifier.weight(1f), label = stringResource(S.string.time), trailingIcon = null, error = if (gap) " " else null)
                    }
                    if (gap) RrText(stringResource(S.string.this_time_does_not_exist_in_the_selected_timezone_choose_another_time), style = RrType.small, color = c.dangerText)
                    RrTextField(draft.location, { onDraft(draft.copy(location = it)) }, label = stringResource(R.string.app_where))
                    RrPickerField(draft.people.joinToString(", ") { it.name }, { peopleEditor = true }, label = stringResource(R.string.app_with), trailingIcon = null)
                }
                RrSwitchRow(stringResource(R.string.app_remind_day_before), draft.remind, { onDraft(draft.copy(remind = it)) }, Modifier.padding(top = 12.dp), divider = true)
                RrSwitchRow(stringResource(R.string.app_phone_calendar), draft.addToCalendar, { onDraft(draft.copy(addToCalendar = it)) })

            }
        }

        if (typePicker) RrBottomSheet({ typePicker = false }, title = stringResource(S.string.type), fitContent = true) {
            InterviewKinds.forEach { kind -> RrListRow(stringResource(S.string.kind_interview, interviewKindLabel(kind)), onClick = { onDraft(draft.copy(kind = kind)); typePicker = false }) }
            if (editing) RrListRow(stringResource(S.string.delete_interview), danger = true, onClick = { typePicker = false; confirmDelete = true })
        }
        if (peopleEditor) RrBottomSheet({ peopleEditor = false }, title = stringResource(S.string.who_you_ll_meet), detents = RrSheetDetents.Full) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                draft.people.forEachIndexed { index, person ->
                    RrTextField(person.name, { name -> onDraft(draft.copy(people = draft.people.mapIndexed { i, p -> if (i == index) p.copy(name = name) else p })) }, label = stringResource(S.string.name))
                    RrTextField(person.role.orEmpty(), { role -> onDraft(draft.copy(people = draft.people.mapIndexed { i, p -> if (i == index) p.copy(role = role) else p })) }, label = stringResource(S.string.role))
                    val url = person.profileUrl.orEmpty()
                    RrTextField(url, { text -> onDraft(draft.copy(people = draft.people.mapIndexed { i, p -> if (i == index) p.copy(profileUrl = text.ifBlank { null }) else p })) }, label = stringResource(S.string.profile_link_optional), error = if (url.isNotBlank() && !url.startsWith("https://")) stringResource(S.string.profile_links_must_be_public_https_addresses) else null)
                    RrButton(stringResource(S.string.remove_person_0, (index + 1).toString()), { onDraft(draft.copy(people = draft.people.filterIndexed { i, _ -> i != index })) }, variant = RrButtonVariant.DangerGhost)
                }
                RrButton(stringResource(S.string.add_a_person), { onDraft(draft.copy(people = draft.people + AddApplicationInterviewRequestParticipantsItem(name = ""))) }, variant = RrButtonVariant.GhostAccent)
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
                    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
                        RrTimePicker(draft.time, { haptics(RrHaptic.Selection); onDraft(draft.copy(time = it)) }, stepMinutes = 5)
                        RrTextField(draft.minutes, { onDraft(draft.copy(minutes = it.filter(Char::isDigit).take(4))) }, label = stringResource(S.string.length_minutes), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                        RrTextField(draft.zoneText.ifBlank { draft.zone.id }, { text -> onDraft(draft.copy(zoneText = text, otherZone = true, zone = runCatching { ZoneId.of(text.trim()) }.getOrNull() ?: draft.zone)) }, label = stringResource(S.string.interview_timezone), error = if (draft.zoneText.isNotBlank() && runCatching { ZoneId.of(draft.zoneText.trim()) }.isFailure) stringResource(S.string.interview_timezone) else null)
                    }
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
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RrText(label, style = RrType.formLabel, color = RrTheme.colors.ink2)
        content()
    }
}
