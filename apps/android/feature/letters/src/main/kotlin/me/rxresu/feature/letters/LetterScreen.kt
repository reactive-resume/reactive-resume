package me.rxresu.feature.letters

import androidx.compose.foundation.layout.height
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.foundation.Canvas
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.foundation.border
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import me.rxresu.core.database.SaveStatus
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as DsR
import me.rxresu.core.strings.R as CoreR
import me.rxresu.core.navigation.LetterMode
import me.rxresu.core.network.generated.*

@Composable internal fun LetterScreen(state: LetterState, mode: LetterMode, details: Boolean, action: (String) -> Unit, match: (Boolean) -> Unit, paper: (CreateCoverLetterResponseStyleMetadataPageFormat) -> Unit, back: () -> Unit) {
    val c = RrTheme.colors; val letter = state.letter
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize().background(c.bg)) {
        RrTopBar(letter?.name ?: stringResource(CoreR.string.cover_letter_7264deefc0), onBack = back, status = {
            if (state.draft.status == SaveStatus.Saving) RrSpinner() else RrIcon(DsR.drawable.ic_ph_cloud_check, null, size = 14.dp)
            RrText(when (state.draft.status) { SaveStatus.Saved -> stringResource(CoreR.string.saved); SaveStatus.Saving -> stringResource(CoreR.string.saving); SaveStatus.Offline -> stringResource(R.string.p4_offline); else -> stringResource(R.string.p4_couldn_t_save) })
        }) {
            RrIconButton(DsR.drawable.ic_ph_arrow_counter_clockwise, stringResource(CoreR.string.reconsider_a_rejected_edit_undo), { action("undo") }, enabled = state.draft.canUndo && state.editable)
            RrIconButton(DsR.drawable.ic_ph_sparkle, stringResource(CoreR.string.assistant), { action("assistant") }, tint = c.accentText)
            RrIconButton(DsR.drawable.ic_ph_dots_three, stringResource(CoreR.string.more), { action("more") })
        }
        if (state.draft.locked) RrStrip(stringResource(R.string.p4_this_letter_is_locked_unlock_editing_to_make_changes), icon = DsR.drawable.ic_ph_lock_simple)
        if (state.draft.status == SaveStatus.Offline) RrOfflineStrip()
        if (state.failed || state.draft.error != null) RrCallout(stringResource(CoreR.string.couldn_t_save_your_wording_your_text_is_still_here_try_again), tone = RrTone.Danger, actionLabel = stringResource(CoreR.string.try_again), onAction = { action("retry") })
        if (state.draft.recoveredCopyId != null) RrCallout(stringResource(R.string.p4_your_changes_were_kept_in_1_s, state.draft.recoveredCopyName.orEmpty()), actionLabel = stringResource(CoreR.string.open), onAction = { action("recovery") })
        if (state.loading) RrSkeletonText(Modifier.weight(1f).padding(16.dp), lines = 8)
        else if (letter != null && mode == LetterMode.Write) Box(Modifier.weight(1f).fillMaxWidth().background(c.sunken)) {
            Column(Modifier.fillMaxSize()) {
                // The pages, as in the builder: every page, pinch or double tap to zoom; tap a block to edit it.
                var selected by remember { mutableStateOf<LetterBlock?>(null) }
                RrPageCanvas(state.pages, { page, x, y ->
                    if (state.editable) {
                        val block = state.blocks.filter { it.page == page && it.contains(x, y) }.minByOrNull { (it.right - it.left) * (it.bottom - it.top) }
                        selected = block
                        action(block?.field ?: "body")
                    }
                }, Modifier.weight(1f), pageCount = state.pageCount ?: 1) { page ->
                    selected?.takeIf { it.page == page }?.let { block -> Canvas(Modifier.matchParentSize()) { drawRect(c.accent, Offset(block.left * size.width, block.top * size.height), Size((block.right - block.left) * size.width, (block.bottom - block.top) * size.height), style = Stroke(2.dp.toPx())) } }
                }
                // A toolbar under the page viewport (line, surface), so the page reads as scrolling behind it rather than
                // cut off, with the actions off the canvas.
                Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
                Column(Modifier.weight(1f, fill = false).background(c.surface).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.aiDraft?.let { ai -> LetterAiCard(ai, state, action) }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (state.aiDraft == null) RrButton(stringResource(CoreR.string.draft_from_the_posting), { action("draft") }, variant = RrButtonVariant.Secondary, enabled = state.editable)
                        RrButton(stringResource(R.string.p4_letter_details), { action("details") }, variant = RrButtonVariant.Secondary)
                        RrButton(stringResource(R.string.p4_letter_content), { action("body") }, variant = RrButtonVariant.Secondary, enabled = state.editable)
                    }
                    if (state.pageFailed) RrCallout(stringResource(R.string.p4_couldn_t_update_the_preview_your_words_are_kept), actionLabel = stringResource(CoreR.string.try_again), onAction = { action("retry") })
                }
            }
            if (details) RrBottomSheet({ action("hide-details") }, modifier = Modifier.consumeWindowInsets(WindowInsets.navigationBars), detents = listOf(0.6f, 0.92f), title = stringResource(R.string.p4_letter_details), showClose = false, headerActions = { RrButton(stringResource(CoreR.string.done), { action("hide-details") }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small) }) { LetterDetails(state, action) }
        } else if (letter != null) Box(Modifier.weight(1f).fillMaxWidth().background(c.sunken)) {
            Column(Modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.Top) {
                    if (letter.sourceResumeId != null) RrPageThumbnail(state.resumePage, Modifier.width(120.dp), contentDescription = stringResource(CoreR.string.linked_resume))
                    RrPageThumbnail(state.page, Modifier.width(120.dp), letter = true, contentDescription = stringResource(CoreR.string.letter_page))
                }
                if (state.resumePageFailed) RrText(stringResource(R.string.p4_resume_preview_failed), Modifier.padding(12.dp), style = RrType.caption)
            }
            RrBottomSheet({}, detents = listOf(0.6f, 0.92f), docked = true, containerColor = c.surface, navigationBarInset = false) {
                LetterDesign(state, action, match, paper, Modifier.weight(1f))
            }
        } else RrEmptyState(stringResource(CoreR.string.cover_letter_7264deefc0), stringResource(CoreR.string.couldn_t_load_try_again), Modifier.weight(1f).padding(16.dp), stringResource(CoreR.string.try_again), { action("retry") })
        RrModeBar(listOf(RrSegment(stringResource(CoreR.string.write), DsR.drawable.ic_ph_pencil_simple, DsR.drawable.ic_ph_pencil_simple_fill), RrSegment(stringResource(CoreR.string.design), DsR.drawable.ic_ph_palette, DsR.drawable.ic_ph_palette_fill), RrSegment(stringResource(R.string.p4_export), DsR.drawable.ic_ph_export)), if (mode == LetterMode.Write) 0 else 1, { action(when (it) { 0 -> "write"; 1 -> "design"; else -> "export" }) })
    }
    }
}

@Composable private fun LetterDetails(state: LetterState, action: (String) -> Unit) {
    val letter = state.letter ?: return
    Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        RrListGroup {
            RrListRow(state.resumes.firstOrNull { it.id == letter.sourceResumeId }?.name ?: stringResource(CoreR.string.choose_a_resume), subtitle = stringResource(CoreR.string.resume), icon = DsR.drawable.ic_ph_file_text, onClick = { action("resume") }, enabled = state.editable, trailing = { RrRowCaret() })
            val app = state.applications.firstOrNull { it.id == letter.sourceApplicationId }
            RrListRow(app?.let { it.company + " · " + it.role } ?: stringResource(CoreR.string.choose_an_application), subtitle = stringResource(CoreR.string.application), icon = DsR.drawable.ic_ph_briefcase, onClick = { action("application") }, enabled = state.editable, trailing = { RrRowCaret() })
            RrListRow(letter.recipient.ifEmpty { stringResource(CoreR.string.who_is_it_for) }, subtitle = stringResource(CoreR.string.recipient), icon = DsR.drawable.ic_ph_buildings, onClick = { action("recipient") }, enabled = state.editable, trailing = { RrRowCaret() })
        }
        val redraft = stringResource(CoreR.string.redraft_from_the_posting)
        val opening = stringResource(CoreR.string.make_the_opening_stronger)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            RrContextChip(redraft, icon = DsR.drawable.ic_ph_sparkle, onClick = { action("assistant:" + redraft) })
            RrContextChip(opening, onClick = { action("assistant:" + opening) })
            val shorter = stringResource(CoreR.string.shorter)
            val personal = stringResource(CoreR.string.more_personal)
            RrContextChip(shorter, onClick = { action("assistant:" + shorter) })
            RrContextChip(personal, onClick = { action("assistant:" + personal) })
        }
        RrButton(stringResource(R.string.p4_letter_content), { action("body") }, variant = RrButtonVariant.Secondary, enabled = state.editable)
    }
}

@Composable private fun LetterDesign(state: LetterState, action: (String) -> Unit, match: (Boolean) -> Unit, paper: (CreateCoverLetterResponseStyleMetadataPageFormat) -> Unit, modifier: Modifier = Modifier) {
    val letter = state.letter ?: return; val metadata = letter.style.metadata
    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (letter.sourceResumeId != null) RrSwitchRow(stringResource(CoreR.string.matching_the_resume), letter.designLinked, match, subtitle = if (letter.designLinked) stringResource(CoreR.string.template_type_and_colors_follow_the_resume_so_the_pair_always_matches) else stringResource(CoreR.string.the_letter_keeps_a_design_of_its_own), enabled = state.editable, containerColor = RrTheme.colors.surface)
        else RrText(stringResource(CoreR.string.choose_a_resume_in_write_to_match_its_design_until_then_the_letter_has_its_own), style = RrType.small)
        RrListGroup(Modifier.alpha(if (letter.designLinked) 0.55f else 1f)) {
            RrListRow(stringResource(CoreR.string.template), enabled = !letter.designLinked && state.editable, onClick = { action("template") }, trailing = { RrRowValue(metadata.template.wireValue.replaceFirstChar(Char::uppercase), caret = !letter.designLinked) })
            RrListRow(stringResource(CoreR.string.type), enabled = !letter.designLinked && state.editable, onClick = { action("type") }, trailing = { RrRowValue(metadata.typography.body.fontFamily + " · " + metadata.typography.body.fontSize, caret = !letter.designLinked) })
            RrListRow(stringResource(CoreR.string.color), enabled = !letter.designLinked && state.editable, onClick = { action("color") }, trailing = { RrRowValue(stringResource(R.string.p4_custom_color), caret = !letter.designLinked) })
        }
        if (letter.designLinked) RrButton(stringResource(CoreR.string.change_the_resume_s_design), { action("resume-design") }, variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Small)
        if (!letter.designLinked) RrListRow(stringResource(CoreR.string.page), onClick = { action("page") }, trailing = { RrRowCaret() }, enabled = state.editable)
        RrText(stringResource(CoreR.string.page), style = RrType.eyebrow, color = RrTheme.colors.ink3)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            RrText(stringResource(CoreR.string.paper)); RrSegmentedControl(listOf(RrSegment("A4"), RrSegment(stringResource(CoreR.string.letter))), if (metadata.page.format == CreateCoverLetterResponseStyleMetadataPageFormat.A4) 0 else 1, { paper(if (it == 0) CreateCoverLetterResponseStyleMetadataPageFormat.A4 else CreateCoverLetterResponseStyleMetadataPageFormat.Letter) }, enabled = state.editable && !letter.designLinked)
        }
        RrListRow(stringResource(CoreR.string.language), onClick = { action("language") }, enabled = state.editable, trailing = { RrRowValue(java.util.Locale.forLanguageTag(metadata.page.locale).displayName) })
    }
}

@Composable private fun LetterAiCard(ai: LetterAiDraft, state: LetterState, action: (String) -> Unit) {
    RrCard {
        if (ai.generating) RrWorkingLabel(listOf(stringResource(R.string.p4_writing_draft)))
        if (ai.text.isNotEmpty()) RrText(ai.text, style = RrType.body)
        if (ai.failed) RrCallout(stringResource(if (ai.destinationChanged) DsR.string.ds_ai_destination_changed else R.string.p4_draft_failed), tone = RrTone.Danger, actionLabel = stringResource(CoreR.string.try_again), onAction = { action("retry-draft") })
        // Try again goes to the renewed connection, named here first.
        if (ai.failed && ai.destinationChanged) state.provider?.let { RrDisclosureLine(stringResource(CoreR.string.sends_this_letter_s_resume_to_0_1_to_draft_the_body_your_provider_may_charge, it.label, it.model)) }
        if (ai.generating) RrButton(stringResource(CoreR.string.stop), { action("stop-draft") }, variant = RrButtonVariant.Secondary)
        else {
            val stale = ai.revision != state.letter?.revision || ai.baseContent != state.letter?.content
            if (stale) RrCallout(stringResource(R.string.p4_draft_changed), tone = RrTone.Warn)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                RrButton(stringResource(CoreR.string.keep), { action("keep-draft") }, enabled = !stale && ai.text.isNotBlank() && state.editable)
                RrButton(stringResource(CoreR.string.shorter), { action("shorter") }, variant = RrButtonVariant.Secondary, enabled = state.editable && ai.text.isNotBlank())
                RrButton(stringResource(CoreR.string.more_personal), { action("personal") }, variant = RrButtonVariant.Secondary, enabled = state.editable && ai.text.isNotBlank())
                RrButton(stringResource(CoreR.string.discard), { action("discard-draft") }, variant = RrButtonVariant.Secondary)
                if (stale) RrButton(stringResource(R.string.p4_separate_copy), { action("copy-draft") }, variant = RrButtonVariant.Secondary, enabled = state.editable && ai.text.isNotBlank())
            }
            ai.versions.forEachIndexed { index, version -> RrListRow(stringResource(R.string.p4_draft_version, index + 1), subtitle = version.text.take(80), onClick = { action("draft-version:" + index) }) }
        }
    }
}
