// W1 · Fit: each posting requirement against the evidence in the resume and Knowledge. A count with words, never a score.
package me.rxresu.feature.workspace

import me.rxresu.core.navigation.Application
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.data.approvedFor
import me.rxresu.core.designsystem.R as DsR
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrCard
import me.rxresu.core.designsystem.RrEvidence
import me.rxresu.core.designsystem.RrEvidencePill
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.Assistant
import me.rxresu.core.navigation.Knowledge
import me.rxresu.core.navigation.KnowledgeTab
import me.rxresu.core.navigation.NewDocument
import me.rxresu.core.navigation.SettingsAi
import me.rxresu.core.navigation.Story
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.generated.CreateCareerOfferResponseDataFitKind
import me.rxresu.core.network.generated.CreateCareerOfferResponseDataFitRequirementsItem
import me.rxresu.core.network.generated.CreateCareerOfferResponseDataFitRequirementsItemOrigin
import me.rxresu.core.network.generated.CreateCareerOfferResponseDataFitRequirementsItemStatus
import me.rxresu.core.network.generated.FitResult
import me.rxresu.core.network.generated.GenerateCareerWorkRequest
import me.rxresu.core.network.generated.GenerateCareerWorkRequestTaskFit
import me.rxresu.core.strings.R as S

internal data class FitState(
    val context: WorkspaceContext,
    val fit: FitResult?,
    /** False when Knowledge and the linked resume hold nothing to check against. */
    val evidenceUsable: Boolean,
    /** Fact id → text, for "see all sources". */
    val facts: Map<String, String>,
    val running: Boolean = false,
    val failed: Boolean = false,
)

/** One-shot outcomes the screen answers with a haptic while it's visible. */
internal enum class Outcome { Success, Error }

internal class FitViewModel(private val repos: RrRepositories, private val id: String) : ViewModel() {
    val state = MutableStateFlow<Load<FitState>>(Load.Loading)
    private val outcomes = Channel<Outcome>(Channel.BUFFERED)
    val outcome = outcomes.receiveAsFlow()
    private var job: Job? = null

    init { load() }

    fun load() {
        state.value = Load.Loading
        fetch()
    }

    /** Reload after returning to the tab (a fact added), keeping what shows meanwhile; never during a check. */
    fun refresh() { if (job?.isActive != true) fetch() }

    private fun fetch() {
        viewModelScope.launch {
            state.value = runCatching {
                val context = repos.workspaceContext(id)
                val usable = runCatching { repos.workspace.getCareerFitEvidence(id).usable }.getOrDefault(true)
                val facts = runCatching { repos.workspace.listCareerFacts(applicationId = id) }.getOrDefault(emptyList()).associate { it.id to it.text }
                FitState(context, context.saved.latest<FitResult>()?.second, usable, facts)
            }.fold({ Load.Ready(it) }, { Load.Failed(it.isOffline()) })
        }
    }

    fun check(locale: Locale) {
        val before = (state.value as? Load.Ready)?.value ?: return
        val provider = before.context.provider ?: return
        if (job?.isActive == true) return
        edit { it.copy(running = true, failed = false) }
        job = viewModelScope.launch {
            try {
                val item = repos.workspace.generateCareerWork(
                    GenerateCareerWorkRequest(id, locale.toLanguageTag(), GenerateCareerWorkRequestTaskFit(CreateCareerOfferResponseDataFitKind.Fit)),
                    RequestOptions().approvedFor(provider),
                ).item
                val fit = item?.data as? FitResult ?: error("No fit result")
                edit { it.copy(fit = fit, running = false) }
                outcomes.send(Outcome.Success)
            } catch (e: CancellationException) {
                edit { it.copy(running = false) }
                throw e
            } catch (e: Exception) {
                if (e.destinationChanged()) {
                    val context = repos.renewAiDisclosure(before.context)
                    edit { it.copy(context = context) }
                }
                edit { it.copy(running = false, failed = true) }
                outcomes.send(Outcome.Error)
            }
        }
    }

    fun stop() { job?.cancel() }

    private fun edit(change: (FitState) -> FitState) = state.update { if (it is Load.Ready) Load.Ready(change(it.value)) else it }
}

@Composable
internal fun FitTab(applicationId: String, nav: NavController) {
    val repos = LocalRepositories.current
    val vm = viewModel(key = "fit-$applicationId") { FitViewModel(repos, applicationId) }
    val load by vm.state.collectAsStateWithLifecycle()
    val haptics = rememberRrHaptics()
    LaunchedEffect(vm) { vm.outcome.collect { haptics(if (it == Outcome.Success) RrHaptic.Success else RrHaptic.Error) } }
    val locale = androidx.compose.ui.platform.LocalConfiguration.current.locales[0]
    val res = androidx.compose.ui.platform.LocalResources.current
    Loaded(load, vm::load, onResume = vm::refresh) { state ->
        FitScreen(
            state,
            onCheck = { vm.check(locale) },
            onStop = vm::stop,
            onAddFact = { nav.navigate(Knowledge(KnowledgeTab.Facts)) },
            onWriteStory = { nav.navigate(Story()) },
            // W1: the linked resume opens the assistant with the tailoring prompt; without one, copy a resume for this job.
            onTailor = {
                val app = state.context.app
                nav.navigate(app.resumeId?.let { Assistant(it, prompt = res.getString(S.string.tailor_to_the_company_posting, app.company)) } ?: NewDocument(copyForApplicationId = applicationId))
            },
            onSetUpAi = { nav.navigate(SettingsAi) },
            // The posting sheet lives on Overview: replace this entry with Overview and the sheet open.
            onAddPosting = { nav.navigate(Application(applicationId, posting = true)) { popUpTo<Application> { inclusive = true } } },
        )
    }
}

@Composable
internal fun FitScreen(
    state: FitState,
    onCheck: () -> Unit,
    onStop: () -> Unit,
    onAddFact: () -> Unit,
    onWriteStory: () -> Unit,
    onTailor: () -> Unit,
    onSetUpAi: () -> Unit,
    onAddPosting: () -> Unit = {},
) {
    val c = RrTheme.colors
    val app = state.context.app
    val fit = state.fit
    var sources by remember { mutableStateOf<CreateCareerOfferResponseDataFitRequirementsItem?>(null) }
    TabBody(
        footer = if (fit != null) {
            {
                RrButton(stringResource(S.string.tailor_resume_for_this_job), onTailor, Modifier.fillMaxWidth(), size = RrButtonSize.Large, icon = DsR.drawable.ic_ph_sparkle)
            }
        } else null,
    ) {
        AiDestinationNotice(state.context)
        if (fit != null) {
            FadeUp {
                Column {
                    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        RrText(fit.headline, style = RrType.sheetTitle, color = c.ink)
                        RrText(fit.summary, style = RrType.small, color = c.ink3)
                    }
                    val groups = fit.requirements.groupBy { it.origin == CreateCareerOfferResponseDataFitRequirementsItemOrigin.Inferred }
                    groups[false]?.let { Requirements(stringResource(S.string.posting), it, onAddFact, onWriteStory) { r -> sources = r } }
                    groups[true]?.let { Requirements(stringResource(S.string.inferred), it, onAddFact, onWriteStory) { r -> sources = r } }
                    // The board's "··· → Check again" lives in the frame's menu on the web; here it closes the list.
                    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (state.running) Working(FitSteps, onStop)
                        else if (state.context.provider != null) RrButton(stringResource(S.string.check_again), onCheck, variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Small, icon = DsR.drawable.ic_ph_arrow_clockwise)
                        if (state.failed) FitFailed(onCheck)
                    }
                }
            }
        } else {
            FirstRun(state, onCheck, onStop, onAddFact, onSetUpAi, onAddPosting)
        }
    }
    sources?.let { requirement ->
        WindowSheet({ sources = null }, stringResource(S.string.sources), fitContent = true) {
            RrText(requirement.text, style = RrType.label, color = c.ink)
            RrText(requirement.evidence, style = RrType.small, color = c.ink2)
            val cited = requirement.factIds.orEmpty().mapNotNull { state.facts[it] }
            if (cited.isNotEmpty()) {
                RrText(stringResource(S.string.supporting_knowledge_facts_and_stories), style = RrType.eyebrow, color = c.ink3)
                me.rxresu.core.designsystem.RrListGroup { cited.forEach { RrListRow(it, icon = DsR.drawable.ic_ph_quotes) } }
            }
        }
    }
}

private val FitSteps = listOf(S.string.reading_the_posting, S.string.matching_your_facts, S.string.weighing_each_requirement)

@Composable
private fun FitFailed(onRetry: () -> Unit) = RrCallout(
    stringResource(S.string.couldn_t_check_your_evidence),
    tone = RrTone.Danger,
    actionLabel = stringResource(S.string.retry),
    onAction = onRetry,
)

@Composable
private fun Requirements(
    title: String,
    items: List<CreateCareerOfferResponseDataFitRequirementsItem>,
    onAddFact: () -> Unit,
    onWriteStory: () -> Unit,
    onOpen: (CreateCareerOfferResponseDataFitRequirementsItem) -> Unit,
) {
    val c = RrTheme.colors
    Eyebrow(title)
    Group {
        items.forEach { r ->
            Column(
                Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = stringResource(S.string.sources)) { onOpen(r) }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    RrText(r.text, Modifier.weight(1f), style = RrType.label, color = c.ink)
                    EvidencePill(r.status)
                }
                val quoted = r.status == CreateCareerOfferResponseDataFitRequirementsItemStatus.Supported && !r.factIds.isNullOrEmpty()
                if (r.evidence.isNotBlank()) RrText(if (quoted) "“${r.evidence}”" else r.evidence, style = RrType.small, color = c.ink2)
                if (r.status == CreateCareerOfferResponseDataFitRequirementsItemStatus.Missing) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        RrButton(stringResource(S.string.add_a_fact), onAddFact, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
                        RrButton(stringResource(R.string.workspace_write_a_story), onWriteStory, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small)
                    }
                }
            }
        }
    }
}

@Composable
private fun EvidencePill(status: CreateCareerOfferResponseDataFitRequirementsItemStatus) = when (status) {
    CreateCareerOfferResponseDataFitRequirementsItemStatus.Supported -> RrEvidencePill(RrEvidence.Supported, stringResource(S.string.supported))
    CreateCareerOfferResponseDataFitRequirementsItemStatus.Partial -> RrEvidencePill(RrEvidence.Partial, stringResource(S.string.partly_supported))
    else -> RrEvidencePill(RrEvidence.Missing, stringResource(S.string.no_evidence_yet))
}

@Composable
private fun FirstRun(state: FitState, onCheck: () -> Unit, onStop: () -> Unit, onAddFact: () -> Unit, onSetUpAi: () -> Unit, onAddPosting: () -> Unit) {
    val c = RrTheme.colors
    val app = state.context.app
    val provider = state.context.provider
    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when {
            app.jobDescription.isNullOrBlank() && app.requirements.isEmpty() ->
                RrCallout(stringResource(R.string.workspace_no_posting_fit), actionLabel = stringResource(S.string.add_posting), onAction = onAddPosting)
            !state.evidenceUsable -> RrCallout(
                stringResource(S.string.fit_needs_evidence_add_facts_to_knowledge_or_choose_a_resume_to_link_before_sending_a_request),
                actionLabel = stringResource(S.string.add_facts),
                onAction = onAddFact,
            )
            provider == null -> RrCallout(
                stringResource(S.string.connect_an_ai_provider),
                actionLabel = stringResource(S.string.set_up_ai),
                onAction = onSetUpAi,
            )
            else -> RrCard(raised = true) {
                RrText(stringResource(S.string.check_this_role_against_your_evidence), style = RrType.label, color = c.ink)
                RrText(stringResource(S.string.each_requirement_in_the_posting_is_checked_against_the_facts_and_stories_in_your_knowledge_gaps_show), style = RrType.small, color = c.ink2)
                if (state.running) Working(FitSteps, onStop) else RrButton(stringResource(S.string.check_fit), onCheck, icon = DsR.drawable.ic_ph_sparkle)
                if (state.failed) FitFailed(onCheck)
            }
        }
    }
    // Without AI (or before the first check) the posting's requirements still show, without evidence pills.
    if (app.requirements.isNotEmpty()) {
        Eyebrow(stringResource(S.string.posting))
        Group { app.requirements.forEach { RrListRow(it) } }
    }
}
