package me.rxresu.feature.applications

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import kotlinx.coroutines.launch
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.designsystem.RrAvatar
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrFilterChip
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrLargeTitleHeader
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMenu
import me.rxresu.core.designsystem.RrMenuItem
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrOfflineStrip
import me.rxresu.core.designsystem.RrPullToRefresh
import me.rxresu.core.designsystem.RrSegment
import me.rxresu.core.designsystem.RrSegmentedControl
import me.rxresu.core.designsystem.RrStageDot
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrToastResult
import me.rxresu.core.designsystem.RrToastTone
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.designsystem.rememberRrLargeTitleState
import me.rxresu.core.navigation.Application as ApplicationDest
import me.rxresu.core.navigation.ApplicationsView
import me.rxresu.core.navigation.InterviewSheet
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.MoveApplication
import me.rxresu.core.navigation.SaveJob
import me.rxresu.core.navigation.Search
import me.rxresu.core.navigation.Settings
import me.rxresu.core.navigation.Trash
import me.rxresu.core.navigation.TrashTab
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.PatchApplicationRequest
import me.rxresu.core.strings.R as S

/** J1–J4: one tab root with List · Board · Calendar · Insights. */
@Composable
internal fun ApplicationsRoute(initialView: ApplicationsView, nav: NavController) {
    val repos = LocalRepositories.current
    val vm = viewModel(key = "applications") { ApplicationsViewModel(repos.applications, repos.career, repos.documents, repos.account, repos.time) }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = LocalToasts.current
    val haptics = rememberRrHaptics()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val res = androidx.compose.ui.platform.LocalResources.current
    val texts = MoveTexts(stringResource(S.string.undo), stringResource(S.string.application_closed), stringResource(S.string.closed_as_accepted_offer), stringResource(S.string.add_the_offer_s_terms))
    val undo = stringResource(S.string.undo)
    val failed = stringResource(R.string.app_couldnt_update)
    var view by rememberSaveable { mutableStateOf(initialView) }
    var actionsFor by remember { mutableStateOf<Row?>(null) }
    var editing by remember { mutableStateOf<Pair<Row, DetailSheet>?>(null) }
    var selected by remember { mutableStateOf<Set<String>?>(null) }
    var bulk by remember { mutableStateOf<BulkSheet?>(null) }

    fun move(row: Row, lane: Lane?, stage: ApplicationStage) {
        val before = row.app.snapshot()
        val label = lane?.let { it.label ?: res.getString(stageRes(it.category)) } ?: res.getString(stageRes(stage))
        scope.launch {
            vm.attempt { vm.moves.move(row.app.id, lane, stage) }
                .onSuccess {
                    haptics(RrHaptic.Success)
                    ToastScope.launch { announceMove(toasts, vm.moves, row.app.id, MoveChoice(lane, stage), label, before, emptyList(), texts, res) { nav.navigate(ApplicationDest(row.app.id, WorkspaceTab.Messages)) } }
                }
                .onFailure { haptics(RrHaptic.Error); toasts.show(failed, tone = RrToastTone.Danger) }
        }
    }

    fun trash(row: Row) {
        scope.launch {
            vm.attempt { vm.moves.trash(row.app.id) }
                .onSuccess { stamp ->
                    ToastScope.launch {
                        if (toasts.show(res.getString(R.string.app_trashed, "${row.app.role} · ${row.app.company}"), undo) == RrToastResult.ActionPerformed) runCatching { vm.moves.untrash(row.app.id, stamp) }
                    }
                }
                .onFailure { toasts.show(failed, tone = RrToastTone.Danger) }
        }
    }

    val rowActions = RowActions(
        open = { nav.navigate(ApplicationDest(it)) },
        actions = { actionsFor = it },
        trash = ::trash,
        advance = ::move,
        toggleSelect = { id -> selected = selected?.let { if (id in it) it - id else if (it.size < 200) it + id else it } },
    )

    ApplicationsScreen(
        state = state,
        view = view,
        onView = { view = it },
        onFilters = vm::setFilters,
        onRefresh = { vm.refresh() },
        onSearch = { nav.navigate(Search("applications")) },
        onSaveJob = { nav.navigate(SaveJob()) },
        onSettings = { nav.navigate(Settings) },
        onTrash = { nav.navigate(Trash(TrashTab.Applications)) },
        selected = selected,
        onSelectDone = { selected = null },
        onBulk = { bulk = it },
        rowActions = rowActions,
        onDrop = ::move,
        onMoveSheet = { nav.navigate(MoveApplication(it.app.id)) },
        onSchedule = { nav.navigate(InterviewSheet("", null)) },
        onAddToCalendar = { addToCalendar(context, it, vm.time.now()) },
        time = vm.time,
    )

    actionsFor?.let { row ->
        RowActionsSheet(
            row = row,
            onDismiss = { actionsFor = null },
            onMove = { actionsFor = null; nav.navigate(MoveApplication(row.app.id)) },
            onEdit = { actionsFor = null; editing = row to DetailSheet.Edit },
            onTags = { actionsFor = null; editing = row to DetailSheet.Tags },
            onTrash = { actionsFor = null; trash(row) },
            onSelect = { actionsFor = null; selected = setOf(row.app.id) },
        )
    }
    editing?.let { (row, sheet) ->
        val save: (PatchApplicationRequest, Set<String>) -> Unit = { body, clear ->
            editing = null
            scope.launch { vm.attempt { repos.applications.patchApplication(row.app.id, body, me.rxresu.core.network.RequestOptions(nullFields = clear)) }.onFailure { toasts.show(failed, tone = RrToastTone.Danger) } }
        }
        when (sheet) {
            DetailSheet.Tags -> TagsSheet(row.app.tags, onDismiss = { editing = null }, onSave = { save(PatchApplicationRequest(tags = it), emptySet()) })
            else -> EditDetailsSheet(row.app, onDismiss = { editing = null }, onSave = save)
        }
    }
    bulk?.let { kind ->
        val ids = selected.orEmpty().toList()
        BulkSheetView(kind, state, onDismiss = { bulk = null }) { action ->
            bulk = null
            scope.launch {
                val result = when (action) {
                    is BulkAction.Move -> vm.bulkMove(ids, action.lane, action.stage, action.reason)
                    is BulkAction.Tag -> vm.bulkTag(ids, action.tags)
                    BulkAction.Trash -> vm.bulkTrash(ids)
                }
                result.onSuccess {
                    haptics(RrHaptic.Success)
                    selected = null
                    toasts.show(plural(res, S.plurals.message_0_plural_one_application_selected_other_applications_selected, ids.size, ids.size.toString()).removeSuffix(".") )
                }.onFailure { toasts.show(res.getString(S.string.couldn_t_update_the_applications_try_again), tone = RrToastTone.Danger) }
            }
        }
    }
}

private fun stageRes(stage: ApplicationStage) = when (stage) {
    ApplicationStage.Applied -> S.string.applied
    ApplicationStage.Screening -> S.string.screening
    ApplicationStage.Interview -> S.string.interview
    ApplicationStage.Offer -> S.string.offer
    ApplicationStage.Closed -> S.string.closed
    else -> S.string.saved
}

@Composable
internal fun ApplicationsScreen(
    state: ApplicationsState,
    view: ApplicationsView,
    onView: (ApplicationsView) -> Unit,
    onFilters: (ApplicationFilters) -> Unit,
    onRefresh: () -> Unit,
    onSearch: () -> Unit,
    onSaveJob: () -> Unit,
    onSettings: () -> Unit,
    onTrash: () -> Unit,
    selected: Set<String>?,
    onSelectDone: () -> Unit,
    onBulk: (BulkSheet) -> Unit,
    rowActions: RowActions,
    onDrop: (Row, Lane?, ApplicationStage) -> Unit,
    onMoveSheet: (Row) -> Unit,
    onSchedule: () -> Unit,
    onAddToCalendar: (CalendarEvent) -> Unit,
    time: me.rxresu.core.data.TimeSource,
) {
    val c = RrTheme.colors
    val title = rememberRrLargeTitleState()
    val dates = rememberDates(time.timezone())
    val reduced = LocalReducedMotion.current
    var menu by remember { mutableStateOf(false) }
    val f = state.filters
    val views = ApplicationsView.entries
    Column(Modifier.fillMaxSize().background(c.bg)) {
        RrLargeTitleHeader(
            title = stringResource(S.string.applications),
            state = title,
            bottom = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    RrSegmentedControl(
                        segments = listOf(
                            RrSegment(stringResource(S.string.list), D.drawable.ic_ph_list),
                            RrSegment(stringResource(S.string.board), D.drawable.ic_ph_kanban),
                            RrSegment(stringResource(S.string.calendar), D.drawable.ic_ph_calendar_blank),
                            RrSegment(stringResource(S.string.insights), D.drawable.ic_ph_chart_bar),
                        ),
                        selectedIndex = views.indexOf(view),
                        onSelect = { onView(views[it]) },
                    )
                    if (view == ApplicationsView.List || (view == ApplicationsView.Insights && (f.tags.isNotEmpty() || f.stage != null || f.text.isNotBlank()))) FilterChips(state, view == ApplicationsView.List, onFilters)
                }
            },
        ) {
            RrIconButton(D.drawable.ic_ph_magnifying_glass, stringResource(S.string.search_applications), onSearch)
            RrButton(stringResource(S.string.save_job), onSaveJob, size = RrButtonSize.Small, icon = D.drawable.ic_ph_plus)
            if (title.collapsed) Box {
                RrIconButton(D.drawable.ic_ph_dots_three, stringResource(S.string.more), { menu = true })
                RrMenu(menu, { menu = false }) {
                    RrMenuItem(stringResource(R.string.app_import_csv), { menu = false; onSaveJob() }, icon = D.drawable.ic_ph_file_arrow_up, enabled = false)
                    RrMenuItem(stringResource(R.string.app_manage_stages), { menu = false }, icon = D.drawable.ic_ph_sliders_horizontal, enabled = false)
                    RrMenuItem(stringResource(S.string.trash), { menu = false; onTrash() }, icon = D.drawable.ic_ph_trash)
                }
            }
            RrAvatar(state.initials.ifEmpty { "·" }, onClick = onSettings, contentDescription = stringResource(S.string.settings))
        }
        if (state.offline) RrOfflineStrip()
        Box(Modifier.weight(1f).fillMaxWidth()) {
            RrPullToRefresh(state.refreshing, onRefresh, Modifier.fillMaxSize()) {
                AnimatedContent(
                    view,
                    transitionSpec = {
                        if (reduced) fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                        else (fadeIn(tween(RrMotion.D2, delayMillis = 140, easing = RrMotion.ease)) + slideInVertically(tween(RrMotion.D2, delayMillis = 140, easing = RrMotion.ease)) { 18 }) togetherWith fadeOut(tween(140, easing = RrMotion.ease))
                    },
                    label = "view",
                ) { v ->
                    when (v) {
                        ApplicationsView.List -> ListView(state, dates, title, selected, rowActions, onSaveJob, onImport = {}, onShowClosed = { onFilters(f.copy(showClosed = true)) }, onClearFilters = { onFilters(ApplicationFilters(showClosed = f.showClosed)) })
                        ApplicationsView.Board -> BoardView(state, dates, rowActions, onDrop, onMoveSheet, initialPage = boardColumns(state).indexOfFirst { it.rows.isNotEmpty() && it.stage != ApplicationStage.Saved }.coerceAtLeast(0))
                        ApplicationsView.Calendar -> CalendarView(state, dates, time.today(), title, rowActions.open, onSchedule, onAddToCalendar)
                        ApplicationsView.Insights -> InsightsView(state, dates, title, onStage = { onFilters(f.copy(stage = it)); onView(ApplicationsView.List) }, onSaveJob)
                    }
                }
            }
            if (selected != null) SelectionBar(selected.size, onBulk, onSelectDone, Modifier.align(Alignment.BottomCenter))
        }
    }
}

@Composable
private fun FilterChips(state: ApplicationsState, all: Boolean, onFilters: (ApplicationFilters) -> Unit) {
    val f = state.filters
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        f.stage?.let { stage -> RrFilterChip(stageLabel(stage), true, { onFilters(f.copy(stage = null)) }) }
        if (all) {
            RrFilterChip("${stringResource(S.string.needs_you)} ${state.needsYouCount}", f.needsYou, { onFilters(f.copy(needsYou = it)) })
            RrFilterChip(stringResource(R.string.app_show_closed), f.showClosed, { onFilters(f.copy(showClosed = it)) })
        }
        (if (all) state.tags else f.tags.toList()).forEach { tag ->
            RrFilterChip(tag, tag in f.tags, { on -> onFilters(f.copy(tags = if (on) f.tags + tag else f.tags - tag)) }, icon = D.drawable.ic_ph_tag)
        }
    }
}

/** Long-press on a row: the actions sheet, the menu alternative to every swipe. */
@Composable
private fun RowActionsSheet(row: Row, onDismiss: () -> Unit, onMove: () -> Unit, onEdit: () -> Unit, onTags: () -> Unit, onTrash: () -> Unit, onSelect: () -> Unit) {
    RrBottomSheet(onDismissRequest = onDismiss, title = row.app.company, fitContent = true) {
        Box(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
            RrListGroup {
                RrListRow(stringResource(S.string.move_to_6ffcfca36b), icon = D.drawable.ic_ph_arrow_up, onClick = onMove)
                if (row.app.status != ApplicationStage.Closed) RrListRow(stringResource(S.string.mark_as_closed_ad3ca6020c), icon = D.drawable.ic_ph_check_circle, onClick = onMove)
                RrListRow(stringResource(R.string.app_edit_details), icon = D.drawable.ic_ph_pencil_simple, onClick = onEdit)
                RrListRow(stringResource(S.string.tags_17a9c1428a), icon = D.drawable.ic_ph_tag, onClick = onTags)
                RrListRow(stringResource(S.string.select), icon = D.drawable.ic_ph_check_square, onClick = onSelect)
                RrListRow(stringResource(S.string.move_to_trash), icon = D.drawable.ic_ph_trash, onClick = onTrash, danger = true)
            }
        }
    }
}

internal enum class BulkSheet { Move, Close, Tags }

internal sealed interface BulkAction {
    data class Move(val lane: Lane?, val stage: ApplicationStage, val reason: me.rxresu.core.network.generated.PatchApplicationClosedReason? = null) : BulkAction
    data class Tag(val tags: List<String>) : BulkAction
    data object Trash : BulkAction
}

/** Select mode: count and the bulk actions (web: Tags…, Move to…, Close…, Move to Trash; up to 200). */
@Composable
private fun SelectionBar(count: Int, onBulk: (BulkSheet) -> Unit, onDone: () -> Unit, modifier: Modifier) {
    val c = RrTheme.colors
    Column(modifier.fillMaxWidth().background(c.raised)) {
        Box(Modifier.fillMaxWidth().padding(0.dp).background(c.line).padding(top = 1.dp))
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            RrText(plural(S.plurals.message_0_plural_one_selected_other_selected, count, count.toString()), style = RrType.ui, color = c.ink)
            RrButton(stringResource(S.string.move_to_6ffcfca36b), { onBulk(BulkSheet.Move) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small, enabled = count > 0)
            RrButton(stringResource(S.string.mark_as_closed_ad3ca6020c), { onBulk(BulkSheet.Close) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small, enabled = count > 0)
            RrButton(stringResource(S.string.tags_17a9c1428a), { onBulk(BulkSheet.Tags) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small, enabled = count > 0)
            RrButton(stringResource(R.string.app_select_done), onDone, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small)
        }
    }
}

@Composable
private fun BulkSheetView(kind: BulkSheet, state: ApplicationsState, onDismiss: () -> Unit, onAction: (BulkAction) -> Unit) {
    when (kind) {
        BulkSheet.Tags -> TagsSheet(emptyList(), onDismiss) { onAction(BulkAction.Tag(it)) }
        else -> RrBottomSheet(onDismissRequest = onDismiss, title = stringResource(if (kind == BulkSheet.Move) S.string.move_to_6ffcfca36b else S.string.mark_as_closed), fitContent = true) {
            Box(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
                RrListGroup {
                    if (kind == BulkSheet.Move) {
                        val open = activeLanes(state.lanes).filter { it.category != ApplicationStage.Closed }
                        if (open.isEmpty()) Pipeline.forEach { stage -> RrListRow(stageLabel(stage), leading = { RrStageDot(stage.rr()) }, onClick = { onAction(BulkAction.Move(null, stage)) }) }
                        else open.forEach { lane -> RrListRow(laneLabel(lane), leading = { RrStageDot(lane.category.rr()) }, onClick = { onAction(BulkAction.Move(lane, lane.category)) }) }
                        RrListRow(stringResource(S.string.move_to_trash), icon = D.drawable.ic_ph_trash, danger = true, onClick = { onAction(BulkAction.Trash) })
                    } else {
                        val closed = categoryLane(state.lanes, ApplicationStage.Closed)
                        ClosedReasons.forEach { reason -> RrListRow(closedReasonLabel(reason), leading = { RrStageDot(ApplicationStage.Closed.rr()) }, onClick = { onAction(BulkAction.Move(closed, ApplicationStage.Closed, reason)) }) }
                    }
                }
            }
        }
    }
}
