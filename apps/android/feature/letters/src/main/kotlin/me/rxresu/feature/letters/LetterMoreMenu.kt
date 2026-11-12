package me.rxresu.feature.letters

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.*
import me.rxresu.core.strings.R as S
import me.rxresu.core.designsystem.R as D

/** Letter menu reads only the letter draft; IDs never cross into the resume repository. */
@Composable internal fun LetterMoreMenu(state: LetterState, dismiss: () -> Unit, action: (String) -> Unit) {
    val letter = state.letter ?: return
    val haptics = rememberRrHaptics()
    RrBottomSheet(dismiss, title = letter.name, fixedHeight = 790.dp, closeIconSize = 24.dp) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            if (state.failed) RrCallout(stringResource(S.string.couldn_t_save_your_changes_try_again_before_continuing), Modifier.padding(24.dp), tone = RrTone.Danger)
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) { RrKeyValue(stringResource(S.string.created), letter.createdAt.take(10), Modifier.weight(1f)); RrKeyValue(stringResource(S.string.last_edited), letter.updatedAt.take(10), Modifier.weight(1f)) }
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) { RrKeyValue(stringResource(S.string.language), java.util.Locale.forLanguageTag(letter.style.metadata.page.locale).displayName, Modifier.weight(1f)); RrKeyValue(stringResource(S.string.length), pluralStringResource(R.plurals.letter_pages, state.pageCount ?: 1, state.pageCount ?: 1), Modifier.weight(1f)) }
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) { RrKeyValue(stringResource(S.string.resume), state.resumes.firstOrNull { it.id == letter.sourceResumeId }?.name.orEmpty(), Modifier.weight(1f)); RrKeyValue(stringResource(S.string.application), state.applications.firstOrNull { it.id == letter.sourceApplicationId }?.company.orEmpty(), Modifier.weight(1f)) }
            }
            RrListRow(stringResource(if (letter.isLocked) S.string.unlock_editing else S.string.lock_editing), leading = { RrIconTile(D.drawable.ic_ph_lock_simple_open, accent = letter.isLocked) }, onClick = { haptics(if (letter.isLocked) RrHaptic.ToggleOff else RrHaptic.ToggleOn); action("lock") }, enabled = !state.busy)
            RrListRow(stringResource(S.string.rename_267f020548), leading = { RrIconTile(D.drawable.ic_ph_pencil_simple) }, onClick = { action("rename") }, enabled = state.editable)
            RrListRow(stringResource(S.string.duplicate), leading = { RrIconTile(D.drawable.ic_ph_copy) }, onClick = { action("duplicate") }, enabled = !state.busy)
            RrListRow(stringResource(S.string.translate_into), leading = { RrIconTile(D.drawable.ic_ph_translate) }, onClick = { action("translate") }, enabled = state.editable)
            RrListRow(stringResource(S.string.copy_for_a_job), leading = { RrIconTile(D.drawable.ic_ph_briefcase) }, onClick = { action("copy-job") }, enabled = state.editable)
            RrListRow(stringResource(R.string.p4_versions), leading = { RrIconTile(D.drawable.ic_ph_clock_counter_clockwise) }, onClick = { action("versions") })
            RrListRow(stringResource(R.string.p4_export), leading = { RrIconTile(D.drawable.ic_ph_export) }, onClick = { action("export") })
            RrListRow(stringResource(S.string.move_to_trash), leading = { RrIconTile(D.drawable.ic_ph_trash, danger = true) }, onClick = { action("trash") }, danger = true, enabled = state.editable)
        }
    }
}
