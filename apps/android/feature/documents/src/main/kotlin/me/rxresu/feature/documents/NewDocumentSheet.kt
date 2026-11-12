package me.rxresu.feature.documents

import androidx.annotation.DrawableRes
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.R as DS
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.designsystem.RrIconTile
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrRowCaret
import me.rxresu.core.designsystem.RrSheetDetents
import me.rxresu.core.designsystem.RrTheme

enum class NewStep { Main, CopyForJob, Letter }

class NewDocumentCallbacks(
    val onClose: () -> Unit = {},
    val onImport: () -> Unit = {},
    val onBlank: () -> Unit = {},
    val onSaveJob: () -> Unit = {},
    val onApplicationLetter: (String) -> Unit = {},
    val onSample: () -> Unit = {},
    val onCopyForJob: (resumeId: String, job: JobChoice, name: String) -> Unit = { _, _, _ -> },
    /** A new letter from a resume, from an earlier letter, or blank (both null). */
    val onLetter: (resumeId: String?, letterId: String?) -> Unit = { _, _ -> },
)

/**
 * D3 New: template, import, letter and save a job. Copy authoring remains available from application flows.
 * [initialApplicationId] preselects that job in "Copy a resume for a job" (open with [NewStep.CopyForJob]).
 */
@Composable
fun NewDocumentSheet(
    state: DocumentActionsUiState,
    callbacks: NewDocumentCallbacks,
    busy: Boolean = false,
    initialStep: NewStep = NewStep.Main,
    initialApplicationId: String? = null,
) {
    var step by rememberSaveable { mutableStateOf(initialStep) }
    var copyDraft by rememberSaveable { mutableStateOf(CopyForJobDraft()) }
    var confirmBack by remember { mutableStateOf(false) }
    val reduced = RrTheme.reducedMotion
    RrBottomSheet(
        onDismissRequest = callbacks.onClose,
        detents = RrSheetDetents.Full,
        confirmDiscard = copyDraft.dirty,
        title = if (step == NewStep.Main) stringResource(R.string.docs_new) else null,
        showClose = step == NewStep.Main,
        fixedHeight = if (step == NewStep.Main) 470.dp else null,
    ) {
        AnimatedContent(
            step,
            transitionSpec = {
                val forward = targetState.ordinal > initialState.ordinal
                val spec = tween<IntOffset>(if (reduced) 0 else RrMotion.D3, easing = RrMotion.ease)
                slideInHorizontally(spec) { if (forward) it else -it } togetherWith slideOutHorizontally(spec) { if (forward) -it else it }
            },
            label = "step",
        ) { current ->
            Column {
                when (current) {
                    NewStep.Main -> Main(state, callbacks) { step = it }
                    NewStep.CopyForJob -> {
                        StepHeader(stringResource(R.string.docs_copy_title)) { if (copyDraft.dirty) confirmBack = true else step = NewStep.Main }
                        CopyForJobForm(state.library, state.applications, null, busy, callbacks.onCopyForJob, initialApplicationId = initialApplicationId, draft = copyDraft, onDraft = { copyDraft = it })
                    }
                    NewStep.Letter -> {
                        StepHeader(stringResource(R.string.docs_letter_title)) { step = NewStep.Main }
                        LetterStart(state, callbacks)
                    }
                }
            }
        }
    }
    if (confirmBack) CopyDiscardDialog(
        onKeep = { confirmBack = false },
        onDiscard = { confirmBack = false; copyDraft = CopyForJobDraft(); step = NewStep.Main },
    )
}

@Composable
private fun Main(state: DocumentActionsUiState, callbacks: NewDocumentCallbacks, onStep: (NewStep) -> Unit) {
    val haptics = rememberRrHaptics()
    RrListGroup(Modifier.verticalScroll(rememberScrollState())) {
        RrListRow(stringResource(R.string.docs_resume), subtitle = stringResource(R.string.docs_template_start), leading = { RrIconTile(DS.drawable.ic_ph_file_text, accent = true) }, onClick = { haptics(RrHaptic.Light); callbacks.onBlank() }, divider = true, trailing = { RrRowCaret() })
        NewRow(DS.drawable.ic_ph_download_simple, stringResource(R.string.docs_import_title), stringResource(R.string.docs_import_short), callbacks.onImport)
        NewRow(DS.drawable.ic_ph_envelope_simple, stringResource(R.string.docs_letter_title), stringResource(R.string.docs_letter_short), onClick = {
            val applications = state.applications.filter { it.status != me.rxresu.core.network.generated.ApplicationStage.Closed && it.trashedAt == null }
            if (applications.size == 1) callbacks.onApplicationLetter(applications.single().id) else if (applications.isEmpty()) callbacks.onSaveJob() else onStep(NewStep.Letter)
        })
        NewRow(DS.drawable.ic_ph_briefcase, stringResource(R.string.docs_save_job_title), stringResource(R.string.docs_save_short), onClick = callbacks.onSaveJob, divider = false)
    }
}

@Composable
private fun NewRow(@DrawableRes icon: Int, title: String, subtitle: String, onClick: () -> Unit, divider: Boolean = true) {
    val haptics = rememberRrHaptics()
    RrListRow(title, subtitle = subtitle, tile = icon, onClick = { haptics(RrHaptic.Light); onClick() }, divider = divider, trailing = { RrRowCaret() })
}

/** Choose the application that owns the new letter. */
@Composable
private fun LetterStart(state: DocumentActionsUiState, callbacks: NewDocumentCallbacks) {
    val applications = state.applications.filter { it.status != me.rxresu.core.network.generated.ApplicationStage.Closed && it.trashedAt == null }
    RrListGroup {
        applications.forEachIndexed { index, app ->
            RrListRow(app.company, subtitle = app.role, tile = DS.drawable.ic_ph_briefcase, onClick = { callbacks.onApplicationLetter(app.id) }, divider = index < applications.lastIndex, trailing = { RrRowCaret() })
        }
    }
}
