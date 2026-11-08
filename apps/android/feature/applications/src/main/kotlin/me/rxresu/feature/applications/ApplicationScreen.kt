package me.rxresu.feature.applications

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.NavController
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.launch
import me.rxresu.core.data.ApplicationNextStep
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.NextStepKind
import me.rxresu.core.data.TimeSource
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.designsystem.RrAvatar
import me.rxresu.core.designsystem.RrBadgeTone
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCard
import me.rxresu.core.designsystem.RrContextChip
import me.rxresu.core.designsystem.RrEmptyState
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrIconButtonSize
import me.rxresu.core.designsystem.RrKeyValue
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMenu
import me.rxresu.core.designsystem.RrMenuItem
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrOfflineStrip
import me.rxresu.core.designsystem.RrRowCaret
import me.rxresu.core.designsystem.RrSectionHeader
import me.rxresu.core.designsystem.RrSkeleton
import me.rxresu.core.designsystem.RrSkeletonText
import me.rxresu.core.designsystem.RrStageLabel
import me.rxresu.core.designsystem.RrStageStepper
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrToastResult
import me.rxresu.core.designsystem.RrToastTone
import me.rxresu.core.designsystem.RrTopBar
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.Builder
import me.rxresu.core.navigation.Coach
import me.rxresu.core.navigation.InterviewSheet
import me.rxresu.core.navigation.Letter
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.ApplicationWorkspace
import me.rxresu.core.designsystem.RrPageTitle
import me.rxresu.core.designsystem.RrHeroCard
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrRowValue
import me.rxresu.core.designsystem.rrNavigationBarsPadding
import me.rxresu.core.navigation.MoveApplication
import me.rxresu.core.navigation.NewDocument
import me.rxresu.core.navigation.Offers
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.Interview
import me.rxresu.core.network.generated.NoteTimelineEntry
import me.rxresu.core.network.generated.PatchApplicationRequest
import me.rxresu.core.network.generated.StageTimelineEntry
import me.rxresu.core.strings.R as S

/** J6 overview. Every workspace tool is a separate pushed destination. */
@Composable
fun ApplicationRoute(id: String, nav: NavController, openPosting: Boolean = false) {
    val entry by nav.currentBackStackEntryAsState()
    val obscured = entry?.destination?.let { it.hasRoute<MoveApplication>() || it.hasRoute<InterviewSheet>() } == true
    val repos = LocalRepositories.current
    val vm = viewModel(key = "application:$id") {
        ApplicationViewModel(repos.applications, repos.career, repos.resumes, repos.documents, repos.time, id)
    }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val haptics = rememberRrHaptics()
    val trashedText = state.app?.let { stringResource(R.string.app_trashed, "${it.role} · ${it.company}") }.orEmpty()
    val undo = stringResource(S.string.undo)
    val followedUp = stringResource(S.string.followed_up)
    val logFailed = stringResource(S.string.couldn_t_log_the_follow_up_check_the_timeline_before_trying_again)
    val saveFailed = stringResource(R.string.app_couldnt_save)
    val interviewLabel = state.interview?.let { interviewKindLabel(it.kind) }
    val eventTitle = interviewLabel?.let { stringResource(S.string.kind_interview, it) + " · " + state.app?.company.orEmpty() }.orEmpty()

    fun saved(ok: Boolean) {
        if (!ok) scope.launch { toasts.show(saveFailed, tone = RrToastTone.Danger) }
    }

    ApplicationScreen(
        state = state,
        obscured = obscured,
        time = vm.time,
        onBack = { nav.popBackStack() },
        onCoach = { nav.navigate(Coach(applicationId = id)) },
        onMove = { nav.navigate(MoveApplication(id)) },
        onInterview = { interviewId -> nav.navigate(InterviewSheet(id, interviewId)) },
        onAddToCalendar = { interview ->
            val start = Instant.parse(interview.at)
            addToCalendar(context, CalendarEvent(interview.id, eventTitle, start, interview.durationMinutes ?: 60, interview.location, interview.notes), vm.time.now())
        },
        onOpenResume = { nav.navigate(Builder(it)) },
        onOpenLetter = { nav.navigate(Letter(it)) },
        onPrepareResume = { nav.navigate(NewDocument(copyForApplicationId = id)) },
        onOffers = { nav.navigate(Offers) },
        onEmail = { email -> runCatching { context.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$email"))) } },
        onOpenLink = { url -> runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } },
        onLogFollowUp = {
            scope.launch {
                if (vm.logFollowUp()) {
                    haptics(RrHaptic.Success)
                    toasts.show(followedUp)
                } else {
                    haptics(RrHaptic.Error)
                    toasts.show(logFailed, tone = RrToastTone.Danger)
                }
            }
        },
        onReopen = { scope.launch { saved(vm.reopen()) } },
        onTrash = {
            scope.launch {
                vm.trash().onSuccess { stamp ->
                    nav.popBackStack()
                    val moves = ApplicationMoves(repos.applications)
                    toasts.post(trashedText, undo) { result ->
                        if (result == RrToastResult.ActionPerformed) runCatching { moves.untrash(id, stamp) }
                            .onFailure { toasts.show(saveFailed, tone = RrToastTone.Danger) }
                    }
                }.onFailure { toasts.show(saveFailed, tone = RrToastTone.Danger) }
            }
        },
        onPatch = { body, clear -> scope.launch { saved(vm.patch(body, clear)) } },
        onAddNote = { text -> scope.launch { saved(vm.addNote(text)) } },
        onRetry = vm::retry,
        onTab = { t -> nav.navigate(ApplicationWorkspace(id, t)) },
        openPosting = openPosting,
    )
}

@Composable
internal fun workspaceTabLabel(tab: WorkspaceTab): String = when (tab) {
    WorkspaceTab.Overview -> stringResource(R.string.app_overview)
    WorkspaceTab.Fit -> stringResource(S.string.fit)
    WorkspaceTab.Apply -> stringResource(S.string.apply)
    WorkspaceTab.Prepare -> stringResource(S.string.interview_prep)
    WorkspaceTab.Practise -> stringResource(S.string.practice)
    WorkspaceTab.Debrief -> stringResource(S.string.debrief)
    WorkspaceTab.Messages -> stringResource(S.string.messages)
    WorkspaceTab.Saved -> stringResource(S.string.application_workspace_tab_earlier_results_kept_for_this_job_library)
}

/** Which in-screen sheet is open. */
internal enum class DetailSheet { Edit, Tags, FollowUp, Note, Posting, People, Notes, Timeline }

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun ApplicationScreen(
    state: ApplicationState,
    time: TimeSource,
    onBack: () -> Unit,
    onCoach: () -> Unit,
    onMove: () -> Unit,
    onInterview: (String?) -> Unit,
    onAddToCalendar: (Interview) -> Unit,
    onOpenResume: (String) -> Unit,
    onOpenLetter: (String) -> Unit,
    onPrepareResume: () -> Unit,
    onOffers: () -> Unit,
    onEmail: (String) -> Unit,
    onOpenLink: (String) -> Unit,
    onLogFollowUp: () -> Unit,
    onReopen: () -> Unit,
    onTrash: () -> Unit,
    onPatch: (PatchApplicationRequest, Set<String>) -> Unit,
    onAddNote: (String) -> Unit,
    onRetry: () -> Unit,
    onTab: (WorkspaceTab) -> Unit,
    openPosting: Boolean = false,
    obscured: Boolean = false,
) {
    val c = RrTheme.colors
    val app = state.app
    val dates = rememberDates(time.timezone())
    var menu by remember { mutableStateOf(false) }
    var sheet by remember { mutableStateOf(if (openPosting) DetailSheet.Posting else null) }
    Box(Modifier.fillMaxSize().background(c.bg)) {
        if (obscured && app != null) ApplicationBackdrop(app.company, onBack)
        else Column(Modifier.fillMaxSize()) {
            RrTopBar(
                onBack = onBack,
                backLabel = stringResource(S.string.back_to_applications),
                flat = true,
                actions = {
                    Box {
                        RrIconButton(D.drawable.ic_ph_dots_three, stringResource(R.string.app_options), { menu = true }, enabled = app != null)
                        RrMenu(menu, { menu = false }) {
                            RrMenuItem(stringResource(S.string.ask_the_coach), { menu = false; onCoach() }, icon = D.drawable.ic_ph_sparkle)
                            RrMenuItem(stringResource(R.string.app_edit_details), { menu = false; sheet = DetailSheet.Edit }, icon = D.drawable.ic_ph_pencil_simple)
                            RrMenuItem(stringResource(S.string.tags_17a9c1428a), { menu = false; sheet = DetailSheet.Tags }, icon = D.drawable.ic_ph_tag)
                            RrMenuItem(stringResource(if (app?.followUpAt != null) R.string.app_change_follow_up else R.string.app_set_follow_up), { menu = false; sheet = DetailSheet.FollowUp }, icon = D.drawable.ic_ph_bell_simple)
                            if (app?.status == ApplicationStage.Closed) RrMenuItem(stringResource(S.string.reopen), { menu = false; onReopen() }, icon = D.drawable.ic_ph_arrow_counter_clockwise)
                            if (app?.status != ApplicationStage.Closed) RrMenuItem(stringResource(S.string.mark_as_closed_ad3ca6020c), { menu = false; onMove() }, icon = D.drawable.ic_ph_check_circle)
                            RrMenuItem(stringResource(S.string.move_to_trash), { menu = false; onTrash() }, icon = D.drawable.ic_ph_trash, danger = true)
                        }
                    }
                },
            )
            if (state.offline) RrOfflineStrip()
            when {
                app == null && state.failed -> LoadFailed(onRetry)
                app == null -> OverviewSkeleton()
                else -> Overview(app, state, state.nextStep(time), dates, onTab, onInterview, onAddToCalendar,
                    onOpenResume, onOpenLetter, onPrepareResume, onOffers, onEmail, onLogFollowUp,
                    onMove = onMove, onSheet = { sheet = it })
            }
        }
        if (app != null) when (sheet) {
            DetailSheet.Edit -> EditDetailsSheet(app, onDismiss = { sheet = null }, onSave = { body, clear -> onPatch(body, clear); sheet = null })
            DetailSheet.Tags -> TagsSheet(app.tags, onDismiss = { sheet = null }, onSave = { onPatch(PatchApplicationRequest(tags = it), emptySet()); sheet = null })
            DetailSheet.FollowUp -> FollowUpSheet(app, time, onDismiss = { sheet = null }, onSave = { body, clear -> onPatch(body, clear); sheet = null })
            DetailSheet.Note -> NoteSheet(onDismiss = { sheet = null }, onSave = { onAddNote(it); sheet = null })
            DetailSheet.Posting -> PostingSheet(app, onDismiss = { sheet = null }, onOpenLink = onOpenLink, onSave = { onPatch(PatchApplicationRequest(jobDescription = it), emptySet()); sheet = null })
            DetailSheet.People -> RrBottomSheet({ sheet = null }, title = stringResource(R.string.app_people), fitContent = true) {
                app.contacts.forEach { person ->
                    RrListRow(person.name, subtitle = person.role, onClick = person.email?.let { { onEmail(it) } }, trailing = { RrRowCaret() })
                }
            }
            DetailSheet.Notes -> RrBottomSheet({ sheet = null }, title = stringResource(S.string.notes), fitContent = true) {
                RrText(app.notes.orEmpty(), Modifier.padding(24.dp), style = RrType.prose)
                app.activity.filterIsInstance<NoteTimelineEntry>().forEach { TimelineRow(it, dates) }
                RrListRow(stringResource(S.string.log_an_update_0da350a096), icon = D.drawable.ic_ph_plus, onClick = { sheet = DetailSheet.Note })
            }
            DetailSheet.Timeline -> RrBottomSheet({ sheet = null }, title = stringResource(R.string.app_timeline), fitContent = true) {
                app.activity.sortedByDescending(::entryAt).forEach { TimelineRow(it, dates) }
            }
            null -> Unit
        }
    }
}

@Composable
private fun LoadFailed(onRetry: () -> Unit) {
    Box(Modifier.fillMaxSize().padding(16.dp)) {
        RrEmptyState(
            title = stringResource(R.string.app_couldnt_load),
            body = "",
            actionLabel = stringResource(S.string.try_again),
            onAction = onRetry,
        )
    }
}

@Composable
private fun OverviewSkeleton() {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        RrSkeleton(Modifier.fillMaxWidth().height(132.dp))
        RrSkeletonText(Modifier.fillMaxWidth(), lines = 3)
        RrSkeleton(Modifier.fillMaxWidth().height(104.dp))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Overview(
    app: Application,
    state: ApplicationState,
    step: ApplicationNextStep?,
    dates: Dates,
    onTab: (WorkspaceTab) -> Unit,
    onInterview: (String?) -> Unit,
    onAddToCalendar: (Interview) -> Unit,
    onOpenResume: (String) -> Unit,
    onOpenLetter: (String) -> Unit,
    onPrepareResume: () -> Unit,
    onOffers: () -> Unit,
    onEmail: (String) -> Unit,
    onLogFollowUp: () -> Unit,
    onMove: () -> Unit,
    onSheet: (DetailSheet) -> Unit,
) {
    val c = RrTheme.colors
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        RrPageTitle(app.company, subtitle = listOfNotNull(app.role, app.location?.takeIf(String::isNotBlank)).joinToString(" · "), subtitleColor = c.ink3)
        if (step != null) NextStepCard(app, state, step, dates, onTab, onInterview, onAddToCalendar, onOffers, onLogFollowUp)
        RrSectionHeader(stringResource(R.string.app_work_on_it))
        val fit = state.saved.filter { it.data is me.rxresu.core.network.generated.FitResult }.maxByOrNull { it.createdAt }?.data as? me.rxresu.core.network.generated.FitResult
        val briefing = state.saved.any { it.data is me.rxresu.core.network.generated.Briefing && !it.outdated }
        val practiceAt = state.saved.filter { it.data is me.rxresu.core.network.generated.PracticeAttempt }.maxByOrNull { it.createdAt }?.createdAt?.let(Instant::parse)
        val applied = app.activity.filterIsInstance<StageTimelineEntry>().firstOrNull { it.stage == ApplicationStage.Applied }?.at?.let(Instant::parse)
        val draft = state.saved.any { it.data is me.rxresu.core.network.generated.MessageDraft }
        val tools = listOf(
            Triple(WorkspaceTab.Fit, D.drawable.ic_ph_target, fit?.headline),
            Triple(WorkspaceTab.Apply, R.drawable.ic_ph_paper_plane_tilt, applied?.let { stringResource(R.string.app_sent_on, dates.dayMonth(it)) }),
            Triple(WorkspaceTab.Prepare, R.drawable.ic_ph_chalkboard_teacher, if (briefing) stringResource(S.string.briefing_ready) else null),
            Triple(WorkspaceTab.Practise, D.drawable.ic_ph_microphone, practiceAt?.let { pluralStringResource(R.plurals.app_last_session_days, Duration.between(it, state.now).toDays().toInt(), Duration.between(it, state.now).toDays().toInt()) }),
            Triple(WorkspaceTab.Debrief, D.drawable.ic_ph_note_pencil, state.interview?.let { stringResource(R.string.app_after_interview, java.time.format.DateTimeFormatter.ofPattern("EEEE", dates.locale).format(Instant.parse(it.at).atZone(dates.zone))) }),
            Triple(WorkspaceTab.Messages, D.drawable.ic_ph_envelope_simple, if (draft) stringResource(R.string.app_note_drafted) else null),
            Triple(WorkspaceTab.Saved, R.drawable.ic_ph_books, stringResource(R.string.app_library_description)),
        )
        tools.forEachIndexed { i, (tab, icon, subtitle) ->
            RrListRow(workspaceTabLabel(tab), subtitle = subtitle, tile = icon, divider = i < tools.lastIndex,
                onClick = { onTab(tab) }, trailing = { RrRowCaret() })
        }
        RrSectionHeader(stringResource(R.string.app_details))
        RrListRow(stringResource(S.string.stage), onClick = onMove, divider = true, trailing = {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    me.rxresu.core.designsystem.RrStageDot(app.status.rr())
                    RrText(stageLabel(app.status), style = RrType.ui, color = c.ink3)
                }
                RrRowCaret()
            }
        })
        RrListRow(stringResource(S.string.posting), onClick = { onSheet(DetailSheet.Posting) }, divider = true, trailing = { RrRowCaret() })
        RrListRow(stringResource(R.string.app_people), subtitle = app.contacts.joinToString(", ") { it.name }.ifEmpty { null }, onClick = { onSheet(DetailSheet.People) }, divider = true, trailing = { RrRowCaret() })
        val notes = app.activity.filterIsInstance<NoteTimelineEntry>().size + if (app.notes.isNullOrBlank()) 0 else 1
        RrListRow(stringResource(S.string.notes), subtitle = pluralStringResource(R.plurals.app_note_count, notes, notes), onClick = { onSheet(DetailSheet.Notes) }, divider = true, trailing = { RrRowCaret() })
        val saved = app.createdAt.let { runCatching { dates.dayMonth(Instant.parse(it)) }.getOrNull() }
        RrListRow(stringResource(R.string.app_timeline), subtitle = listOfNotNull(saved?.let { stringResource(R.string.app_saved_date, it) }, applied?.let { stringResource(R.string.app_applied_date, dates.dayMonth(it)) }).joinToString(" · "), onClick = { onSheet(DetailSheet.Timeline) }, trailing = { RrRowCaret() })
        Spacer(Modifier.rrNavigationBarsPadding())
    }
}

private fun entryAt(entry: me.rxresu.core.network.generated.TimelineEntry): String = when (entry) {
    is StageTimelineEntry -> entry.at
    is NoteTimelineEntry -> entry.at
    is Interview -> entry.at
    else -> ""
}

@Composable
private fun TimelineRow(entry: me.rxresu.core.network.generated.TimelineEntry, dates: Dates) {
    val at = entryAt(entry).let { runCatching { Instant.parse(it) }.getOrNull() }
    val date = at?.let(dates::dayMonth)
    when (entry) {
        is StageTimelineEntry -> {
            val title = if (entry.stage == ApplicationStage.Closed && entry.closedReason != null) stringResource(R.string.app_timeline_closed, closedReasonLabel(entry.closedReason!!))
            else stringResource(R.string.app_timeline_moved, entry.laneLabel ?: stageLabel(entry.stage))
            RrListRow(title, subtitle = date, leading = { RrStageLabel(entry.stage.rr(), "") })
        }
        is NoteTimelineEntry -> RrListRow(entry.text, subtitle = date, icon = D.drawable.ic_ph_note)
        is Interview -> RrListRow(stringResource(S.string.kind_interview, interviewKindLabel(entry.kind)), subtitle = at?.let(dates::whenWithTime), icon = D.drawable.ic_ph_calendar_blank)
        else -> Unit
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NextStepCard(
    app: Application,
    state: ApplicationState,
    step: ApplicationNextStep,
    dates: Dates,
    onTab: (WorkspaceTab) -> Unit,
    onInterview: (String?) -> Unit,
    onAddToCalendar: (Interview) -> Unit,
    onOffers: () -> Unit,
    onLogFollowUp: () -> Unit,
) {
    val c = RrTheme.colors
    val text = describeNextStep(step, app, dates)
    RrHeroCard {
        val interview = step.interview
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (step.kind == NextStepKind.Interview) me.rxresu.core.designsystem.RrStageDot(ApplicationStage.Interview.rr())
        RrText(if (step.kind == NextStepKind.Interview && step.at != null) stringResource(R.string.app_next_at, java.time.format.DateTimeFormatter.ofPattern("EEEE d MMM, HH:mm", dates.locale).format(step.at!!.atZone(dates.zone))) else stringResource(S.string.next_step), style = RrType.keyLine, color = c.ink3)
        }
        RrText(text.title, style = RrType.heading, color = if (text.tone == StepTone.Warn) c.warnText else c.ink)
        val people = interview?.participants.orEmpty().joinToString(" and ") { it.name }
        val location = interview?.location?.takeIf(String::isNotBlank)
        val sub = if (step.kind == NextStepKind.Interview && people.isNotBlank()) listOfNotNull(
            stringResource(R.string.app_with_people, people),
            location?.let { if (it.startsWith("http://") || it.startsWith("https://") || it.startsWith("meet.")) stringResource(R.string.app_video_call).lowercase(dates.locale) else it },
        ).joinToString(" · ") else text.sub
        if (sub.isNotBlank()) RrText(sub, style = RrType.body, color = c.ink2)
        val action: Pair<String, () -> Unit>? = when (step.kind) {
            NextStepKind.Interview -> stringResource(S.string.open_briefing) to { onTab(WorkspaceTab.Prepare) }
            NextStepKind.FollowUp, NextStepKind.NoReply -> stringResource(R.string.app_draft_follow_up) to { onTab(WorkspaceTab.Messages) }
            NextStepKind.Offer -> stringResource(if (step.terms) S.string.compare_offers else S.string.add_the_offer_s_terms) to onOffers
            NextStepKind.NotApplied -> stringResource(S.string.confirm_applied) to { onTab(WorkspaceTab.Apply) }
            NextStepKind.NoInterview -> stringResource(S.string.schedule_interview) to { onInterview(null) }
            NextStepKind.InterviewFeedback -> stringResource(S.string.debrief) to { onTab(WorkspaceTab.Debrief) }
            else -> null
        }
        action?.let { (label, click) -> RrButton(label, click, Modifier.fillMaxWidth().padding(top = 8.dp), size = RrButtonSize.Large) }
    }
}

/** Sheets keep only the application's title visible behind their scrim. */
@Composable
internal fun ApplicationBackdrop(company: String, onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg)) {
        RrTopBar(onBack = onBack)
        RrPageTitle(company)
    }
}
