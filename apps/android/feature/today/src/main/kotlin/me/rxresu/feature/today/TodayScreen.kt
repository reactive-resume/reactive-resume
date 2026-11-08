package me.rxresu.feature.today

import android.text.format.DateFormat
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneId
import me.rxresu.core.data.FirstRun
import me.rxresu.core.data.TodayItem
import me.rxresu.core.data.TodayKind
import me.rxresu.core.designsystem.R as DS
import me.rxresu.core.designsystem.RrAvatar
import me.rxresu.core.designsystem.RrBadge
import me.rxresu.core.designsystem.RrBadgeTone
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrCheckbox
import me.rxresu.core.designsystem.RrEmptyState
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrIconButtonSize
import me.rxresu.core.designsystem.RrLargeTitleHeader
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrOfflineStrip
import me.rxresu.core.designsystem.RrPullToRefresh
import me.rxresu.core.designsystem.RrRowCaret
import me.rxresu.core.designsystem.RrSectionHeader
import me.rxresu.core.designsystem.RrSkeleton
import me.rxresu.core.designsystem.RrStage
import me.rxresu.core.designsystem.RrStageDot
import me.rxresu.core.designsystem.RrSwipeAction
import me.rxresu.core.designsystem.RrSwipeRow
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.designsystem.rememberRrLargeTitleState
import me.rxresu.core.designsystem.rrLargeTitleScroll
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.network.generated.AddApplicationInterviewRequestKind
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.CareerSchedule
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.network.generated.DocumentType
import me.rxresu.core.network.generated.Opportunity
import me.rxresu.core.strings.R as S

/** Everything the Today screen can ask for. Defaults do nothing, for previews and screenshots. */
class TodayActions(
    val onSearch: () -> Unit = {},
    val onSettings: () -> Unit = {},
    val onRefresh: () -> Unit = {},
    val onRetry: () -> Unit = {},
    /** Opens the application (J6), or a workspace tab of it. */
    val onOpenApplication: (id: String, tab: WorkspaceTab) -> Unit = { _, _ -> },
    val onNotification: (TodayEntry) -> Unit = {},
    val onCompareOffers: () -> Unit = {},
    val onLogFollowUp: (applicationId: String) -> Unit = {},
    val onMarkRead: (TodayItem) -> Unit = {},
    val onCalendar: () -> Unit = {},
    val onTrack: (Opportunity) -> Unit = {},
    val onNotForMe: (Opportunity) -> Unit = {},
    val onToggleRole: (String) -> Unit = {},
    val onClearSelection: () -> Unit = {},
    val onApplySelection: (track: Boolean) -> Unit = {},
    val onOpenSchedule: (id: String?) -> Unit = {},
    val onOpenDocument: (DocumentSummary) -> Unit = {},
    val onNew: () -> Unit = {},
    val onSaveJob: () -> Unit = {},
    val onPreferences: () -> Unit = {},
    val onTurnOnReminders: () -> Unit = {},
    val onOpenSystemSettings: () -> Unit = {},
    val onCreateAccount: () -> Unit = {},
)

/**
 * T1 Today and T2 first run. Stateless: [state] from [TodayViewModel], [now] and [zone] from the account's clock.
 *
 * @param remindersDenied the system refused notifications; the reminders row offers Open settings instead of Turn on.
 */
@Composable
fun TodayScreen(
    state: TodayUiState,
    now: Instant,
    zone: ZoneId,
    actions: TodayActions,
    modifier: Modifier = Modifier,
    remindersDenied: Boolean = false,
    listState: LazyListState = rememberLazyListState(),
) {
    val context = LocalContext.current
    val locale = LocalConfiguration.current.locales[0]
    val format = remember(locale, zone) { TodayFormat(locale, zone, DateFormat.is24HourFormat(context)) }
    val header = rememberRrLargeTitleState()
    val c = RrTheme.colors
    Box(modifier.fillMaxSize().background(c.bg)) {
        Column(Modifier.fillMaxSize()) {
            RrLargeTitleHeader(
                title = stringResource(S.string.today),
                state = header,
                subtitle = if (state.newAccount) null else format.header(now.atZone(zone).toLocalDate()),
            ) {
                RrIconButton(DS.drawable.ic_ph_magnifying_glass, stringResource(S.string.search), actions.onSearch)
                RrAvatar(state.initials, onClick = actions.onSettings, contentDescription = stringResource(S.string.settings))
            }
            if (state.offline) RrOfflineStrip()
            RrPullToRefresh(state.refreshing, actions.onRefresh, Modifier.weight(1f)) {
                LazyColumn(
                    Modifier.fillMaxSize().rrLargeTitleScroll(header),
                    state = listState,
                    contentPadding = PaddingValues(bottom = if (state.selectedRoles.isEmpty()) 24.dp else 80.dp),
                ) {
                    when {
                        state.loading -> item("loading") { Loading() }
                        state.error -> item("error") {
                            RrCallout(
                                stringResource(R.string.today_load_failed),
                                Modifier.padding(16.dp),
                                tone = RrTone.Danger,
                                actionLabel = stringResource(S.string.retry),
                                onAction = actions.onRetry,
                            )
                        }
                        else -> content(state, now, format, actions, remindersDenied)
                    }
                }
            }
        }
        if (state.selectedRoles.isNotEmpty()) SelectionBar(state.selectedRoles.size, actions, Modifier.align(Alignment.BottomCenter))
    }
}

private fun LazyListScope.content(state: TodayUiState, now: Instant, format: TodayFormat, actions: TodayActions, remindersDenied: Boolean) {
    val firstRun = state.firstRun
    // One accent per view: "Add your resume" when it shows, otherwise the top Needs-you action.
    val addResume = state.showChecklist && firstRun?.hasDocument == false
    if (state.showChecklist && firstRun != null) {
        if (state.guest) item("guest") {
            RrCallout(
                stringResource(R.string.today_guest),
                Modifier.padding(horizontal = 16.dp).padding(bottom = 16.dp),
                actionLabel = stringResource(R.string.today_create_account),
                onAction = actions.onCreateAccount,
                actionLink = true,
            )
        }
        if (state.newAccount) item("hero") {
            RrEmptyState(
                stringResource(S.string.your_job_search_starts_here),
                stringResource(R.string.today_first_run_body),
                Modifier.padding(horizontal = 16.dp),
            )
        }
        item("checklist") { Checklist(firstRun, remindersDenied, actions) }
        if (addResume) item("add-resume") {
            RrButton(
                stringResource(R.string.today_add_resume),
                actions.onNew,
                Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 16.dp),
                size = RrButtonSize.Large,
                icon = DS.drawable.ic_ph_plus,
            )
        }
        if (state.newAccount) return
    }

    item("needs-header") {
        RrSectionHeader(stringResource(S.string.needs_you), topPadding = 4.dp, count = state.needsYou.size.takeIf { it > 0 }?.toString())
    }
    item("needs") {
        if (state.needsYou.isEmpty()) {
            RrEmptyState(stringResource(S.string.you_re_up_to_date), stringResource(R.string.today_up_to_date_body), Modifier.padding(horizontal = 16.dp))
        } else {
            RrListGroup(Modifier.padding(horizontal = 16.dp).animateContentSize(fold())) {
                state.needsYou.forEachIndexed { i, entry -> NeedsRow(entry, accent = i == 0 && !addResume, format, actions) }
            }
        }
    }

    if (state.comingUp.isNotEmpty()) {
        item("coming-header") {
            RrSectionHeader(stringResource(S.string.coming_up), actionLabel = stringResource(S.string.calendar), onAction = actions.onCalendar)
        }
        item("coming") {
            RrListGroup(Modifier.padding(horizontal = 16.dp)) { state.comingUp.forEach { ComingRow(it, format, actions) } }
        }
    }

    item("roles-header") {
        val today = now.atZone(format.zone).toLocalDate()
        val foundToday = state.newRoles.count { format.parse(it.firstSeenAt)?.toLocalDate() == today }
        RrSectionHeader(
            stringResource(R.string.today_new_roles),
            count = when {
                foundToday > 0 -> stringResource(R.string.today_roles_today, foundToday.toString())
                state.newRoles.isNotEmpty() -> state.newRoles.size.toString()
                else -> null
            },
        )
    }
    item("roles") {
        if (state.newRoles.isEmpty()) {
            NoNewRoles(state.discovery, now, format, actions)
        } else {
            RrListGroup(Modifier.padding(horizontal = 16.dp).animateContentSize(fold())) {
                state.newRoles.forEach { RoleCard(it, it.id in state.selectedRoles, state.selectedRoles.isNotEmpty(), now, format, actions) }
            }
        }
    }

    if (state.recent.isNotEmpty()) {
        item("recent-header") { RrSectionHeader(stringResource(R.string.today_recent)) }
        item("recent") {
            RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                state.recent.forEach { doc ->
                    val letter = doc.type == DocumentType.Letter
                    val when_ = format.relative(doc.editedAt, now)
                    RrListRow(
                        doc.name,
                        subtitle = stringResource(if (letter) R.string.today_letter_meta else R.string.today_resume_meta, when_),
                        icon = if (letter) DS.drawable.ic_ph_note_pencil else DS.drawable.ic_ph_file_text,
                        onClick = { actions.onOpenDocument(doc) },
                        trailing = { RrRowCaret() },
                    )
                }
            }
        }
    }
}

@Composable
private fun Loading() {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        RrSkeleton(Modifier.width(96.dp).height(12.dp))
        repeat(3) { RrSkeleton(Modifier.fillMaxWidth().height(96.dp)) }
    }
}

private fun ApplicationStage?.rr(): RrStage = when (this) {
    ApplicationStage.Applied -> RrStage.Applied
    ApplicationStage.Screening -> RrStage.Screening
    ApplicationStage.Interview -> RrStage.Interview
    ApplicationStage.Offer -> RrStage.Offer
    ApplicationStage.Closed -> RrStage.Closed
    else -> RrStage.Saved
}

@Composable
private fun kindLabel(kind: String): String = stringResource(
    when (kind) {
        AddApplicationInterviewRequestKind.Screening.wireValue -> R.string.today_kind_screening
        AddApplicationInterviewRequestKind.Technical.wireValue -> R.string.today_kind_technical
        AddApplicationInterviewRequestKind.Behavioral.wireValue -> R.string.today_kind_behavioral
        AddApplicationInterviewRequestKind.Onsite.wireValue -> R.string.today_kind_onsite
        else -> R.string.today_kind_other
    },
)

/** A dismissed row folds its height (d2 ease); instant under reduced motion. */
@Composable
private fun fold() = tween<IntSize>(if (RrTheme.reducedMotion) 0 else RrMotion.D2, easing = RrMotion.ease)

/** A Needs-you item: stage dot, company, a status on the end, one line of context and its actions. Swipe = Mark as read. */
@Composable
private fun NeedsRow(entry: TodayEntry, accent: Boolean, format: TodayFormat, actions: TodayActions) {
    val c = RrTheme.colors
    val item = entry.item
    val at = format.parse(item.at)
    val appId = item.applicationId
    val open = {
        if (item.kind == TodayKind.Notification) actions.onNotification(entry)
        else if (appId != null) actions.onOpenApplication(appId, WorkspaceTab.Overview)
    }
    val markRead = stringResource(S.string.mark_as_read)
    RrSwipeRow(startAction = RrSwipeAction(markRead, DS.drawable.ic_ph_check, onCommit = { actions.onMarkRead(item) })) {
        Column(
            Modifier.fillMaxWidth().background(c.surface).combinedClickable(role = Role.Button, onClick = open).padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            val notification = item.kind == TodayKind.Notification
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!notification || entry.stage != null) RrStageDot(entry.stage.rr())
                RrText(item.company.ifBlank { item.title }, style = RrType.label, color = c.ink, modifier = Modifier.weight(1f))
                when (item.kind) {
                    TodayKind.Briefing -> RrBadge(stringResource(R.string.today_briefing_ready), tone = RrBadgeTone.Accent)
                    TodayKind.Offer -> if (at != null) RrBadge(stringResource(R.string.today_by_date, format.shortDay(at)), tone = RrBadgeTone.Warn)
                    TodayKind.FollowUp -> format.parse(entry.appliedAt)?.let { RrText(stringResource(R.string.today_applied_on, format.dayMonth(it)), style = RrType.small, color = c.ink3) }
                    else -> {}
                }
            }
            val detail = when (item.kind) {
                TodayKind.Briefing, TodayKind.Interview -> listOfNotNull(
                    stringResource(R.string.today_interview_kind, kindLabel(item.title)),
                    at?.let { "${format.shortDay(it)}, ${format.time(it)}" },
                    entry.role,
                ).joinToString(" · ")
                TodayKind.Offer -> "${stringResource(R.string.today_reply_to_offer)} · ${stringResource(R.string.today_offer_hint)}"
                TodayKind.FollowUp -> "${stringResource(R.string.today_follow_up)} · ${stringResource(R.string.today_follow_up_hint)}"
                TodayKind.Notification -> if (item.company.isBlank()) null else item.title
            }
            if (detail != null) RrText(detail, style = RrType.small, color = c.ink2)
            @OptIn(ExperimentalLayoutApi::class)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val first = if (accent) RrButtonVariant.Primary else RrButtonVariant.Secondary
                RrButton(markRead, { actions.onMarkRead(item) }, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small)
                when (item.kind) {
                    TodayKind.Briefing -> if (appId != null) {
                        RrButton(stringResource(S.string.open_briefing), { actions.onOpenApplication(appId, WorkspaceTab.Prepare) }, variant = first, size = RrButtonSize.Small)
                        Practice(appId, RrButtonVariant.Secondary, actions)
                    }
                    TodayKind.Interview -> if (appId != null) Practice(appId, first, actions)
                    TodayKind.Offer -> RrButton(stringResource(S.string.compare_offers), actions.onCompareOffers, variant = first, size = RrButtonSize.Small, icon = DS.drawable.ic_ph_scales)
                    TodayKind.FollowUp -> if (appId != null) {
                        RrButton(
                            stringResource(R.string.today_draft_follow_up),
                            { actions.onOpenApplication(appId, WorkspaceTab.Messages) },
                            variant = first,
                            size = RrButtonSize.Small,
                            icon = DS.drawable.ic_ph_sparkle,
                            iconTint = if (accent) null else c.accentText,
                        )
                        RrButton(stringResource(R.string.today_log_follow_up), { actions.onLogFollowUp(appId) }, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small)
                    }
                    TodayKind.Notification -> if (appId != null) RrButton(stringResource(R.string.today_open), open, variant = first, size = RrButtonSize.Small)
                }
            }
        }
    }
}

@Composable
private fun Practice(appId: String, variant: RrButtonVariant, actions: TodayActions) = RrButton(
    stringResource(S.string.application_workspace_tab_rehearse_interview_answers_practice),
    { actions.onOpenApplication(appId, WorkspaceTab.Practise) },
    variant = variant,
    size = RrButtonSize.Small,
    icon = DS.drawable.ic_ph_microphone,
)

/** Coming up: weekday and date column, "Company · Kind", "15:30 · Video call with Priya Shah". */
@Composable
private fun ComingRow(entry: TodayEntry, format: TodayFormat, actions: TodayActions) {
    val c = RrTheme.colors
    val item = entry.item
    val at = format.parse(item.at)
    val interview = entry.interview
    val title = if (item.kind == TodayKind.FollowUp) "${item.company} · ${stringResource(R.string.today_follow_up)}" else "${item.company} · ${kindLabel(item.title)}"
    val place = interview?.location?.takeIf { it.isNotBlank() }
    val person = interview?.participants?.firstOrNull()?.name
    val where = when {
        place != null && person != null -> stringResource(R.string.today_with_person, place, person)
        else -> place ?: person
    }
    RrListRow(
        title,
        subtitle = listOfNotNull(at?.let(format::time), where).joinToString(" · ").ifEmpty { null },
        onClick = { item.applicationId?.let { actions.onOpenApplication(it, WorkspaceTab.Overview) } },
        leading = if (at == null) null else {
            {
                Column(Modifier.width(44.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    RrText(format.weekday(at), style = RrType.caption, color = c.ink3)
                    RrText(at.dayOfMonth.toString(), style = RrType.sectionHeading, color = c.ink)
                }
            }
        },
        trailing = { RrRowCaret() },
    )
}

/** A new role: role and company, place, when it was found; Track, Not for me and the reasons behind "Why this role". */
@OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
private fun RoleCard(role: Opportunity, selected: Boolean, selecting: Boolean, now: Instant, format: TodayFormat, actions: TodayActions) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    var why by rememberSaveable(role.id) { mutableStateOf(false) }
    val found = format.parse(role.firstSeenAt)?.toLocalDate()
    val today = now.atZone(format.zone).toLocalDate()
    val foundLabel = when (found) {
        today -> stringResource(R.string.today_found_today)
        today.minusDays(1) -> stringResource(R.string.today_found_yesterday)
        null -> null
        else -> stringResource(R.string.today_found_on, format.dayMonth(found.atStartOfDay(format.zone)))
    }
    val selectLabel = stringResource(R.string.today_select_role, role.role)
    Column(
        Modifier
            .fillMaxWidth()
            .background(if (selected) c.accentSoft else c.surface)
            .combinedClickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = LocalIndication.current,
                onLongClickLabel = selectLabel,
                onLongClick = { haptics(RrHaptic.Light); actions.onToggleRole(role.id) },
                onClick = { if (selecting) actions.onToggleRole(role.id) else why = !why },
            )
            .semantics { if (selecting) this.selected = selected }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        RrText("${role.role} · ${role.company}", style = RrType.label, color = c.ink)
        RrText(listOfNotNull(role.location.ifBlank { null }, foundLabel).joinToString(" · "), style = RrType.small, color = c.ink3)
        if (why) {
            RrText(
                if (role.matches.isEmpty()) stringResource(R.string.today_no_matches) else stringResource(R.string.today_matches, role.matches.joinToString(" · ")),
                style = RrType.small,
                color = c.ink2,
            )
            runCatching { java.net.URI(role.url).host }.getOrNull()?.let { RrText(stringResource(R.string.today_source, it), style = RrType.small, color = c.ink3) }
        }
        if (!selecting) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                RrButton(stringResource(S.string.track_in_applications), { actions.onTrack(role) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
                RrButton(stringResource(S.string.not_for_me), { actions.onNotForMe(role) }, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small)
                RrButton(stringResource(R.string.today_why_this_role), { why = !why }, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small)
            }
        }
    }
}

@Composable
private fun NoNewRoles(discovery: CareerSchedule?, now: Instant, format: TodayFormat, actions: TodayActions) {
    val c = RrTheme.colors
    val next = format.parse(discovery?.nextRunAt)
    val text = when {
        discovery == null || !discovery.enabled || next == null -> stringResource(R.string.today_discovery_paused)
        else -> {
            val today = now.atZone(format.zone).toLocalDate()
            when (next.toLocalDate()) {
                today -> stringResource(R.string.today_discovery_today, format.time(next))
                today.plusDays(1) -> stringResource(R.string.today_discovery_tomorrow, format.time(next))
                else -> stringResource(R.string.today_discovery_on, format.shortDay(next), format.time(next))
            }
        }
    }
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RrText(text, style = RrType.small, color = c.ink3)
        RrButton(
            stringResource(if (discovery == null) R.string.today_set_up_discovery else S.string.open_the_schedule),
            { actions.onOpenSchedule(discovery?.id) },
            variant = RrButtonVariant.Secondary,
            size = RrButtonSize.Small,
        )
    }
}

/** T2 checklist: rows tick themselves when the thing exists. */
@Composable
private fun Checklist(firstRun: FirstRun, remindersDenied: Boolean, actions: TodayActions) {
    val done = listOf(firstRun.hasDocument, firstRun.hasApplication, firstRun.hasPreferences, firstRun.remindersEnabled)
    Column {
        RrSectionHeader(stringResource(R.string.today_get_set_up), count = stringResource(R.string.today_progress, done.count { it }.toString(), done.size.toString()))
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            CheckRow(stringResource(S.string.import_or_create_a_resume), stringResource(R.string.today_import_subtitle), firstRun.hasDocument, actions.onNew)
            CheckRow(stringResource(S.string.save_a_job), stringResource(R.string.today_save_job_subtitle), firstRun.hasApplication, actions.onSaveJob)
            CheckRow(stringResource(S.string.set_your_preferences), stringResource(R.string.today_preferences_subtitle), firstRun.hasPreferences, actions.onPreferences)
            val reminders = stringResource(R.string.today_reminders)
            RrListRow(
                reminders,
                subtitle = stringResource(if (remindersDenied && !firstRun.remindersEnabled) R.string.today_reminders_off else R.string.today_reminders_subtitle),
                leading = { RrCheckbox(firstRun.remindersEnabled, null) },
                trailing = if (firstRun.remindersEnabled) null else {
                    {
                        if (remindersDenied) {
                            RrButton(stringResource(S.string.open_settings), actions.onOpenSystemSettings, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
                        } else {
                            RrButton(stringResource(R.string.today_turn_on), actions.onTurnOnReminders, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
                        }
                    }
                },
                modifier = Modifier.semantics { contentDescription = reminders },
            )
        }
    }
}

@Composable
private fun CheckRow(title: String, subtitle: String, done: Boolean, onClick: () -> Unit) {
    RrListRow(title, subtitle = subtitle, onClick = onClick, leading = { RrCheckbox(done, null) }, trailing = { RrRowCaret() })
}

/** Bottom bar while new roles are selected: Dismiss selected · Track selected. */
@Composable
private fun SelectionBar(count: Int, actions: TodayActions, modifier: Modifier) {
    val c = RrTheme.colors
    Column(modifier.fillMaxWidth().background(c.bg)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
        Row(
            Modifier.fillMaxWidth().padding(start = 8.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            RrIconButton(DS.drawable.ic_ph_x, stringResource(R.string.today_clear_selection), actions.onClearSelection, size = RrIconButtonSize.Small)
            RrText(stringResource(R.string.today_selected, count.toString()), style = RrType.small, color = c.ink2, modifier = Modifier.weight(1f))
            RrButton(stringResource(R.string.today_dismiss_selected), { actions.onApplySelection(false) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
            RrButton(stringResource(R.string.today_track_selected), { actions.onApplySelection(true) }, size = RrButtonSize.Small)
        }
    }
}
