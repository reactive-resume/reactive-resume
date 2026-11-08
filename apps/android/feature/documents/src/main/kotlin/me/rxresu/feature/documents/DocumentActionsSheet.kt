package me.rxresu.feature.documents

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import java.time.Instant
import me.rxresu.core.designsystem.R as DS
import me.rxresu.core.designsystem.RrSheetHeader
import me.rxresu.core.designsystem.RrIconTile
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrChoiceRow
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrIconButtonSize
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.strings.R as S

/** Steps pushed inside the D2 sheet. */
enum class ActionsStep { Main, Tags, Link, CopyForJob }

class DocumentActionsCallbacks(
    val onClose: () -> Unit = {},
    val onOpen: () -> Unit = {},
    val onFormats: () -> Unit = {},
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
    val onTailor: (() -> Unit)? = null,
    val onCopyForJob: (resumeId: String, job: JobChoice, name: String) -> Unit = { _, _, _ -> },
)

/**
 * D2 Document actions: seven plain rows. Locked documents can't be renamed, tagged or trashed.
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
    // The main menu uses the storyboard height; authoring steps keep their full-height scroll surface.
    if (doc == null) return
    var copyDraft by rememberSaveable(doc.id) { mutableStateOf(CopyForJobDraft()) }
    var confirmBack by remember { mutableStateOf(false) }
    RrBottomSheet(
        onDismissRequest = callbacks.onClose,
        fixedHeight = if (step == ActionsStep.Main) 640.dp else null,
        detents = listOf(0.92f),
        confirmDiscard = renaming || copyDraft.dirty,
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
                        RrListGroup(Modifier.padding(start = 24.dp, end = 24.dp, bottom = 16.dp)) {
                            RrChoiceRow(stringResource(S.string.not_linked_to_a_job), doc.application == null, { callbacks.onLink(null) })
                            state.applications.forEach { app ->
                                RrChoiceRow(stringResource(R.string.docs_copy_for_company, app.company, app.role), doc.application?.id == app.id, { callbacks.onLink(app.id) })
                            }
                        }
                    }
                    ActionsStep.CopyForJob -> {
                        StepHeader(stringResource(R.string.docs_copy_title)) { if (copyDraft.dirty) confirmBack = true else step = ActionsStep.Main }
                        CopyForJobForm(state.library, state.applications, doc.id, busy, callbacks.onCopyForJob, draft = copyDraft, onDraft = { copyDraft = it })
                    }
                }
            }
        }
    }
    if (confirmBack) CopyDiscardDialog(
        onKeep = { confirmBack = false },
        onDiscard = { confirmBack = false; copyDraft = CopyForJobDraft(); step = ActionsStep.Main },
    )
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
    Column {
        RrSheetHeader(if (renaming) "" else doc.name) {
            if (renaming) {
                val done = { if (name.isNotBlank() && name.trim() != doc.name) callbacks.onRename(name); onRenamingChange(false) }
                RrTextField(name, { name = it }, Modifier.weight(1f), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { done() }))
                RrButton(stringResource(S.string.done), done, size = RrButtonSize.Small)
            }
            RrIconButton(DS.drawable.ic_ph_x, stringResource(S.string.close), callbacks.onClose, size = RrIconButtonSize.Small)
        }
        RrText(stringResource(R.string.docs_actions_meta, stringResource(if (doc.isLetter) R.string.docs_cover_letter else R.string.docs_resume), relativeTime(doc.editedAt, now)), Modifier.fillMaxWidth().padding(horizontal = 24.dp), style = RrType.body, color = c.ink3)
    }
}

/** Rename edits the name inline in the header; the tile only switches it to editing. */
@Composable
private fun Main(doc: DocumentSummary, state: DocumentActionsUiState, preparing: Boolean, callbacks: DocumentActionsCallbacks, onStep: (ActionsStep) -> Unit, onRename: () -> Unit) {
    val locked = doc.isLocked
    RrListGroup(Modifier.verticalScroll(rememberScrollState())) {
        RrListRow(stringResource(R.string.docs_open), tile = DS.drawable.ic_ph_pencil_simple, onClick = callbacks.onOpen, onLongClick = callbacks.onSelect, onLongClickLabel = stringResource(R.string.docs_select_action), divider = true)
        if (!doc.isLetter) RrListRow(stringResource(R.string.docs_tailor), subtitle = stringResource(R.string.docs_tailor_subtitle), leading = { RrIconTile(DS.drawable.ic_ph_sparkle, accent = true) }, onClick = { callbacks.onTailor?.invoke() ?: onStep(ActionsStep.CopyForJob) }, divider = true)
        RrListRow(stringResource(R.string.docs_duplicate), tile = DS.drawable.ic_ph_copy, onClick = callbacks.onDuplicate, divider = true)
        RrListRow(stringResource(R.string.docs_rename), tile = DS.drawable.ic_ph_text_aa, onClick = onRename, enabled = !locked, divider = true)
        RrListRow(stringResource(if (preparing) R.string.docs_preparing else R.string.docs_share_pdf), tile = DS.drawable.ic_ph_share_network, onClick = callbacks.onFormats, divider = true)
        RrListRow(stringResource(if (locked) R.string.docs_unlock else R.string.docs_lock), tile = if (locked) DS.drawable.ic_ph_lock_simple_open else DS.drawable.ic_ph_lock_simple, onClick = callbacks.onToggleLock, divider = true)
        RrListRow(stringResource(R.string.docs_move_to_trash), leading = { RrIconTile(DS.drawable.ic_ph_trash) }, danger = true, enabled = !locked, onClick = callbacks.onTrash)
    }
}
