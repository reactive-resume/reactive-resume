package me.rxresu.feature.documents

import androidx.annotation.DrawableRes
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.R as DS
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrRowCaret
import me.rxresu.core.designsystem.RrSectionHeader
import me.rxresu.core.designsystem.RrSheetDetents
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.network.generated.DocumentType

enum class NewStep { Main, CopyForJob, Letter }

class NewDocumentCallbacks(
    val onClose: () -> Unit = {},
    val onImport: () -> Unit = {},
    val onBlank: () -> Unit = {},
    val onSaveJob: () -> Unit = {},
    val onSample: () -> Unit = {},
    val onCopyForJob: (resumeId: String, job: JobChoice, name: String) -> Unit = { _, _, _ -> },
    /** A new letter from a resume, from an earlier letter, or blank (both null). */
    val onLetter: (resumeId: String?, letterId: String?) -> Unit = { _, _ -> },
)

/**
 * D3 New: import, start blank, copy for a job, new cover letter, save a job; steps push inside the sheet.
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
    val reduced = RrTheme.reducedMotion
    RrBottomSheet(
        onDismissRequest = callbacks.onClose,
        detents = RrSheetDetents.Full,
        title = if (step == NewStep.Main) stringResource(R.string.docs_new) else null,
        showClose = step == NewStep.Main,
        footer = if (step == NewStep.Main) {
            {
                Box(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars).padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                    RrButton(stringResource(R.string.docs_try_sample), callbacks.onSample, variant = RrButtonVariant.GhostAccent)
                }
            }
        } else null,
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
                    NewStep.Main -> Main(callbacks) { step = it }
                    NewStep.CopyForJob -> {
                        StepHeader(stringResource(R.string.docs_copy_title)) { step = NewStep.Main }
                        CopyForJobForm(state.library, state.applications, null, busy, callbacks.onCopyForJob, initialApplicationId = initialApplicationId)
                    }
                    NewStep.Letter -> {
                        StepHeader(stringResource(R.string.docs_letter_title)) { step = NewStep.Main }
                        LetterStart(state, callbacks)
                    }
                }
            }
        }
    }
}

@Composable
private fun Main(callbacks: NewDocumentCallbacks, onStep: (NewStep) -> Unit) {
    val c = RrTheme.colors
    Column(Modifier.fillMaxWidth()) {
        RrText(stringResource(R.string.docs_new_intro), Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp), style = RrType.small, color = c.ink2)
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            NewRow(DS.drawable.ic_ph_file_arrow_up, stringResource(R.string.docs_import_title), stringResource(R.string.docs_import_subtitle), callbacks.onImport)
            NewRow(DS.drawable.ic_ph_file_plus, stringResource(R.string.docs_blank_title), stringResource(R.string.docs_blank_subtitle), callbacks.onBlank)
            NewRow(DS.drawable.ic_ph_copy, stringResource(R.string.docs_copy_title), stringResource(R.string.docs_copy_subtitle)) { onStep(NewStep.CopyForJob) }
            NewRow(DS.drawable.ic_ph_note_pencil, stringResource(R.string.docs_letter_title), stringResource(R.string.docs_letter_subtitle)) { onStep(NewStep.Letter) }
            NewRow(DS.drawable.ic_ph_briefcase, stringResource(R.string.docs_save_job_title), stringResource(R.string.docs_save_job_subtitle), callbacks.onSaveJob)
        }
    }
}

/** A New sheet row (board `.nw`): the icon on a 40 dp tile, a label and a two-line description. */
@Composable
private fun NewRow(@DrawableRes icon: Int, title: String, subtitle: String, onClick: () -> Unit) {
    RrListRow(title, subtitle = subtitle, tile = icon, onClick = onClick)
}

/** New cover letter: from a resume, from an earlier letter, or blank. */
@Composable
private fun LetterStart(state: DocumentActionsUiState, callbacks: NewDocumentCallbacks) {
    val live = state.library.filter { it.trashedAt == null }
    Column(Modifier.padding(bottom = 16.dp)) {
        val resumes = live.filter { it.type == DocumentType.Resume }
        if (resumes.isNotEmpty()) {
            RrSectionHeader(stringResource(R.string.docs_letter_resume), topPadding = 0.dp)
            RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                resumes.forEach { doc -> RrListRow(doc.name, icon = DS.drawable.ic_ph_file_text, onClick = { callbacks.onLetter(doc.id, null) }, trailing = { RrRowCaret() }) }
            }
        }
        val letters = live.filter { it.type == DocumentType.Letter }
        if (letters.isNotEmpty()) {
            RrSectionHeader(stringResource(R.string.docs_letter_earlier))
            RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                letters.forEach { doc ->
                    RrListRow(doc.name, subtitle = doc.application?.company, icon = DS.drawable.ic_ph_note_pencil, onClick = { callbacks.onLetter(null, doc.id) }, trailing = { RrRowCaret() })
                }
            }
        }
        RrListGroup(Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp)) {
            RrListRow(stringResource(R.string.docs_blank_letter), icon = DS.drawable.ic_ph_file_plus, onClick = { callbacks.onLetter(null, null) }, trailing = { RrRowCaret() })
        }
    }
}
