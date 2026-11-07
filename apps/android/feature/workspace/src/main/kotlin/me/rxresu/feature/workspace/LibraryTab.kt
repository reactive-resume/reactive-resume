// Library: earlier results kept for this job (fit checks, briefings, practice, debriefs, answers, replies, offers),
// newest first, opened read-only.
package me.rxresu.feature.workspace

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import java.time.Instant
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.designsystem.R as DsR
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrEmptyState
import me.rxresu.core.designsystem.RrFilterChip
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrRowCaret
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.Offers
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.network.generated.AnswersData
import me.rxresu.core.network.generated.Briefing
import me.rxresu.core.network.generated.Debrief
import me.rxresu.core.network.generated.FitResult
import me.rxresu.core.network.generated.MessageDraft
import me.rxresu.core.network.generated.Offer
import me.rxresu.core.network.generated.PracticeAttempt
import me.rxresu.core.network.generated.SavedData
import me.rxresu.core.network.generated.SavedItem
import me.rxresu.core.strings.R as S

/** Library kinds, each with its label and the tab it opens in (null: Career → Offers). */
internal enum class LibraryKind(val label: Int, val tab: WorkspaceTab?, val icon: Int) {
    Fit(S.string.application_workspace_tab_how_well_a_job_fits_your_experience_fit, WorkspaceTab.Fit, DsR.drawable.ic_ph_target),
    Briefing(S.string.briefing, WorkspaceTab.Prepare, DsR.drawable.ic_ph_book_open),
    Practice(S.string.application_workspace_tab_rehearse_interview_answers_practice, WorkspaceTab.Practise, DsR.drawable.ic_ph_microphone),
    Debrief(S.string.debrief, WorkspaceTab.Debrief, DsR.drawable.ic_ph_note),
    Answers(S.string.answers, WorkspaceTab.Apply, DsR.drawable.ic_ph_list_checks),
    Reply(S.string.reply, WorkspaceTab.Messages, DsR.drawable.ic_ph_envelope_simple),
    Offer(S.string.offer, null, DsR.drawable.ic_ph_scales),
    ;

    companion object {
        fun of(data: SavedData): LibraryKind? = when (data) {
            is FitResult -> Fit
            is me.rxresu.core.network.generated.Briefing -> Briefing
            is PracticeAttempt -> Practice
            is me.rxresu.core.network.generated.Debrief -> Debrief
            is AnswersData -> Answers
            is MessageDraft -> Reply
            is me.rxresu.core.network.generated.Offer -> Offer
            else -> null
        }
    }
}

internal data class LibraryState(val context: WorkspaceContext, val filter: LibraryKind? = null) {
    val items get() = context.saved.filter { item -> LibraryKind.of(item.data)?.let { filter == null || it == filter } == true }
    val kinds get() = context.saved.mapNotNull { LibraryKind.of(it.data) }.distinct().sortedBy { it.ordinal }
}

internal class LibraryViewModel(private val repos: RrRepositories, private val id: String) : ViewModel() {
    val state = MutableStateFlow<Load<LibraryState>>(Load.Loading)

    init { load() }

    fun load() {
        viewModelScope.launch { state.value = runCatching { LibraryState(repos.workspaceContext(id)) }.fold({ Load.Ready(it) }, { Load.Failed(it.isOffline()) }) }
    }

    fun filter(kind: LibraryKind?) = state.update { if (it is Load.Ready) Load.Ready(it.value.copy(filter = kind)) else it }

    suspend fun delete(item: SavedItem): Boolean = runCatching {
        repos.workspace.deleteCareerSavedItem(item.id)
        state.update { if (it is Load.Ready) Load.Ready(it.value.copy(context = it.value.context.copy(saved = it.value.context.saved - item))) else it }
    }.isSuccess
}

@Composable
internal fun LibraryTab(applicationId: String, nav: NavController) {
    val repos = LocalRepositories.current
    val vm = viewModel(key = "library-$applicationId") { LibraryViewModel(repos, applicationId) }
    val load by vm.state.collectAsStateWithLifecycle()
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()
    val deleted = stringResource(S.string.deleted_from_library)
    val failed = stringResource(S.string.couldn_t_complete_this_action_try_again)
    Loaded(load, vm::load) { state ->
        LibraryScreen(
            state,
            dates = rememberDates(repos.time.timezone()),
            onFilter = vm::filter,
            onOpenTab = { kind -> if (kind.tab == null) nav.navigate(Offers) else nav.openTab(applicationId, kind.tab) },
            onDelete = { item -> scope.launch { toasts.show(if (vm.delete(item)) deleted else failed) } },
            onCheckFit = { nav.openTab(applicationId, WorkspaceTab.Fit) },
        )
    }
}

@Composable
internal fun LibraryScreen(
    state: LibraryState,
    dates: Dates,
    onFilter: (LibraryKind?) -> Unit,
    onOpenTab: (LibraryKind) -> Unit,
    onDelete: (SavedItem) -> Unit,
    onCheckFit: () -> Unit,
) {
    val c = RrTheme.colors
    var open by remember { mutableStateOf<SavedItem?>(null) }
    TabBody {
        if (state.context.saved.none { LibraryKind.of(it.data) != null }) {
            Column(Modifier.padding(16.dp)) {
                RrEmptyState(
                    stringResource(S.string.nothing_in_your_library_yet),
                    stringResource(S.string.fit_checks_briefings_practice_feedback_debriefs_answers_replies_and_offers_land_here_as_you_save_the),
                    actionLabel = stringResource(S.string.check_fit),
                    onAction = onCheckFit,
                )
            }
            return@TabBody
        }
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            RrText(stringResource(S.string.library_items_for_company_newest_first, state.context.app.company), style = RrType.small, color = c.ink3)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                RrFilterChip(stringResource(S.string.all), state.filter == null, { onFilter(null) })
                state.kinds.forEach { kind -> RrFilterChip(stringResource(kind.label), state.filter == kind, { onFilter(kind) }) }
            }
        }
        Column(Modifier.padding(top = 12.dp)) {
            Group {
                state.items.forEach { item ->
                    val kind = LibraryKind.of(item.data)!!
                    val at = Instant.parse(item.createdAt)
                    RrListRow(
                        item.title,
                        subtitle = "${stringResource(kind.label)} · ${dates.day(at)}, ${dates.time(at)}",
                        icon = kind.icon,
                        onClick = { open = item },
                        trailing = { RrRowCaret() },
                    )
                }
            }
        }
    }
    open?.let { item ->
        val kind = LibraryKind.of(item.data)!!
        WindowSheet(
            { open = null },
            item.title,
            footer = {
                Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RrButton(stringResource(S.string.delete), { onDelete(item); open = null }, variant = RrButtonVariant.DangerGhost)
                    RrButton(
                        if (kind.tab == null) stringResource(S.string.open_in_offers) else stringResource(S.string.open_in_tabname, stringResource(kind.label)),
                        { open = null; onOpenTab(kind) },
                        Modifier.weight(1f),
                    )
                }
            },
        ) {
            SavedBody(item.data)
        }
    }
}

/** A saved result, read-only. */
@Composable
private fun SavedBody(data: SavedData) {
    val c = RrTheme.colors
    when (data) {
        is FitResult -> {
            val n = { s: me.rxresu.core.network.generated.CreateCareerOfferResponseDataFitRequirementsItemStatus -> data.requirements.count { it.status == s } }
            RrText(
                stringResource(S.string.supported_supported_partial_partly_supported_missing_with_no_evidence_yet_summary, n(me.rxresu.core.network.generated.CreateCareerOfferResponseDataFitRequirementsItemStatus.Supported).toString(), n(me.rxresu.core.network.generated.CreateCareerOfferResponseDataFitRequirementsItemStatus.Partial).toString(), n(me.rxresu.core.network.generated.CreateCareerOfferResponseDataFitRequirementsItemStatus.Missing).toString(), data.summary),
                style = RrType.body, color = c.ink,
            )
            data.requirements.forEach { LabeledText(it.text, it.evidence) }
        }
        is Briefing -> {
            RrText(data.summary, style = RrType.body, color = c.ink)
            data.plan.forEach { LabeledText(it.title, it.detail) }
        }
        is PracticeAttempt -> {
            LabeledText(stringResource(S.string.question), data.question)
            LabeledText(stringResource(S.string.what_works), data.works)
            LabeledText(stringResource(S.string.strengthen), data.strengthen)
            LabeledText(stringResource(S.string.your_answer), data.answer)
        }
        is Debrief -> {
            LabeledText(data.question, data.answer)
            LabeledText(stringResource(S.string.for_the_next_round), data.nextRound)
            LabeledText(stringResource(S.string.practice_priority), data.priority)
        }
        is AnswersData -> data.answers.forEach { LabeledText(it.question, it.answer) }
        is MessageDraft -> RrText(data.reply, style = RrType.body, color = c.ink)
        is Offer -> RrText(stringResource(S.string.open_in_offers), style = RrType.small, color = c.ink3)
        else -> Unit
    }
}
