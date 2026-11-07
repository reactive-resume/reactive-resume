package me.rxresu.feature.assistant

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as DsR
import me.rxresu.core.strings.R as CoreR

@Composable internal fun AssistantScreen(state: AssistantState, dismiss: () -> Unit, input: (String) -> Unit, send: () -> Unit, stop: () -> Unit,
    context: (Boolean?, Boolean?) -> Unit, action: (String) -> Unit) {
    val c = RrTheme.colors; val haptics = rememberRrHaptics()
    LaunchedEffect(state.failed) { if (state.failed) haptics(RrHaptic.Error) }
    RrBottomSheet(dismiss, detents = listOf(0.935f), footer = {
        Column(Modifier.fillMaxWidth().background(c.bg).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            state.attachments.forEach { file -> RrContextChip(file.filename, onRemove = { action("remove:" + file.id) }) }
            RrAiComposer(state.input, input, { haptics(RrHaptic.Light); send() }, stringResource(R.string.p4_ask_about_this_resume), enabled = state.provider != null && !state.locked, sending = state.streaming, onStop = { haptics(RrHaptic.Light); stop() }, contextChips = {
                RrContextChip(if (state.letterId == null) stringResource(R.string.p4_this_resume) else stringResource(R.string.p4_this_letter), icon = DsR.drawable.ic_ph_file_text, leftOut = !state.documentContext,
                    onRemove = if (state.documentContext) ({ context(false, null) }) else null, onClick = if (!state.documentContext) ({ context(true, null) }) else null)
                RrContextChip(stringResource(CoreR.string.posting), icon = DsR.drawable.ic_ph_briefcase, leftOut = !state.postingContext,
                    onRemove = if (state.postingContext) ({ context(null, false) }) else null, onClick = if (!state.postingContext) ({ context(null, true) }) else null)
            }, tools = { RrIconButton(DsR.drawable.ic_ph_paperclip, stringResource(CoreR.string.attach_a_file), { action("attach") }, size = RrIconButtonSize.Small, enabled = !state.locked && state.provider != null && state.attachments.size < 10) })
            RrDisclosureLine(stringResource(R.string.p4_when_you_press_send_selected_context_attachments_and_earlier_messages_go_to_1_s_with_, state.provider?.label ?: stringResource(R.string.p4_your_connection)))
        }
    }) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 6.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            RrIcon(DsR.drawable.ic_ph_sparkle, null, size = 20.dp, tint = c.accentText); RrText(stringResource(CoreR.string.assistant), style = RrType.label, modifier = Modifier.weight(1f))
            RrButton(state.provider?.let { it.label + " · " + it.model } ?: stringResource(CoreR.string.choose_a_connection), { action("providers") }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
            RrIconButton(DsR.drawable.ic_ph_clock_counter_clockwise, stringResource(CoreR.string.past_conversations), { action("history") }, size = RrIconButtonSize.Small)
            RrIconButton(DsR.drawable.ic_ph_x, stringResource(CoreR.string.close_the_assistant), dismiss, size = RrIconButtonSize.Small)
        }
        Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (state.loading) RrSkeletonText(lines = 6)
            if (state.locked) RrCallout(stringResource(CoreR.string.this_resume_is_locked_unlock_it_to_make_changes))
            if (state.provider == null && !state.loading) RrCallout(stringResource(R.string.p4_choose_a_connection_before_sending_anything), actionLabel = stringResource(R.string.p4_add_connection), onAction = { action("setup") })
            if (state.content.reply.isEmpty() && !state.streaming) {
                RrText(stringResource(CoreR.string.what_should_we_work_on), style = RrType.sheetTitle)
                RrText(state.documentName, style = RrType.small, color = c.ink3)
                RrListGroup {
                    listOf(stringResource(CoreR.string.tighten_to_one_page), stringResource(R.string.p4_tailor_to_the_posting), stringResource(CoreR.string.find_weak_bullets), stringResource(CoreR.string.draft_a_summary), stringResource(CoreR.string.translate_into)).forEach { starter -> RrListRow(starter, subtitle = stringResource(R.string.p4_proposes_edits_for_you_to_review), icon = DsR.drawable.ic_ph_sparkle, onClick = { input(starter) }, enabled = !state.locked) }
                }
            }
            if (state.content.trace.isNotEmpty()) RrTraceSteps(state.content.trace.map { RrTraceStep(it, true) })
            if (state.streaming) RrWorkingLabel(listOf(stringResource(R.string.p4_reading_your_request), stringResource(R.string.p4_reviewing_your_words), stringResource(CoreR.string.still_working)))
            if (state.content.reply.isNotEmpty()) RrText(state.content.reply, style = RrType.body)
            state.content.question?.let { question ->
                // TODO(lead): move assistant question card to designsystem.
                Column(Modifier.fillMaxWidth().clip(RrShape.lg).background(c.infoSoft).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    RrText(question.text, style = RrType.label)
                    question.answers.forEach { answer -> RrButton(answer, { input(answer) }, Modifier.fillMaxWidth(), variant = RrButtonVariant.Secondary, size = RrButtonSize.Large) }
                    RrButton(stringResource(CoreR.string.or_in_your_own_words), { input("") }, variant = RrButtonVariant.Secondary)
                }
            }
            if (state.proposals.isNotEmpty()) RrButton(stringResource(R.string.p4_review_1_s_edits, state.proposals.size.toString()), { action("proposals") }, variant = RrButtonVariant.Secondary)
            if (state.historyUnavailable) RrCallout(stringResource(R.string.p4_saved_conversation_content_is_unavailable_your_document_is_unchanged))
            if (state.failed) RrCallout(stringResource(R.string.p4_couldn_t_send_your_message_is_kept), tone = RrTone.Danger, actionLabel = stringResource(CoreR.string.retry), onAction = send)
            if (state.failed) RrButton(stringResource(CoreR.string.switch_model), { action("providers") }, variant = RrButtonVariant.Secondary)
            if (state.stopped) RrCallout(if (state.proposals.isEmpty()) stringResource(CoreR.string.stopped_no_edits_were_proposed) else stringResource(R.string.p4_stopped), actionLabel = stringResource(CoreR.string.message_continue), onAction = { action("continue") })
        }
    }
}

@Composable internal fun ProposalsScreen(state: AssistantState, dismiss: () -> Unit, decide: (List<String>, Decision, String?) -> Unit, suggest: () -> Unit) {
    val c = RrTheme.colors
    var editing by remember { mutableStateOf<String?>(null) }; var wording by remember { mutableStateOf("") }
    val haptics = rememberRrHaptics()
    val open = state.proposals.filter { it.decision == Decision.Pending }
    var previousOpen by remember { mutableIntStateOf(open.size) }
    LaunchedEffect(open.size, state.deciding, state.failed) { if (!state.deciding) { if (!state.failed && previousOpen > 0 && open.isEmpty() && state.proposals.all { it.decision in setOf(Decision.Accepted, Decision.Rejected) } && state.proposals.any { it.decision == Decision.Accepted }) haptics(RrHaptic.Success); previousOpen = open.size } }
    RrBottomSheet(dismiss, detents = listOf(0.935f), footer = {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RrButton(stringResource(CoreR.string.reject_all), { decide(open.map { it.id }, Decision.Rejected, null) }, Modifier.weight(1f), variant = RrButtonVariant.Secondary, size = RrButtonSize.Large, enabled = !state.deciding && !state.locked)
            RrButton(stringResource(CoreR.string.accept_the_others), { decide(bulkEligible(state.proposals).map { it.id }, Decision.Accepted, null) }, Modifier.weight(1f), variant = RrButtonVariant.Secondary, size = RrButtonSize.Large, enabled = !state.deciding && !state.locked)
        }
    }) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            RrIconButton(DsR.drawable.ic_ph_caret_left, stringResource(CoreR.string.back), dismiss, mirrorInRtl = true)
            RrText(stringResource(R.string.p4_proposed_edits), style = RrType.label, modifier = Modifier.weight(1f))
        }
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            RrText(stringResource(R.string.p4_1_s_of_2_s_open, open.size.toString(), state.proposals.size.toString()), style = RrType.mono, color = c.ink3)
            if (state.proposals.isEmpty()) RrEmptyState(stringResource(R.string.p4_proposed_edits), stringResource(R.string.p4_no_edits_were_proposed))
            state.proposals.forEachIndexed { index, proposal ->
                key(proposal.id) {
                    Crossfade(proposal.decision, animationSpec = tween(if (RrTheme.reducedMotion) 0 else RrMotion.D2), label = "proposal") { decision ->
                        when (decision) {
                            Decision.Accepted, Decision.Rejected -> RrDecidedProposal(index + 1, proposal.location + " · " + if (decision == Decision.Accepted) stringResource(CoreR.string.accepted) else stringResource(CoreR.string.rejected), { decide(listOf(proposal.id), Decision.Pending, null) })
                            Decision.Stale -> RrCallout(stringResource(CoreR.string.out_of_date_the_text_has_changed_since), tone = RrTone.Warn, actionLabel = stringResource(R.string.p4_suggest_again), onAction = suggest)
                            Decision.Pending -> if (editing == proposal.id) {
                                RrCard {
                                    RrTextField(wording, { wording = it }, label = stringResource(CoreR.string.your_wording), singleLine = false, minLines = 4)
                                    RrButton(stringResource(CoreR.string.save_wording), { decide(listOf(proposal.id), Decision.Pending, wording) }, enabled = wording.isNotBlank() && !state.deciding && !state.locked)
                                    RrButton(stringResource(CoreR.string.cancel), { editing = null }, variant = RrButtonVariant.Secondary)
                                    if (state.failed) RrCallout(stringResource(CoreR.string.couldn_t_save_your_wording_your_text_is_still_here_try_again), tone = RrTone.Danger)
                                }
                            } else RrSwipeRow(startAction = RrSwipeAction(stringResource(CoreR.string.reject), DsR.drawable.ic_ph_x, onCommit = { if (!state.deciding && !state.locked) decide(listOf(proposal.id), Decision.Rejected, null) }), endAction = RrSwipeAction(stringResource(CoreR.string.accept), DsR.drawable.ic_ph_check, onCommit = { if (!state.deciding && !state.locked) decide(listOf(proposal.id), Decision.Accepted, null) })) { RrProposalCard(index + 1, proposal.location, editRuns(plain(proposal.before), plain(proposal.after)),
                                { if (!state.deciding && !state.locked) decide(listOf(proposal.id), Decision.Accepted, null) }, { if (!state.deciding && !state.locked) decide(listOf(proposal.id), Decision.Rejected, null) },
                                onEdit = { editing = proposal.id; wording = plain(proposal.after) }, acceptPrimary = !proposal.newDetail && index == state.proposals.indexOfFirst { it.decision == Decision.Pending },
                                badge = if (proposal.newDetail || proposal.unsupported.isNotEmpty()) ({ RrBadge(stringResource(CoreR.string.new_detail_check_it_s_true), tone = RrBadgeTone.Warn) }) else null) {
                                if (proposal.why.isNotBlank()) RrText(proposal.why, style = RrType.caption, color = c.ink2)
                                proposal.evidence.forEach { RrUsedChip(it, DsR.drawable.ic_ph_book_open) }
                                if (proposal.unsupported.isNotEmpty()) RrCallout(stringResource(R.string.p4_nothing_checked_backs_these_confirm_each_before_accepting_1_s, proposal.unsupported.joinToString()), tone = RrTone.Warn)
                                if (proposal.snapshot) RrCallout(stringResource(R.string.p4_this_edit_needs_structural_review_in_the_web_app), tone = RrTone.Warn)
                            } }
                        }
                    }
                }
            }
            if (state.failed && editing == null) RrCallout(stringResource(CoreR.string.couldn_t_save_your_wording_your_text_is_still_here_try_again), tone = RrTone.Danger)
        }
    }
}
internal fun plain(value: String) = android.text.Html.fromHtml(value, android.text.Html.FROM_HTML_MODE_LEGACY).toString().trim()

internal fun editRuns(before: String, after: String): List<RrEditRun> {
    val prefix = before.commonPrefixWith(after).length
    val suffix = before.drop(prefix).commonSuffixWith(after.drop(prefix)).length
    return listOf(RrEditRun.Same(before.take(prefix)), RrEditRun.Removed(before.substring(prefix, before.length - suffix)), RrEditRun.Added(after.substring(prefix, after.length - suffix)), RrEditRun.Same(before.takeLast(suffix)))
}
