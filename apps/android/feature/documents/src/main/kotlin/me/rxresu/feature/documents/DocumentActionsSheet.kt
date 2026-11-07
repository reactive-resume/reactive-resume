package me.rxresu.feature.documents

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.Instant
import me.rxresu.core.designsystem.R as DS
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrChoiceRow
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrIconButtonSize
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrQuickActionTile
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrRowValue
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.network.generated.DocumentType
import me.rxresu.core.strings.R as S

/** Steps pushed inside the D2 sheet. */
enum class ActionsStep { Main, Tags, Link, CopyForJob }

class DocumentActionsCallbacks(
    val onClose: () -> Unit = {},
    val onSharePdf: () -> Unit = {},
    val onCopyLink: () -> Unit = {},
    val onDuplicate: () -> Unit = {},
    val onRename: (String) -> Unit = {},
    val onWriteLetter: () -> Unit = {},
    val onLink: (applicationId: String?) -> Unit = {},
    val onTags: (add: Set<String>, remove: Set<String>) -> Unit = { _, _ -> },
    val onToggleLock: () -> Unit = {},
    val onSelect: () -> Unit = {},
    val onTrash: () -> Unit = {},
    val onCopyForJob: (resumeId: String, job: JobChoice, name: String) -> Unit = { _, _, _ -> },
)

/**
 * D2 Document actions: four quick tiles, then the rest as rows. Locked documents can't be renamed, tagged or trashed.
 * Draws its own [RrBottomSheet] once the document is loaded; the caller removes it on [DocumentActionsCallbacks.onClose].
 */
@Composable
fun DocumentActionsSheet(
    state: DocumentActionsUiState,
    now: Instant,
    callbacks: DocumentActionsCallbacks,
    preparing: Boolean = false,
    busy: Boolean = false,
    initialStep: ActionsStep = ActionsStep.Main,
) {
    val doc = state.document
    var step by rememberSaveable { mutableStateOf(initialStep) }
    var renaming by rememberSaveable { mutableStateOf(false) }
    // Nothing to show until the document loads. The fit-content Main step and the full-height pushed steps share one
    // sheet: it follows its content's height as the step changes.
    if (doc == null) return
    RrBottomSheet(
        onDismissRequest = callbacks.onClose,
        fitContent = step == ActionsStep.Main,
        detents = listOf(0.92f),
        confirmDiscard = renaming,
    ) {
        val reduced = RrTheme.reducedMotion
        AnimatedContent(
            step,
            transitionSpec = {
                val forward = targetState.ordinal > initialState.ordinal
                val spec = tween<androidx.compose.ui.unit.IntOffset>(if (reduced) 0 else RrMotion.D3, easing = RrMotion.ease)
                slideInHorizontally(spec) { if (forward) it else -it } togetherWith slideOutHorizontally(spec) { if (forward) -it else it }
            },
            label = "step",
        ) { current ->
            Column {
                when (current) {
                    ActionsStep.Main -> {
                        Header(doc, now, renaming, callbacks, onRenamingChange = { renaming = it })
                        Main(doc, state, preparing, callbacks, onStep = { step = it }, onRename = { renaming = true })
                    }
                    ActionsStep.Tags -> {
                        StepHeader(stringResource(R.string.docs_tags_title)) { step = ActionsStep.Main }
                        TagsEditor(state.tags, doc.tags.toSet(), { add, remove -> callbacks.onTags(add, remove); step = ActionsStep.Main }, saving = busy)
                    }
                    ActionsStep.Link -> {
                        StepHeader(stringResource(R.string.docs_application_title)) { step = ActionsStep.Main }
                        RrListGroup(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
                            RrChoiceRow(stringResource(S.string.not_linked_to_a_job), doc.application == null, { callbacks.onLink(null) })
                            state.applications.forEach { app ->
                                RrChoiceRow(stringResource(R.string.docs_copy_for_company, app.company, app.role), doc.application?.id == app.id, { callbacks.onLink(app.id) })
                            }
                        }
                    }
                    ActionsStep.CopyForJob -> {
                        StepHeader(stringResource(R.string.docs_copy_title)) { step = ActionsStep.Main }
                        CopyForJobForm(state.library, state.applications, doc.id, busy, callbacks.onCopyForJob)
                    }
                }
            }
        }
    }
}

@Composable
internal fun StepHeader(title: String, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 16.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        RrIconButton(DS.drawable.ic_ph_caret_left, stringResource(R.string.docs_back), onBack, size = RrIconButtonSize.Small, mirrorInRtl = true)
        RrText(title, style = RrType.sheetTitle, color = RrTheme.colors.ink, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun Header(doc: DocumentSummary, now: Instant, renaming: Boolean, callbacks: DocumentActionsCallbacks, onRenamingChange: (Boolean) -> Unit) {
    val c = RrTheme.colors
    var name by rememberSaveable(doc.id) { mutableStateOf(doc.name) }
    Row(
        Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SmallThumbnail(doc, width = 40.dp)
        if (renaming) {
            val done = { if (name.isNotBlank() && name.trim() != doc.name) callbacks.onRename(name); onRenamingChange(false) }
            RrTextField(
                name,
                { name = it },
                Modifier.weight(1f),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { done() }),
            )
            RrButton(stringResource(S.string.done), done, size = RrButtonSize.Small)
        } else {
            Column(Modifier.weight(1f)) {
                RrText(doc.name, style = RrType.label, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val parts = listOfNotNull(
                    stringResource(if (doc.type == DocumentType.Letter) S.string.letter else S.string.resume),
                    if (doc.isPublic) stringResource(R.string.docs_public) else null,
                    stringResource(R.string.docs_meta_edited, relativeTime(doc.editedAt, now)),
                )
                RrText(parts.joinToString(" · "), style = RrType.small, color = c.ink3)
            }
            RrIconButton(DS.drawable.ic_ph_x, stringResource(S.string.close), callbacks.onClose, size = RrIconButtonSize.Small)
        }
    }
}

/** Rename edits the name inline in the header; the tile only switches it to editing. */
@Composable
private fun Main(doc: DocumentSummary, state: DocumentActionsUiState, preparing: Boolean, callbacks: DocumentActionsCallbacks, onStep: (ActionsStep) -> Unit, onRename: () -> Unit) {
    val locked = doc.isLocked
    val resume = doc.type == DocumentType.Resume
    Column(Modifier.padding(bottom = 16.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val tile = Modifier.weight(1f)
            RrQuickActionTile(if (preparing) stringResource(R.string.docs_preparing) else stringResource(R.string.docs_share_pdf), DS.drawable.ic_ph_share_network, callbacks.onSharePdf, tile, busy = preparing)
            if (state.publicUrl != null) RrQuickActionTile(stringResource(R.string.docs_copy_link), DS.drawable.ic_ph_link_simple, callbacks.onCopyLink, tile)
            RrQuickActionTile(stringResource(R.string.docs_duplicate), DS.drawable.ic_ph_copy, callbacks.onDuplicate, tile)
            RrQuickActionTile(stringResource(R.string.docs_rename), DS.drawable.ic_ph_pencil_simple, onRename, tile, enabled = !locked)
        }
        if (locked) RrCallout(stringResource(R.string.docs_locked_note), Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp), tone = RrTone.Warn, icon = DS.drawable.ic_ph_lock_simple)
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            if (resume) RrListRow(stringResource(R.string.docs_copy_for_job), icon = DS.drawable.ic_ph_briefcase, onClick = { onStep(ActionsStep.CopyForJob) })
            Disabled(locked && !resume) {
                RrListRow(
                    stringResource(R.string.docs_link_application),
                    icon = DS.drawable.ic_ph_link_simple,
                    enabled = !(locked && !resume),
                    onClick = { onStep(ActionsStep.Link) },
                    trailing = doc.application?.let { { RrRowValue(it.company, caret = false) } },
                )
            }
            if (resume) RrListRow(stringResource(R.string.docs_write_letter), icon = DS.drawable.ic_ph_note_pencil, onClick = callbacks.onWriteLetter)
            Disabled(locked) {
                RrListRow(
                    stringResource(R.string.docs_tags),
                    icon = DS.drawable.ic_ph_tag,
                    enabled = !locked,
                    onClick = { onStep(ActionsStep.Tags) },
                    trailing = if (doc.tags.isEmpty()) null else { { RrRowValue(doc.tags.joinToString(", "), caret = false) } },
                )
            }
            RrListRow(
                stringResource(if (locked) R.string.docs_unlock else R.string.docs_lock),
                icon = if (locked) DS.drawable.ic_ph_lock_simple_open else DS.drawable.ic_ph_lock_simple,
                onClick = callbacks.onToggleLock,
            )
            RrListRow(stringResource(R.string.docs_select_action), icon = DS.drawable.ic_ph_check_square, onClick = callbacks.onSelect)
            Disabled(locked) {
                RrListRow(stringResource(R.string.docs_move_to_trash), icon = DS.drawable.ic_ph_trash, danger = true, enabled = !locked, onClick = callbacks.onTrash)
            }
        }
    }
}

@Composable
private fun Disabled(disabled: Boolean, content: @Composable () -> Unit) {
    Box(Modifier.alpha(if (disabled) 0.45f else 1f)) { content() }
}
