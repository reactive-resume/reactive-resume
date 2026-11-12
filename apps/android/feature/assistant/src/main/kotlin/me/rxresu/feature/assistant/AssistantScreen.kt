package me.rxresu.feature.assistant

import androidx.compose.ui.res.pluralStringResource
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
    val scroll = rememberScrollState()
    var following by remember { mutableStateOf(true) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(scroll.isScrollInProgress) { if (scroll.isScrollInProgress) following = false else if (scroll.value >= scroll.maxValue - 32) following = true }
    LaunchedEffect(scroll.maxValue, state.streaming) { if (following && state.streaming) scroll.scrollTo(scroll.maxValue) }
    val c = RrTheme.colors; val haptics = rememberRrHaptics()
    LaunchedEffect(state.failed) { if (state.failed) haptics(RrHaptic.Error) }
    val composer: @Composable () -> Unit = {
        Column(Modifier.fillMaxWidth().background(c.bg).padding(horizontal = 24.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            state.attachments.forEach { file -> RrContextChip(file.filename, onRemove = { action("remove:" + file.id) }) }
            RrAiComposer(state.input, input, { haptics(RrHaptic.Light); send() }, stringResource(R.string.p4_ask_about_this_resume), enabled = state.provider != null && !state.locked, sending = state.streaming, onStop = { haptics(RrHaptic.Light); stop() }, dimEmptySend = false, contextChips = {
                RrContextChip(if (state.letterId == null) stringResource(R.string.p4_this_resume) else stringResource(R.string.p4_this_letter), icon = DsR.drawable.ic_ph_file_text, leftOut = !state.documentContext,
                    onRemove = if (state.documentContext) ({ context(false, null) }) else null, onClick = if (!state.documentContext) ({ context(true, null) }) else null)
                RrContextChip(state.postingLabel ?: stringResource(CoreR.string.posting), icon = DsR.drawable.ic_ph_briefcase, leftOut = !state.postingContext,
                    onRemove = if (state.postingContext) ({ context(null, false) }) else null, onClick = if (!state.postingContext) ({ context(null, true) }) else null)
            }, tools = { if (state.input.isNotEmpty() || WindowInsets.ime.getBottom(androidx.compose.ui.platform.LocalDensity.current) > 0) RrIconButton(DsR.drawable.ic_ph_paperclip, stringResource(CoreR.string.attach_a_file), { action("attach") }, size = RrIconButtonSize.Small, enabled = !state.locked && state.provider != null && state.attachments.size < 10) })
        }
    }
    Column(Modifier.fillMaxSize().background(c.bg).imePadding().rrNavigationBarsPadding()) {
        RrTopBar(onClose = dismiss, center = { RrConnectionChip(state.provider?.let { it.label + " · " + it.model } ?: stringResource(CoreR.string.choose_a_connection), { action("providers") }) }) {
            RrIconButton(DsR.drawable.ic_ph_clock_counter_clockwise, stringResource(CoreR.string.past_conversations), { action("history") })
        }
        Column(Modifier.weight(1f).verticalScroll(scroll).padding(horizontal = 24.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (state.loading) RrSkeletonText(lines = 6)
            if (state.locked) RrCallout(stringResource(CoreR.string.this_resume_is_locked_unlock_it_to_make_changes))
            if (state.provider == null && !state.loading) RrCallout(stringResource(R.string.p4_choose_a_connection_before_sending_anything), actionLabel = stringResource(R.string.p4_add_connection), onAction = { action("setup") })
            if (state.content.messages.isEmpty() && state.content.reply.isEmpty() && !state.streaming) {
                RrText(stringResource(CoreR.string.what_should_we_work_on), style = RrType.sheetTitle)
                RrText(state.documentName, style = RrType.small, color = c.ink3)
                RrListGroup {
                    listOf(stringResource(CoreR.string.tighten_to_one_page), stringResource(R.string.p4_tailor_to_the_posting), stringResource(CoreR.string.find_weak_bullets), stringResource(CoreR.string.draft_a_summary), stringResource(CoreR.string.translate_into)).forEach { starter -> RrListRow(starter, subtitle = stringResource(R.string.p4_proposes_edits_for_you_to_review), icon = DsR.drawable.ic_ph_sparkle, onClick = { input(starter) }, enabled = !state.locked) }
                }
            }
            if (state.content.messages.isEmpty() && state.content.trace.isNotEmpty()) RrText(state.content.trace.joinToString(" · "), style = RrType.ui, color = c.ink3)
            if (state.streaming) RrWorkingLabel(listOf(stringResource(R.string.p4_reading_your_request), stringResource(R.string.p4_reviewing_your_words), stringResource(CoreR.string.still_working)))
            state.content.messages.forEach { message ->
                val text = message.parts.filter { it.type == "text" }.joinToString("") { it.extraFields.text("text").orEmpty() }
                val user = message.role == me.rxresu.core.network.generated.AiTailorResumeForApplicationResponseConversationMessagesItemRole.User
                if (text.isNotEmpty()) {
                    if (user) RrUserBubble(text)
                    else {
                        if (message.id == state.content.messages.lastOrNull()?.id && state.content.trace.isNotEmpty()) RrText(state.content.trace.joinToString(" · "), style = RrType.ui, color = c.ink3)
                        RrText(text, style = RrType.body)
                    }
                }
                message.parts.filter { it.type == "source-url" }.forEach { source -> source.extraFields.text("url")?.let { url -> RrButton(source.extraFields.text("title") ?: url, { action("source:" + url) }, variant = RrButtonVariant.GhostAccent) } }
                if (message.id == state.content.messages.lastOrNull()?.id) message.parts.filter { it.extraFields.text("state") == "approval-requested" }.forEach { tool ->
                    RrCallout(tool.type.removePrefix("tool-").replace('_', ' '))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        RrButton(stringResource(R.string.p4_allow), { action("approve:" + tool.extraFields.text("toolCallId")) }, enabled = !state.streaming && !state.locked)
                        RrButton(stringResource(CoreR.string.reject), { action("deny:" + tool.extraFields.text("toolCallId")) }, variant = RrButtonVariant.Secondary, enabled = !state.streaming && !state.locked)
                    }
                }
            }
            if (state.content.messages.isEmpty() && state.content.reply.isNotEmpty()) RrText(state.content.reply, style = RrType.body)
            state.content.question?.let { question ->
                var ownAnswer by remember(question.toolCallId) { mutableStateOf("") }
                val ownWordsLabel = stringResource(CoreR.string.or_in_your_own_words)
                RrQuestionCard(question.text, question.answers,
                    onAnswer = { answer -> action("answer:" + question.toolCallId + ":" + answer) },
                    enabled = !state.streaming && !state.locked,
                    ownWordsInput = {
                        RrTextField(ownAnswer, { ownAnswer = it }, placeholder = ownWordsLabel,
                            enabled = !state.streaming && !state.locked,
                            trailing = {
                                RrIcon(DsR.drawable.ic_ph_arrow_up, stringResource(CoreR.string.send), size = 20.dp, tint = c.ink3,
                                    modifier = Modifier.clickable(enabled = ownAnswer.isNotBlank() && !state.streaming && !state.locked,
                                        role = androidx.compose.ui.semantics.Role.Button) { action("answer:" + question.toolCallId + ":" + ownAnswer) })
                            })
                    })
            }
            if (state.proposals.isNotEmpty()) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.postingLabel?.let { RrUsedChip(it, DsR.drawable.ic_ph_briefcase) }
                    if (state.facts.isNotEmpty()) RrUsedChip(stringResource(R.string.facts_count, state.facts.size), DsR.drawable.ic_ph_book_open)
                }
                RrButton(pluralStringResource(R.plurals.p4_review_edits, state.proposals.size, state.proposals.size), { action("proposals") }, variant = RrButtonVariant.Secondary)
            }
            if (state.historyUnavailable) RrCallout(stringResource(R.string.p4_saved_conversation_content_is_unavailable_your_document_is_unchanged))
            // A changed connection says so; the disclosure line below already names the renewed destination.
            if (state.failed) RrCallout(stringResource(if (state.destinationChanged) DsR.string.ds_ai_destination_changed else R.string.p4_couldn_t_send_your_message_is_kept), tone = RrTone.Danger, actionLabel = stringResource(CoreR.string.retry), onAction = send)
            if (state.failed) RrButton(stringResource(CoreR.string.switch_model), { action("providers") }, variant = RrButtonVariant.Secondary)
            if (state.stopped) RrCallout(if (state.proposals.isEmpty()) stringResource(CoreR.string.stopped_no_edits_were_proposed) else stringResource(R.string.p4_stopped), actionLabel = stringResource(CoreR.string.message_continue), onAction = { action("continue") })
        }
        if (!following) RrButton(stringResource(R.string.p4_latest), { following = true; scope.launch { scroll.scrollTo(scroll.maxValue) } }, variant = RrButtonVariant.Secondary)
        composer()
    }
}

/**
 * B17. The wording being written lives in [AssistantState.wording] (the view model), so leaving for the edit's location,
 * closing after a failed save, or a refreshed proposal never loses it; closing with unsaved wording asks first.
 */
@Composable internal fun ProposalsScreen(state: AssistantState, dismiss: () -> Unit, decide: (List<String>, Decision, String?) -> Unit, suggest: () -> Unit, location: (Proposal) -> Unit = {}, saveWording: (Proposal, String) -> Unit = { proposal, text -> decide(listOf(proposal.id), Decision.Pending, text) },
    editWording: (Proposal) -> Unit = {}, onWording: (String) -> Unit = {}, cancelWording: () -> Unit = {}) {
    val c = RrTheme.colors
    val draft = state.wording; val editing = draft?.proposal?.id; val wording = draft?.text.orEmpty(); val baseline = draft?.proposal
    val dirty = draft?.dirty == true
    var askDiscard by remember { mutableStateOf(false) }
    val close = { if (dirty) askDiscard = true else dismiss() }
    val haptics = rememberRrHaptics()
    val open = state.proposals.filter { it.decision == Decision.Pending }
    var previousOpen by remember { mutableIntStateOf(open.size) }
    LaunchedEffect(open.size, state.deciding, state.failed) { if (!state.deciding) { if (!state.failed && previousOpen > 0 && open.isEmpty() && state.proposals.all { it.decision in setOf(Decision.Accepted, Decision.Rejected) } && state.proposals.any { it.decision == Decision.Accepted }) haptics(RrHaptic.Success); previousOpen = open.size } }
    if (askDiscard) RrAlertDialog(stringResource(DsR.string.ds_discard_changes_title), stringResource(DsR.string.ds_discard_changes_body), stringResource(DsR.string.ds_discard),
        onConfirm = { askDiscard = false; cancelWording(); dismiss() }, onDismissRequest = { askDiscard = false }, dismissLabel = stringResource(DsR.string.ds_keep_editing), confirm = RrDialogConfirm.Danger)
    androidx.activity.compose.BackHandler(onBack = close)
    // As on the web: bulk actions only when there's more than one edit to act on; "the others" only when some must
    // be confirmed one by one.
    val checked = bulkEligible(state.proposals)
    val bulk = open.size > 1 || checked.size > 1
    var focused by remember { mutableStateOf<String?>(null) }
    val focusId = focused?.takeIf { id -> open.any { it.id == id } } ?: open.firstOrNull()?.id
    Column(Modifier.fillMaxSize().background(c.bg)) {
        RrTopBar(onBack = close) {
            RrText(stringResource(R.string.p4_1_s_of_2_s_open, open.size.toString(), state.proposals.size.toString()), modifier = Modifier.padding(end = 12.dp), style = RrType.ui, color = c.ink3)
        }
        RrPageTitle(stringResource(R.string.p4_proposed_edits), subtitle = state.content.requirements.takeIf { it.isNotEmpty() }?.let { stringResource(R.string.posting_asks, it.distinct().joinToString(" · ") { it.first }) }, subtitleColor = c.ink3)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp)) {
            if (state.proposals.isEmpty()) RrEmptyState(stringResource(R.string.p4_proposed_edits), stringResource(R.string.p4_no_edits_were_proposed))
            state.proposals.forEachIndexed { index, proposal ->
                key(proposal.id) {
                    Crossfade(proposal.decision, modifier = Modifier.padding(top = if (index == 0) 0.dp else if (proposal.decision in setOf(Decision.Accepted, Decision.Rejected)) 8.dp else 16.dp), animationSpec = tween(if (RrTheme.reducedMotion) 0 else RrMotion.D2), label = "proposal") { decision ->
                        when (decision) {
                            Decision.Accepted, Decision.Rejected -> RrDecidedProposal(index + 1, proposal.location + " · " + if (decision == Decision.Accepted) stringResource(CoreR.string.accepted) else stringResource(CoreR.string.rejected), { decide(listOf(proposal.id), Decision.Pending, null) })
                            Decision.Stale -> RrCallout(stringResource(CoreR.string.out_of_date_the_text_has_changed_since), tone = RrTone.Warn, actionLabel = stringResource(R.string.p4_suggest_again), onAction = suggest)
                            Decision.Pending -> if (editing == proposal.id) {
                                RrCard {
                                    RrTextField(wording, onWording, label = stringResource(CoreR.string.your_wording), singleLine = false, minLines = 4)
                                    RrButton(stringResource(CoreR.string.save_wording), { baseline?.let { saveWording(it, wording) } }, enabled = wording.isNotBlank() && !state.deciding && !state.locked && baseline?.after == proposal.after)
                                    if (baseline?.after != proposal.after) RrCallout(stringResource(R.string.p4_wording_changed), tone = RrTone.Warn)
                                    RrButton(stringResource(CoreR.string.cancel), cancelWording, variant = RrButtonVariant.Secondary)
                                    if (state.failed) RrCallout(stringResource(CoreR.string.couldn_t_save_your_wording_your_text_is_still_here_try_again), tone = RrTone.Danger)
                                }
                            } else RrSwipeRow(startAction = RrSwipeAction(stringResource(CoreR.string.reject), DsR.drawable.ic_ph_x, onCommit = { if (!state.deciding && !state.locked) decide(listOf(proposal.id), Decision.Rejected, null) }), endAction = RrSwipeAction(stringResource(CoreR.string.accept), DsR.drawable.ic_ph_check, onCommit = { if (!state.deciding && !state.locked) decide(listOf(proposal.id), Decision.Accepted, null) })) { RrProposalCard(index + 1, proposal.location, editRuns(plain(proposal.before), plain(proposal.after)),
                                { if (!state.deciding && !state.locked) decide(listOf(proposal.id), Decision.Accepted, null) }, { if (!state.deciding && !state.locked) decide(listOf(proposal.id), Decision.Rejected, null) },
                                modifier = Modifier.clickable { if (proposal.id == focusId) location(proposal) else focused = proposal.id }, focused = proposal.id == focusId, showActions = proposal.id == focusId,
                                onEdit = { editWording(proposal) }, acceptPrimary = proposal.id == focusId,
                                badge = if (proposal.newDetail || proposal.unsupported.isNotEmpty()) ({ RrBadge(stringResource(CoreR.string.new_detail_check_it_s_true), tone = RrBadgeTone.Warn) }) else null) {
                                if (proposal.id == focusId) {
                                    if (proposal.why.isNotBlank()) RrText(proposal.why, style = RrType.ui, color = c.ink3)
                                    proposal.evidence.forEach { RrUsedChip(it, DsR.drawable.ic_ph_book_open) }
                                    proposal.factIds.forEach { id -> RrUsedChip(state.facts[id] ?: stringResource(R.string.p4_fact_unavailable), DsR.drawable.ic_ph_book_open) }
                                    if (proposal.snapshot) RrText(stringResource(R.string.p4_structure_review), style = RrType.caption)
                                }
                                if (proposal.unsupported.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    RrIcon(DsR.drawable.ic_ph_warning, null, size = 16.dp, slotHeight = 36.dp, alignment = Alignment.TopCenter, tint = c.warnText)
                                    RrText(if (proposal.unsupported.size == 1) stringResource(R.string.p4_nothing_checked_backs_this_confirm_1_s, proposal.unsupported.single()) else stringResource(R.string.p4_nothing_checked_backs_these_confirm_each_before_accepting_1_s, proposal.unsupported.joinToString()), style = RrType.small, color = c.warnText)
                                }
                            } }
                        }
                    }
                }
            }
            if (state.proposals.isNotEmpty()) Box(Modifier.padding(top = 4.dp)) {
                RrText(state.pageFit?.let { fit -> stringResource(CoreR.string.page_fit_0_1_printed_pages, fit.before.toString(), fit.after.toString()) }
                    ?: stringResource(CoreR.string.couldn_t_measure_page_fit_check_the_page_preview_before_accepting), style = RrType.ui, color = c.ink3)
            }
            if (state.failed && editing == null) Box(Modifier.padding(top = 16.dp)) { RrCallout(stringResource(CoreR.string.couldn_t_save_your_wording_your_text_is_still_here_try_again), tone = RrTone.Danger) }
        }
        if (bulk) {
        RrFooterBar {
            if (open.size > 1) RrButton(stringResource(CoreR.string.reject_all), { decide(open.map { it.id }, Decision.Rejected, null) }, Modifier.weight(1f), variant = RrButtonVariant.Secondary, size = RrButtonSize.Large, enabled = !state.deciding && !state.locked)
            if (checked.size > 1) RrButton(stringResource(if (checked.size < open.size) CoreR.string.accept_the_others else CoreR.string.accept_all), { decide(checked.map { it.id }, Decision.Accepted, null) }, Modifier.weight(1f), variant = RrButtonVariant.Secondary, size = RrButtonSize.Large, enabled = !state.deciding && !state.locked)
        }
        }
    }
}
internal fun plain(value: String) = android.text.Html.fromHtml(value, android.text.Html.FROM_HTML_MODE_LEGACY).toString().trim()

internal fun editRuns(before: String, after: String): List<RrEditRun> {
    val old = Regex("\\S+").findAll(before).toList()
    val next = Regex("\\S+").findAll(after).toList()
    val prefix = old.zip(next).takeWhile { (a, b) -> a.value == b.value }.size
    val suffix = old.drop(prefix).asReversed().zip(next.drop(prefix).asReversed()).takeWhile { (a, b) -> a.value == b.value }.size
    val oldStart = old.getOrNull(prefix)?.range?.first ?: before.length
    val nextStart = next.getOrNull(prefix)?.range?.first ?: after.length
    val oldEnd = old.getOrNull(old.size - suffix)?.range?.first ?: before.length
    val nextEnd = next.getOrNull(next.size - suffix)?.range?.first ?: after.length
    val removed = before.substring(oldStart, oldEnd)
    return listOf(RrEditRun.Same(if (removed.isEmpty()) after.take(nextStart) else before.take(oldStart)), RrEditRun.Removed(removed), RrEditRun.Added(after.substring(nextStart, nextEnd)), RrEditRun.Same(after.substring(nextEnd)))
}
