package me.rxresu.feature.applications

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import me.rxresu.core.data.ApplicationQuery
import me.rxresu.core.data.ApplicationsRepository
import me.rxresu.core.data.DocumentsRepository
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.TimeSource
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrChoiceRow
import me.rxresu.core.designsystem.RrDatePicker
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrPickerField
import me.rxresu.core.designsystem.RrSectionHeader
import me.rxresu.core.designsystem.RrStageDot
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrToastHostState
import me.rxresu.core.designsystem.RrToastResult
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrBottomSheetState
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.Application as ApplicationRoute
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.network.generated.DocumentType
import me.rxresu.core.network.generated.PatchApplicationClosedReason
import me.rxresu.core.network.generated.PatchApplicationRequest
import me.rxresu.core.network.generated.PatchApplicationsRequest
import me.rxresu.core.strings.R as S

/**
 * Toasts that outlive the sheet or row that raised them (the sheet closes before its toast's Undo can run).
 * ponytail: one app-lifetime scope; move to an app-provided scope if the shell ever offers one.
 */
internal val ToastScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

/** One choice in the Move sheet: an open lane or a closing reason. */
internal data class MoveChoice(val lane: Lane?, val stage: ApplicationStage, val reason: PatchApplicationClosedReason? = null)

internal data class MoveState(
    val app: Application? = null,
    val others: List<Application> = emptyList(),
    val lanes: List<Lane> = emptyList(),
    val documents: List<DocumentSummary> = emptyList(),
    val error: WriteError? = null,
    val busy: Boolean = false,
)

internal class MoveViewModel(private val apps: ApplicationsRepository, private val documents: DocumentsRepository, val time: TimeSource, val id: String) : ViewModel() {
    private val extra = MutableStateFlow(MoveState())
    val moves = ApplicationMoves(apps)

    val state: StateFlow<MoveState> = combine(apps.observe(ApplicationQuery(showClosed = true)), extra) { list, e ->
        val rows = list.data.orEmpty()
        e.copy(app = rows.firstOrNull { it.id == id } ?: e.app, others = rows.filter { it.id != id && it.status != ApplicationStage.Closed })
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), MoveState())

    init { loadLanes() }

    private fun loadLanes() = viewModelScope.launch {
        runCatching { apps.getApplicationLanes().lanes }.onSuccess { extra.value = extra.value.copy(lanes = it) }
        runCatching { documents.listDocuments(trashed = false) }.onSuccess { extra.value = extra.value.copy(documents = it) }
    }

    /** Applies [choice]; true when it worked. A stale pipeline refreshes the lanes and keeps the sheet open. */
    suspend fun apply(choice: MoveChoice, applied: AppliedDetails? = null): Boolean {
        extra.value = extra.value.copy(busy = true, error = null)
        return try {
            if (applied == null) moves.move(id, choice.lane, choice.stage, choice.reason)
            else apps.patchApplication(
                id,
                PatchApplicationRequest(laneId = choice.lane?.id, status = choice.stage, stageEnteredAt = applied.date.atStartOfDay(ZoneOffset.UTC).toInstant().toString(), resumeId = applied.resumeId, coverLetterId = applied.letterId),
                RequestOptions(nullFields = setOfNotNull("/resumeId".takeIf { applied.resumeId == null }, "/coverLetterId".takeIf { applied.letterId == null })),
            )
            extra.value = extra.value.copy(busy = false)
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val err = e.writeError()
            if (err == WriteError.StagesChanged) loadLanes()
            extra.value = extra.value.copy(busy = false, error = err)
            false
        }
    }
}

/** What "Mark as applied" records: the date and the documents actually sent. */
internal data class AppliedDetails(val date: LocalDate, val resumeId: String?, val letterId: String?)

@Composable
internal fun MoveRoute(id: String, nav: NavController) {
    val repos = LocalRepositories.current
    val vm = viewModel(key = "move:$id") { MoveViewModel(repos.applications, repos.documents, repos.time, id) }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = LocalToasts.current
    val haptics = rememberRrHaptics()
    val sheet = rememberRrBottomSheetState()
    val scope = rememberCoroutineScope()
    val res = androidx.compose.ui.platform.LocalResources.current
    val texts = MoveTexts(
        undo = stringResource(S.string.undo),
        closed = stringResource(S.string.application_closed),
        acceptedAlone = stringResource(S.string.closed_as_accepted_offer),
        offerTerms = stringResource(S.string.add_the_offer_s_terms),
    )
    val app = state.app
    MoveSheet(
        state = state,
        time = vm.time,
        onDismiss = { nav.popBackStack() },
        onChoose = { choice, applied, label ->
            scope.launch {
                val before = app?.snapshot()
                if (!vm.apply(choice, applied)) { haptics(RrHaptic.Error); return@launch }
                haptics(if (choice.stage == ApplicationStage.Offer || choice.reason == PatchApplicationClosedReason.Accepted) RrHaptic.Success else RrHaptic.Selection)
                // The tick moves (d1), then the sheet closes (d2).
                delay(RrMotion.D1.toLong())
                sheet.hide()
                nav.popBackStack()
                ToastScope.launch { announceMove(toasts, vm.moves, id, choice, label, before, state.others, texts, res, onOfferTerms = { nav.navigate(ApplicationRoute(id, WorkspaceTab.Messages)) }) }
            }
        },
        sheetState = sheet,
    )
}

internal data class MoveTexts(val undo: String, val closed: String, val acceptedAlone: String, val offerTerms: String)

/** The toast after a move (web use-application-actions): Offer offers its terms, Accepted offers to close the rest, others Undo. */
internal suspend fun announceMove(
    toasts: RrToastHostState,
    moves: ApplicationMoves,
    id: String,
    choice: MoveChoice,
    label: String,
    before: StageSnapshot?,
    others: List<Application>,
    texts: MoveTexts,
    res: android.content.res.Resources,
    onOfferTerms: () -> Unit,
) {
    when {
        choice.stage == ApplicationStage.Offer ->
            if (toasts.show(res.getString(S.string.moved_to_0, label), texts.offerTerms) == RrToastResult.ActionPerformed) onOfferTerms()
        choice.reason == PatchApplicationClosedReason.Accepted -> {
            if (others.isEmpty()) { toasts.show(texts.acceptedAlone); return }
            val n = others.size
            val ask = plural(res, S.plurals.message_0_plural_one_closed_as_accepted_offer_close_your_other_open_application_as_accepted_another_offer_ot, n, n.toString())
            val action = plural(res, S.plurals.message_0_plural_one_close_it_other_close_all, n, n.toString())
            if (toasts.show(ask, action) == RrToastResult.ActionPerformed) {
                runCatching { moves.closeAll(others.map { it.id }) }
                toasts.show(plural(res, S.plurals.message_0_plural_one_application_closed_as_accepted_another_offer_other_applications_closed_as_accepted_anot, n, n.toString()))
            }
        }
        else -> {
            val message = if (choice.stage != ApplicationStage.Closed) res.getString(S.string.moved_to_0, label)
            else if (choice.lane?.systemKey != null || choice.lane == null) texts.closed else res.getString(R.string.app_closed_as, label)
            val changed = before != null && (before.status != choice.stage || before.laneId != choice.lane?.id || before.closedReason != choice.reason)
            if (toasts.show(message, if (changed) texts.undo else null) == RrToastResult.ActionPerformed && before != null) runCatching { moves.restore(id, before) }
        }
    }
}

internal suspend fun ApplicationMoves.closeAll(ids: List<String>) = bulk(PatchApplicationsRequest(ids = ids, status = ApplicationStage.Closed, closedReason = PatchApplicationClosedReason.AcceptedOther))

@Composable
internal fun MoveSheet(
    state: MoveState,
    time: TimeSource,
    onDismiss: () -> Unit,
    onChoose: (MoveChoice, AppliedDetails?, String) -> Unit,
    sheetState: me.rxresu.core.designsystem.RrBottomSheetState = rememberRrBottomSheetState(),
) {
    val c = RrTheme.colors
    val app = state.app
    val current = app?.let { displayLane(state.lanes, it) }
    var picked by remember { mutableStateOf<MoveChoice?>(null) }
    var confirming by remember { mutableStateOf<Pair<MoveChoice, String>?>(null) }
    val open = activeLanes(state.lanes).filter { it.category != ApplicationStage.Closed }
        .map { MoveChoice(it, it.category) }
        .ifEmpty { Pipeline.map { MoveChoice(null, it) } }
    val closedLane = categoryLane(state.lanes, ApplicationStage.Closed)
    val customClosed = activeLanes(state.lanes).filter { it.category == ApplicationStage.Closed && it.systemKey == null && it.closedReason != null }
    val closing = ClosedReasons.map { reason -> customClosed.firstOrNull { it.closedReason == reason } ?: closedLane }
        .zip(ClosedReasons) { lane, reason -> MoveChoice(lane, ApplicationStage.Closed, reason) }

    val confirm = confirming
    var details by remember(confirm) { mutableStateOf(AppliedDetails(time.today(), app?.resumeId, app?.coverLetterId)) }
    RrBottomSheet(
        onDismissRequest = onDismiss,
        state = sheetState,
        title = if (confirm != null) stringResource(S.string.mark_as_applied) else stringResource(S.string.move_to_6ffcfca36b),
        fitContent = confirm == null,
        detents = me.rxresu.core.designsystem.RrSheetDetents.Full,
        footer = confirm?.let { (choice, label) ->
            { SheetFooter { RrButton(stringResource(S.string.mark_as_applied), { onChoose(choice, details, label) }, size = RrButtonSize.Large, enabled = !state.busy, loading = state.busy) } }
        },
    ) {
        if (confirm != null) {
            MarkAsApplied(state, time, details) { details = it }
            return@RrBottomSheet
        }
        SheetBody {
            when (state.error) {
                WriteError.StagesChanged -> RrCallout(stringResource(R.string.app_stages_changed), tone = RrTone.Warn)
                WriteError.Failed -> RrCallout(stringResource(R.string.app_couldnt_update), tone = RrTone.Danger)
                null -> Unit
            }
            RrListGroup {
                open.forEach { choice ->
                    val label = choice.lane?.let { laneLabel(it) } ?: stageLabel(choice.stage)
                    val selected = picked?.let { it == choice } ?: (app?.status != ApplicationStage.Closed && (current?.id == choice.lane?.id && choice.lane != null || choice.lane == null && app?.status == choice.stage))
                    ChoiceRow(choice, label, selected) {
                        if (state.busy) return@ChoiceRow
                        picked = choice
                        if (app?.status == ApplicationStage.Saved && choice.stage == ApplicationStage.Applied) confirming = choice to label
                        else onChoose(choice, null, label)
                    }
                }
            }
            Column {
                RrText(stringResource(S.string.mark_as_closed), Modifier.padding(top = 4.dp, bottom = 8.dp), style = RrType.eyebrow, color = c.ink3)
                RrListGroup {
                    closing.forEach { choice ->
                        val label = closedReasonLabel(choice.reason!!)
                        val selected = picked?.let { it == choice } ?: (app?.status == ApplicationStage.Closed && app.closedReason == choice.reason)
                        ChoiceRow(choice, label, selected) {
                            if (state.busy) return@ChoiceRow
                            picked = choice
                            onChoose(choice, null, label)
                        }
                    }
                }
            }
            RrText(stringResource(S.string.the_reason_is_kept_for_insights_linked_documents_aren_t_touched), style = RrType.small, color = c.ink3)
        }
    }
}

@Composable
private fun ChoiceRow(choice: MoveChoice, label: String, selected: Boolean, onClick: () -> Unit) {
    RrListRow(
        title = label,
        selected = selected,
        onClick = onClick,
        leading = { Row(Modifier.width(24.dp), horizontalArrangement = Arrangement.Center) { RrStageDot(choice.stage.rr()) } },
        trailing = if (selected) ({ RrIcon(D.drawable.ic_ph_check, null, size = 20.dp, tint = RrTheme.colors.ink2) }) else null,
    )
}

/** Saved → Applied: "Confirm submission and choose the documents you actually sent." */
@Composable
private fun MarkAsApplied(state: MoveState, time: TimeSource, value: AppliedDetails, onChange: (AppliedDetails) -> Unit) {
    val dates = rememberDates(time.timezone())
    var picking by remember { mutableStateOf(false) }
    val resumes = state.documents.filter { it.type == DocumentType.Resume }
    val letters = state.documents.filter { it.type == DocumentType.Letter }
    SheetBody {
        RrText(stringResource(S.string.confirm_submission_and_choose_the_documents_you_actually_sent_their_current_versions_will_be_saved), style = RrType.small, color = RrTheme.colors.ink2)
        if (state.error == WriteError.Failed) RrCallout(stringResource(S.string.couldn_t_record_submission_try_again), tone = RrTone.Danger)
        RrPickerField(dates.fullDate(value.date), { picking = !picking }, label = stringResource(S.string.application_date), trailingIcon = D.drawable.ic_ph_calendar_blank)
        if (picking) RrDatePicker(value.date, { onChange(value.copy(date = it)); picking = false }, today = time.today(), max = time.today())
        RrText(stringResource(S.string.resume), style = RrType.fieldLabel, color = RrTheme.colors.ink2)
        Column {
            RrChoiceRow(stringResource(S.string.no_resume), value.resumeId == null, { onChange(value.copy(resumeId = null)) })
            resumes.forEach { doc -> RrChoiceRow(doc.name, value.resumeId == doc.id, { onChange(value.copy(resumeId = doc.id)) }) }
        }
        RrText(stringResource(S.string.cover_letter_7264deefc0), style = RrType.fieldLabel, color = RrTheme.colors.ink2)
        Column {
            RrChoiceRow(stringResource(S.string.none), value.letterId == null, { onChange(value.copy(letterId = null)) })
            letters.forEach { doc -> RrChoiceRow(doc.name, value.letterId == doc.id, { onChange(value.copy(letterId = doc.id)) }) }
        }
    }
}
