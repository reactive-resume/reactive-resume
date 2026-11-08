// W4 · Practice: the question large, a live waveform, a timer against 2:00 and one big record control. Spoken or
// typed; feedback per attempt; attempts newest first in a sheet from the bottom row.
package me.rxresu.feature.workspace

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavController
import androidx.navigation.toRoute
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
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrCard
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrRecordButton
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.RrWaveform
import me.rxresu.core.designsystem.RrWorkingLabel
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.Application as ApplicationRoute
import me.rxresu.core.navigation.SettingsAi
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.UploadPart
import me.rxresu.core.network.generated.Briefing
import me.rxresu.core.network.generated.CreateCareerOfferResponseDataPracticeKind
import me.rxresu.core.network.generated.CreateCareerOfferResponseDataPracticeMode
import me.rxresu.core.network.generated.CreateCareerOfferResponseDataPracticeOrigin
import me.rxresu.core.network.generated.GenerateCareerWorkRequest
import me.rxresu.core.network.generated.GenerateCareerWorkRequestTaskPractice
import me.rxresu.core.network.generated.Interview
import me.rxresu.core.network.generated.PracticeAttempt
import me.rxresu.core.strings.R as S

/** Where the answer stands. */
internal sealed interface AnswerPhase {
    data object Idle : AnswerPhase
    data object Transcribing : AnswerPhase
    /** The answer to send for feedback: transcribed (spoken, with its length) or typed. */
    data class Review(val text: String, val mode: CreateCareerOfferResponseDataPracticeMode, val spokenMs: Long? = null) : AnswerPhase
    data class Feedback(val attempt: PracticeAttempt) : AnswerPhase
}

/** Notices under the record control; each maps to the web's copy. */
internal enum class VoiceNotice { AtLimit, Unusable, NothingHeard, TranscribeFailed, StartFailed, FeedbackFailed }

internal data class PractiseState(
    val context: WorkspaceContext,
    val interview: Interview?,
    val questions: List<String>,
    val index: Int,
    /** Question → story to use. */
    val stories: Map<String, String>,
    val storyIds: Map<String, String>,
    val transcriber: Transcriber?,
    val attempts: List<Pair<Instant, PracticeAttempt>>,
    val phase: AnswerPhase = AnswerPhase.Idle,
    val typing: Boolean = false,
    val notice: VoiceNotice? = null,
    val sending: Boolean = false,
) {
    val question get() = questions[index]
}

/** Haptic outcomes: success when feedback arrives, warning at the 2-minute limit, light on start and stop. */
internal enum class VoiceOutcome { Started, Stopped, Limit, Feedback, Failed }

internal class PractiseViewModel(
    private val repos: RrRepositories,
    private val id: String,
    /** Questions when the briefing has none (from the catalog, with the company filled in). */
    private val fallbackQuestions: (company: String) -> List<String>,
    recorder: VoiceRecorder,
    now: () -> Long,
    /** The question Interview prep handed over (the route's `practiceQuestion`), asked first. */
    private val handed: String? = null,
) : ViewModel() {
    val state = MutableStateFlow<Load<PractiseState>>(Load.Loading)
    private val outcomes = Channel<VoiceOutcome>(Channel.BUFFERED)
    val outcome = outcomes.receiveAsFlow()
    private var spokenMs = 0L
    private var pending: ByteArray? = null
    private var job: Job? = null
    val recording = Recording(viewModelScope, recorder, now) { take -> onTake(take) }

    init { load() }

    fun load() {
        viewModelScope.launch {
            state.value = runCatching {
                val context = repos.workspaceContext(id)
                val interview = context.app.currentInterview(repos.time.now())
                val briefing = context.saved.latest<Briefing>(interview?.id)?.second ?: context.saved.latest<Briefing>()?.second
                val storyTitles = runCatching { repos.workspace.listCareerStories() }.getOrDefault(emptyList()).associate { it.id to it.data.title }
                val fromPlan = briefing?.plan.orEmpty().filter { it.storyId != null }.associate { it.title to it.storyId!! }
                var questions = briefing?.practiceQuestions?.takeIf { it.isNotEmpty() } ?: fallbackQuestions(context.app.company)
                if (handed != null && handed !in questions) questions = listOf(handed) + questions
                PractiseState(
                    context, interview, questions, questions.indexOf(handed).coerceAtLeast(0),
                    fromPlan.mapNotNull { (q, sid) -> storyTitles[sid]?.let { q to it } }.toMap(), fromPlan,
                    chooseTranscriber(context.providers),
                    context.saved.mapNotNull { item -> (item.data as? PracticeAttempt)?.let { Instant.parse(item.createdAt) to it } },
                )
            }.fold({ Load.Ready(it) }, { Load.Failed(it.isOffline()) })
        }
    }

    private fun edit(change: (PractiseState) -> PractiseState) = state.update { if (it is Load.Ready) Load.Ready(change(it.value)) else it }
    private fun ready() = (state.value as? Load.Ready)?.value

    fun record() {
        edit { it.copy(notice = null, phase = AnswerPhase.Idle) }
        if (recording.start()) viewModelScope.launch { outcomes.send(VoiceOutcome.Started) } else edit { it.copy(notice = VoiceNotice.StartFailed) }
    }

    fun stopRecording() = recording.stop()

    private fun onTake(take: Take) {
        spokenMs = recording.state.value.elapsedMs
        viewModelScope.launch { outcomes.send(if (take.atLimit) VoiceOutcome.Limit else VoiceOutcome.Stopped) }
        when (take) {
            is Take.Unusable -> edit { it.copy(notice = VoiceNotice.Unusable) }
            is Take.Audio -> {
                pending = take.bytes
                edit { it.copy(notice = if (take.atLimit) VoiceNotice.AtLimit else null) }
                transcribe()
            }
        }
    }

    /** Sends the kept take for transcription; on failure the recording stays for another try. */
    fun transcribe() {
        val bytes = pending ?: return
        val transcriber = ready()?.transcriber ?: return
        edit { it.copy(phase = AnswerPhase.Transcribing) }
        job = viewModelScope.launch {
            try {
                val text = repos.workspace.transcribeCareerAnswer(transcriber.providerId, transcriber.model, id, UploadPart("audio", bytes, "answer.m4a", "audio/mp4"), transcriber.approval()).text
                pending = null
                if (text.isBlank()) edit { it.copy(phase = AnswerPhase.Idle, notice = VoiceNotice.NothingHeard) }
                else edit { it.copy(phase = AnswerPhase.Review(text, CreateCareerOfferResponseDataPracticeMode.Spoken, spokenMs)) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (e.destinationChanged()) {
                    val current = ready()
                    if (current != null) {
                        val context = repos.renewAiDisclosure(current.context)
                        edit { it.copy(context = context, transcriber = chooseTranscriber(context.providers)) }
                    }
                }

                edit { it.copy(phase = AnswerPhase.Idle, notice = VoiceNotice.TranscribeFailed) }
            }
        }
    }

    fun type() = recording.cancel().let { edit { it.copy(typing = true, notice = null, phase = AnswerPhase.Review(it.phase.let { p -> (p as? AnswerPhase.Review)?.text.orEmpty() }, CreateCareerOfferResponseDataPracticeMode.Typed)) } }

    fun editAnswer(text: String) = edit { s -> s.copy(phase = (s.phase as? AnswerPhase.Review)?.copy(text = text) ?: s.phase) }

    fun feedback(locale: Locale) {
        val s = ready() ?: return
        val review = s.phase as? AnswerPhase.Review ?: return
        val provider = s.context.provider ?: return
        if (review.text.isBlank() || s.sending) return
        edit { it.copy(sending = true, notice = null) }
        job = viewModelScope.launch {
            try {
                val item = repos.workspace.generateCareerWork(
                    GenerateCareerWorkRequest(
                        id, locale.toLanguageTag(),
                        GenerateCareerWorkRequestTaskPractice(review.text, s.interview?.id, review.mode, CreateCareerOfferResponseDataPracticeOrigin.Simulated, s.question, s.storyIds[s.question], CreateCareerOfferResponseDataPracticeKind.Practice),
                    ),
                    RequestOptions().approvedFor(provider),
                ).item
                val attempt = item?.data as? PracticeAttempt ?: error("No feedback")
                edit { it.copy(sending = false, phase = AnswerPhase.Feedback(attempt), attempts = listOf(Instant.parse(item.createdAt) to attempt) + it.attempts) }
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

                // Keep the person's words; only the request failed.
                edit { it.copy(sending = false, notice = VoiceNotice.FeedbackFailed) }
                outcomes.send(VoiceOutcome.Failed)
            }
        }
    }

    fun stop() { job?.cancel() }

    fun again() = edit { s -> s.copy(phase = (s.phase as? AnswerPhase.Feedback)?.let { AnswerPhase.Review(it.attempt.answer, it.attempt.mode) } ?: AnswerPhase.Idle, notice = null) }

    fun next() = edit { s -> s.copy(index = (s.index + 1) % s.questions.size, phase = AnswerPhase.Idle, typing = false, notice = null) }

    override fun onCleared() = recording.cancel()
}

@Composable
internal fun PractiseTab(applicationId: String, nav: NavController) {
    val repos = LocalRepositories.current
    val context = LocalContext.current
    val res = androidx.compose.ui.platform.LocalResources.current
    val fallback = { company: String ->
        listOf(
            res.getString(S.string.tell_me_about_a_piece_of_work_you_re_proud_of_what_was_your_part_in_it_and_how_did_you_measure_succe),
            res.getString(S.string.tell_me_about_a_time_you_disagreed_with_a_colleague_how_did_you_resolve_it),
            res.getString(S.string.why_do_you_want_this_role_at_company, company),
        )
    }
    // The Application entry hosting this tab carries the question Interview prep handed over, if any.
    val entry = LocalViewModelStoreOwner.current as? NavBackStackEntry
    val handed = remember(entry) { entry?.let { runCatching { it.toRoute<ApplicationRoute>().practiceQuestion }.getOrNull() } }
    val vm = viewModel(key = "practise-$applicationId") {
        PractiseViewModel(repos, applicationId, fallback, MediaVoiceRecorder(context.applicationContext), { android.os.SystemClock.elapsedRealtime() }, handed)
    }
    val load by vm.state.collectAsStateWithLifecycle()
    val recording by vm.recording.state.collectAsStateWithLifecycle()
    val haptics = rememberRrHaptics()
    LaunchedEffect(vm) {
        vm.outcome.collect {
            haptics(
                when (it) {
                    VoiceOutcome.Started, VoiceOutcome.Stopped -> RrHaptic.Light
                    VoiceOutcome.Limit -> RrHaptic.Warning
                    VoiceOutcome.Feedback -> RrHaptic.Success
                    VoiceOutcome.Failed -> RrHaptic.Error
                },
            )
        }
    }
    // Leaving the app stops the recording and keeps the take.
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) vm.stopRecording() }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    val mic = rememberMicPermission(onGranted = vm::record)
    val locale = LocalConfiguration.current.locales[0]
    Loaded(load, vm::load) { state ->
        PractiseScreen(
            state,
            recording,
            micDenied = mic.denied,
            dates = rememberDates(repos.time.timezone()),
            now = repos.time.now(),
            onRecord = { if (recording.recording) vm.stopRecording() else mic.request() },
            onType = vm::type,
            onAnswerChange = vm::editAnswer,
            onFeedback = { vm.feedback(locale) },
            onStop = vm::stop,
            onRetryTranscribe = vm::transcribe,
            onAgain = vm::again,
            onNext = vm::next,
            onSetUpAi = { nav.navigate(SettingsAi) },
            onOpenSettings = { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))) },
        )
    }
}

internal class MicPermission(val denied: Boolean, val request: () -> Unit)

/** Asks for the microphone the first time; once refused, the tab offers typing and a link to system settings. */
@Composable
internal fun rememberMicPermission(onGranted: () -> Unit): MicPermission {
    val context = LocalContext.current
    var denied by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        denied = !granted
        if (granted) onGranted()
    }
    return MicPermission(denied) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) onGranted()
        else launcher.launch(Manifest.permission.RECORD_AUDIO)
    }
}

@Composable
internal fun PractiseScreen(
    state: PractiseState,
    recording: RecordingState,
    micDenied: Boolean,
    dates: Dates,
    onRecord: () -> Unit,
    onType: () -> Unit,
    onAnswerChange: (String) -> Unit,
    onFeedback: () -> Unit,
    onStop: () -> Unit,
    onRetryTranscribe: () -> Unit,
    onAgain: () -> Unit,
    onNext: () -> Unit,
    onSetUpAi: () -> Unit,
    onOpenSettings: () -> Unit,
    now: Instant,
) {
    val c = RrTheme.colors
    var attemptsOpen by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        AiDestinationNotice(state.context)
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            val kind = state.interview?.let { interviewKindLabel(it.kind) }
            val position = stringResource(S.string.question_position_of_total, (state.index + 1).toString(), state.questions.size.toString())
            RrText(if (kind == null) position else "$kind · ${position.replaceFirstChar { it.lowercase(dates.locale) }}", style = RrType.eyebrow, color = c.ink3)
            RrText(state.question, style = RrType.sheetTitle, color = c.ink, modifier = Modifier.semantics { heading() })
            state.stories[state.question]?.let { RrText(stringResource(R.string.workspace_story_to_use_star, it), style = RrType.small, color = c.ink3) }
            when (val phase = state.phase) {
                is AnswerPhase.Feedback -> FeedbackCard(phase.attempt, state.context.app.jobDescription.isNullOrBlank().not(), onAgain, onNext)
                is AnswerPhase.Review -> ReviewAnswer(state, phase, onAnswerChange, onFeedback, onStop, onRecord, micDenied)
                else -> {
                    if (!state.typing && !micDenied && state.transcriber != null) RecorderCard(state, recording, onRecord, onStop)
                    if (micDenied) RrCallout(stringResource(S.string.allow_microphone_access_in_device_settings_or_type_your_answer), actionLabel = stringResource(S.string.open_device_settings), onAction = onOpenSettings)
                    if (state.transcriber == null) RrCallout(stringResource(S.string.none_of_your_ai_connections_can_transcribe_speech_openai_google_gemini_mistral_xai_groq_or_vercel_ai), actionLabel = stringResource(S.string.connect_an_ai_provider), onAction = onSetUpAi)
                    if (phase == AnswerPhase.Idle) {
                        RrButton(stringResource(S.string.type_instead), onType, Modifier.align(Alignment.CenterHorizontally), variant = RrButtonVariant.Ghost, icon = DsR.drawable.ic_ph_keyboard)
                    }
                }
            }
            Notice(state.notice, onRetryTranscribe)
        }
        Spacer(Modifier.fillMaxWidth().height(1.dp).background(c.line))
        val latest = state.attempts.firstOrNull()
        Column(Modifier.background(c.surface).windowInsetsPadding(WindowInsets.navigationBars)) {
            RrListRow(
                stringResource(S.string.your_attempts),
                subtitle = latest?.let { (at, a) -> attemptLine(at, a, dates, now) } ?: stringResource(S.string.each_answer_you_get_feedback_on_is_kept_here_newest_first),
                icon = DsR.drawable.ic_ph_clock_counter_clockwise,
                onClick = { attemptsOpen = true },
                trailing = {
                    if (state.attempts.isNotEmpty()) RrText(state.attempts.size.toString(), style = RrType.small, color = c.ink3)
                    RrIcon(DsR.drawable.ic_ph_caret_up, null, size = 18.dp, tint = c.ink3)
                },
            )
        }
    }
    if (attemptsOpen) {
        WindowSheet({ attemptsOpen = false }, stringResource(S.string.your_attempts)) {
            RrText(stringResource(S.string.each_answer_you_get_feedback_on_is_kept_here_newest_first), style = RrType.small, color = c.ink3)
            state.attempts.forEach { (at, a) ->
                RrCard {
                    RrText(attemptLine(at, a, dates, now), style = RrType.caption, color = c.ink3)
                    RrText(a.question, style = RrType.label, color = c.ink)
                    LabeledText(stringResource(S.string.what_works), a.works)
                    LabeledText(stringResource(S.string.strengthen), a.strengthen)
                }
            }
        }
    }
}

@Composable
private fun attemptLine(at: Instant, a: PracticeAttempt, dates: Dates, now: Instant): String {
    val today = dates.date(at) == dates.date(now)
    val day = if (today) stringResource(S.string.today_hour, dates.time(at)) else "${dates.day(at)}, ${dates.time(at)}"
    val mode = stringResource(if (a.mode == CreateCareerOfferResponseDataPracticeMode.Typed) S.string.typed else S.string.spoken)
    return listOf(day, mode, a.title.replaceFirstChar { it.lowercase(dates.locale) }).joinToString(" · ")
}

@Composable
private fun RecorderCard(state: PractiseState, recording: RecordingState, onRecord: () -> Unit, onStop: () -> Unit) {
    val c = RrTheme.colors
    RrCard(raised = true, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 20.dp)) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.phase == AnswerPhase.Transcribing) {
                RrWorkingLabel(listOf(stringResource(S.string.transcribing_with_model, state.transcriber?.model.orEmpty())))
                RrButton(stringResource(S.string.stop), onStop, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small)
                return@Column
            }
            RrWaveform(recording.levels, bars = Recording.BARS)
            Row(Modifier.semantics(mergeDescendants = true) {}) {
                RrText(clock(recording.elapsedMs), style = RrType.mono.copy(fontSize = 16.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium), color = c.ink)
                RrText(" / ${clock(Recording.MAX_MS)}", style = RrType.mono.copy(fontSize = 16.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium), color = c.ink3)
            }
            RrRecordButton(recording.recording, onRecord)
            RrText(
                stringResource(if (recording.recording) R.string.workspace_recording_tap_to_stop else S.string.up_to_2_minutes_2_mb_maximum),
                style = RrType.small,
                color = c.ink2,
            )
        }
    }
}

@Composable
private fun ReviewAnswer(
    state: PractiseState,
    review: AnswerPhase.Review,
    onChange: (String) -> Unit,
    onFeedback: () -> Unit,
    onStop: () -> Unit,
    onRecordAgain: () -> Unit,
    micDenied: Boolean,
) {
    val c = RrTheme.colors
    if (review.spokenMs != null) RrText(stringResource(S.string.transcribed_spokenfor_check_numbers_and_names_before_using_it, clock(review.spokenMs)), style = RrType.caption, color = c.ink3)
    RrTextField(review.text, onChange, label = stringResource(S.string.your_answer), singleLine = false, minLines = 6)
    if (state.sending) {
        Working(listOf(S.string.reading_your_answer, S.string.finding_what_works, S.string.sharpening_the_opening), onStop)
    } else {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RrButton(stringResource(S.string.get_feedback), onFeedback, enabled = review.text.isNotBlank() && state.context.provider != null, icon = DsR.drawable.ic_ph_sparkle)
            if (state.transcriber != null && !micDenied) RrButton(stringResource(if (review.spokenMs != null) S.string.record_again else S.string.record_your_answer), onRecordAgain, variant = RrButtonVariant.Secondary, icon = DsR.drawable.ic_ph_microphone)
        }
    }
}

@Composable
private fun FeedbackCard(attempt: PracticeAttempt, hasPosting: Boolean, onAgain: () -> Unit, onNext: () -> Unit) {
    val c = RrTheme.colors
    FadeUp {
        RrCard(raised = true) {
            RrText(attempt.title, style = RrType.label, color = c.ink)
            RrText(stringResource(if (hasPosting) S.string.compared_with_your_stories_and_the_posting else S.string.compared_with_your_stories), style = RrType.caption, color = c.ink3)
            LabeledText(stringResource(S.string.what_works), attempt.works)
            LabeledText(stringResource(S.string.strengthen), attempt.strengthen)
            LabeledText(stringResource(S.string.try_this_opening), attempt.opening)
            LabeledText(stringResource(S.string.your_answer_mode, stringResource(if (attempt.mode == CreateCareerOfferResponseDataPracticeMode.Typed) S.string.typed else S.string.spoken)), attempt.answer)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                RrButton(stringResource(S.string.try_again_with_this), onAgain, variant = RrButtonVariant.Secondary)
                RrButton(stringResource(S.string.next_question), onNext)
            }
            RrText(stringResource(S.string.saved_to_library_practice), style = RrType.caption, color = c.ink3)
        }
    }
}

@Composable
internal fun LabeledText(label: String, text: String) {
    if (text.isBlank()) return
    val c = RrTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        RrText(label, style = RrType.eyebrow, color = c.ink3)
        RrText(text, style = RrType.ui, color = c.ink)
    }
}

@Composable
internal fun Notice(notice: VoiceNotice?, onRetryTranscribe: () -> Unit) {
    notice ?: return
    when (notice) {
        VoiceNotice.AtLimit -> RrCallout(stringResource(S.string.recording_stopped_at_the_2_minute_limit_transcribing_what_you_said))
        VoiceNotice.Unusable -> RrCallout(stringResource(S.string.that_recording_was_empty_or_over_2_mb_try_a_shorter_answer), tone = RrTone.Warn)
        VoiceNotice.NothingHeard -> RrCallout(stringResource(R.string.workspace_nothing_was_heard), tone = RrTone.Warn)
        VoiceNotice.TranscribeFailed -> RrCallout(stringResource(S.string.couldn_t_transcribe_your_recording_is_still_here), tone = RrTone.Danger, actionLabel = stringResource(S.string.try_again), onAction = onRetryTranscribe)
        VoiceNotice.StartFailed -> RrCallout(stringResource(S.string.couldn_t_start_recording_try_again_or_type_your_answer), tone = RrTone.Danger)
        VoiceNotice.FeedbackFailed -> RrCallout(stringResource(S.string.couldn_t_complete_this_action_try_again), tone = RrTone.Danger)
    }
}
