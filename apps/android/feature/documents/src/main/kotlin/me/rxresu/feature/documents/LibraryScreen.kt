package me.rxresu.feature.documents

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.time.Instant
import me.rxresu.core.designsystem.R as DS
import me.rxresu.core.designsystem.RrDocumentThumbnail
import me.rxresu.core.designsystem.RrSectionHeading
import me.rxresu.core.designsystem.RrIcon
import androidx.compose.foundation.clickable
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrEmptyState
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrIconButtonSize
import me.rxresu.core.designsystem.RrLargeTitleHeader
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrOfflineStrip
import me.rxresu.core.designsystem.RrPullToRefresh
import me.rxresu.core.designsystem.RrRowCaret
import me.rxresu.core.designsystem.RrSkeleton
import me.rxresu.core.designsystem.RrSwipeAction
import me.rxresu.core.designsystem.RrSwipeRow
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
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

private enum class LibrarySheet { Tags }

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
            ) {
                RrIconButton(DS.drawable.ic_ph_magnifying_glass, stringResource(S.string.search), actions.onSearch)
                RrIconButton(DS.drawable.ic_ph_plus, stringResource(R.string.docs_new), actions.onNew)
            }
            if (state.offline) RrOfflineStrip()
            RrPullToRefresh(state.refreshing, actions.onRefresh, Modifier.weight(1f)) {
                val modifierScroll = Modifier.fillMaxSize().rrLargeTitleScroll(header)
                when {
                    state.loading -> LoadingList(modifierScroll)
                    state.error -> Message(modifierScroll) {
                        RrEmptyState(stringResource(R.string.docs_load_failed_title), stringResource(R.string.docs_load_failed_body), actionLabel = stringResource(R.string.docs_try_again), onAction = actions.onRetry)
                    }
                    state.all.isEmpty() -> Message(modifierScroll) {
                        RrEmptyState(stringResource(R.string.docs_empty_title), stringResource(R.string.docs_empty_body), actionLabel = stringResource(R.string.docs_new), onAction = actions.onNew)
                    }
                    else -> ListView(state.all, state, now, actions, modifierScroll)
                }
            }
        }
        if (state.selecting) SelectionBar(state, actions, onTags = { sheet = LibrarySheet.Tags }, Modifier.align(Alignment.BottomCenter))
        when (sheet) {
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
private fun Message(modifier: Modifier, content: @Composable () -> Unit) {
    LazyColumn(modifier, contentPadding = PaddingValues(16.dp)) { item { content() } }
}

@Composable
private fun LoadingList(modifier: Modifier) {
    LazyColumn(modifier, contentPadding = PaddingValues(24.dp)) {
        items(5) { RrSkeleton(Modifier.fillMaxWidth().padding(vertical = 12.dp).height(50.dp)) }
    }
}

@Composable
private fun ListView(docs: List<DocumentSummary>, state: LibraryUiState, now: Instant, actions: LibraryActions, modifier: Modifier) {
    LazyColumn(modifier, contentPadding = PaddingValues(bottom = if (state.selecting) 80.dp else 24.dp)) {
        val groups = listOf(docs.filterNot { it.isLetter }, docs.filter { it.isLetter })
        groups.forEachIndexed { groupIndex, group ->
            if (group.isNotEmpty()) {
                item { RrSectionHeading(stringResource(if (groupIndex == 0) S.string.resumes else R.string.docs_cover_letters), count = group.size.toString(), first = groupIndex == 0) }
                item {
                    RrListGroup {
                        group.forEachIndexed { index, doc ->
                            val selectLabel = stringResource(R.string.docs_select, doc.name)
                            val open = { if (state.selecting) actions.onToggle(doc.id) else if (doc.isLocked) actions.onActions(doc) else actions.onOpen(doc) }
                            RrSwipeRow(startAction = RrSwipeAction(stringResource(S.string.actions), DS.drawable.ic_ph_sliders_horizontal) { actions.onActions(doc) }) {
                                RrListRow(
                                    doc.name,
                                    modifier = Modifier.semantics { if (state.selecting) selected = doc.id in state.selection; customActions = listOf(CustomAccessibilityAction(selectLabel) { actions.onToggle(doc.id); true }) },
                                    subtitle = documentMeta(doc, now),
                                    leading = { RrDocumentThumbnail(letter = doc.isLetter) },
                                    selected = doc.id in state.selection,
                                    onClick = open,
                                    onLongClick = { if (state.selecting) actions.onToggle(doc.id) else actions.onActions(doc) },
                                    onLongClickLabel = stringResource(R.string.docs_select, doc.name),
                                    divider = index < group.lastIndex,
                                    trailing = { RrRowCaret() },
                                )
                            }
                        }
                    }
                }
            }
        }
        item {
            Row(Modifier.padding(start = 24.dp, top = 12.dp).height(44.dp).clickable(onClick = actions.onOpenTrash), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                RrIcon(DS.drawable.ic_ph_trash, null, size = 20.dp, tint = RrTheme.colors.ink3)
                RrText(stringResource(R.string.docs_trash_count, state.trashCount), style = RrType.textLink, color = RrTheme.colors.ink3)
            }
        }
    }
}

@Composable
private fun documentMeta(doc: DocumentSummary, now: Instant): String = listOfNotNull(
    stringResource(R.string.docs_meta_edited, relativeTime(doc.editedAt, now)),
    if (doc.isPublic) stringResource(R.string.docs_public) else if (!doc.isLetter) doc.application?.let { stringResource(R.string.docs_for_company, it.company) } else null,
).joinToString(" · ")

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
