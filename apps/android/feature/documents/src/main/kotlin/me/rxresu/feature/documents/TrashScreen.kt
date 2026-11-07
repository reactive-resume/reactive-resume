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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import java.time.Instant
import me.rxresu.core.designsystem.R as DS
import me.rxresu.core.designsystem.RrAlertDialog
import me.rxresu.core.designsystem.RrAlertDialogLayer
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrDialogConfirm
import me.rxresu.core.designsystem.RrEmptyState
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrIconButtonSize
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrOfflineStrip
import me.rxresu.core.designsystem.RrSegment
import me.rxresu.core.designsystem.RrSegmentedControl
import me.rxresu.core.designsystem.RrSkeleton
import me.rxresu.core.designsystem.RrSwipeAction
import me.rxresu.core.designsystem.RrSwipeRow
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTopBar
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.navigation.TrashTab
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.strings.R as S

/** What the permanent-delete dialog is confirming. */
sealed interface TrashConfirm {
    data class Document(val doc: DocumentSummary) : TrashConfirm
    data class Application(val app: TrashedApplication) : TrashConfirm
    data class Selection(val count: Int, val firstName: String) : TrashConfirm
    data object Empty : TrashConfirm
}

class TrashCallbacks(
    val onBack: () -> Unit = {},
    val onTab: (TrashTab) -> Unit = {},
    val onRestore: (DocumentSummary) -> Unit = {},
    val onRestoreApplication: (TrashedApplication) -> Unit = {},
    val onConfirm: (TrashConfirm) -> Unit = {},
    val onDismissConfirm: () -> Unit = {},
    val onDelete: (TrashConfirm) -> Unit = {},
    val onToggle: (String) -> Unit = {},
    val onClearSelection: () -> Unit = {},
    val onRestoreSelection: () -> Unit = {},
)

/**
 * D6 Trash. Rows say what they are and how long they have left; Restore is each row's one button. Swipe toward the
 * start (or the TalkBack action) opens Delete permanently…; long-press selects for bulk Restore or Delete.
 *
 * @param inlineDialog draws the confirmation in place instead of in its own window (screenshots).
 */
@Composable
fun TrashScreen(
    state: TrashUiState,
    tab: TrashTab,
    confirm: TrashConfirm?,
    now: Instant,
    callbacks: TrashCallbacks,
    modifier: Modifier = Modifier,
    inlineDialog: Boolean = false,
) {
    val c = RrTheme.colors
    val documents = tab == TrashTab.Documents
    Box(modifier.fillMaxSize().background(c.bg)) {
        Column(Modifier.fillMaxSize()) {
            RrTopBar(stringResource(R.string.trash_title), onBack = callbacks.onBack, backLabel = stringResource(S.string.back_to_documents_187273e32d)) {
                if (documents && state.documents.isNotEmpty()) {
                    RrButton(stringResource(R.string.trash_empty), { callbacks.onConfirm(TrashConfirm.Empty) }, variant = RrButtonVariant.DangerGhost, size = RrButtonSize.Small)
                }
            }
            if (state.offline) RrOfflineStrip()
            RrSegmentedControl(
                listOf(RrSegment(stringResource(R.string.trash_documents)), RrSegment(stringResource(R.string.trash_applications))),
                selectedIndex = tab.ordinal,
                onSelect = { callbacks.onTab(TrashTab.entries[it]) },
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 8.dp),
            )
            RrText(
                stringResource(if (documents) R.string.trash_documents_note else R.string.trash_applications_note),
                Modifier.padding(start = 16.dp, end = 16.dp, bottom = 4.dp),
                style = RrType.small,
                color = c.ink3,
            )
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 16.dp)) {
                item {
                    when {
                        state.loading -> RrSkeleton(Modifier.fillMaxWidth().height(180.dp))
                        documents && state.documents.isEmpty() || !documents && state.applications.isEmpty() ->
                            RrEmptyState(stringResource(R.string.trash_empty_title), stringResource(R.string.trash_empty_body))
                        documents -> DocumentRows(state, now, callbacks)
                        else -> ApplicationRows(state, callbacks)
                    }
                }
            }
            if (state.selection.isNotEmpty()) SelectionBar(state.selection.size, state.documents.firstOrNull { it.id in state.selection }?.name.orEmpty(), callbacks)
        }
        if (confirm != null) ConfirmDialog(confirm, callbacks, inlineDialog)
    }
}

@Composable
private fun DocumentRows(state: TrashUiState, now: Instant, callbacks: TrashCallbacks) {
    val deleteLabel = stringResource(R.string.trash_delete_permanently)
    RrListGroup {
        state.documents.forEach { doc ->
            val type = stringResource(if (doc.isLetter) S.string.letter else S.string.resume)
            val left = daysLeft(doc.trashedAt, now)
            val subtitle = if (left == 0) stringResource(R.string.trash_deleted_today, type)
            else stringResource(R.string.trash_deleted_in, type, pluralStringResource(R.plurals.trash_days, left, left))
            val selecting = state.selection.isNotEmpty()
            RrSwipeRow(startAction = RrSwipeAction(deleteLabel, DS.drawable.ic_ph_trash, danger = true) { callbacks.onConfirm(TrashConfirm.Document(doc)) }) {
                RrListRow(
                    doc.name,
                    subtitle = subtitle,
                    leading = { SmallThumbnail(doc) },
                    selected = doc.id in state.selection,
                    onClick = if (selecting) ({ callbacks.onToggle(doc.id) }) else null,
                    onLongClick = { callbacks.onToggle(doc.id) },
                    onLongClickLabel = stringResource(R.string.docs_select, doc.name),
                    trailing = if (selecting) null else {
                        { RrButton(stringResource(R.string.trash_restore), { callbacks.onRestore(doc) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small) }
                    },
                )
            }
        }
    }
}

@Composable
private fun ApplicationRows(state: TrashUiState, callbacks: TrashCallbacks) {
    val deleteLabel = stringResource(R.string.trash_delete_permanently)
    RrListGroup {
        state.applications.forEach { app ->
            RrSwipeRow(startAction = RrSwipeAction(deleteLabel, DS.drawable.ic_ph_trash, danger = true) { callbacks.onConfirm(TrashConfirm.Application(app)) }) {
                RrListRow(
                    app.company,
                    subtitle = app.role,
                    icon = DS.drawable.ic_ph_briefcase,
                    onLongClick = { callbacks.onConfirm(TrashConfirm.Application(app)) },
                    onLongClickLabel = deleteLabel,
                    trailing = { RrButton(stringResource(R.string.trash_restore), { callbacks.onRestoreApplication(app) }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small) },
                )
            }
        }
    }
}

@Composable
private fun SelectionBar(count: Int, firstName: String, callbacks: TrashCallbacks) {
    val c = RrTheme.colors
    Column(Modifier.fillMaxWidth().background(c.bg)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
        Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 16.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RrIconButton(DS.drawable.ic_ph_x, stringResource(R.string.docs_clear_selection), callbacks.onClearSelection, size = RrIconButtonSize.Small)
            RrText(stringResource(R.string.docs_selected, count.toString()), style = RrType.small, color = c.ink2, modifier = Modifier.weight(1f))
            RrButton(stringResource(R.string.trash_restore_selected), callbacks.onRestoreSelection, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
            RrButton(stringResource(R.string.trash_delete_selected), { callbacks.onConfirm(TrashConfirm.Selection(count, firstName)) }, variant = RrButtonVariant.DangerGhost, size = RrButtonSize.Small)
        }
    }
}

@Composable
private fun ConfirmDialog(confirm: TrashConfirm, callbacks: TrashCallbacks, inline: Boolean) {
    val title = when (confirm) {
        is TrashConfirm.Document -> stringResource(R.string.trash_delete_title, confirm.doc.name)
        is TrashConfirm.Application -> stringResource(R.string.trash_delete_title, confirm.app.company)
        is TrashConfirm.Selection -> if (confirm.count == 1) stringResource(R.string.trash_delete_title, confirm.firstName) else stringResource(R.string.trash_delete_many_title, confirm.count.toString())
        TrashConfirm.Empty -> stringResource(R.string.trash_empty_confirm_title)
    }
    val text = when (confirm) {
        is TrashConfirm.Document -> stringResource(R.string.trash_delete_one)
        is TrashConfirm.Application -> stringResource(R.string.trash_delete_application)
        is TrashConfirm.Selection -> stringResource(if (confirm.count == 1) R.string.trash_delete_one else R.string.trash_delete_many)
        TrashConfirm.Empty -> stringResource(R.string.trash_empty_confirm)
    }
    val hold = stringResource(S.string.hold_to_delete)
    val keep = stringResource(R.string.trash_keep)
    if (inline) {
        RrAlertDialogLayer(title, text, hold, { callbacks.onDelete(confirm) }, callbacks.onDismissConfirm, keep, RrDialogConfirm.HoldToDelete)
    } else {
        RrAlertDialog(title, text, hold, { callbacks.onDelete(confirm) }, callbacks.onDismissConfirm, keep, RrDialogConfirm.HoldToDelete)
    }
}
