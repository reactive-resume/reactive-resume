// W3 · Interview prep: the round's briefing, made to be read on the way: title, countdown, short sections, one action.
package me.rxresu.feature.workspace

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import java.time.Instant
import java.time.temporal.ChronoUnit
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
import me.rxresu.core.designsystem.R as DsR
import me.rxresu.core.designsystem.RrBadge
import me.rxresu.core.designsystem.RrBadgeTone
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrCard
import me.rxresu.core.designsystem.RrDisclosureLine
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.RrUsedChip
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.InterviewSheet
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.SettingsAi
import me.rxresu.core.navigation.Story
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.network.generated.Briefing
import me.rxresu.core.network.generated.CreateCareerOfferResponseDataBriefingKind
import me.rxresu.core.network.generated.CreateCareerOfferResponseDataBriefingPlanItemAction
import me.rxresu.core.network.generated.GenerateCareerWorkRequest
import me.rxresu.core.network.generated.GenerateCareerWorkRequestTaskBriefing
import me.rxresu.core.network.generated.Interview
import me.rxresu.core.strings.R as S

internal data class PrepareState(
    val context: WorkspaceContext,
    val now: Instant,
    val interview: Interview?,
    val briefing: Briefing?,
    val briefingAt: Instant?,
    val running: Boolean = false,
    val failed: Boolean = false,
)

internal class PrepareViewModel(private val repos: RrRepositories, private val id: String) : ViewModel() {
    val state = MutableStateFlow<Load<PrepareState>>(Load.Loading)
    private val outcomes = Channel<Outcome>(Channel.BUFFERED)
    val outcome = outcomes.receiveAsFlow()
    private var job: Job? = null

    init { load() }

    fun load() {
        viewModelScope.launch {
            state.value = runCatching {
                val context = repos.workspaceContext(id)
                val now = repos.time.now()
                val interview = context.app.currentInterview(now) ?: context.app.interviews().lastOrNull()
                val saved = interview?.let { context.saved.latest<Briefing>(it.id) }
                PrepareState(context, now, interview, saved?.second, saved?.first?.createdAt?.let(Instant::parse))
            }.fold({ Load.Ready(it) }, { Load.Failed(it.isOffline()) })
        }
    }

    fun generate(locale: Locale) {
        val interview = (state.value as? Load.Ready)?.value?.interview ?: return
        if (job?.isActive == true) return
        edit { it.copy(running = true, failed = false) }
        job = viewModelScope.launch {
            try {
                val item = repos.workspace.generateCareerWork(
                    GenerateCareerWorkRequest(id, locale.toLanguageTag(), GenerateCareerWorkRequestTaskBriefing(interview.id, CreateCareerOfferResponseDataBriefingKind.Briefing)),
                ).item
                val briefing = item?.data as? Briefing ?: error("No briefing")
                edit { it.copy(briefing = briefing, briefingAt = Instant.parse(item.createdAt), running = false) }
                outcomes.send(Outcome.Success)
            } catch (e: CancellationException) {
                edit { it.copy(running = false) }
                throw e
            } catch (_: Exception) {
                edit { it.copy(running = false, failed = true) }
                outcomes.send(Outcome.Error)
            }
        }
    }

    fun stop() { job?.cancel() }

    private fun edit(change: (PrepareState) -> PrepareState) = state.update { if (it is Load.Ready) Load.Ready(change(it.value)) else it }
}

/**
 * The question a Practice button hands to the Practice tab, by application.
 * ponytail: process-wide map; a route argument on `Application` would survive process death (lead request).
 */
internal object PracticeHandoff {
    val question = mutableMapOf<String, String>()
}

@Composable
internal fun PrepareTab(applicationId: String, nav: NavController) {
    val repos = LocalRepositories.current
    val vm = viewModel(key = "prepare-$applicationId") { PrepareViewModel(repos, applicationId) }
    val load by vm.state.collectAsStateWithLifecycle()
    val haptics = rememberRrHaptics()
    LaunchedEffect(vm) { vm.outcome.collect { haptics(if (it == Outcome.Success) RrHaptic.Success else RrHaptic.Error) } }
    val locale = LocalConfiguration.current.locales[0]
    val context = LocalContext.current
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()
    val copied = stringResource(R.string.workspace_question_copied)
    Loaded(load, vm::load) { state ->
        PrepareScreen(
            state,
            dates = rememberDates(repos.time.timezone()),
            onGenerate = { vm.generate(locale) },
            onStop = vm::stop,
            onPractise = { question ->
                if (question != null) PracticeHandoff.question[applicationId] = question
                nav.openTab(applicationId, WorkspaceTab.Practise)
            },
            onAddStory = { nav.navigate(Story()) },
            onCopyQuestion = {
                context.copyToClipboard(it, it)
                scope.launch { toasts.show(copied) }
            },
            onAddInterview = { nav.navigate(InterviewSheet(applicationId)) },
            onDebrief = { nav.openTab(applicationId, WorkspaceTab.Debrief) },
            onSetUpAi = { nav.navigate(SettingsAi) },
        )
    }
}

@Composable
internal fun PrepareScreen(
    state: PrepareState,
    dates: Dates,
    onGenerate: () -> Unit,
    onStop: () -> Unit,
    onPractise: (String?) -> Unit,
    onAddStory: () -> Unit,
    onCopyQuestion: (String) -> Unit,
    onAddInterview: () -> Unit,
    onDebrief: () -> Unit,
    onSetUpAi: () -> Unit,
) {
    val c = RrTheme.colors
    val interview = state.interview
    val briefing = state.briefing
    val showBriefing = interview != null && !interview.ended(state.now) && briefing != null
    TabBody(
        footer = if (showBriefing) {
            { RrButton(stringResource(R.string.workspace_practice_these_questions), { onPractise(null) }, Modifier.fillMaxWidth(), size = RrButtonSize.Large, icon = DsR.drawable.ic_ph_microphone) }
        } else null,
    ) {
        when {
            interview == null -> Prompt(stringResource(S.string.add_an_interview_to_plan_for_it), stringResource(S.string.once_a_round_is_scheduled_interview_prep_builds_a_timed_plan_your_opening_and_the_questions_to_ask), stringResource(S.string.add_an_interview), onAddInterview)
            interview.ended(state.now) -> Prompt(stringResource(S.string.how_did_it_go), stringResource(S.string.write_down_what_they_asked_while_it_s_fresh_the_coach_compares_your_answers_with_your_stories), stringResource(S.string.start_a_debrief), onDebrief)
            briefing == null -> Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp)) {
                val provider = state.context.provider
                RrCard(raised = true) {
                    RrText(stringResource(R.string.workspace_prepare_for, state.context.app.company), style = RrType.label, color = c.ink)
                    RrText(stringResource(S.string.a_timed_plan_your_opening_the_stories_to_bring_and_questions_to_ask_it_becomes_your_checklist_10_min), style = RrType.small, color = c.ink2)
                    if (provider == null) {
                        RrButton(stringResource(S.string.set_up_ai), onSetUpAi, variant = RrButtonVariant.Secondary)
                    } else {
                        RrDisclosureLine(sendsLine(provider, S.string.the_interview_details, S.string.this_posting, S.string.enabled_knowledge))
                        if (state.running) Working(BriefingSteps, onStop) else RrButton(stringResource(S.string.generate_briefing_now), onGenerate, icon = DsR.drawable.ic_ph_sparkle)
                    }
                    if (state.failed) RrCallout(stringResource(S.string.couldn_t_complete_this_action_try_again), tone = RrTone.Danger, actionLabel = stringResource(S.string.retry), onAction = onGenerate)
                }
            }
            else -> FadeUp { BriefingBody(state, interview, briefing, dates, onPractise, onAddStory, onCopyQuestion) }
        }
    }
}

private val BriefingSteps = listOf(S.string.picking_your_stories, S.string.timing_the_plan, S.string.drafting_questions)

@Composable
private fun Prompt(title: String, body: String, action: String, onAction: () -> Unit) {
    val c = RrTheme.colors
    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp)) {
        RrCard(raised = true) {
            RrText(title, style = RrType.label, color = c.ink)
            RrText(body, style = RrType.small, color = c.ink2)
            RrButton(action, onAction, variant = RrButtonVariant.Secondary)
        }
    }
}

@Composable
private fun BriefingBody(
    state: PrepareState,
    interview: Interview,
    briefing: Briefing,
    dates: Dates,
    onPractise: (String?) -> Unit,
    onAddStory: () -> Unit,
    onCopyQuestion: (String) -> Unit,
) {
    val c = RrTheme.colors
    Column {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            RrText(briefing.headline, style = RrType.sheetTitle, color = c.ink)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                val days = ChronoUnit.DAYS.between(dates.date(state.now), dates.date(Instant.parse(interview.at)))
                RrBadge(
                    when (days) {
                        0L -> stringResource(S.string.today)
                        1L -> stringResource(S.string.tomorrow)
                        else -> pluralStringResource(R.plurals.workspace_in_days, days.toInt(), days.toInt())
                    },
                    tone = RrBadgeTone.Accent,
                )
                state.briefingAt?.let { at ->
                    val day = if (dates.date(at) == dates.date(state.now)) stringResource(S.string.today).lowercase(dates.locale) else dates.day(at)
                    RrText(stringResource(R.string.workspace_briefing_made, "$day ${dates.time(at)}"), style = RrType.small, color = c.ink3)
                }
            }
        }
        Eyebrow(stringResource(R.string.workspace_company_brief))
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Bullets(briefing.summary.split(Regex("(?<=[.!?])\\s+")).filter { it.isNotBlank() })
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                RrUsedChip(stringResource(S.string.posting), DsR.drawable.ic_ph_clipboard_text)
            }
        }
        val questions = briefing.plan.filter { it.action != CreateCareerOfferResponseDataBriefingPlanItemAction.None && it.action != CreateCareerOfferResponseDataBriefingPlanItemAction.Questions }
        if (questions.isNotEmpty()) {
            Eyebrow(stringResource(R.string.workspace_likely_questions))
            Group {
                questions.forEach { item ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            RrText(item.title, style = RrType.ui, color = c.ink)
                            val missing = item.action == CreateCareerOfferResponseDataBriefingPlanItemAction.DraftStory
                            RrText(
                                item.detail,
                                Modifier.then(if (missing) Modifier.clickable(role = Role.Button, onClick = onAddStory) else Modifier),
                                style = RrType.small,
                                color = if (missing) c.warnText else c.ink3,
                            )
                        }
                        RrButton(stringResource(S.string.application_workspace_tab_rehearse_interview_answers_practice), { onPractise(item.title) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small, icon = DsR.drawable.ic_ph_microphone)
                    }
                }
            }
        }
        if (briefing.questions.isNotEmpty()) {
            Eyebrow(stringResource(R.string.workspace_questions_to_ask_them))
            Column(Modifier.padding(horizontal = 16.dp)) { Bullets(briefing.questions.map { it.text }, onCopyQuestion) }
        }
    }
}

/** A short bulleted list (14/20, 18 dp indent). Tapping an item copies it when [onTap] is set. */
@Composable
private fun Bullets(items: List<String>, onTap: ((String) -> Unit)? = null) {
    val c = RrTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items.forEach { text ->
            Row(
                Modifier.fillMaxWidth().then(if (onTap != null) Modifier.clickable(role = Role.Button, onClickLabel = stringResource(S.string.copy)) { onTap(text) } else Modifier),
            ) {
                RrText("•", Modifier.widthIn(min = 18.dp), style = RrType.ui, color = c.ink)
                RrText(text, Modifier.weight(1f), style = RrType.ui, color = c.ink)
            }
        }
    }
}
