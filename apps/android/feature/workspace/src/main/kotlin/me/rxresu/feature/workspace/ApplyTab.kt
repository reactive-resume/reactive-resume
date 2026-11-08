// W2 · Apply: three numbered steps (documents, form answers, submit on their site), copy-first answers, the
// employer's form in the system browser, and Mark as applied. Autofill and the embedded browser stay web-only.
package me.rxresu.feature.workspace

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.designsystem.R as DsR
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrChoiceRow
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrIconButtonSize
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrRowCaret
import me.rxresu.core.designsystem.RrSheetDetents
import me.rxresu.core.designsystem.RrStepMarker
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrToastResult
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.Builder
import me.rxresu.core.navigation.Letter
import me.rxresu.core.navigation.NewDocument
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.CareerWorkspace
import me.rxresu.core.network.generated.ListReviewedAnswersResponseItem
import me.rxresu.core.network.generated.ReuseReviewedAnswerRequest
import me.rxresu.core.network.generated.SaveCareerWorkspaceRequest
import me.rxresu.core.network.generated.SaveCareerWorkspaceRequestAnswersItem
import me.rxresu.core.network.generated.SaveCareerWorkspaceRequestExpected
import me.rxresu.core.network.generated.SaveReviewedAnswerRequest
import me.rxresu.core.network.generated.SaveReviewedAnswerRequestScope
import me.rxresu.core.network.generated.SaveReviewedAnswerRequestSource
import me.rxresu.core.network.generated.SubmitCareerApplicationRequest
import me.rxresu.core.network.generated.SubmitCareerApplicationRequestExpectedDocuments
import me.rxresu.core.strings.R as S

internal data class LinkedDocument(val id: String, val name: String, val updatedAt: Instant)

internal data class ApplyState(
    val context: WorkspaceContext,
    val resume: LinkedDocument?,
    val letter: LinkedDocument?,
    val workspace: CareerWorkspace,
    val library: List<ListReviewedAnswersResponseItem>,
    val busy: Boolean = false,
) {
    val answers get() = workspace.answers
    val submitted get() = workspace.submissionReview != null || context.app.status !in setOf(ApplicationStage.Saved, ApplicationStage.Unknown)
}

internal class ApplyViewModel(private val repos: RrRepositories, private val id: String) : ViewModel() {
    val state = MutableStateFlow<Load<ApplyState>>(Load.Loading)

    init { load() }

    fun load() {
        viewModelScope.launch {
            state.value = runCatching { fetch() }.fold({ Load.Ready(it) }, { Load.Failed(it.isOffline()) })
        }
    }

    private suspend fun fetch(): ApplyState = coroutineScope {
        val context = repos.workspaceContext(id)
        val app = context.app
        val resume = async { app.resumeId?.let { runCatching { repos.resumes.getResume(it) }.getOrNull() }?.let { LinkedDocument(it.id, it.name, Instant.parse(it.updatedAt)) } }
        val letter = async { app.coverLetterId?.let { runCatching { repos.letters.getCoverLetter(it) }.getOrNull() }?.let { LinkedDocument(it.id, it.name, Instant.parse(it.updatedAt)) } }
        val workspace = async { repos.workspace.getCareerWorkspace(id) }
        val library = async { runCatching { repos.workspace.listReviewedAnswers(id) }.getOrDefault(emptyList()) }
        ApplyState(context, resume.await(), letter.await(), workspace.await(), library.await())
    }

    private fun ready() = (state.value as? Load.Ready)?.value

    /** Saves the answer list with the previous one as the expected version, so a change elsewhere isn't overwritten. */
    private suspend fun saveAnswers(next: List<SaveCareerWorkspaceRequestAnswersItem>) {
        val current = ready() ?: return
        val saved = repos.workspace.saveCareerWorkspace(id, SaveCareerWorkspaceRequest(answers = next, expected = SaveCareerWorkspaceRequestExpected(answers = current.answers)))
        state.update { if (it is Load.Ready) Load.Ready(it.value.copy(workspace = saved)) else it }
    }

    /** Saves one answer; [forOtherApplications] also keeps it, reviewed, in the answer library for this employer. */
    suspend fun saveAnswer(answerId: String?, question: String, answer: String, forOtherApplications: Boolean): Boolean = runCatching {
        val current = ready() ?: return false
        val old = current.answers.firstOrNull { it.id == answerId }
        val item = SaveCareerWorkspaceRequestAnswersItem(old?.aiOperationIds, answer, old?.factIds.orEmpty(), answerId ?: UUID.randomUUID().toString(), question)
        saveAnswers(if (old == null) current.answers + item else current.answers.map { if (it.id == answerId) item else it })
        if (forOtherApplications) {
            repos.workspace.saveReviewedAnswer(
                SaveReviewedAnswerRequest(
                    aiOperationIds = item.aiOperationIds, answer = answer, applicationId = id, expectedEvidence = emptyList(),
                    factIds = item.factIds, noEmployerWording = false, question = question, reviewed = true,
                    scope = SaveReviewedAnswerRequestScope.Employer,
                    source = if (item.aiOperationIds.isNullOrEmpty()) SaveReviewedAnswerRequestSource.Application else SaveReviewedAnswerRequestSource.AiAssisted,
                    storyIds = emptyList(),
                ),
            )
        }
        true
    }.getOrDefault(false)

    suspend fun removeAnswer(answerId: String): Boolean = runCatching {
        val current = ready() ?: return false
        saveAnswers(current.answers.filterNot { it.id == answerId })
        true
    }.getOrDefault(false)

    /** Reuses a reviewed library answer for this application (refused when its evidence changed). */
    suspend fun useReviewed(item: ListReviewedAnswersResponseItem): Boolean = runCatching {
        val current = ready() ?: return false
        val reused = repos.workspace.reuseReviewedAnswer(item.id, ReuseReviewedAnswerRequest(item.answer, id, item.revision, reviewed = true))
        saveAnswers(current.answers + SaveCareerWorkspaceRequestAnswersItem(reused.aiOperationIds, reused.text, reused.factIds, UUID.randomUUID().toString(), item.question))
        true
    }.getOrDefault(false)

    /** Records the submission with the exact answers and linked documents. Returns the follow-up date, or null. */
    suspend fun markApplied(): Result<Instant?> {
        val current = ready() ?: return Result.failure(IllegalStateException())
        state.update { if (it is Load.Ready) Load.Ready(it.value.copy(busy = true)) else it }
        return runCatching {
            val app = current.context.app
            repos.workspace.submitCareerApplication(
                id,
                SubmitCareerApplicationRequest(current.answers, current.answers, SubmitCareerApplicationRequestExpectedDocuments(app.coverLetterId, app.resumeId)),
            )
            val next = fetch()
            state.value = Load.Ready(next)
            next.context.app.followUpAt?.let { runCatching { Instant.parse(it) }.getOrNull() }
        }.also { if (it.isFailure) state.update { s -> if (s is Load.Ready) Load.Ready(s.value.copy(busy = false)) else s } }
    }
}

@Composable
internal fun ApplyTab(applicationId: String, nav: NavController) {
    val repos = LocalRepositories.current
    val vm = viewModel(key = "apply-$applicationId") { ApplyViewModel(repos, applicationId) }
    val load by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val colors = RrTheme.colors
    val toasts = LocalToasts.current
    val haptics = rememberRrHaptics()
    val scope = rememberCoroutineScope()
    val dates = rememberDates(repos.time.timezone())
    var confirming by remember { mutableStateOf(false) }
    // Returning from the employer's form, ask once whether it went in.
    var awaitingReturn by remember { mutableStateOf(false) }
    val owner = LocalLifecycleOwner.current
    val submitted = (load as? Load.Ready)?.value?.submitted ?: true
    val didSubmit = stringResource(R.string.workspace_did_you_submit_it)
    val markLabel = stringResource(S.string.mark_as_applied)
    DisposableEffect(owner, awaitingReturn, submitted) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && awaitingReturn) {
                awaitingReturn = false
                if (!submitted) scope.launch { if (toasts.show(didSubmit, markLabel) == RrToastResult.ActionPerformed) confirming = true }
            }
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    val copied = stringResource(S.string.answer_copied)
    val failed = stringResource(S.string.couldn_t_complete_this_action_try_again)
    val markFailed = stringResource(S.string.couldn_t_mark_it_as_applied_try_again)
    val applied = stringResource(S.string.marked_as_applied_the_versions_you_sent_are_kept)
    val appliedWithFollowUp = R.string.workspace_applied_follow_up
    val res = androidx.compose.ui.platform.LocalResources.current
    Loaded(load, vm::load) { state ->
        ApplyScreen(
            state,
            dates = dates,
            now = repos.time.now(),
            onOpenResume = { nav.navigate(Builder(it)) },
            onOpenLetter = { nav.navigate(Letter(it)) },
            onPrepareResume = { nav.navigate(NewDocument(copyForApplicationId = applicationId)) },
            onCopy = { answer ->
                context.copyToClipboard(answer.question, answer.answer)
                haptics(RrHaptic.Success)
                scope.launch { toasts.show(copied) }
            },
            onSave = { answerId, question, answer, library -> scope.launch { if (!vm.saveAnswer(answerId, question, answer, library)) toasts.show(failed) } },
            onRemove = { answerId -> scope.launch { if (!vm.removeAnswer(answerId)) toasts.show(failed) } },
            onUseReviewed = { item -> scope.launch { if (!vm.useReviewed(item)) toasts.show(failed) } },
            onOpenForm = { url ->
                awaitingReturn = true
                context.openInBrowser(url, colors)
            },
            onMarkApplied = { confirming = true },
        )
        if (confirming) {
            ConfirmApplied(state, onDismiss = { confirming = false }) {
                scope.launch {
                    vm.markApplied().fold(
                        { followUp ->
                            confirming = false
                            haptics(RrHaptic.Success)
                            toasts.show(followUp?.let { res.getString(appliedWithFollowUp, dates.day(it)) } ?: applied)
                        },
                        { toasts.show(markFailed) },
                    )
                }
            }
        }
    }
}

@Composable
internal fun ApplyScreen(
    state: ApplyState,
    dates: Dates,
    now: Instant,
    onOpenResume: (String) -> Unit,
    onOpenLetter: (String) -> Unit,
    onPrepareResume: () -> Unit,
    onCopy: (SaveCareerWorkspaceRequestAnswersItem) -> Unit,
    onSave: (answerId: String?, question: String, answer: String, library: Boolean) -> Unit,
    onRemove: (String) -> Unit,
    onUseReviewed: (ListReviewedAnswersResponseItem) -> Unit,
    onOpenForm: (String) -> Unit,
    onMarkApplied: () -> Unit,
) {
    val app = state.context.app
    var editing by remember { mutableStateOf<SaveCareerWorkspaceRequestAnswersItem?>(null) }
    var adding by remember { mutableStateOf(false) }
    var library by remember { mutableStateOf(false) }
    val today = dates.date(now)
    fun edited(at: Instant) = dates.date(at).let { if (it == today) null else dates.day(it) }
    TabBody(
        footer = if (state.submitted) null else {
            { RrButton(stringResource(S.string.mark_as_applied), onMarkApplied, Modifier.fillMaxWidth(), size = RrButtonSize.Large, icon = DsR.drawable.ic_ph_check, loading = state.busy) }
        },
    ) {
        StepHeader(1, state.resume != null, stringResource(S.string.documents), Modifier.padding(top = 0.dp))
        Group {
            // The web's sent-documents: an open application without a resume offers a copy made for this job.
            val canPrepare = app.resumeId == null && app.status != ApplicationStage.Closed && app.status != ApplicationStage.Offer
            if (state.resume == null && state.letter == null && !canPrepare) RrListRow(stringResource(S.string.no_documents_88069aadea), icon = DsR.drawable.ic_ph_file_text)
            if (canPrepare) RrListRow(stringResource(S.string.prepare_a_resume), icon = DsR.drawable.ic_ph_copy, onClick = onPrepareResume, trailing = { RrRowCaret() })
            state.resume?.let { doc ->
                RrListRow(doc.name, subtitle = listOfNotNull(stringResource(S.string.resume), edited(doc.updatedAt) ?: stringResource(S.string.today)).joinToString(" · "), icon = DsR.drawable.ic_ph_file_text, onClick = { onOpenResume(doc.id) }, trailing = { RrRowCaret() })
            }
            state.letter?.let { doc ->
                RrListRow(doc.name, subtitle = listOfNotNull(stringResource(S.string.letter), edited(doc.updatedAt) ?: stringResource(S.string.today)).joinToString(" · "), icon = DsR.drawable.ic_ph_note_pencil, onClick = { onOpenLetter(doc.id) }, trailing = { RrRowCaret() })
            }
        }
        StepHeader(2, state.submitted && state.answers.isNotEmpty(), stringResource(S.string.form_answers)) {
            RrButton(stringResource(R.string.workspace_add_a_question), { adding = true }, variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Small, icon = DsR.drawable.ic_ph_plus)
        }
        Group {
            state.answers.forEach { answer -> AnswerRow(answer, onOpen = { editing = answer }, onCopy = { onCopy(answer) }) }
            RrListRow(
                stringResource(S.string.use_a_saved_answer),
                subtitle = pluralStringResource(R.plurals.workspace_reviewed_answers, state.library.size, state.library.size),
                icon = DsR.drawable.ic_ph_book_bookmark,
                onClick = { library = true },
                trailing = { RrRowCaret() },
            )
        }
        StepHeader(3, state.submitted, stringResource(R.string.workspace_submit_on_their_site))
        Group {
            val url = app.sourceUrl
            if (url.isNullOrBlank()) RrListRow(stringResource(R.string.workspace_open_employer_form), subtitle = stringResource(R.string.workspace_no_form_link), icon = DsR.drawable.ic_ph_arrow_square_out, enabled = false)
            else RrListRow(stringResource(R.string.workspace_open_employer_form), subtitle = stringResource(R.string.workspace_in_your_browser, displayUrl(url)), icon = DsR.drawable.ic_ph_arrow_square_out, onClick = { onOpenForm(url) })
        }
    }
    val edit = editing
    if (edit != null || adding) {
        AnswerSheet(edit, onDismiss = { editing = null; adding = false }, onSave = { q, a, lib -> onSave(edit?.id, q, a, lib); editing = null; adding = false }, onRemove = edit?.let { { onRemove(it.id); editing = null } })
    }
    if (library) {
        WindowSheet({ library = false }, stringResource(S.string.use_a_saved_answer)) {
            if (state.library.isEmpty()) RrText(stringResource(S.string.no_recorded_answers_are_available), style = RrType.small, color = RrTheme.colors.ink3)
            state.library.forEach { item ->
                me.rxresu.core.designsystem.RrCard {
                    RrText(item.question, style = RrType.label, color = RrTheme.colors.ink)
                    RrText(item.answer, style = RrType.small, color = RrTheme.colors.ink2, maxLines = 4)
                    if (item.stale || !item.canReuse) RrCallout(stringResource(S.string.evidence_changed_or_was_removed_edit_and_review_before_reuse), tone = RrTone.Warn)
                    else RrButton(stringResource(S.string.use_reviewed_answer), { onUseReviewed(item); library = false }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
                }
            }
        }
    }
}

/** A step eyebrow: the number (a tick once done) in a 24 dp square, its name, and an optional trailing action. */
@Composable
private fun StepHeader(number: Int, done: Boolean, title: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    val c = RrTheme.colors
    Row(modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = if (number == 1) 14.dp else 20.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        RrStepMarker(number, done)
        RrText(title, Modifier.weight(1f).padding(start = 8.dp), style = RrType.eyebrow, color = c.ink3)
        action?.invoke()
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AnswerRow(answer: SaveCareerWorkspaceRequestAnswersItem, onOpen: () -> Unit, onCopy: () -> Unit) {
    val words = answer.answer.split(Regex("\\s+")).count { it.isNotBlank() }
    val subtitle = when {
        answer.answer.isBlank() -> stringResource(S.string.write_your_answer_or_draft_one_from_your_knowledge)
        words <= 6 -> answer.answer
        else -> pluralStringResource(R.plurals.workspace_words, words, words)
    }
    RrListRow(
        answer.question,
        subtitle = subtitle,
        onClick = onOpen,
        onLongClick = onCopy,
        onLongClickLabel = stringResource(S.string.copy),
        trailing = { RrIconButton(DsR.drawable.ic_ph_copy, stringResource(R.string.workspace_copy_answer), onCopy, size = RrIconButtonSize.Small) },
    )
}

@Composable
private fun AnswerSheet(
    answer: SaveCareerWorkspaceRequestAnswersItem?,
    onDismiss: () -> Unit,
    onSave: (question: String, answer: String, library: Boolean) -> Unit,
    onRemove: (() -> Unit)?,
) {
    var question by remember { mutableStateOf(answer?.question.orEmpty()) }
    var text by remember { mutableStateOf(answer?.answer.orEmpty()) }
    var reviewed by remember { mutableStateOf(false) }
    val dirty = question != answer?.question.orEmpty() || text != answer?.answer.orEmpty()
    WindowSheet(
        onDismiss,
        stringResource(if (answer == null) S.string.add_a_question_from_the_form else S.string.answer),
        detents = RrSheetDetents.Full,
        confirmDiscard = dirty,
        footer = {
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (onRemove != null) RrButton(stringResource(S.string.delete), onRemove, variant = RrButtonVariant.DangerGhost)
                Box(Modifier.weight(1f))
                RrButton(stringResource(S.string.save_for_other_applications), { onSave(question, text, true) }, variant = RrButtonVariant.Secondary, enabled = reviewed && question.isNotBlank() && text.isNotBlank())
                RrButton(stringResource(S.string.save), { onSave(question, text, false) }, enabled = question.isNotBlank())
            }
        },
    ) {
        RrTextField(question, { question = it }, label = stringResource(S.string.question_from_the_form), placeholder = stringResource(S.string.paste_the_question_from_the_form), singleLine = false)
        RrTextField(text, { text = it; reviewed = false }, label = stringResource(S.string.answer), placeholder = stringResource(S.string.write_your_answer_or_draft_one_from_your_knowledge), singleLine = false, minLines = 6)
        RrChoiceRow(stringResource(S.string.i_reviewed_this_answer_its_evidence_and_the_application_context), reviewed, { reviewed = !reviewed }, radio = false)
    }
}

@Composable
private fun ConfirmApplied(state: ApplyState, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    val documents = listOfNotNull(state.resume?.name, state.letter?.name).ifEmpty { listOf(stringResource(S.string.no_documents_88069aadea)) }
    val answers = pluralStringResource(R.plurals.workspace_answers, state.answers.size, state.answers.size)
    WindowSheet(
        onDismiss,
        stringResource(S.string.mark_as_applied),
        fitContent = true,
        footer = {
            RrButton(stringResource(S.string.mark_as_applied), onConfirm, Modifier.fillMaxWidth().padding(16.dp), size = RrButtonSize.Large, icon = DsR.drawable.ic_ph_check, loading = state.busy)
        },
    ) {
        RrText(stringResource(S.string.records_records_as_sent_you_submit_on_the_employer_s_site_yourself, (documents + answers).joinToString(" · ")), style = RrType.body, color = RrTheme.colors.ink2)
    }
}
