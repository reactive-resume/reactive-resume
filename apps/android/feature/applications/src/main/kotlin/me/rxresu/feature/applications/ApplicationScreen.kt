package me.rxresu.feature.applications

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.ui.draw.clip
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
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.launch
import me.rxresu.core.data.ApplicationNextStep
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.NextStepKind
import me.rxresu.core.data.TimeSource
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.designsystem.RrAvatar
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
import me.rxresu.core.designsystem.RrShape
import me.rxresu.core.designsystem.RrSkeleton
import me.rxresu.core.designsystem.RrSkeletonText
import me.rxresu.core.designsystem.RrStage
import me.rxresu.core.designsystem.RrStageLabel
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrToastTone
import me.rxresu.core.designsystem.RrTopBar
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.RrUnderlineTab
import me.rxresu.core.designsystem.RrUnderlineTabs
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.Builder
import me.rxresu.core.navigation.Coach
import me.rxresu.core.navigation.InterviewSheet
import me.rxresu.core.navigation.Letter
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.LocalWorkspaceTab
import me.rxresu.core.navigation.MoveApplication
import me.rxresu.core.navigation.Offers
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.Interview
import me.rxresu.core.network.generated.NoteTimelineEntry
import me.rxresu.core.network.generated.PatchApplicationRequest
import me.rxresu.core.network.generated.StageTimelineEntry
import me.rxresu.core.designsystem.RrToastResult
import me.rxresu.core.strings.R as S

/**
 * J6 and the workspace frame (W1–W5): top bar, stage row on Overview, the scrollable tab strip, and one page per tab.
 * Overview is drawn here; every other tab is `LocalWorkspaceTab` (filled by :feature:workspace).
 */
@Composable
fun ApplicationRoute(id: String, tab: WorkspaceTab, nav: NavController) {
    val repos = LocalRepositories.current
    val vm = viewModel(key = "application:$id") {
        ApplicationViewModel(repos.applications, repos.career, repos.resumes, repos.documents, repos.time, id)
    }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val haptics = rememberRrHaptics()
    val workspaceTab = LocalWorkspaceTab.current
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
        time = vm.time,
        initialTab = tab,
        onBack = { nav.popBackStack() },
        onCoach = { nav.navigate(Coach()) },
        onMove = { nav.navigate(MoveApplication(id)) },
        onInterview = { interviewId -> nav.navigate(InterviewSheet(id, interviewId)) },
        onAddToCalendar = { interview ->
            val start = Instant.parse(interview.at)
            addToCalendar(context, CalendarEvent(interview.id, eventTitle, start, interview.durationMinutes ?: 60, interview.location, interview.notes), vm.time.now())
        },
        onOpenResume = { nav.navigate(Builder(it)) },
        onOpenLetter = { nav.navigate(Letter(it)) },
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
                    if (toasts.show(trashedText, undo) == RrToastResult.ActionPerformed) vm.untrash(stamp)
                }.onFailure { toasts.show(saveFailed, tone = RrToastTone.Danger) }
            }
        },
        onPatch = { body, clear -> scope.launch { saved(vm.patch(body, clear)) } },
        onAddNote = { text -> scope.launch { saved(vm.addNote(text)) } },
        onRetry = vm::retry,
        workspaceTab = { t -> workspaceTab(id, t, nav) },
    )
}

/** Tabs in strip order. */
internal val WorkspaceTabs = WorkspaceTab.entries

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
internal enum class DetailSheet { Edit, Tags, FollowUp, Note, Posting }

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun ApplicationScreen(
    state: ApplicationState,
    time: TimeSource,
    initialTab: WorkspaceTab,
    onBack: () -> Unit,
    onCoach: () -> Unit,
    onMove: () -> Unit,
    onInterview: (String?) -> Unit,
    onAddToCalendar: (Interview) -> Unit,
    onOpenResume: (String) -> Unit,
    onOpenLetter: (String) -> Unit,
    onOffers: () -> Unit,
    onEmail: (String) -> Unit,
    onOpenLink: (String) -> Unit,
    onLogFollowUp: () -> Unit,
    onReopen: () -> Unit,
    onTrash: () -> Unit,
    onPatch: (PatchApplicationRequest, Set<String>) -> Unit,
    onAddNote: (String) -> Unit,
    onRetry: () -> Unit,
    workspaceTab: @Composable (WorkspaceTab) -> Unit,
) {
    val c = RrTheme.colors
    val app = state.app
    val dates = rememberDates(time.timezone())
    val pager = rememberPagerState(initialPage = WorkspaceTabs.indexOf(initialTab)) { WorkspaceTabs.size }
    val scope = rememberCoroutineScope()
    val reduced = LocalReducedMotion.current
    val haptics = rememberRrHaptics()
    var menu by remember { mutableStateOf(false) }
    var sheet by remember { mutableStateOf<DetailSheet?>(null) }
    // A sideways swipe is a tab change too: `selection` once it settles on a new tab (taps play it in the strip).
    var tapped by remember { mutableStateOf(-1) }
    LaunchedEffect(pager) {
        var last = pager.settledPage
        snapshotFlow { pager.settledPage }.collect { page ->
            if (page != last && page != tapped) haptics(RrHaptic.Selection)
            last = page
            tapped = -1
        }
    }

    Box(Modifier.fillMaxSize().background(c.bg)) {
        Column(Modifier.fillMaxSize()) {
            RrTopBar(
                title = app?.company.orEmpty(),
                onBack = onBack,
                backLabel = stringResource(S.string.back_to_applications),
                flat = true,
                status = app?.let { a -> { RrText(listOfNotNull(a.role, a.location?.takeIf(String::isNotBlank)).joinToString(" · "), maxLines = 1) } },
                actions = {
                    RrIconButton(D.drawable.ic_ph_sparkle, stringResource(S.string.ask_the_coach), onCoach, tint = c.accentText)
                    Box {
                        RrIconButton(D.drawable.ic_ph_dots_three, stringResource(R.string.app_options), { menu = true }, enabled = app != null)
                        RrMenu(menu, { menu = false }) {
                            RrMenuItem(stringResource(R.string.app_edit_details), { menu = false; sheet = DetailSheet.Edit }, icon = D.drawable.ic_ph_pencil_simple)
                            RrMenuItem(stringResource(S.string.tags_17a9c1428a), { menu = false; sheet = DetailSheet.Tags }, icon = D.drawable.ic_ph_tag)
                            RrMenuItem(stringResource(if (app?.followUpAt != null) R.string.app_change_follow_up else R.string.app_set_follow_up), { menu = false; sheet = DetailSheet.FollowUp }, icon = D.drawable.ic_ph_bell_simple)
                            if (app?.status != ApplicationStage.Closed) RrMenuItem(stringResource(S.string.mark_as_closed_ad3ca6020c), { menu = false; onMove() }, icon = D.drawable.ic_ph_check_circle)
                            RrMenuItem(stringResource(S.string.move_to_trash), { menu = false; onTrash() }, icon = D.drawable.ic_ph_trash, danger = true)
                        }
                    }
                },
            )
            if (state.offline) RrOfflineStrip()
            if (app != null && pager.currentPage == 0) StageRow(app, state.lanes, onMove, onReopen)
            RrUnderlineTabs(
                tabs = WorkspaceTabs.map { t -> tabWithBadge(t, state) },
                selectedIndex = pager.currentPage,
                onSelect = { i -> tapped = i; scope.launch { if (reduced) pager.scrollToPage(i) else pager.animateScrollToPage(i, animationSpec = androidx.compose.animation.core.tween(RrMotion.D3, easing = RrMotion.easeInOutStrong)) } },
            )
            HorizontalPager(pager, Modifier.weight(1f).fillMaxWidth(), beyondViewportPageCount = 0, key = { WorkspaceTabs[it] }) { page ->
                val t = WorkspaceTabs[page]
                Box(Modifier.fillMaxSize()) {
                    when {
                        app == null && state.failed -> LoadFailed(onRetry)
                        app == null -> OverviewSkeleton()
                        t == WorkspaceTab.Overview -> Overview(
                            app = app,
                            state = state,
                            step = state.nextStep(time),
                            dates = dates,
                            onTab = { next -> scope.launch { pager.animateScrollToPage(WorkspaceTabs.indexOf(next)) } },
                            onInterview = onInterview,
                            onAddToCalendar = onAddToCalendar,
                            onOpenResume = onOpenResume,
                            onOpenLetter = onOpenLetter,
                            onOffers = onOffers,
                            onEmail = onEmail,
                            onLogFollowUp = onLogFollowUp,
                            onSheet = { sheet = it },
                        )
                        else -> workspaceTab(t)
                    }
                }
            }
        }
        if (app != null) when (sheet) {
            DetailSheet.Edit -> EditDetailsSheet(app, onDismiss = { sheet = null }, onSave = { body, clear -> onPatch(body, clear); sheet = null })
            DetailSheet.Tags -> TagsSheet(app.tags, onDismiss = { sheet = null }, onSave = { onPatch(PatchApplicationRequest(tags = it), emptySet()); sheet = null })
            DetailSheet.FollowUp -> FollowUpSheet(app, time, onDismiss = { sheet = null }, onSave = { body, clear -> onPatch(body, clear); sheet = null })
            DetailSheet.Note -> NoteSheet(onDismiss = { sheet = null }, onSave = { onAddNote(it); sheet = null })
            DetailSheet.Posting -> PostingSheet(app, onDismiss = { sheet = null }, onOpenLink = onOpenLink)
            null -> Unit
        }
    }
}

/** Badges after tab labels (web shell): Interview prep counts down to the interview, Messages flags a reply, Library counts. */
@Composable
private fun tabWithBadge(tab: WorkspaceTab, state: ApplicationState): RrUnderlineTab {
    val label = workspaceTabLabel(tab)
    return when (tab) {
        WorkspaceTab.Prepare -> {
            val minutes = state.interview?.let { Duration.between(state.now, Instant.parse(it.at)).toMinutes() }
            if (minutes == null || minutes <= 0 || minutes >= 7 * 24 * 60) RrUnderlineTab(label)
            else {
                val text = when {
                    minutes <= 60 -> stringResource(R.string.app_minutes_short, minutes.toInt())
                    minutes < 48 * 60 -> stringResource(R.string.app_hours_short, Math.round(minutes / 60.0).toInt())
                    else -> pluralStringResource(R.plurals.app_days_short, Math.round(minutes / 1440.0).toInt(), Math.round(minutes / 1440.0).toInt())
                }
                RrUnderlineTab(label, text, warn = minutes <= 60)
            }
        }
        WorkspaceTab.Messages -> if (state.unreadMessages > 0) RrUnderlineTab(label, state.unreadMessages.toString()) else RrUnderlineTab(label)
        WorkspaceTab.Saved -> if (state.saved.isNotEmpty()) RrUnderlineTab(label, state.saved.size.toString()) else RrUnderlineTab(label)
        else -> RrUnderlineTab(label)
    }
}

/** Stage as dot, name and stepper, with Move to… beside it; a closed application reads "Closed · reason" with Reopen. */
@Composable
private fun StageRow(app: Application, lanes: List<Lane>, onMove: () -> Unit, onReopen: () -> Unit) {
    val lane = displayLane(lanes, app)
    val name = lane?.let { laneLabel(it) } ?: stageLabel(app.status)
    val closed = app.status == ApplicationStage.Closed
    val label = if (closed && app.closedReason != null) stringResource(R.string.app_stage_closed_reason, name, closedReasonLabel(app.closedReason!!)) else name
    Row(
        Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RrStageLabel(app.status.rr(), label, style = RrType.label)
        if (!closed) PipelineStepper(app.status, Modifier.weight(1f)) else Spacer(Modifier.weight(1f))
        if (closed) RrButton(stringResource(S.string.reopen), onReopen, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
        else RrButton(stringResource(S.string.move_to_6ffcfca36b), onMove, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
    }
}

/**
 * Pipeline stepper bar: one 4 dp segment per open stage, each reached stage in its own colour (as the web header draws
 * it), the rest `line`. Decorative beside the stage name.
 */
// TODO(lead): move to designsystem — RrStageStepper with an inline layout and per-stage segment colours.
@Composable
private fun PipelineStepper(current: ApplicationStage, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    val reached = Pipeline.indexOf(current)
    val reduced = LocalReducedMotion.current
    Row(modifier.semantics { contentDescription = "" }, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Pipeline.forEachIndexed { i, stage ->
            val color by androidx.compose.animation.animateColorAsState(if (i <= reached) stage.rr().color else c.line, RrMotion.spec(RrMotion.D2, reduced), label = "segment")
            Box(Modifier.weight(1f).height(4.dp).clip(RrShape.sm).background(color))
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
    onOffers: () -> Unit,
    onEmail: (String) -> Unit,
    onLogFollowUp: () -> Unit,
    onSheet: (DetailSheet) -> Unit,
) {
    val c = RrTheme.colors
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        if (step != null) NextStepCard(app, state, step, dates, onTab, onInterview, onAddToCalendar, onOffers, onLogFollowUp)

        if (app.contacts.isNotEmpty()) {
            RrSectionHeader(stringResource(S.string.who_you_ll_meet))
            RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                app.contacts.forEach { person ->
                    RrListRow(
                        title = person.name,
                        subtitle = listOfNotNull(person.role?.takeIf(String::isNotBlank), person.type?.takeIf { it.isNotBlank() && it != person.role }).joinToString(" · ").ifEmpty { null },
                        leading = { RrAvatar(initials(person.name)) },
                        trailing = person.email?.takeIf(String::isNotBlank)?.let { email ->
                            { RrIconButton(D.drawable.ic_ph_envelope_simple, stringResource(R.string.app_email_person, person.name), { onEmail(email) }, size = RrIconButtonSize.Small) }
                        },
                    )
                }
            }
        }

        val sentOn = app.activity.filterIsInstance<StageTimelineEntry>().firstOrNull { it.stage == ApplicationStage.Applied }?.at
            ?.let { dates.dayMonth(Instant.parse(it)) }
        if (app.resumeId != null || app.coverLetterId != null) {
            RrSectionHeader(stringResource(S.string.what_you_sent))
            RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                app.resumeId?.let { rid ->
                    RrListRow(
                        title = state.sent.resumeName ?: stringResource(S.string.resume),
                        subtitle = when {
                            state.sent.resumeVersion != null && sentOn != null -> stringResource(R.string.app_resume_sent, state.sent.resumeVersion, sentOn)
                            sentOn != null -> stringResource(R.string.app_resume_sent_plain, sentOn)
                            else -> stringResource(S.string.resume)
                        },
                        icon = D.drawable.ic_ph_file_text,
                        onClick = { onOpenResume(rid) },
                        trailing = { RrRowCaret() },
                    )
                }
                app.coverLetterId?.let { lid ->
                    RrListRow(
                        title = state.sent.letterName ?: stringResource(S.string.letter),
                        subtitle = sentOn?.let { stringResource(R.string.app_letter_sent, it) } ?: stringResource(S.string.letter),
                        icon = D.drawable.ic_ph_note_pencil,
                        onClick = { onOpenLetter(lid) },
                        trailing = { RrRowCaret() },
                    )
                }
            }
        }

        RrSectionHeader(stringResource(S.string.more))
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            RrListRow(
                title = stringResource(S.string.posting),
                subtitle = if (app.jobDescription.isNullOrBlank()) stringResource(R.string.app_no_posting)
                else hostOf(app.sourceUrl)?.let { stringResource(R.string.app_posting_saved, it) } ?: stringResource(S.string.saved_description),
                icon = D.drawable.ic_ph_clipboard_text,
                onClick = { onSheet(DetailSheet.Posting) },
                trailing = { RrRowCaret() },
            )
        }

        // Below the fold: notes, activity, tags and the details the web shows beside every tab.
        RrSectionHeader(stringResource(S.string.notes), actionLabel = stringResource(S.string.edit), onAction = { onSheet(DetailSheet.Edit) })
        RrCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            RrText(app.notes?.takeIf(String::isNotBlank) ?: stringResource(R.string.app_no_notes), style = RrType.body, color = if (app.notes.isNullOrBlank()) c.ink3 else c.ink)
        }

        RrSectionHeader(stringResource(S.string.activity), actionLabel = stringResource(S.string.log_an_update_0da350a096), onAction = { onSheet(DetailSheet.Note) })
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            app.activity.sortedByDescending { entryAt(it) }.take(8).forEach { entry -> TimelineRow(entry, dates) }
        }

        RrSectionHeader(stringResource(S.string.tags), actionLabel = stringResource(S.string.edit), onAction = { onSheet(DetailSheet.Tags) })
        FlowRow(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (app.tags.isEmpty()) RrText(stringResource(R.string.app_no_tags), style = RrType.small, color = c.ink3)
            app.tags.forEach { RrContextChip(it, icon = D.drawable.ic_ph_tag) }
        }

        RrSectionHeader(stringResource(S.string.contact_details))
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                RrKeyValue(stringResource(S.string.source), app.source?.takeIf(String::isNotBlank) ?: stringResource(R.string.app_not_set))
                RrKeyValue(stringResource(S.string.salary), app.salary?.takeIf(String::isNotBlank) ?: stringResource(R.string.app_not_set))
                RrKeyValue(stringResource(S.string.location), app.location?.takeIf(String::isNotBlank) ?: stringResource(R.string.app_not_set))
                app.sourceUrl?.takeIf(String::isNotBlank)?.let { RrKeyValue(stringResource(R.string.app_source_url), it, mono = true) }
                app.contacts.forEach { p ->
                    listOfNotNull(p.email?.takeIf(String::isNotBlank), p.phone?.takeIf(String::isNotBlank)).forEach { RrKeyValue(p.name, it, mono = true) }
                }
            }
        }
        Spacer(Modifier.height(24.dp))
        Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
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
    val sub = if (step.kind == NextStepKind.Interview && step.at != null) {
        val days = Duration.between(state.now, step.at).toDays().toInt()
        val rel = if (days >= 1) pluralStringResource(R.plurals.app_in_days, days, days) else stringResource(R.string.app_today)
        listOfNotNull(step.interview?.durationMinutes?.let { stringResource(R.string.app_minutes_length, it.toInt()) }, step.interview?.location?.takeIf(String::isNotBlank), rel).joinToString(" · ")
    } else text.sub
    val title = if (step.kind == NextStepKind.Interview && step.at != null) "${text.title} · ${dates.whenWithTime(step.at!!)}" else text.title
    RrCard(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 14.dp), raised = true) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            RrText(stringResource(if (step.kind == NextStepKind.Closed) S.string.outcome else S.string.next_step), style = RrType.eyebrow, color = c.ink3)
            Column {
                RrText(title, style = RrType.label, color = if (text.tone == StepTone.Warn) c.warnText else c.ink)
                if (sub.isNotBlank()) RrText(sub, style = RrType.small, color = c.ink3)
            }
            // One line that scrolls sideways when the actions are wider than the card (large fonts).
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val sm = RrButtonSize.Small
                when (step.kind) {
                    NextStepKind.Interview -> {
                        RrButton(stringResource(S.string.open_briefing), { onTab(WorkspaceTab.Prepare) }, size = sm)
                        RrButton(stringResource(S.string.edit_interview), { onInterview(step.interview?.id) }, variant = RrButtonVariant.Secondary, size = sm)
                        step.interview?.let { i -> RrButton(stringResource(S.string.add_to_calendar), { onAddToCalendar(i) }, variant = RrButtonVariant.Ghost, size = sm, icon = D.drawable.ic_ph_calendar_plus) }
                    }
                    NextStepKind.FollowUp, NextStepKind.NoReply -> {
                        RrButton(stringResource(R.string.app_draft_follow_up), { onTab(WorkspaceTab.Messages) }, size = sm)
                        RrButton(stringResource(R.string.app_log_follow_up), onLogFollowUp, variant = RrButtonVariant.Secondary, size = sm)
                    }
                    NextStepKind.Offer -> {
                        if (step.terms) RrButton(stringResource(S.string.compare_offers), onOffers, size = sm)
                        else RrButton(stringResource(S.string.add_the_offer_s_terms), { onTab(WorkspaceTab.Messages) }, size = sm)
                    }
                    NextStepKind.NotApplied -> RrButton(stringResource(S.string.confirm_applied), { onTab(WorkspaceTab.Apply) }, size = sm)
                    NextStepKind.NoInterview -> RrButton(stringResource(S.string.schedule_interview), { onInterview(null) }, size = sm)
                    NextStepKind.InterviewFeedback -> RrButton(stringResource(S.string.debrief), { onTab(WorkspaceTab.Debrief) }, variant = RrButtonVariant.Secondary, size = sm)
                    NextStepKind.Waiting, NextStepKind.Closed -> Unit
                }
            }
        }
    }
}
