@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
package me.rxresu.feature.career


import androidx.compose.ui.res.stringResource
import me.rxresu.core.strings.R as CoreStrings


import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as Icons
import me.rxresu.core.navigation.KnowledgeTab
import me.rxresu.core.network.generated.*
import kotlinx.coroutines.launch

@Composable internal fun CareerError(retry: () -> Unit) = RrCallout(stringResource(R.string.career_couldn_t_load_try_again_b45e5d), Modifier.padding(16.dp), tone = RrTone.Warn, actionLabel = stringResource(R.string.career_retry_9f5cd8), onAction = retry)
@Composable internal fun CareerLoading() = Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { repeat(3) { RrSkeletonText(Modifier.fillMaxWidth(), lines = 3) } }
@Composable internal fun SaveStatus(status: SaveState) {
    if (status == SaveState.Saving) RrSpinner() else RrIcon(if (status == SaveState.Saved) Icons.drawable.ic_ph_cloud_check else Icons.drawable.ic_ph_cloud_slash, null, size = 14.dp)
    RrText(when (status) { SaveState.Saved -> stringResource(R.string.career_saved_c0ae8f); SaveState.Saving -> stringResource(R.string.career_saving_56a228); SaveState.KeptOnDevice -> stringResource(R.string.career_saved_on_this_device_87222e); SaveState.Failed -> stringResource(R.string.career_couldn_t_save_try_again_292c60) })
}

@Composable internal fun CareerScreen(state: CareerState, refresh: () -> Unit, search: () -> Unit, settings: () -> Unit,
    coach: (String?) -> Unit, thread: (String) -> Unit, knowledge: (KnowledgeTab) -> Unit, offers: () -> Unit, schedules: () -> Unit,
    practice: () -> Unit, setupAi: () -> Unit, all: () -> Unit,
) {
    val header = rememberRrLargeTitleState()
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg)) {
        RrLargeTitleHeader(stringResource(R.string.career_career_348f0b), header, actions = {
            RrIconButton(Icons.drawable.ic_ph_magnifying_glass, stringResource(R.string.career_search_bce064), search)
            RrAvatar(state.initials, onClick = settings, contentDescription = stringResource(R.string.career_settings_c7f73b))
        })
        RrPullToRefresh(state.refreshing, refresh, Modifier.weight(1f)) {
            Column(Modifier.fillMaxSize().rrLargeTitleScroll(header).verticalScroll(rememberScrollState())) {
                if (state.loading) CareerLoading() else {
                    if (state.error) CareerError(refresh)
                    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        val openCoach = if (state.providers.isEmpty()) setupAi else { { coach(null) } }
                        RrCard(onClick = openCoach, contentPadding = PaddingValues(start = 12.dp, end = 8.dp, top = 10.dp, bottom = 10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                RrIcon(Icons.drawable.ic_ph_sparkle, null, tint = RrTheme.colors.accentText, size = 20.dp)
                                RrText(if (state.providers.isEmpty()) stringResource(R.string.career_connect_an_ai_provider_to_use_the_coach_cd023a) else stringResource(R.string.career_ask_about_your_next_career_step_ba2404), Modifier.weight(1f), style = RrType.body, color = RrTheme.colors.ink3)
                                RrIconButton(Icons.drawable.ic_ph_arrow_up, stringResource(R.string.career_coach_b32c9a), openCoach, size = RrIconButtonSize.Small, tint = RrTheme.colors.onAccent, containerColor = RrTheme.colors.accent)
                            }
                        }
                        Crossfade(state.offers.isNotEmpty(), animationSpec = tween(if (RrTheme.reducedMotion) 0 else RrMotion.D2), label = "starters") { hasOffer ->
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                val starter1 = if (state.facts.isEmpty()) stringResource(R.string.career_help_me_turn_an_accomplishment_into_a_situation_task_action__b4a1b4) else stringResource(R.string.career_which_opportunities_best_match_my_priorities_057ca4)
                                Starter(starter1) { coach(starter1) }
                                val starter2 = if (hasOffer) stringResource(R.string.career_help_me_weigh_the_offer_i_have_against_what_i_want_bcc192) else stringResource(R.string.career_help_me_prepare_for_an_interview_4b94ca)
                                Starter(starter2) { coach(starter2) }
                            }
                        }
                    }
                    RrSectionHeader(stringResource(R.string.career_recent_conversations_2eff3a), actionLabel = stringResource(R.string.career_all_6a7208), onAction = all)
                    if (state.threads.isEmpty()) RrEmptyState(stringResource(R.string.career_no_conversations_yet_f58811), stringResource(R.string.career_ask_about_your_next_career_step_ba2404), Modifier.padding(horizontal = 16.dp))
                    else RrListGroup(Modifier.padding(horizontal = 16.dp)) { state.threads.take(1).forEach { t -> RrListRow(t.title, subtitle = t.lastMessageAt.take(10), icon = Icons.drawable.ic_ph_chat_circle, onClick = { thread(t.id) }) } }
                    RrSectionHeader(stringResource(R.string.career_knowledge_dec1fc))
                    RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                        RrListRow(stringResource(R.string.career_facts_aeff1b), icon = Icons.drawable.ic_ph_book_open, onClick = { knowledge(KnowledgeTab.Facts) }, trailing = { RrRowValue(state.facts.size.toString()) })
                        RrListRow(stringResource(R.string.career_stories_67b5fe), icon = Icons.drawable.ic_ph_quotes, onClick = { knowledge(KnowledgeTab.Stories) }, trailing = { RrRowValue(state.stories.size.toString()) })
                        RrListRow(stringResource(R.string.career_job_search_preferences_d56450), icon = Icons.drawable.ic_ph_target, onClick = { knowledge(KnowledgeTab.Preferences) }, trailing = { RrRowCaret() })
                    }
                    RrSectionHeader(stringResource(R.string.career_decide_and_plan_167ea4))
                    RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                        RrListRow(stringResource(R.string.career_offers_43c943), subtitle = state.offers.firstOrNull()?.let { listOfNotNull(it.application?.company, (it.data as? Offer)?.respondBy).joinToString(" · ") }, icon = Icons.drawable.ic_ph_scales, onClick = offers, trailing = { RrRowCaret() })
                        RrListRow(stringResource(R.string.career_schedules_26d9d0), subtitle = if (!state.scheduling) stringResource(R.string.career_not_available_on_this_server_911d05) else state.schedules.joinToString(" · ") { it.query.ifBlank { it.kind } }, icon = Icons.drawable.ic_ph_timer, onClick = schedules, trailing = { RrRowCaret() })
                        RrListRow(stringResource(R.string.career_practice_without_an_application_bfa55d), icon = Icons.drawable.ic_ph_microphone, onClick = practice, trailing = { RrRowCaret() })
                    }
                    Spacer(Modifier.height(16.dp))
                }
            }
        }
    }
}
@Composable private fun Starter(text: String, onClick: () -> Unit) = RrCard(onClick = onClick, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp)) {
    Row(Modifier.heightIn(min = 24.dp), verticalAlignment = Alignment.CenterVertically) { RrText(text, Modifier.weight(1f), style = RrType.ui); RrIcon(Icons.drawable.ic_ph_arrow_up, null, size = 18.dp, tint = RrTheme.colors.ink3) }
}

@Composable internal fun CoachScreen(state: CoachState, onDraft: (String) -> Unit, memory: (Boolean) -> Unit, applications: (Boolean) -> Unit,
    back: () -> Unit, chooseProvider: () -> Unit, more: () -> Unit, retry: () -> Unit, knowledge: () -> Unit, setup: () -> Unit,
    send: () -> Unit, stop: () -> Unit, rememberFact: (CoachFact) -> Unit, dismissFact: (String) -> Unit, copyReply: (String) -> Unit, shareReply: (String) -> Unit = {}, contextUsed: (kotlinx.serialization.json.JsonObject) -> Unit = {},
) {
    val scroll = rememberScrollState()
    val dragging by scroll.interactionSource.collectIsDraggedAsState()
    var follow by remember { mutableStateOf(true) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(dragging, scroll.value) { if (dragging) follow = scroll.value >= scroll.maxValue }
    LaunchedEffect(state.messages.lastOrNull()?.text) { if (follow) scroll.scrollTo(scroll.maxValue) }
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).windowInsetsPadding(WindowInsets.navigationBars).imePadding()) {
        RrTopBar(stringResource(R.string.career_coach_b32c9a), onBack = back, actions = {
            RrContextChip(state.providers.firstOrNull { it.id == state.selected }?.let { it.label + " · " + it.model } ?: stringResource(R.string.career_choose_a_connection_428239), onClick = chooseProvider)
            RrIconButton(Icons.drawable.ic_ph_dots_three, stringResource(R.string.career_more_for_this_conversation_f3f947), more)
        })
        Column(Modifier.weight(1f).verticalScroll(scroll).padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.loading) CareerLoading() else {
                if (state.error) CareerError(retry)
                state.messages.forEachIndexed { index, m ->
                    if (m.mine) Row(Modifier.fillMaxWidth()) { Spacer(Modifier.weight(1f)); RrCard(Modifier.fillMaxWidth(.84f), contentPadding = PaddingValues(12.dp)) { RrText(m.text, style = RrType.body) } }
                    else {
                        var actions by remember(m.id) { mutableStateOf(false) }
                        RrText(m.text, Modifier.combinedClickable(onClick = {}, onLongClick = { actions = true }, onLongClickLabel = stringResource(R.string.career_reply_options_101219)), style = RrType.body)
                        RrMenu(actions, { actions = false }) {
                            RrMenuItem(stringResource(R.string.career_copy_af74f7), { copyReply(m.text); actions = false })
                            RrMenuItem(stringResource(R.string.career_share_09ca55), { shareReply(m.text); actions = false })
                        }
                        val used = state.messages.take(index).lastOrNull { it.mine }?.used
                        if (used != null) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            if ((used["facts"] as? kotlinx.serialization.json.JsonArray).orEmpty().isNotEmpty()) RrUsedChip(stringResource(R.string.career_facts_aeff1b), Icons.drawable.ic_ph_book_open, onClick = { contextUsed(used) })
                            if ((used["stories"] as? kotlinx.serialization.json.JsonArray).orEmpty().isNotEmpty()) RrUsedChip(stringResource(R.string.career_stories_67b5fe), Icons.drawable.ic_ph_quotes, onClick = { contextUsed(used) })
                            if (used["preferences"].toString() == "true") RrUsedChip(stringResource(R.string.career_preferences_9dfd34), Icons.drawable.ic_ph_target, onClick = { contextUsed(used) })
                            if (used["applications"].toString() == "true") RrUsedChip(stringResource(R.string.career_applications_76c74b), Icons.drawable.ic_ph_briefcase, onClick = { contextUsed(used) })
                        }
                    }
                }
                if (state.messages.any { message -> message.parts.any { part ->
                    part["state"].toString().trim('"') in setOf("approval-requested", "approval-responded") ||
                        part["type"].toString().trim('"') == "tool-ask_user_question" && part["state"].toString().trim('"') == "input-available"
                } }) RrCallout(stringResource(R.string.career_continue_browser), tone = RrTone.Info,
                    actionLabel = stringResource(R.string.career_open_in_browser_052269), onAction = more)
                state.pendingFacts.forEach { proposal ->
                    RrCard {
                        RrText(proposal.fact.text, style = RrType.small)
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            RrButton(if (proposal.savedId == null) stringResource(R.string.career_remember_281f30) else stringResource(R.string.career_view_fact_b34722), { if (proposal.savedId == null) rememberFact(proposal) else knowledge() }, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
                            RrButton(stringResource(R.string.career_not_now_e45714), { dismissFact(proposal.callId) }, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small)
                        }
                    }
                }
                if (state.providers.isEmpty() && !state.loading) RrEmptyState(stringResource(R.string.career_connect_an_ai_provider_to_use_the_coach_cd023a), stringResource(R.string.career_nothing_is_sent_until_you_choose_a_connection_for_this_conve_4fe026), actionLabel = stringResource(R.string.career_add_ai_provider_9ce5e6), onAction = setup)
            }
        }
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (state.memory && !state.knowledgeReady) RrText(if (state.loading) stringResource(R.string.career_loading_knowledge_before_you_send_266b01) else stringResource(R.string.career_knowledge_couldn_t_load_try_again_or_switch_knowledge_off_be_38aa66), style = RrType.small, color = RrTheme.colors.ink3)
            RrAiComposer(state.draft, onDraft, send, stringResource(R.string.career_ask_about_your_next_career_step_ba2404), enabled = !state.readOnly && state.selected != null && (!state.memory || state.knowledgeReady), sending = state.busy, onStop = stop, contextChips = {
                RrContextChip(if (state.memory) stringResource(R.string.career_knowledge_on_4bf78f) else stringResource(R.string.career_knowledge_off_3697f7), icon = Icons.drawable.ic_ph_book_open, leftOut = !state.memory, onClick = { memory(!state.memory) })
                RrContextChip(stringResource(R.string.career_applications_76c74b), icon = Icons.drawable.ic_ph_briefcase, leftOut = !state.applications, onClick = { applications(!state.applications) })
            })
            if (!follow) RrButton(stringResource(R.string.career_latest_decd7c), { follow = true; scope.launch { scroll.animateScrollTo(scroll.maxValue) } }, variant = RrButtonVariant.Secondary)
            if (state.busy) RrWorkingLabel(listOf(stringResource(R.string.career_working_13b7bf)))
            RrDisclosureLine(stringResource(R.string.career_when_you_press_send_your_message_and_conversation_history_go_e24f7e, state.server, state.providers.firstOrNull { it.id == state.selected }?.let { it.label + " · " + it.model } ?: stringResource(R.string.career_the_connection_you_choose_462a19), if (state.applications) stringResource(R.string.career_on_e0049a) else stringResource(R.string.career_off_e3de5a), if (state.memory) stringResource(R.string.career_on_e0049a) else stringResource(R.string.career_off_e3de5a)))
            if (!state.memory) RrDisclosureLine(if (!state.memory) stringResource(R.string.career_knowledge_is_off_for_this_message_the_coach_doesn_t_read_it__73f271) else stringResource(R.string.career_nothing_is_sent_until_you_choose_a_connection_for_this_conve_4fe026))
        }
    }
}

@Composable internal fun KnowledgeScreen(state: FactsState, tab: KnowledgeTab, onTab: (KnowledgeTab) -> Unit, query: String, onQuery: (String) -> Unit,
    category: SaveCareerFactRequestCategory?, onCategory: (SaveCareerFactRequestCategory?) -> Unit, forgotten: Boolean, showForgotten: (Boolean) -> Unit,
    newFact: String, onNewFact: (String) -> Unit, add: () -> Unit, fact: (CareerFact) -> Unit, forget: (CareerFact) -> Unit,
    story: (String?) -> Unit, pull: () -> Unit, memory: (SaveCareerProfileRequestMemoryMode) -> Unit, back: () -> Unit, retry: () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).windowInsetsPadding(WindowInsets.navigationBars).imePadding()) {
        RrTopBar(stringResource(R.string.career_knowledge_dec1fc), onBack = back, actions = { RrIconButton(Icons.drawable.ic_ph_file_arrow_up, stringResource(R.string.career_pull_facts_from_my_resume_6bd5a2), pull) })
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            RrSegmentedControl(listOf(RrSegment(stringResource(R.string.career_facts_aeff1b)), RrSegment(stringResource(R.string.career_stories_67b5fe)), RrSegment(stringResource(R.string.career_preferences_9dfd34))), tab.ordinal, { onTab(KnowledgeTab.entries[it]) })
            if (tab == KnowledgeTab.Facts) RrSearchField(query, onQuery, stringResource(R.string.career_search_facts_f4ad2d))
        }
        if (tab == KnowledgeTab.Facts) Row(Modifier.horizontalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RrFilterChip(stringResource(R.string.career_all_6a7208) + " " + state.facts.count { it.status != "forgotten" }, category == null, { onCategory(null) })
            SaveCareerFactRequestCategory.entries.filter { it != SaveCareerFactRequestCategory.Unknown }.forEach { type -> RrFilterChip(categoryLabel(type.wireValue), category == type, { onCategory(type) }) }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.loading) CareerLoading() else {
                if (state.error) CareerError(retry)
                if (tab == KnowledgeTab.Facts) {
                    val rows = state.facts.filter { it.status != "forgotten" && it.id !in state.pendingForget && (category == null || it.category == category.wireValue) && (query.isBlank() || it.text.contains(query, true)) }
                    if (rows.isEmpty()) RrEmptyState(if (state.facts.isEmpty()) stringResource(R.string.career_no_facts_yet_8f3622) else stringResource(R.string.career_no_facts_match_try_another_word_or_type_fac4bf), stringResource(R.string.career_add_a_fact_6c1785), Modifier.padding(horizontal = 16.dp), actionLabel = stringResource(R.string.career_pull_facts_from_my_resume_6bd5a2), onAction = pull)
                    else RrListGroup(Modifier.padding(horizontal = 16.dp)) { rows.forEach { row ->
                        RrSwipeRow(endAction = if (row.status == "forgotten") null else RrSwipeAction(stringResource(R.string.career_forget_03d5d8), Icons.drawable.ic_ph_trash, onCommit = { forget(row) })) { FactRow(row) { fact(row) } }
                    } }
                    RrSwitchRow(stringResource(R.string.career_show_forgotten_3a0025), forgotten, showForgotten, Modifier.padding(horizontal = 16.dp))
                    if (forgotten) RrCard(Modifier.padding(horizontal = 16.dp)) {
                        if (state.forgotten.isEmpty()) RrText(stringResource(R.string.career_no_forgotten_facts), style = RrType.small, color = RrTheme.colors.ink3)
                        state.forgotten.forEach { row -> RrText(stringResource(R.string.career_forgotten_count, row.count.toString(), row.at.take(10)), style = RrType.small, color = RrTheme.colors.ink3) }
                    }
                    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        RrText(stringResource(R.string.career_remember_facts_from_my_messages_323c02), style = RrType.fieldLabel, color = RrTheme.colors.ink2)
                        val modes = SaveCareerProfileRequestMemoryMode.entries.filter { it != SaveCareerProfileRequestMemoryMode.Unknown }
                        RrSegmentedControl(modes.map { RrSegment(memoryLabel(it.wireValue)) }, modes.indexOf(state.profile?.memoryMode).coerceAtLeast(0), { memory(modes[it]) })
                    }
                } else {
                    RrButton(stringResource(R.string.career_add_story_7d30ba), { story(null) }, Modifier.padding(horizontal = 16.dp), variant = RrButtonVariant.GhostAccent, icon = Icons.drawable.ic_ph_plus)
                    if (state.stories.isEmpty()) RrEmptyState(stringResource(R.string.career_no_stories_yet_d7ed09), stringResource(R.string.career_build_a_story_from_something_you_did_4ff3b8), Modifier.padding(horizontal = 16.dp))
                    else RrListGroup(Modifier.padding(horizontal = 16.dp)) { state.stories.forEach { row -> RrListRow(row.data.title, subtitle = row.data.result, onClick = { story(row.id) }, trailing = { RrRowCaret() }) } }
                }
                Spacer(Modifier.height(16.dp))
            }
        }
        if (tab == KnowledgeTab.Facts) Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) { RrTextField(newFact, onNewFact, placeholder = stringResource(R.string.career_add_a_fact_for_example_i_mentored_two_associate_pms_in_2025_6b23d4), trailing = {
            RrIconButton(Icons.drawable.ic_ph_plus, stringResource(R.string.career_add_a_fact_6c1785), add, size = RrIconButtonSize.Small, enabled = newFact.isNotBlank() && !state.busy, tint = RrTheme.colors.accentText)
        }) }
    }
}
@Composable private fun FactRow(fact: CareerFact, onClick: () -> Unit) = Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    RrText(fact.text, style = RrType.ui)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        RrBadge(categoryLabel(fact.category)); RrBadge(sourceLabel(fact.source.kind), tone = RrBadgeTone.Outline)
        if (fact.company != null) RrBadge(stringResource(R.string.career_1_s_only_d3e9b1, fact.company.orEmpty()), tone = RrBadgeTone.Info)
        if (fact.usedBy.savedItems > 0) RrBadge(stringResource(R.string.career_used_in_coaching_ab569c), tone = RrBadgeTone.Accent)
        if (fact.status == "forgotten") RrBadge(stringResource(R.string.career_forgotten_c35b3b), tone = RrBadgeTone.Warn)
    }
}
@Composable internal fun categoryLabel(type: String): String = when (type) { "accomplishment" -> stringResource(R.string.career_accomplishment_210035); "experience" -> stringResource(R.string.career_experience_5b5aaf); "skill" -> stringResource(R.string.career_skill_ec9f63); "preference" -> stringResource(R.string.career_preference_97d9b2); else -> type }
@Composable internal fun sourceLabel(source: ExportAccountDataResponseCareerFactsItemSourceKind): String = when (source) {
    ExportAccountDataResponseCareerFactsItemSourceKind.Manual -> stringResource(R.string.career_added_by_you_9ce55c)
    ExportAccountDataResponseCareerFactsItemSourceKind.UserMessage -> stringResource(R.string.career_from_your_message_137f03)
    ExportAccountDataResponseCareerFactsItemSourceKind.Resume, ExportAccountDataResponseCareerFactsItemSourceKind.ResumeVersion -> stringResource(R.string.career_from_your_resume_9f60ed)
    ExportAccountDataResponseCareerFactsItemSourceKind.Letter, ExportAccountDataResponseCareerFactsItemSourceKind.LetterVersion -> stringResource(R.string.career_from_your_cover_letter_be8787)
    ExportAccountDataResponseCareerFactsItemSourceKind.Debrief -> stringResource(R.string.career_from_a_debrief_b0303b); else -> stringResource(R.string.career_from_a_document_you_attached_7c074f)
}
@Composable internal fun memoryLabel(value: String) = when (value) { "auto" -> stringResource(R.string.career_automatically_1a9dfc); "off" -> stringResource(R.string.career_never_80c305); else -> stringResource(R.string.career_ask_first_1aeb84) }

@Composable internal fun StoryScreen(state: StoryState, change: (SaveCareerStoryRequest) -> Unit, back: () -> Unit, retry: () -> Unit, more: () -> Unit, practice: () -> Unit, facts: () -> Unit) {
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).windowInsetsPadding(WindowInsets.navigationBars).imePadding()) {
        RrTopBar(stringResource(R.string.career_story_86b4ba), onBack = back, status = { SaveStatus(state.status) }, actions = {
            if (state.error) RrButton(stringResource(R.string.career_retry_9f5cd8), retry, variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Small)
            RrIconButton(Icons.drawable.ic_ph_dots_three, stringResource(R.string.career_story_options_89089f), more)
        })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.loading) CareerLoading() else state.draft?.let { d ->
                RrTextField(d.title, { change(d.copy(title = it)) }, label = stringResource(R.string.career_title_768e0c))
                RrTextField(d.situation, { change(d.copy(situation = it)) }, label = stringResource(R.string.career_situation_30f6fe), placeholder = stringResource(R.string.career_what_was_happening_before_you_started_2c3ccf), singleLine = false, minLines = 2)
                RrTextField(d.task, { change(d.copy(task = it)) }, label = stringResource(R.string.career_task_7bb0dd), placeholder = stringResource(R.string.career_what_were_you_responsible_for_8cf568), singleLine = false, minLines = 2)
                RrTextField(d.action, { change(d.copy(action = it)) }, label = stringResource(R.string.career_action_97c89a), placeholder = stringResource(R.string.career_what_did_you_do_341410), singleLine = false, minLines = 2)
                RrTextField(d.result.orEmpty(), { change(d.copy(result = it)) }, label = stringResource(R.string.career_result_5faa59), placeholder = stringResource(R.string.career_what_changed_because_of_your_work_a4fcbd), singleLine = false, minLines = 2)
                RrTextField(d.reflection.orEmpty(), { change(d.copy(reflection = it)) }, label = stringResource(R.string.career_reflection_fda05a), placeholder = stringResource(R.string.career_what_would_you_do_differently_next_time_53a004), singleLine = false, minLines = 2)
                RrUsedChip(stringResource(R.string.career_1_s_facts_67a5cd, d.factIds.orEmpty().size.toString()), Icons.drawable.ic_ph_book_open, onClick = facts)
                if (state.status == SaveState.KeptOnDevice) RrCallout(stringResource(R.string.career_your_changes_are_kept_on_this_device_try_again_when_you_re_o_35ff35), tone = RrTone.Warn, actionLabel = stringResource(R.string.career_retry_9f5cd8), onAction = retry)
            } ?: RrEmptyState(stringResource(R.string.career_this_story_is_unavailable_or_uses_facts_that_are_switched_of_ab5011), "")
        }
        RrButton(stringResource(R.string.career_practice_this_story_8b37ea), practice, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), size = RrButtonSize.Large, icon = Icons.drawable.ic_ph_microphone, enabled = state.draft?.title?.isNotBlank() == true)
    }
}
