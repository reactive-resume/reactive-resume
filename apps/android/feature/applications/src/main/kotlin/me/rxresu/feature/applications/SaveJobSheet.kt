package me.rxresu.feature.applications

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import java.time.LocalDate
import java.time.ZoneOffset
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.ApplicationsRepository
import me.rxresu.core.data.DocumentsRepository
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.TimeSource
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrChoiceRow
import me.rxresu.core.designsystem.RrContextChip
import me.rxresu.core.designsystem.RrDatePicker
import me.rxresu.core.designsystem.RrDisclosureLine
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrPickerField
import me.rxresu.core.designsystem.RrRowCaret
import me.rxresu.core.designsystem.RrSearchField
import me.rxresu.core.designsystem.RrSegment
import me.rxresu.core.designsystem.RrSegmentedControl
import me.rxresu.core.designsystem.RrSheetDetents
import me.rxresu.core.designsystem.RrSkeleton
import me.rxresu.core.designsystem.RrSpinner
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrBottomSheetState
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.Application as ApplicationDest
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.NewDocument
import me.rxresu.core.navigation.Welcome
import me.rxresu.core.network.generated.AddApplicationInterviewResponsePostingSourceCompleteness
import me.rxresu.core.network.generated.AiParseApplicationPostingResponseFilledBy
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.CreateApplicationRequest
import me.rxresu.core.network.generated.CreatePostingParseRequest
import me.rxresu.core.network.generated.CreatePostingParseResponse
import me.rxresu.core.network.generated.CreatePostingSearchRequest
import me.rxresu.core.network.generated.CreatePostingSearchResponseItem
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.network.generated.DocumentType
import me.rxresu.core.network.generated.FindTrackedPostingResponseApplication
import me.rxresu.core.strings.R as S

/** Where a saved job starts (web: Saved, Already applied, Already interviewing). */
internal enum class StartStage(val stage: ApplicationStage) { Saved(ApplicationStage.Saved), Applied(ApplicationStage.Applied), Interviewing(ApplicationStage.Interview) }

internal enum class ReadOutcome { None, Page, Ai, Guessed, Failed }

internal data class SaveJobState(
    val input: String = "",
    val role: String = "",
    val company: String = "",
    val location: String = "",
    val salary: String = "",
    val stage: StartStage = StartStage.Saved,
    val appliedOn: LocalDate? = null,
    val resumeId: String? = null,
    val letterId: String? = null,
    val reading: Boolean = false,
    val outcome: ReadOutcome = ReadOutcome.None,
    val parsed: CreatePostingParseResponse? = null,
    val duplicate: FindTrackedPostingResponseApplication? = null,
    val documents: List<DocumentSummary> = emptyList(),
    val saving: Boolean = false,
    val saveFailed: Boolean = false,
    val signedIn: Boolean = true,
    val searching: Boolean = false,
    val results: List<CreatePostingSearchResponseItem>? = null,
    val searchFailed: Boolean = false,
    /** Opened from the share sheet with a link: the web's "capture". */
    val captured: Boolean = false,
) {
    val isLink get() = input.trim().let { it.startsWith("https://") || it.startsWith("http://") } && !input.trim().contains(' ')
    val clipped get() = parsed?.postingSource?.let { it.truncated || it.completeness == AddApplicationInterviewResponsePostingSourceCompleteness.Incomplete } == true
    val canSave get() = role.isNotBlank() && company.isNotBlank() && !saving && !reading
}

internal class SaveJobViewModel(
    private val apps: ApplicationsRepository,
    private val documents: DocumentsRepository,
    val time: TimeSource,
    signedIn: Boolean,
    initialUrl: String?,
) : ViewModel() {
    private val _state = MutableStateFlow(SaveJobState(signedIn = signedIn, appliedOn = time.today()))
    val state: StateFlow<SaveJobState> = _state.asStateFlow()
    private var check: Job? = null

    init {
        if (signedIn) viewModelScope.launch { runCatching { documents.listDocuments(trashed = false) }.onSuccess { d -> _state.update { it.copy(documents = d) } } }
        // From the share sheet: the link is filled in and reading starts at once.
        if (signedIn && !initialUrl.isNullOrBlank()) { _state.update { it.copy(captured = true) }; setInput(initialUrl); read(useAi = false) }
    }

    fun update(block: (SaveJobState) -> SaveJobState) = _state.update(block)

    /** A link is checked against tracked jobs ("Already tracked") shortly after typing stops. */
    fun setInput(value: String) {
        _state.update { it.copy(input = value, duplicate = null) }
        check?.cancel()
        if (!_state.value.isLink) return
        check = viewModelScope.launch {
            delay(400)
            runCatching { apps.findTrackedPosting(value.trim()).application }.onSuccess { found -> _state.update { it.copy(duplicate = found) } }
        }
    }

    /** Built-in reader first (no AI); "Read with AI" sends the posting to the account's AI provider. */
    fun read(useAi: Boolean) = viewModelScope.launch {
        val input = _state.value.input.trim().ifEmpty { return@launch }
        _state.update { it.copy(reading = true) }
        val result = try {
            apps.createPostingParse(CreatePostingParseRequest(input = input, useAI = useAi))
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }
        _state.update { s ->
            if (result == null || (result.role.isBlank() && result.company.isBlank())) s.copy(reading = false, outcome = ReadOutcome.Failed, parsed = result ?: s.parsed)
            else s.copy(
                reading = false,
                parsed = result,
                outcome = when (result.filledBy) {
                    AiParseApplicationPostingResponseFilledBy.Page -> ReadOutcome.Page
                    AiParseApplicationPostingResponseFilledBy.Ai -> ReadOutcome.Ai
                    else -> ReadOutcome.Guessed
                },
                role = s.role.ifBlank { result.role },
                company = s.company.ifBlank { result.company },
                location = s.location.ifBlank { result.location },
                salary = s.salary.ifBlank { result.salary },
            )
        }
    }

    fun search(query: String) = viewModelScope.launch {
        _state.update { it.copy(searching = true, searchFailed = false) }
        val found = runCatching { apps.createPostingSearch(CreatePostingSearchRequest(query = query.trim())) }.getOrNull()
        _state.update { it.copy(searching = false, results = found ?: it.results, searchFailed = found == null) }
    }

    /** Saves and returns the new application's id, or null (the sheet keeps every field). */
    suspend fun save(): String? {
        val s = _state.value
        if (!s.canSave) return null
        _state.update { it.copy(saving = true, saveFailed = false) }
        val sent = s.stage != StartStage.Saved
        return try {
            apps.createApplication(
                CreateApplicationRequest(
                    role = s.role.trim(),
                    company = s.company.trim(),
                    location = s.location.trim().ifEmpty { null },
                    salary = s.salary.trim().ifEmpty { null },
                    sourceUrl = s.parsed?.sourceUrl ?: s.input.trim().takeIf { s.isLink },
                    jobDescription = s.parsed?.jobDescription?.ifBlank { null } ?: s.input.trim().takeIf { !s.isLink && it.isNotEmpty() },
                    requirements = s.parsed?.requirements,
                    postingSource = s.parsed?.postingSource,
                    status = s.stage.stage,
                    stageEnteredAt = if (sent) s.appliedOn?.toString() else null,
                    resumeId = if (sent) s.resumeId else null,
                    coverLetterId = if (sent) s.letterId else null,
                ),
            ).also { _state.update { it.copy(saving = false) } }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            _state.update { it.copy(saving = false, saveFailed = true) }
            null
        }
    }
}

@Composable
internal fun SaveJobRoute(url: String?, nav: NavController) {
    val repos = LocalRepositories.current
    val session by repos.authSession.state.collectAsStateWithLifecycle()
    val signedIn = session is SessionState.SignedIn
    val vm = viewModel(key = "save-job") { SaveJobViewModel(repos.applications, repos.documents, repos.time, signedIn, url) }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = LocalToasts.current
    val haptics = rememberRrHaptics()
    val scope = rememberCoroutineScope()
    val sheet = rememberRrBottomSheetState()
    val added = stringResource(R.string.app_added_at, state.role.trim(), state.company.trim())
    // `error` when the posting can't be read.
    LaunchedEffect(state.outcome) { if (state.outcome == ReadOutcome.Failed) haptics(RrHaptic.Error) }
    SaveJobSheet(
        state = state,
        time = vm.time,
        sheetState = sheet,
        onDismiss = { nav.popBackStack() },
        onInput = vm::setInput,
        onRead = { vm.read(it) },
        onChange = vm::update,
        onSearch = vm::search,
        onOpenTracked = { id -> nav.popBackStack(); nav.navigate(ApplicationDest(id)) },
        onOpenApp = { nav.popBackStack(); nav.navigate(Welcome) },
        onSave = { prepare ->
            scope.launch {
                val id = vm.save() ?: return@launch
                haptics(RrHaptic.Success)
                sheet.hide()
                nav.popBackStack()
                nav.navigate(if (prepare) NewDocument(copyForApplicationId = id) else ApplicationDest(id))
                toasts.post(added)
            }
        },
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun SaveJobSheet(
    state: SaveJobState,
    time: TimeSource,
    onDismiss: () -> Unit,
    onInput: (String) -> Unit,
    onRead: (Boolean) -> Unit,
    onChange: ((SaveJobState) -> SaveJobState) -> Unit,
    onSearch: (String) -> Unit,
    onOpenTracked: (String) -> Unit,
    onOpenApp: () -> Unit,
    onSave: (prepare: Boolean) -> Unit,
    sheetState: me.rxresu.core.designsystem.RrBottomSheetState = rememberRrBottomSheetState(),
) {
    val c = RrTheme.colors
    val context = LocalContext.current
    var searching by remember { mutableStateOf(false) }
    var requirements by remember { mutableStateOf(false) }
    var pickDate by remember { mutableStateOf(false) }
    val dates = rememberDates(time.timezone())
    // Offer the clipboard's link only when it holds text; reading it happens on tap, so Android's paste notice is honest.
    val clip = remember { context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager }
    val clipHasText = remember { clip?.primaryClipDescription?.hasMimeType("text/*") == true }

    Box(Modifier.fillMaxSize()) {
        RrBottomSheet(
            onDismissRequest = onDismiss,
            state = sheetState,
            title = stringResource(S.string.save_a_job),
            detents = RrSheetDetents.Full,
            confirmDiscard = state.role.isNotBlank() || state.company.isNotBlank() || state.input.isNotBlank(),
            headerActions = if (state.signedIn) ({ RrButton(stringResource(R.string.app_search_postings), { searching = true }, variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Medium, icon = D.drawable.ic_ph_magnifying_glass) }) else null,
            footer = if (state.signedIn) ({
                Column {
                    Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
                    Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        RrButton(stringResource(S.string.save_and_prepare_resume), { onSave(true) }, Modifier.weight(1.4f), variant = RrButtonVariant.Secondary, size = RrButtonSize.Large, enabled = state.canSave)
                        RrButton(stringResource(if (state.stage == StartStage.Saved) S.string.save_job else S.string.record_application), { onSave(false) }, Modifier.weight(1f), size = RrButtonSize.Large, enabled = state.canSave, loading = state.saving)
                    }
                }
            }) else null,
        ) {
            if (!state.signedIn) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    RrText(stringResource(R.string.app_sign_in_to_save), style = RrType.body, color = c.ink)
                    RrButton(stringResource(R.string.app_open_app), onOpenApp)
                }
                return@RrBottomSheet
            }
            Column(
                Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                RrTextField(
                    state.input,
                    onInput,
                    label = stringResource(R.string.app_job_link_or_text),
                    placeholder = stringResource(R.string.app_job_link_placeholder),
                    leadingIcon = D.drawable.ic_ph_link_simple,
                    ltr = state.isLink,
                    mono = state.isLink,
                    singleLine = state.isLink || state.input.isEmpty(),
                    trailing = if (state.input.isNotBlank() && !state.reading && state.outcome == ReadOutcome.None) ({ RrButton(stringResource(S.string.read_posting), { onRead(false) }, variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Small) }) else null,
                )
                if (state.input.isEmpty() && clipHasText) {
                    RrButton(stringResource(R.string.app_paste_clipboard), {
                        clip?.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString()?.trim()?.let { onInput(it); onRead(false) }
                    }, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small, icon = D.drawable.ic_ph_clipboard_text)
                }
                state.duplicate?.let { dup ->
                    RrCallout(stringResource(S.string.already_tracked_0_at_1_open_it_or_update_only_its_posting_details, dup.role, dup.company), tone = RrTone.Warn, actionLabel = stringResource(S.string.open_tracked_job), onAction = { onOpenTracked(dup.id) })
                }
                ReadStatus(state, onRead)
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    LoadingField(state.reading, Modifier.weight(1f)) { RrTextField(state.role, { v -> onChange { it.copy(role = v) } }, label = stringResource(S.string.role)) }
                    LoadingField(state.reading, Modifier.weight(1f)) { RrTextField(state.company, { v -> onChange { it.copy(company = v) } }, label = stringResource(S.string.company)) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    LoadingField(state.reading, Modifier.weight(1f)) { RrTextField(state.location, { v -> onChange { it.copy(location = v) } }, label = stringResource(S.string.location)) }
                    LoadingField(state.reading, Modifier.weight(1f)) { RrTextField(state.salary, { v -> onChange { it.copy(salary = v) } }, label = stringResource(S.string.salary), placeholder = stringResource(S.string.optional_538bc1f07a)) }
                }
                Field(stringResource(S.string.stage)) {
                    RrSegmentedControl(
                        listOf(RrSegment(stringResource(S.string.saved)), RrSegment(stringResource(R.string.app_already_applied)), RrSegment(stringResource(R.string.app_already_interviewing))),
                        selectedIndex = state.stage.ordinal,
                        onSelect = { i -> onChange { it.copy(stage = StartStage.entries[i]) } },
                    )
                }
                if (state.stage != StartStage.Saved) {
                    RrPickerField(state.appliedOn?.let(dates::fullDate).orEmpty(), { pickDate = !pickDate }, label = stringResource(S.string.application_date), trailingIcon = D.drawable.ic_ph_calendar_blank)
                    if (pickDate) RrDatePicker(state.appliedOn, { d -> onChange { it.copy(appliedOn = d) }; pickDate = false }, today = time.today(), max = time.today())
                    DocumentChoice(stringResource(R.string.app_resume_optional), stringResource(S.string.no_resume_selected), state.documents.filter { it.type == DocumentType.Resume }, state.resumeId) { id -> onChange { it.copy(resumeId = id) } }
                    DocumentChoice(stringResource(S.string.cover_letter_optional), stringResource(S.string.no_cover_letter_selected), state.documents.filter { it.type == DocumentType.Letter }, state.letterId) { id -> onChange { it.copy(letterId = id) } }
                }
                val count = state.parsed?.requirements?.size ?: 0
                if (count > 0) Column {
                    RrListRow(
                        stringResource(S.string.what_it_asks_for),
                        subtitle = pluralStringResource(R.plurals.app_requirements_read, count, count),
                        icon = D.drawable.ic_ph_list_checks,
                        onClick = { requirements = true },
                        trailing = { RrRowCaret() },
                    )
                }
                if (state.saveFailed) RrCallout(stringResource(R.string.app_couldnt_add), tone = RrTone.Danger)
                // As on the web: only for a shared link, and never after the user chose to read it with AI.
                if (state.captured && state.outcome != ReadOutcome.Ai) RrDisclosureLine(stringResource(R.string.app_capture_no_ai), icon = D.drawable.ic_ph_info)
            }
        }
        if (requirements) RrBottomSheet(onDismissRequest = { requirements = false }, title = stringResource(S.string.what_it_asks_for), fitContent = true) {
            FlowRow(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                state.parsed?.requirements.orEmpty().forEach { RrContextChip(it) }
            }
        }
        if (searching) SearchPostingsSheet(state, onDismiss = { searching = false }, onSearch = onSearch) { url ->
            searching = false
            onInput(url)
            onRead(false)
        }
    }
}

/** A field that keeps its size while the link is read ("Reading the link…" placeholders), then crossfades in (d2). */
@Composable
private fun LoadingField(loading: Boolean, modifier: Modifier, content: @Composable () -> Unit) {
    val reduced = LocalReducedMotion.current
    androidx.compose.animation.Crossfade(loading, modifier, animationSpec = androidx.compose.animation.core.tween(if (reduced) 0 else me.rxresu.core.designsystem.RrMotion.D2), label = "field") { busy ->
        if (busy) Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            RrSkeleton(Modifier.fillMaxWidth(0.4f).padding(vertical = 2.dp))
            RrSkeleton(Modifier.fillMaxWidth().padding(vertical = 20.dp))
        } else content()
    }
}

@Composable
private fun ReadStatus(state: SaveJobState, onRead: (Boolean) -> Unit) {
    val c = RrTheme.colors
    when {
        state.reading -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            RrSpinner(tint = c.ink2)
            RrText(stringResource(if (state.isLink) R.string.app_reading_link else R.string.app_reading_posting), style = RrType.small, color = c.ink2)
        }
        state.outcome == ReadOutcome.Failed -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            RrCallout(stringResource(R.string.app_posting_unreadable), tone = RrTone.Danger)
            RrButton(stringResource(S.string.read_with_ai), { onRead(true) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small, icon = D.drawable.ic_ph_sparkle)
            RrDisclosureLine(stringResource(R.string.app_read_ai_disclosure))
        }
        // As on the web: a read that left the role or company empty says so instead of "Found".
        (state.outcome == ReadOutcome.Page || state.outcome == ReadOutcome.Ai) && (state.parsed?.role.isNullOrBlank() || state.parsed?.company.isNullOrBlank()) ->
            StatusLine(stringResource(R.string.app_some_details_unread), c.warnText, D.drawable.ic_ph_warning_circle)
        state.outcome == ReadOutcome.Page || state.outcome == ReadOutcome.Ai -> StatusLine(stringResource(R.string.app_found_role_company), c.accentText)
        state.outcome == ReadOutcome.Guessed -> StatusLine(stringResource(R.string.app_filled_first_line), c.ink2)
    }
    if (state.clipped) RrCallout(stringResource(S.string.this_description_is_clipped_or_incomplete_review_it_or_paste_the_full_description_before_preparing), tone = RrTone.Warn)
}

@Composable
private fun StatusLine(text: String, color: androidx.compose.ui.graphics.Color, icon: Int = D.drawable.ic_ph_check_circle) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RrIcon(icon, null, size = 18.dp, tint = color)
        RrText(text, style = RrType.small, color = color)
    }
}

@Composable
private fun DocumentChoice(label: String, none: String, docs: List<DocumentSummary>, selected: String?, onSelect: (String?) -> Unit) {
    Field(label) {
        Column {
            RrChoiceRow(none, selected == null, { onSelect(null) })
            docs.forEach { d -> RrChoiceRow(d.name, selected == d.id, { onSelect(d.id) }) }
        }
    }
}

/** Search job postings: query, results, "Use posting" reads the chosen one. */
@Composable
private fun SearchPostingsSheet(state: SaveJobState, onDismiss: () -> Unit, onSearch: (String) -> Unit, onUse: (String) -> Unit) {
    val c = RrTheme.colors
    var query by remember { mutableStateOf("") }
    RrBottomSheet(onDismissRequest = onDismiss, title = stringResource(S.string.search_job_postings), detents = RrSheetDetents.Full) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            RrSearchField(query, { query = it }, placeholder = stringResource(S.string.role_company_or_location), keyboardActions = androidx.compose.foundation.text.KeyboardActions(onSearch = { onSearch(query) }))
            RrButton(stringResource(S.string.search), { onSearch(query) }, enabled = query.isNotBlank() && !state.searching, loading = state.searching)
            when {
                state.searching -> RrText(stringResource(R.string.app_searching_postings), style = RrType.small, color = c.ink2)
                state.searchFailed -> RrCallout(stringResource(R.string.app_search_failed), tone = RrTone.Danger)
                state.results?.isEmpty() == true -> RrText(stringResource(S.string.no_postings_found_try_different_keywords), style = RrType.small, color = c.ink3)
            }
            state.results.orEmpty().forEach { item ->
                me.rxresu.core.designsystem.RrCard(Modifier.fillMaxWidth()) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        RrText(item.title, style = RrType.label, color = c.ink)
                        RrText(hostOf(item.url) ?: item.url, style = RrType.mono, color = c.ink3)
                        item.description?.takeIf(String::isNotBlank)?.let { RrText(it, style = RrType.small, color = c.ink2, maxLines = 3) }
                        RrButton(stringResource(R.string.app_use_posting), { onUse(item.url) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
                    }
                }
            }
        }
    }
}
