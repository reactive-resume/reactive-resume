package me.rxresu.feature.today

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneId
import me.rxresu.core.data.FirstRun
import me.rxresu.core.data.TodayItem
import me.rxresu.core.data.TodayKind
import me.rxresu.core.designsystem.R as DS
import me.rxresu.core.designsystem.RrHeroCard
import me.rxresu.core.designsystem.RrCompanyTile
import me.rxresu.core.designsystem.InstrumentSerif
import me.rxresu.core.designsystem.RrDocumentThumbnail
import me.rxresu.core.designsystem.RrBottomSheet
import androidx.compose.foundation.clickable
import androidx.compose.animation.Crossfade
import me.rxresu.core.designsystem.RrAvatar
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrEmptyState
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
import me.rxresu.core.designsystem.rememberRrLargeTitleState
import me.rxresu.core.designsystem.rrLargeTitleScroll
import me.rxresu.core.navigation.WorkspaceTab
import androidx.compose.ui.unit.sp
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
    val onImport: () -> Unit = {},
    val onApplications: () -> Unit = {},
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
    scrollState: ScrollState = rememberScrollState(),
) {
    val context = LocalContext.current
    val locale = LocalConfiguration.current.locales[0]
    val format = remember(locale, zone) { TodayFormat(locale, zone, true) }
    val header = rememberRrLargeTitleState()
    val c = RrTheme.colors
    Box(modifier.fillMaxSize().background(c.bg)) {
        Column(Modifier.fillMaxSize()) {
            RrLargeTitleHeader(
                title = stringResource(S.string.today),
                state = header,
                subtitle = if (state.newAccount) { if (state.firstName.isBlank()) stringResource(R.string.today_welcome_empty) else stringResource(R.string.today_welcome, state.firstName) } else format.header(now.atZone(zone).toLocalDate()),
            ) {
                if (!state.newAccount) RrIconButton(DS.drawable.ic_ph_magnifying_glass, stringResource(S.string.search), actions.onSearch)
                RrAvatar(state.initials, modifier = Modifier.padding(start = 4.dp), onClick = actions.onSettings, contentDescription = stringResource(S.string.settings))
            }
            if (state.offline) RrOfflineStrip()
            RrPullToRefresh(state.refreshing, actions.onRefresh, Modifier.weight(1f)) {
                Column(
                    Modifier.fillMaxSize().rrLargeTitleScroll(header).verticalScroll(scrollState)
                        .padding(bottom = if (state.selectedRoles.isEmpty()) 24.dp else 80.dp),
                ) {
                    when {
                        state.loading -> Loading()
                        state.error -> {
                            RrCallout(
                                stringResource(R.string.today_load_failed),
                                Modifier.padding(16.dp),
                                tone = RrTone.Danger,
                                actionLabel = stringResource(S.string.retry),
                                onAction = actions.onRetry,
                            )
                        }
                        else -> TodayContent(state, now, format, actions, remindersDenied)
                    }
                }
            }
        }
        if (state.selectedRoles.isNotEmpty()) SelectionBar(state.selectedRoles.size, actions, Modifier.align(Alignment.BottomCenter))
    }
}

/** A dashboard page: all section headings keep real layout positions beneath the shared dock. */
@Composable
private fun TodayContent(state: TodayUiState, now: Instant, format: TodayFormat, actions: TodayActions, remindersDenied: Boolean) {
    if (state.newAccount) {
        FirstResumeHero(actions)
        Checklist(requireNotNull(state.firstRun), remindersDenied, actions)
        return
    }
    val hero = todayHero(state.needsYou, state.comingUp, now)
    if (hero != null) {
        Crossfade(hero, animationSpec = tween(if (RrTheme.reducedMotion) 0 else RrMotion.D3), label = "hero") { entry ->
            TodayHero(entry, format, actions)
        }
    }
    val needs = state.needsYou.filter { it.item.id != hero?.item?.id }
    RrSectionHeader(stringResource(S.string.needs_you))
    if (needs.isEmpty()) RrEmptyState(stringResource(S.string.you_re_up_to_date), stringResource(R.string.today_up_to_date_body), Modifier.padding(horizontal = 24.dp))
    else RrListGroup(Modifier.animateContentSize(fold())) {
        needs.forEachIndexed { index, entry -> NeedsRow(entry, format, actions, divider = index < needs.lastIndex) }
    }
    val coming = (state.comingUp + listOfNotNull(hero).filter { it.item.kind == TodayKind.Briefing || it.item.kind == TodayKind.Interview })
        .distinctBy { it.item.id }.sortedBy { it.item.at }
    if (coming.isNotEmpty()) {
        RrSectionHeader(stringResource(S.string.coming_up), actionLabel = stringResource(S.string.calendar), onAction = actions.onCalendar)
        RrListGroup { coming.forEachIndexed { index, entry -> ComingRow(entry, format, actions, index < coming.lastIndex) } }
    }
    var allRoles by remember { mutableStateOf(false) }
    RrSectionHeader(stringResource(R.string.today_new_roles),
        modifier = if (state.newRoles.isNotEmpty()) Modifier.clickable(role = androidx.compose.ui.semantics.Role.Button) { allRoles = true } else Modifier,
        count = state.newRoles.size.takeIf { it > 0 }?.let { stringResource(R.string.today_roles_today, it.toString()) })
    if (state.newRoles.isEmpty()) NoNewRoles(state.discovery, now, format, actions)
    else RrListGroup(Modifier.animateContentSize(fold())) {
        state.newRoles.firstOrNull()?.let { role -> RoleRow(role, role.id in state.selectedRoles, state.selectedRoles.isNotEmpty(), actions, divider = false) }
    }
    if (allRoles) RrBottomSheet({ allRoles = false }, title = stringResource(R.string.today_new_roles), fitContent = true,
        footer = if (state.selectedRoles.isEmpty()) null else { { SelectionBar(state.selectedRoles.size, actions, Modifier) } },
    ) {
        RrListGroup(Modifier.verticalScroll(rememberScrollState())) {
            state.newRoles.forEachIndexed { index, role -> RoleRow(role, role.id in state.selectedRoles, state.selectedRoles.isNotEmpty(), actions, index < state.newRoles.lastIndex) }
        }
    }
    if (state.recent.isNotEmpty()) {
        RrSectionHeader(stringResource(R.string.today_recent))
        RrListGroup {
            state.recent.take(3).forEachIndexed { index, doc ->
                RrListRow(doc.name, subtitle = stringResource(if (doc.type == DocumentType.Letter) R.string.today_letter_meta else R.string.today_resume_meta, format.relative(doc.editedAt, now)), leading = { RrDocumentThumbnail(letter = doc.type == DocumentType.Letter) }, onClick = { actions.onOpenDocument(doc) }, divider = index < state.recent.take(3).lastIndex, trailing = { RrRowCaret() })
            }
        }
    }
}

/** Ready briefings take priority; otherwise earliest interview, offer, then follow-up. */
internal fun todayHero(needs: List<TodayEntry>, coming: List<TodayEntry>, now: Instant): TodayEntry? =
    (needs + coming).filter { entry ->
        when (entry.item.kind) {
            TodayKind.Notification -> false
            TodayKind.Interview -> entry.item.at?.let { runCatching { Instant.parse(it) <= now.plusSeconds(48 * 3600) }.getOrDefault(false) } == true
            else -> true
        }
    }.minWithOrNull(compareBy<TodayEntry> {
        when (it.item.kind) { TodayKind.Briefing -> 0; TodayKind.Interview -> 1; TodayKind.Offer -> 2; TodayKind.FollowUp -> 3; else -> 4 }
    }.thenBy { it.item.at })

@Composable
private fun FirstResumeHero(actions: TodayActions) {
    val c = RrTheme.colors
    RrHeroCard {
        RrText(stringResource(R.string.today_start_here), style = RrType.keyLine, color = c.ink3)
        RrText(stringResource(R.string.today_bring_resume), style = RrType.heading)
        RrText(stringResource(R.string.today_import_body), style = RrType.body, color = c.ink2)
        RrButton(stringResource(S.string.import_a_resume), actions.onImport, Modifier.fillMaxWidth().padding(top = 8.dp), size = RrButtonSize.Large)
        Box(Modifier.align(Alignment.CenterHorizontally).height(32.dp).clickable(onClick = actions.onNew), contentAlignment = Alignment.BottomCenter) { RrText(stringResource(R.string.today_template_instead), style = RrType.textLink, color = c.accentText) }
    }
}

@Composable
private fun TodayHero(entry: TodayEntry, format: TodayFormat, actions: TodayActions) {
    val c = RrTheme.colors
    val item = entry.item
    val interview = item.kind == TodayKind.Briefing || item.kind == TodayKind.Interview
    RrHeroCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RrStageDot(entry.stage.rr())
            RrText(format.parse(item.at)?.let { "${format.fullDay(it)} · ${format.time(it)}" }.orEmpty(), style = RrType.keyLine, color = c.ink3)
        }
        RrText(if (interview) stringResource(R.string.today_interview_at, kindLabel(item.title), item.company) else item.title, style = RrType.heading)
        RrText(stringResource(if (interview && item.briefingReady) R.string.today_briefing_body else if (interview) R.string.today_prepare_body else R.string.today_offer_hint), style = RrType.body, color = c.ink2)
        RrButton(stringResource(if (interview) R.string.today_open_briefing else R.string.today_open), {
            if (item.kind == TodayKind.Offer) actions.onCompareOffers() else item.applicationId?.let { actions.onOpenApplication(it, if (interview) WorkspaceTab.Prepare else WorkspaceTab.Messages) }
        }, Modifier.fillMaxWidth().padding(top = 8.dp), size = RrButtonSize.Large)
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

@Composable
private fun NeedsRow(entry: TodayEntry, format: TodayFormat, actions: TodayActions, divider: Boolean) {
    var menu by remember { mutableStateOf(false) }
    val item = entry.item
    val offer = item.kind == TodayKind.Offer
    val title = when (item.kind) {
        TodayKind.Offer -> stringResource(R.string.today_reply_company, item.company)
        TodayKind.FollowUp -> stringResource(R.string.today_follow_company, item.company)
        else -> item.title
    }
    val subtitle = when (item.kind) {
        TodayKind.Offer -> format.parse(item.at)?.let { stringResource(R.string.today_offer_by, format.deadline(it)) }
        TodayKind.FollowUp -> format.parse(entry.appliedAt)?.let { stringResource(R.string.today_follow_since, format.dayMonth(it)) }
        else -> item.company
    }
    RrSwipeRow(startAction = RrSwipeAction(stringResource(S.string.done), DS.drawable.ic_ph_check) { actions.onMarkRead(item) }) {
        RrListRow(title, subtitle = subtitle, leading = { RrStageDot(entry.stage.rr()) }, onLongClick = { menu = true }, onLongClickLabel = stringResource(S.string.actions), onClick = {
            if (offer) actions.onCompareOffers() else if (item.kind == TodayKind.Notification) actions.onNotification(entry)
            else item.applicationId?.let { actions.onOpenApplication(it, WorkspaceTab.Messages) }
        }, divider = divider, trailing = { RrRowCaret() })
    }
    if (menu) RrBottomSheet({ menu = false }, fitContent = true, title = title) {
        RrListRow(stringResource(S.string.mark_as_read), tile = DS.drawable.ic_ph_check, onClick = { actions.onMarkRead(item); menu = false })
    }
}

@Composable
private fun ComingRow(entry: TodayEntry, format: TodayFormat, actions: TodayActions, divider: Boolean) {
    val item = entry.item
    val at = format.parse(item.at)
    RrListRow(item.company, subtitle = at?.let { "${if (item.title == "screening") stringResource(R.string.today_screening_call) else stringResource(R.string.today_interview_kind, kindLabel(item.title))} · ${format.time(it)}" }, leading = {
        if (at != null) Column(Modifier.width(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            RrText(format.weekday(at), style = RrType.caption, color = RrTheme.colors.ink3)
            RrText(at.dayOfMonth.toString(), style = RrType.sheetTitle.copy(lineHeight = androidx.compose.ui.unit.TextUnit(26f, androidx.compose.ui.unit.TextUnitType.Sp)))
        }
    }, onClick = { item.applicationId?.let { actions.onOpenApplication(it, WorkspaceTab.Overview) } }, divider = divider, trailing = { RrRowCaret() })
}

@Composable
private fun RoleRow(role: Opportunity, selected: Boolean, selecting: Boolean, actions: TodayActions, divider: Boolean) {
    var open by remember { mutableStateOf(false) }
    RrListRow(role.role, modifier = Modifier.semantics { if (selecting) this.selected = selected }, subtitle = listOfNotNull(role.company, role.location).joinToString(" · "), leading = { RrCompanyTile(role.company, content = role.company.split(Regex("\\s+")).mapNotNull { it.firstOrNull(Char::isLetterOrDigit) }.take(2).joinToString("").uppercase()) }, selected = selected,
        onClick = { if (selecting) actions.onToggleRole(role.id) else open = true }, onLongClick = { actions.onToggleRole(role.id) }, onLongClickLabel = stringResource(R.string.today_select_role, role.role), divider = divider, trailing = { RrRowCaret() })
    if (open) RrBottomSheet({ open = false }, title = role.role, fitContent = true) {
        RrListRow(role.company, subtitle = role.location)
        RrText(role.snippet.orEmpty(), Modifier.padding(24.dp), style = RrType.body)
        RrButton(stringResource(S.string.track_in_applications), { actions.onTrack(role); open = false }, Modifier.fillMaxWidth().padding(horizontal = 24.dp), size = RrButtonSize.Large)
        RrButton(stringResource(S.string.not_for_me), { actions.onNotForMe(role); open = false }, Modifier.align(Alignment.CenterHorizontally), variant = RrButtonVariant.Ghost)
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

@Composable
private fun Checklist(firstRun: FirstRun, remindersDenied: Boolean, actions: TodayActions) {
    val numberStyle = RrType.ui.copy(fontFamily = InstrumentSerif, fontSize = 18.sp, lineHeight = 16.sp)
    Column {
        RrSectionHeader(stringResource(R.string.today_how_it_works))
        RrListGroup {
            RrListRow(stringResource(R.string.today_step_resume), subtitle = stringResource(R.string.today_step_resume_body), leading = { RrCompanyTile("1", textStyle = numberStyle) }, divider = true)
            RrListRow(stringResource(R.string.today_step_job), subtitle = stringResource(R.string.today_step_job_body), leading = { RrCompanyTile("2", textStyle = numberStyle) }, onClick = if (firstRun.hasDocument) actions.onSaveJob else null, divider = true)
            RrListRow(stringResource(R.string.today_step_apply), subtitle = stringResource(R.string.today_step_apply_body), leading = { RrCompanyTile("3", textStyle = numberStyle) }, onClick = if (firstRun.hasApplication) actions.onApplications else null)
        }
    }
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
