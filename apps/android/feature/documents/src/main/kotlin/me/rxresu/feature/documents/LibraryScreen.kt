package me.rxresu.feature.documents

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.Instant
import me.rxresu.core.designsystem.R as DS
import me.rxresu.core.designsystem.RrAvatar
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrChoiceRow
import me.rxresu.core.designsystem.RrEmptyState
import me.rxresu.core.designsystem.RrFilterChip
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrIconButtonSize
import me.rxresu.core.designsystem.RrLargeTitleHeader
import me.rxresu.core.designsystem.RrLayout
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrOfflineStrip
import me.rxresu.core.designsystem.RrPageThumbnail
import me.rxresu.core.designsystem.RrPullToRefresh
import me.rxresu.core.designsystem.RrRowCaret
import me.rxresu.core.designsystem.RrSectionHeader
import me.rxresu.core.designsystem.RrSegment
import me.rxresu.core.designsystem.RrSegmentedControl
import me.rxresu.core.designsystem.RrShape
import me.rxresu.core.designsystem.RrSkeleton
import me.rxresu.core.designsystem.RrSwipeAction
import me.rxresu.core.designsystem.RrSwipeRow
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.designsystem.rememberRrLargeTitleState
import me.rxresu.core.designsystem.rrLargeTitleScroll
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.network.generated.ListDocumentsSort
import me.rxresu.core.strings.R as S

/** Everything D1 can ask for. Defaults do nothing, for previews and screenshots. */
class LibraryActions(
    val onSearch: () -> Unit = {},
    val onNew: () -> Unit = {},
    val onSettings: () -> Unit = {},
    val onRefresh: () -> Unit = {},
    val onRetry: () -> Unit = {},
    val onType: (LibraryType) -> Unit = {},
    val onTag: (String?) -> Unit = {},
    val onSort: (ListDocumentsSort) -> Unit = {},
    val onGrid: (Boolean) -> Unit = {},
    val onClearFilters: () -> Unit = {},
    val onOpen: (DocumentSummary) -> Unit = {},
    /** Long-press: the D2 actions sheet. */
    val onActions: (DocumentSummary) -> Unit = {},
    val onToggle: (String) -> Unit = {},
    val onTrash: (DocumentSummary) -> Unit = {},
    val onClearSelection: () -> Unit = {},
    val onTrashSelection: () -> Unit = {},
    val onTagSelection: (add: Set<String>, remove: Set<String>) -> Unit = { _, _ -> },
    val onOpenTrash: () -> Unit = {},
)

private enum class LibrarySheet { SortAndView, Tags }

/** D1 Documents library. Stateless: [state] from [LibraryViewModel]. */
@Composable
fun LibraryScreen(state: LibraryUiState, now: Instant, actions: LibraryActions, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    val header = rememberRrLargeTitleState()
    var sheet by rememberSaveable { mutableStateOf<LibrarySheet?>(null) }
    Box(modifier.fillMaxSize().background(c.bg)) {
        Column(Modifier.fillMaxSize()) {
            RrLargeTitleHeader(
                title = stringResource(S.string.documents),
                state = header,
                bottom = { Filters(state, actions) { sheet = LibrarySheet.SortAndView } },
            ) {
                RrIconButton(DS.drawable.ic_ph_magnifying_glass, stringResource(S.string.search), actions.onSearch)
                RrButton(stringResource(R.string.docs_new), actions.onNew, size = RrButtonSize.Small, icon = DS.drawable.ic_ph_plus)
                RrAvatar(state.initials, onClick = actions.onSettings, contentDescription = stringResource(S.string.settings))
            }
            if (state.offline) RrOfflineStrip()
            RrPullToRefresh(state.refreshing, actions.onRefresh, Modifier.weight(1f)) {
                val modifierScroll = Modifier.fillMaxSize().rrLargeTitleScroll(header)
                when {
                    state.loading -> LoadingGrid(modifierScroll)
                    state.error -> Message(modifierScroll) {
                        RrEmptyState(stringResource(R.string.docs_load_failed_title), stringResource(R.string.docs_load_failed_body), actionLabel = stringResource(R.string.docs_try_again), onAction = actions.onRetry)
                    }
                    state.all.isEmpty() -> Message(modifierScroll) {
                        RrEmptyState(stringResource(R.string.docs_empty_title), stringResource(R.string.docs_empty_body), actionLabel = stringResource(R.string.docs_new), onAction = actions.onNew)
                    }
                    else -> Crossfade(
                        state.filters.copy(sort = ListDocumentsSort.Edited),
                        animationSpec = tween(if (RrTheme.reducedMotion) 0 else RrMotion.D2, easing = RrMotion.ease),
                        label = "filter",
                    ) { filters ->
                        val shown = remember(state.all, filters) { LibraryViewModel.filter(state.all, filters) }
                        when {
                            shown.isEmpty() -> Message(modifierScroll) {
                                RrEmptyState(stringResource(R.string.docs_no_match_title), stringResource(R.string.docs_no_match_body), actionLabel = stringResource(R.string.docs_clear_filters), onAction = actions.onClearFilters)
                            }
                            filters.grid -> Grid(shown, state, now, actions, modifierScroll)
                            else -> ListView(shown, state, now, actions, modifierScroll)
                        }
                    }
                }
            }
        }
        if (state.selecting) SelectionBar(state, actions, onTags = { sheet = LibrarySheet.Tags }, Modifier.align(Alignment.BottomCenter))
        when (sheet) {
            LibrarySheet.SortAndView -> RrBottomSheet({ sheet = null }, fitContent = true, title = stringResource(R.string.docs_sort_and_view)) {
                SortAndView(state.filters, actions) { sheet = null; actions.onOpenTrash() }
            }
            LibrarySheet.Tags -> RrBottomSheet({ sheet = null }, fitContent = true, title = stringResource(R.string.docs_tags_title)) {
                val selected = state.selected.filterNot { it.isLocked }
                TagsEditor(
                    known = state.tags,
                    initial = selected.map { it.tags.toSet() }.reduceOrNull { a, b -> a intersect b }.orEmpty(),
                    onSave = { add, remove -> sheet = null; actions.onTagSelection(add, remove) },
                )
            }
            null -> {}
        }
    }
}

@Composable
private fun Filters(state: LibraryUiState, actions: LibraryActions, onSortAndView: () -> Unit) {
    val f = state.filters
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        LazyRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item { RrFilterChip(stringResource(S.string.all), f.type == LibraryType.All && f.tag == null, { actions.onClearFilters() }) }
            item { RrFilterChip("${stringResource(S.string.resumes)} ${state.resumes}", f.type == LibraryType.Resume, { on -> actions.onType(if (on) LibraryType.Resume else LibraryType.All) }) }
            item { RrFilterChip("${stringResource(S.string.letters)} ${state.letters}", f.type == LibraryType.Letter, { on -> actions.onType(if (on) LibraryType.Letter else LibraryType.All) }) }
            items(state.tags) { tag ->
                RrFilterChip(tag, f.tag == tag, { on -> actions.onTag(if (on) tag else null) }, icon = DS.drawable.ic_ph_tag)
            }
        }
        RrIconButton(DS.drawable.ic_ph_sliders_horizontal, stringResource(R.string.docs_sort_and_view), onSortAndView, size = RrIconButtonSize.Small)
    }
}

@Composable
private fun Message(modifier: Modifier, content: @Composable () -> Unit) {
    LazyColumn(modifier, contentPadding = PaddingValues(16.dp)) { item { content() } }
}

@Composable
private fun LoadingGrid(modifier: Modifier) {
    LazyVerticalGrid(
        GridCells.Fixed(2),
        modifier,
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
        userScrollEnabled = false,
    ) {
        items(4) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                RrSkeleton(Modifier.fillMaxWidth().aspectRatio(RrLayout.PAGE_ASPECT), RrShape.xs)
                RrSkeleton(Modifier.width(96.dp).height(12.dp))
            }
        }
    }
}

@Composable
private fun Grid(docs: List<DocumentSummary>, state: LibraryUiState, now: Instant, actions: LibraryActions, modifier: Modifier) {
    val reduced = RrTheme.reducedMotion
    LazyVerticalGrid(
        GridCells.Fixed(2),
        modifier,
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = if (state.selecting) 80.dp else 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        items(docs, key = { it.id }) { doc ->
            DocumentCard(
                doc,
                now,
                selecting = state.selecting,
                selected = doc.id in state.selection,
                actions = actions,
                modifier = if (reduced) Modifier else Modifier.animateItem(
                    fadeInSpec = null,
                    placementSpec = tween(RrMotion.D2, easing = RrMotion.easeInOutStrong),
                    fadeOutSpec = tween(RrMotion.D2, easing = RrMotion.ease),
                ),
            )
        }
    }
}

@Composable
private fun meta(doc: DocumentSummary, now: Instant): String =
    stringResource(if (doc.isLetter) R.string.docs_letter_meta else R.string.docs_resume_meta, relativeTime(doc.editedAt, now))

/** A grid card: the first page (white paper in both themes), name, type and time, at most two badges. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DocumentCard(doc: DocumentSummary, now: Instant, selecting: Boolean, selected: Boolean, actions: LibraryActions, modifier: Modifier) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val optionsLabel = stringResource(S.string.options_for_0, doc.name)
    Column(
        modifier
            .combinedClickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = LocalIndication.current,
                role = Role.Button,
                onLongClickLabel = optionsLabel,
                onLongClick = { haptics(RrHaptic.Light); actions.onActions(doc) },
                onClick = { if (selecting) actions.onToggle(doc.id) else actions.onOpen(doc) },
            )
            .semantics { if (selecting) this.selected = selected },
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box {
            RrPageThumbnail(rememberThumbnail(doc, 174.dp), Modifier.fillMaxWidth(), letter = doc.isLetter, locked = doc.isLocked)
            if (selecting) {
                me.rxresu.core.designsystem.RrCheckbox(selected, null, Modifier.align(Alignment.TopStart).padding(8.dp))
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            RrText(doc.name, style = CardName, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            RrText(meta(doc, now), style = CardMeta, color = c.ink3)
            DocumentBadges(doc, Modifier.padding(top = 2.dp))
        }
    }
}

/** List view: rows that swipe toward the start to move to Trash; long-press opens the actions sheet. */
@Composable
private fun ListView(docs: List<DocumentSummary>, state: LibraryUiState, now: Instant, actions: LibraryActions, modifier: Modifier) {
    val trash = stringResource(R.string.docs_move_to_trash)
    LazyColumn(modifier, contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = if (state.selecting) 80.dp else 16.dp)) {
        item {
            RrListGroup {
                docs.forEach { doc ->
                    RrSwipeRow(startAction = if (doc.isLocked || state.selecting) null else RrSwipeAction(trash, DS.drawable.ic_ph_trash, danger = true) { actions.onTrash(doc) }) {
                        RrListRow(
                            doc.name,
                            subtitle = meta(doc, now),
                            leading = { SmallThumbnail(doc) },
                            selected = doc.id in state.selection,
                            onClick = { if (state.selecting) actions.onToggle(doc.id) else actions.onOpen(doc) },
                            onLongClick = { actions.onActions(doc) },
                            onLongClickLabel = stringResource(S.string.options_for_0, doc.name),
                            trailing = if (doc.isLocked) {
                                { me.rxresu.core.designsystem.RrIcon(DS.drawable.ic_ph_lock_simple, stringResource(R.string.docs_locked), size = 18.dp, tint = RrTheme.colors.ink3) }
                            } else null,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SortAndView(filters: LibraryFilters, actions: LibraryActions, onOpenTrash: () -> Unit) {
    Column(Modifier.padding(bottom = 16.dp)) {
        RrSectionHeader(stringResource(S.string.sort), topPadding = 0.dp)
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            listOf(
                ListDocumentsSort.Edited to stringResource(S.string.last_edited),
                ListDocumentsSort.Name to stringResource(R.string.docs_name),
                ListDocumentsSort.Created to stringResource(S.string.created),
            ).forEach { (sort, label) ->
                RrChoiceRow(label, filters.sort == sort, { actions.onSort(sort) })
            }
        }
        RrSectionHeader(stringResource(R.string.docs_view))
        RrSegmentedControl(
            listOf(RrSegment(stringResource(S.string.grid_view), DS.drawable.ic_ph_files), RrSegment(stringResource(S.string.list_view), DS.drawable.ic_ph_list)),
            selectedIndex = if (filters.grid) 0 else 1,
            onSelect = { actions.onGrid(it == 0) },
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        RrListGroup(Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp)) {
            RrListRow(stringResource(R.string.docs_open_trash), icon = DS.drawable.ic_ph_trash, onClick = onOpenTrash, trailing = { RrRowCaret() })
        }
    }
}

/** Bottom bar in select mode: Tags and Move to Trash. Locked documents are skipped and said so. */
@Composable
private fun SelectionBar(state: LibraryUiState, actions: LibraryActions, onTags: () -> Unit, modifier: Modifier) {
    val c = RrTheme.colors
    Column(modifier.fillMaxWidth().background(c.bg)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
        Row(
            Modifier.fillMaxWidth().padding(start = 8.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            RrIconButton(DS.drawable.ic_ph_x, stringResource(R.string.docs_clear_selection), actions.onClearSelection, size = RrIconButtonSize.Small)
            val count = stringResource(R.string.docs_selected, state.selection.size.toString())
            RrText(count, style = RrType.small, color = c.ink2, modifier = Modifier.weight(1f).semantics { contentDescription = count })
            RrButton(stringResource(R.string.docs_tags_title), onTags, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small, icon = DS.drawable.ic_ph_tag)
            RrButton(stringResource(R.string.docs_move_to_trash), actions.onTrashSelection, variant = RrButtonVariant.DangerGhost, size = RrButtonSize.Small, icon = DS.drawable.ic_ph_trash)
        }
    }
}
