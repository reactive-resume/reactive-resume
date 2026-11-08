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
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import me.rxresu.core.database.SaveStatus
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as DsR
import me.rxresu.core.strings.R as CoreR
import me.rxresu.core.navigation.LetterMode
import me.rxresu.core.network.generated.*

@Composable internal fun LetterScreen(state: LetterState, mode: LetterMode, details: Boolean, action: (String) -> Unit, match: (Boolean) -> Unit, paper: (CreateCoverLetterResponseStyleMetadataPageFormat) -> Unit, back: () -> Unit, onContent: (String) -> Unit = {}) {
    val c = RrTheme.colors; val letter = state.letter
    val keyboard = WindowInsets.ime.getBottom(androidx.compose.ui.platform.LocalDensity.current) > 0
    Column(Modifier.fillMaxSize().background(c.bg).imePadding()) {
        RrTopBar(onBack = back) {
            if (state.draft.canUndo) RrIconButton(DsR.drawable.ic_ph_arrow_counter_clockwise, stringResource(CoreR.string.reconsider_a_rejected_edit_undo), { action("undo") }, enabled = state.editable)
            if (mode == LetterMode.Write) RrIconButton(DsR.drawable.ic_ph_sparkle, stringResource(CoreR.string.assistant), { action("assistant") }, tint = c.accentText)
            RrIconButton(DsR.drawable.ic_ph_dots_three, stringResource(CoreR.string.more), { action("more") })
        }
        if (state.draft.locked) RrStrip(stringResource(R.string.p4_this_letter_is_locked_unlock_editing_to_make_changes), icon = DsR.drawable.ic_ph_lock_simple)
        if (state.draft.status == SaveStatus.Offline) RrOfflineStrip()
        if (state.failed || state.draft.error != null) RrCallout(stringResource(CoreR.string.couldn_t_save_your_wording_your_text_is_still_here_try_again), tone = RrTone.Danger, actionLabel = stringResource(CoreR.string.try_again), onAction = { action("retry") })
        if (state.draft.recoveredCopyId != null) RrCallout(stringResource(R.string.p4_your_changes_were_kept_in_1_s, state.draft.recoveredCopyName.orEmpty()), actionLabel = stringResource(CoreR.string.open), onAction = { action("recovery") })
        if (state.loading) RrSkeletonText(Modifier.weight(1f).padding(24.dp), lines = 8)
        else if (letter != null && mode == LetterMode.Write) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
                val status = when (state.draft.status) { SaveStatus.Saved -> stringResource(CoreR.string.saved); SaveStatus.Saving -> stringResource(CoreR.string.saving); SaveStatus.Offline -> stringResource(R.string.p4_offline); else -> stringResource(R.string.p4_couldn_t_save) }
                RrPageTitle(letter.name, subtitle = status + letter.recipientCompany?.let { stringResource(R.string.to_hiring_team, it) }.orEmpty(), subtitleColor = c.ink3)
                Column(Modifier.padding(start = 24.dp, end = 24.dp, top = 28.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    letter.greeting?.takeIf { it.isNotBlank() }?.let { RrText(it, Modifier.clickable(enabled = state.editable) { action("greeting") }, style = RrType.prose) }
                    LetterProse(letter, state.editable, action, onContent)
                }
                state.aiDraft?.let { ai -> Box(Modifier.padding(24.dp)) { LetterAiCard(ai, state, action) } }
                RrSectionHeader(stringResource(R.string.details))
                LetterDetails(state, action)
                FlowRow(Modifier.padding(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (state.aiDraft == null) RrButton(stringResource(CoreR.string.draft_from_the_posting), { action("draft") }, variant = RrButtonVariant.Secondary, enabled = state.editable)
                    RrButton(stringResource(R.string.p4_letter_content), { action("body") }, variant = RrButtonVariant.GhostAccent, enabled = state.editable)
                    RrButton(stringResource(R.string.preview), { action("preview") }, variant = RrButtonVariant.GhostAccent)
                }
            }
        } else if (letter != null) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
                RrPageTitle(stringResource(CoreR.string.design))
                RrPageBand(onClick = { action("preview") }) { RrPageThumbnail(state.designPage ?: state.page, Modifier.width(150.dp), letter = true, contentDescription = stringResource(CoreR.string.letter_page)) }
                LetterDesign(state, action, match, paper, Modifier.padding(top = 8.dp))
            }
        } else RrEmptyState(stringResource(CoreR.string.cover_letter_7264deefc0), stringResource(CoreR.string.couldn_t_load_try_again), Modifier.weight(1f).padding(24.dp), stringResource(CoreR.string.try_again), { action("retry") })
        if (!keyboard) RrModeBar(listOf(RrSegment(stringResource(CoreR.string.write), DsR.drawable.ic_ph_pencil_simple, DsR.drawable.ic_ph_pencil_simple_fill), RrSegment(stringResource(CoreR.string.design), DsR.drawable.ic_ph_palette, DsR.drawable.ic_ph_palette_fill), RrSegment(stringResource(R.string.p4_export), DsR.drawable.ic_ph_export)), if (mode == LetterMode.Write) 0 else 1, { action(when (it) { 0 -> "write"; 1 -> "design"; else -> "export" }) })
    }
}

/** Readable prose becomes the same rich document in place; unsupported markup keeps its original HTML. */
@Composable private fun LetterProse(letter: CoverLetter, editable: Boolean, action: (String) -> Unit, content: (String) -> Unit) {
    var editing by remember(letter.id) { mutableStateOf(false) }
    var rich by remember(letter.id) { mutableStateOf(RrRichDoc.parse(letter.content)) }
    var value by remember(letter.id) { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(rich.text)) }
    val supported = RrRichDoc.editable(letter.content)
    val focus = remember { androidx.compose.ui.focus.FocusRequester() }
    LaunchedEffect(editing) { if (editing && supported) focus.requestFocus() }
    LaunchedEffect(letter.content, editing) { if (!editing) { rich = RrRichDoc.parse(letter.content); value = androidx.compose.ui.text.input.TextFieldValue(rich.text) } }
    if (editing && supported) {
        RrRichTextField(value, rich, { next, doc ->
            value = next; rich = doc; content(doc.toHtml())
        }, Modifier.fillMaxWidth().focusRequester(focus), readOnly = !editable, textStyle = RrType.prose)
        if (!value.selection.collapsed) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                RrButton(stringResource(CoreR.string.improve), { action("assistant:Improve this selected passage and propose edits for review:\n\n" + value.text.substring(value.selection.min, value.selection.max)) }, variant = RrButtonVariant.GhostAccent)
                RrButton(stringResource(CoreR.string.shorter), { action("assistant:Shorten this selected passage and propose edits for review:\n\n" + value.text.substring(value.selection.min, value.selection.max)) }, variant = RrButtonVariant.Ghost)
            }
        }
        RrRichTextToolbar(rich, value.selection, { rich = it; content(it.toHtml()) }, enabled = editable)
        RrButton(stringResource(CoreR.string.done), { editing = false; action("blur") }, variant = RrButtonVariant.GhostAccent)
    } else {
        val transformed = RrRichTransformation(rich, 22.sp, RrTheme.colors.accentText).filter(androidx.compose.ui.text.AnnotatedString(rich.text)).text
        Column(Modifier.fillMaxWidth().clickable(enabled = editable && supported) { editing = true; action("focus") }, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            var start = 0
            transformed.text.split('\n').forEach { line ->
                RrText(transformed.subSequence(start, start + line.length), style = RrType.prose)
                start += line.length + 1
            }
        }
        if (!supported) RrCallout(stringResource(R.string.p4_rich_text_editing_is_not_available_on_this_device_yet_your_formatting_is_kept))
    }
}

@Composable private fun LetterDetails(state: LetterState, action: (String) -> Unit) {
    val letter = state.letter ?: return
    val app = state.applications.firstOrNull { it.id == letter.sourceApplicationId }
    RrListGroup {
        RrListRow(stringResource(CoreR.string.resume), subtitle = state.resumes.firstOrNull { it.id == letter.sourceResumeId }?.name ?: stringResource(CoreR.string.choose_a_resume), onClick = { action("resume") }, enabled = state.editable, divider = true, trailing = { RrRowCaret() })
        RrListRow(stringResource(CoreR.string.application), subtitle = app?.let { it.company + " · " + it.role } ?: stringResource(CoreR.string.choose_an_application), onClick = { action("application") }, enabled = state.editable, divider = true, trailing = { RrRowCaret() })
        RrListRow(stringResource(CoreR.string.recipient), subtitle = letter.recipient.ifBlank { stringResource(CoreR.string.who_is_it_for) }, onClick = { action("recipient") }, enabled = state.editable, trailing = { RrRowCaret() })
    }
}

@Composable private fun LetterDesign(state: LetterState, action: (String) -> Unit, match: (Boolean) -> Unit, paper: (CreateCoverLetterResponseStyleMetadataPageFormat) -> Unit, modifier: Modifier = Modifier) {
    val letter = state.letter ?: return; val metadata = letter.style.metadata
    Column(modifier.fillMaxWidth()) {
        if (letter.sourceResumeId != null) {
            val color = letterAccents.firstOrNull { letterHex(it.second) == letterHex(metadata.design.colors.primary) }?.first?.let { stringResource(it) }.orEmpty()
            val type = letterPairings.firstOrNull { it.heading == metadata.typography.heading.fontFamily && it.body == metadata.typography.body.fontFamily }?.label?.let { stringResource(it) }.orEmpty()
            RrSwitchRow(stringResource(R.string.match_resume), letter.designLinked, match, subtitle = listOf(metadata.template.wireValue.replaceFirstChar(Char::uppercase), color, type.takeIf { it.isNotEmpty() }?.let { stringResource(R.string.type_name, it) }).filterNotNull().filter { it.isNotEmpty() }.joinToString(" · "), enabled = state.editable, divider = true)
        } else RrListRow(stringResource(R.string.match_resume), subtitle = stringResource(CoreR.string.choose_a_resume), onClick = { action("resume") }, trailing = { RrRowCaret() })
        if (!letter.designLinked) {
            RrListRow(stringResource(CoreR.string.template), onClick = { action("template") }, trailing = { RrRowValue(metadata.template.wireValue.replaceFirstChar(Char::uppercase)) }, enabled = state.editable, divider = true)
            RrListRow(stringResource(CoreR.string.type), onClick = { action("type") }, trailing = { RrRowCaret() }, enabled = state.editable, divider = true)
            RrListRow(stringResource(CoreR.string.color), onClick = { action("color") }, trailing = { RrRowCaret() }, enabled = state.editable, divider = true)
        }
        RrListRow(stringResource(R.string.letterhead), subtitle = stringResource(R.string.letterhead_hint), onClick = { action("letterhead") }, trailing = { RrRowValue(if (letter.senderLinked) stringResource(CoreR.string.resume) else stringResource(R.string.independent)) }, enabled = state.editable, divider = true)
        RrListRow(stringResource(CoreR.string.page), subtitle = stringResource(R.string.page_summary, metadata.page.format.wireValue.uppercase()), onClick = { action("page") }, trailing = { RrRowCaret() }, enabled = state.editable, divider = true)
        RrListRow(stringResource(R.string.signature), subtitle = stringResource(R.string.typed_name), onClick = { action("signature") }, trailing = { RrRowCaret() }, enabled = state.editable)
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
