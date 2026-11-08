// Debrief: right after the interview, write (or say) what they asked and what you answered; the coach separates what
// the evidence supports from observations, and proposes one thing to remember (Remember / Not now).
package me.rxresu.feature.workspace

import me.rxresu.core.navigation.SettingsAi
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import java.time.Instant
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
import me.rxresu.core.designsystem.RrBadge
import me.rxresu.core.designsystem.RrBadgeTone
import me.rxresu.core.designsystem.RrPickerField
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrPageTitle
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrCard
import me.rxresu.core.designsystem.RrFilterChip
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrRecordButton
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.UploadPart
import me.rxresu.core.network.generated.AddApplicationInterviewRequestKind
import me.rxresu.core.network.generated.CreateCareerOfferResponseDataDebriefKind
import me.rxresu.core.network.generated.CreateCareerOfferResponseDataDebriefLanded
import me.rxresu.core.network.generated.CreateCareerOfferResponseDataDebriefVerdictsItemTag
import me.rxresu.core.network.generated.Debrief
import me.rxresu.core.network.generated.ExportAccountDataResponseCareerFactsItemSourceKind
import me.rxresu.core.network.generated.GenerateCareerWorkRequest
import me.rxresu.core.network.generated.GenerateCareerWorkRequestTaskDebrief
import me.rxresu.core.network.generated.Interview
import me.rxresu.core.network.generated.SaveCareerFactRequest
import me.rxresu.core.network.generated.SaveCareerFactRequestCategory
import me.rxresu.core.network.generated.SaveCareerFactRequestSource
import me.rxresu.core.strings.R as S

internal data class DebriefState(
    val context: WorkspaceContext,
    val now: Instant,
    val interview: Interview?,
    val question: String = "",
    val answer: String = "",
    val landed: CreateCareerOfferResponseDataDebriefLanded? = null,
    val review: Pair<String, Debrief>? = null,
    val transcriber: Transcriber? = null,
    val transcribing: Boolean = false,
    val sending: Boolean = false,
    val notice: VoiceNotice? = null,
    val remembered: Boolean = false,
    val dismissed: Boolean = false,
)

internal class DebriefViewModel(private val repos: RrRepositories, private val id: String, recorder: VoiceRecorder, now: () -> Long) : ViewModel() {
    val state = MutableStateFlow<Load<DebriefState>>(Load.Loading)
    private val outcomes = Channel<VoiceOutcome>(Channel.BUFFERED)
    val outcome = outcomes.receiveAsFlow()
    private var job: Job? = null
    private var pending: ByteArray? = null
    val recording = Recording(viewModelScope, recorder, now) { take ->
        viewModelScope.launch { outcomes.send(if (take.atLimit) VoiceOutcome.Limit else VoiceOutcome.Stopped) }
        when (take) {
            is Take.Unusable -> edit { it.copy(notice = VoiceNotice.Unusable) }
            is Take.Audio -> { pending = take.bytes; edit { it.copy(notice = if (take.atLimit) VoiceNotice.AtLimit else null) }; transcribe() }
        }
    }

    init { load() }

    fun load() {
        viewModelScope.launch {
            state.value = runCatching {
                val context = repos.workspaceContext(id)
                val now = repos.time.now()
                val round = context.app.debriefRound(now)
                val saved = context.saved.firstOrNull { it.data is Debrief && (round == null || it.interviewId == null || it.interviewId == round.id) }
                DebriefState(context, now, round, review = saved?.let { it.id to it.data as Debrief }, transcriber = chooseTranscriber(context.providers))
            }.fold({ Load.Ready(it) }, { Load.Failed(it.isOffline()) })
        }
    }

    private fun edit(change: (DebriefState) -> DebriefState) = state.update { if (it is Load.Ready) Load.Ready(change(it.value)) else it }
    private fun ready() = (state.value as? Load.Ready)?.value

    fun setQuestion(text: String) = edit { it.copy(question = text) }
    fun setAnswer(text: String) = edit { it.copy(answer = text) }
    fun setLanded(value: CreateCareerOfferResponseDataDebriefLanded) = edit { it.copy(landed = value) }
    fun startOver() = edit { it.copy(review = null, question = "", answer = "", landed = null) }

    fun record() {
        edit { it.copy(notice = null) }
        if (recording.start()) viewModelScope.launch { outcomes.send(VoiceOutcome.Started) } else edit { it.copy(notice = VoiceNotice.StartFailed) }
    }

    fun stopRecording() = recording.stop()

    /** Dictation adds what was said to the answer field, which stays editable. */
    fun transcribe() {
        val bytes = pending ?: return
        val t = ready()?.transcriber ?: return
        edit { it.copy(transcribing = true) }
        job = viewModelScope.launch {
            try {
                val text = repos.workspace.transcribeCareerAnswer(t.providerId, t.model, id, UploadPart("audio", bytes, "answer.m4a", "audio/mp4"), t.approval()).text
                pending = null
                edit { s -> if (text.isBlank()) s.copy(transcribing = false, notice = VoiceNotice.NothingHeard) else s.copy(transcribing = false, answer = listOf(s.answer, text).filter { it.isNotBlank() }.joinToString("\n\n")) }
            } catch (e: CancellationException) {
                edit { it.copy(transcribing = false) }
                throw e
            } catch (e: Exception) {
                if (e.destinationChanged()) {
                    val current = ready()
                    if (current != null) {
                        val context = repos.renewAiDisclosure(current.context)
                        edit { it.copy(context = context, transcriber = chooseTranscriber(context.providers)) }
                    }
                }

                edit { it.copy(transcribing = false, notice = VoiceNotice.TranscribeFailed) }
            }
        }
    }

    fun review(locale: Locale) {
        val s = ready() ?: return
        val landed = s.landed ?: return
        val provider = s.context.provider ?: return
        if (s.question.isBlank() || s.answer.isBlank() || s.sending) return
        edit { it.copy(sending = true, notice = null) }
        job = viewModelScope.launch {
            try {
                val item = repos.workspace.generateCareerWork(
                    GenerateCareerWorkRequest(id, locale.toLanguageTag(), GenerateCareerWorkRequestTaskDebrief(s.answer, s.interview?.id, landed, s.question, CreateCareerOfferResponseDataDebriefKind.Debrief)),
                    RequestOptions().approvedFor(provider),
                ).item
                val debrief = item?.data as? Debrief ?: error("No debrief")
                edit { it.copy(sending = false, review = item.id to debrief) }
                outcomes.send(VoiceOutcome.Feedback)
            } catch (e: CancellationException) {
                edit { it.copy(sending = false) }
                throw e
            } catch (e: Exception) {
                if (e.destinationChanged()) {
                    val current = ready()
                    if (current != null) {
                        val context = repos.renewAiDisclosure(current.context)
                        edit { it.copy(context = context, transcriber = chooseTranscriber(context.providers)) }
                    }
                }

                edit { it.copy(sending = false, notice = VoiceNotice.FeedbackFailed) }
                outcomes.send(VoiceOutcome.Failed)
            }
        }
    }

    fun stop() { job?.cancel() }

    /** Saves the proposed fact to Knowledge, private to this application. */
    suspend fun remember(): Boolean {
        val (reviewId, debrief) = ready()?.review ?: return false
        val text = debrief.remember ?: return false
        return runCatching {
            repos.workspace.saveCareerFact(SaveCareerFactRequest(id, SaveCareerFactRequestCategory.Experience, SaveCareerFactRequestSource(reviewId, ExportAccountDataResponseCareerFactsItemSourceKind.Debrief, text), text))
            edit { it.copy(remembered = true) }
        }.isSuccess
    }

    fun notNow() = edit { it.copy(dismissed = true) }

    override fun onCleared() = recording.cancel()
}

@Composable
internal fun DebriefTab(applicationId: String, nav: NavController) {
    val repos = LocalRepositories.current
    val context: Context = LocalContext.current
    val vm = viewModel(key = "debrief-$applicationId") { DebriefViewModel(repos, applicationId, MediaVoiceRecorder(context.applicationContext), { android.os.SystemClock.elapsedRealtime() }) }
    val load by vm.state.collectAsStateWithLifecycle()
    val recording by vm.recording.state.collectAsStateWithLifecycle()
    val haptics = rememberRrHaptics()
    LaunchedEffect(vm) {
        vm.outcome.collect {
            haptics(when (it) { VoiceOutcome.Limit -> RrHaptic.Warning; VoiceOutcome.Feedback -> RrHaptic.Success; VoiceOutcome.Failed -> RrHaptic.Error; else -> RrHaptic.Light })
        }
    }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) vm.stopRecording() }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    val mic = rememberMicPermission(onGranted = vm::record)
    val locale = LocalConfiguration.current.locales[0]
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val toasts = me.rxresu.core.navigation.LocalToasts.current
    val saveFailed = stringResource(S.string.couldn_t_save_that_to_knowledge_try_again)
    Loaded(load, vm::load, onBack = { nav.popBackStack() }) { state ->
        WorkspaceFrame(onBack = { nav.popBackStack() }, onSettings = { nav.navigate(me.rxresu.core.navigation.SettingsAi) }) {
            DebriefScreen(
                state,
                recording,
                micDenied = mic.denied,
                dates = rememberDates(repos.time.timezone()),
                onQuestion = vm::setQuestion,
                onAnswer = vm::setAnswer,
                onLanded = vm::setLanded,
                onRecord = { if (recording.recording) vm.stopRecording() else mic.request() },
                onRetryTranscribe = vm::transcribe,
                onReview = { vm.review(locale) },
                onStop = vm::stop,
                onRemember = { scope.launch { if (!vm.remember()) toasts.show(saveFailed) } },
                onNotNow = vm::notNow,
                onStartOver = vm::startOver,
                onOpenPrepare = { nav.openTab(applicationId, WorkspaceTab.Prepare) },
                onSetUpAi = { nav.navigate(SettingsAi) },
            )
        }
    }
}

@Composable
internal fun DebriefScreen(
    state: DebriefState,
    recording: RecordingState,
    micDenied: Boolean,
    dates: Dates,
    onQuestion: (String) -> Unit,
    onAnswer: (String) -> Unit,
    onLanded: (CreateCareerOfferResponseDataDebriefLanded) -> Unit,
    onRecord: () -> Unit,
    onRetryTranscribe: () -> Unit,
    onReview: () -> Unit,
    onStop: () -> Unit,
    onRemember: () -> Unit,
    onNotNow: () -> Unit,
    onStartOver: () -> Unit,
    onOpenPrepare: () -> Unit,
    onSetUpAi: () -> Unit = {},
) {
    var landedPicker by remember { mutableStateOf(false) }
    val c = RrTheme.colors
    val interview = state.interview
    val before = interview != null && !interview.ended(state.now) && state.review == null
    val writing = !before && state.review == null
    TabBody(
        footer = if (writing && state.context.provider != null) {
            {
                if (state.sending) Working(listOf(S.string.reading_your_notes, S.string.checking_against_knowledge, S.string.planning_your_week), onStop)
                else RrButton(stringResource(S.string.review_my_answer), onReview, Modifier.fillMaxWidth(), size = RrButtonSize.Large, icon = DsR.drawable.ic_ph_sparkle, enabled = state.question.isNotBlank() && state.answer.isNotBlank() && state.landed != null)
            }
        } else null,
    ) {
        RrPageTitle(stringResource(S.string.debrief), subtitle = "${state.context.app.company} · ${state.context.app.role}", subtitleColor = c.ink3)
        AiDestinationNotice(state.context)
        Column(Modifier.padding(start = 24.dp, end = 24.dp, top = 24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            RrText(roundTitle(interview?.kind), style = RrType.sheetTitle, color = c.ink)
            when {
                before -> {
                    RrText(stringResource(S.string.write_this_after_your_interview_on_0, dates.day(Instant.parse(interview.at))), style = RrType.label, color = c.ink)
                    RrText(stringResource(S.string.until_then_interview_prep_has_your_plan_your_opening_and_the_questions_to_ask), style = RrType.small, color = c.ink2)
                    RrButton(stringResource(S.string.open_interview_prep), onOpenPrepare, variant = RrButtonVariant.Secondary)
                }
                state.review != null -> ReviewResult(state, onRemember, onNotNow, onStartOver)
                else -> {
                    RrText(stringResource(S.string.write_it_down_while_it_s_fresh), style = RrType.small, color = c.ink3)
                    RrTextField(state.question, onQuestion, label = stringResource(S.string.what_did_they_ask), singleLine = false)
                    RrTextField(state.answer, onAnswer, label = stringResource(S.string.what_did_you_say_as_close_as_you_remember), singleLine = false, minLines = 5)
                    if (state.transcriber != null && !micDenied) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            RrRecordButton(recording.recording, onRecord)
                            when {
                                state.transcribing -> me.rxresu.core.designsystem.RrWorkingLabel(listOf(stringResource(S.string.transcribing_with_model, state.transcriber.model)))
                                recording.recording -> RrText(stringResource(S.string.recording_elapsed, clock(recording.elapsedMs)), style = RrType.small, color = c.ink2)
                                else -> RrText(stringResource(S.string.up_to_2_minutes_2_mb_maximum), style = RrType.small, color = c.ink3)
                            }
                        }
                    }
                    if (micDenied) RrCallout(stringResource(S.string.allow_microphone_access_in_device_settings_or_type_your_answer))
                    Notice(state.notice, onRetryTranscribe)
                    val label = when (state.landed) {
                        CreateCareerOfferResponseDataDebriefLanded.Well -> S.string.went_well
                        CreateCareerOfferResponseDataDebriefLanded.Mixed -> S.string.mixed
                        CreateCareerOfferResponseDataDebriefLanded.Not -> S.string.didn_t_land
                        else -> S.string.choose
                    }
                    RrPickerField(stringResource(label), { landedPicker = true }, label = stringResource(S.string.how_did_it_land))
                    if (state.context.provider == null) RrCallout(stringResource(S.string.connect_an_ai_provider), actionLabel = stringResource(S.string.set_up_ai), onAction = onSetUpAi)
                }
            }
        }
    }
    if (landedPicker) WindowSheet({ landedPicker = false }, stringResource(S.string.how_did_it_land), fitContent = true) {
        listOf(CreateCareerOfferResponseDataDebriefLanded.Well to S.string.went_well, CreateCareerOfferResponseDataDebriefLanded.Mixed to S.string.mixed, CreateCareerOfferResponseDataDebriefLanded.Not to S.string.didn_t_land).forEach { (value, label) ->
            RrListRow(stringResource(label), onClick = { onLanded(value); landedPicker = false })
        }
    }

}

@Composable
private fun roundTitle(kind: AddApplicationInterviewRequestKind?) = stringResource(
    when (kind) {
        AddApplicationInterviewRequestKind.Screening -> S.string.after_the_screening
        AddApplicationInterviewRequestKind.Technical -> S.string.after_the_technical_interview
        AddApplicationInterviewRequestKind.Behavioral -> S.string.after_the_behavioral_interview
        AddApplicationInterviewRequestKind.Onsite -> S.string.after_the_onsite
        else -> S.string.after_the_interview
    },
)

@Composable
private fun ReviewResult(state: DebriefState, onRemember: () -> Unit, onNotNow: () -> Unit, onStartOver: () -> Unit) {
    val c = RrTheme.colors
    val debrief = state.review!!.second
    FadeUp {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            RrCard(raised = true) {
                RrText(debrief.title, style = RrType.label, color = c.ink)
                debrief.verdicts.forEach { v ->
                    val supported = v.tag == CreateCareerOfferResponseDataDebriefVerdictsItemTag.Supported
                    RrBadge(stringResource(if (supported) S.string.supported else S.string.observation), tone = if (supported) RrBadgeTone.Accent else RrBadgeTone.Warn)
                    RrText(v.text, style = RrType.ui, color = c.ink)
                }
                if (debrief.nextRound.isNotBlank()) LabeledText(stringResource(S.string.for_the_next_round), debrief.nextRound)
                if (debrief.priority.isNotBlank()) LabeledText(stringResource(S.string.practice_priority), debrief.priority)
            }
            val remember = debrief.remember
            if (remember != null && !state.dismissed) {
                if (state.remembered) RrCallout(stringResource(S.string.saved_to_knowledge_private_to_this_application), tone = RrTone.Accent, icon = DsR.drawable.ic_ph_check_circle)
                else {
                    RrCallout(remember, title = stringResource(S.string.remember_for_company_only, state.context.app.company), icon = DsR.drawable.ic_ph_book_bookmark)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        RrButton(stringResource(S.string.remember), onRemember, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
                        RrButton(stringResource(S.string.not_now), onNotNow, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small)
                    }
                }
            }
            RrButton(stringResource(S.string.start_a_debrief), onStartOver, variant = RrButtonVariant.Secondary)
        }
    }
}
