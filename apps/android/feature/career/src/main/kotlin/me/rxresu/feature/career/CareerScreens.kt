@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
package me.rxresu.feature.career


import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import me.rxresu.core.strings.R as CoreStrings


import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
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
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
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
    coach: (String?) -> Unit, thread: (String) -> Unit, knowledge: (KnowledgeTab) -> Unit, offers: () -> Unit, schedules: (String?) -> Unit,
    practice: () -> Unit, setupAi: () -> Unit, all: () -> Unit,
) {
    val header = rememberRrLargeTitleState()
    val time = rememberCareerTime()
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg)) {
        RrLargeTitleHeader(stringResource(R.string.career_career_348f0b), header, actions = {
            RrAvatar(state.initials, onClick = settings, contentDescription = stringResource(R.string.career_settings_c7f73b))
        })
        RrPullToRefresh(state.refreshing, refresh, Modifier.weight(1f)) {
            Column(Modifier.fillMaxSize().rrLargeTitleScroll(header).verticalScroll(rememberScrollState())) {
                RrText(stringResource(R.string.career_intro), Modifier.padding(horizontal = 24.dp), style = RrType.ui, color = RrTheme.colors.ink3)
                if (state.loading) CareerLoading() else {
                    if (state.error) CareerError(refresh)
                    RrHeroCard {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            RrIcon(Icons.drawable.ic_ph_sparkle, null, size = 18.dp, tint = RrTheme.colors.accentText)
                            RrText(stringResource(R.string.career_coach_b32c9a), style = RrType.keyLine, color = RrTheme.colors.ink3)
                        }
                        RrText(stringResource(if (state.providers.isEmpty()) R.string.career_connect_an_ai_provider_to_use_the_coach_cd023a else R.string.career_hero_title), style = RrType.heading)
                        RrText(stringResource(R.string.career_hero_body), style = RrType.body, color = RrTheme.colors.ink2)
                        RrButton(stringResource(if (state.providers.isEmpty()) R.string.career_connect else R.string.career_start_conversation), { if (state.providers.isEmpty()) setupAi() else coach(null) }, Modifier.fillMaxWidth().padding(top = 8.dp), size = RrButtonSize.Large)
                    }
                    RrSectionHeading(stringResource(R.string.career_what_it_knows))
                    RrListGroup {
                        RrListRow(stringResource(R.string.career_facts_aeff1b), subtitle = pluralStringResource(R.plurals.career_facts_count, state.facts.size, state.facts.size), onClick = { knowledge(KnowledgeTab.Facts) }, divider = true, trailing = { RrRowCaret() })
                        RrListRow(stringResource(R.string.career_stories_67b5fe), subtitle = pluralStringResource(R.plurals.career_stories_count, state.stories.size, state.stories.size), onClick = { knowledge(KnowledgeTab.Stories) }, divider = true, trailing = { RrRowCaret() })
                        RrListRow(stringResource(R.string.career_job_search), subtitle = state.profile?.let { (it.targetRoles + it.locations).joinToString(" · ") }, onClick = { knowledge(KnowledgeTab.Preferences) }, trailing = { RrRowCaret() })
                    }
                    RrSectionHeading(stringResource(R.string.career_decide))
                    RrListGroup { RrListRow(stringResource(R.string.career_compare_offers), subtitle = offerSummary(state.offers, time), onClick = offers, trailing = { RrRowCaret() }) }
                    RrSectionHeading(stringResource(R.string.career_routines))
                    RrListGroup { RrListRow(stringResource(R.string.career_discovery), subtitle = if (!state.scheduling) stringResource(R.string.career_not_available_on_this_server_911d05) else scheduleSummary(state.schedules, time), onClick = { schedules(state.schedules.firstOrNull { it.kind == "discovery" }?.id) }, trailing = { RrRowCaret() }) }
                    RrListGroup {
                        val primary = state.schedules.firstOrNull { it.kind == "discovery" }?.id
                        state.schedules.filter { it.id != primary }.forEach { row ->
                            RrListRow(scheduleTitle(row.kind), subtitle = listOf(row.query, scheduleStatus(row, time)).filter(String::isNotBlank).joinToString(" · "), onClick = { schedules(row.id) }, trailing = { RrRowCaret() })
                        }
                    }
                    RrSectionHeading(stringResource(R.string.career_more))
                    RrListGroup {
                        RrListRow(stringResource(R.string.career_new_schedule_3e70c3), onClick = { schedules(null) }, trailing = { RrRowCaret() })
                        RrListRow(stringResource(R.string.career_conversations_07c59b), onClick = all, trailing = { RrRowCaret() })
                        RrListRow(stringResource(R.string.career_practice_without_an_application_bfa55d), onClick = practice, trailing = { RrRowCaret() })
                        RrListRow(stringResource(R.string.career_search_bce064), onClick = search, trailing = { RrRowCaret() })
                    }
                }
            }
        }
    }
}

@Composable private fun offerSummary(offers: List<SavedItem>, time: CareerTime): String {
    val count = pluralStringResource(R.plurals.career_offers_count, offers.size, offers.size)
    val next = offers.filter { time.date((it.data as? Offer)?.respondBy) != null }.minByOrNull { time.date((it.data as Offer).respondBy)!! }
    return next?.let { stringResource(R.string.career_offer_summary, count, it.application?.company ?: it.title, time.weekday((it.data as Offer).respondBy).orEmpty()) } ?: count
}

@Composable internal fun CoachScreen(state: CoachState, onDraft: (String) -> Unit, memory: (Boolean) -> Unit, applications: (Boolean) -> Unit,
    back: () -> Unit, chooseProvider: () -> Unit, more: () -> Unit, retry: () -> Unit, knowledge: () -> Unit, setup: () -> Unit,
    send: () -> Unit, stop: () -> Unit, rememberFact: (CoachFact) -> Unit, dismissFact: (String) -> Unit, copyReply: (String) -> Unit, shareReply: (String) -> Unit = {}, contextUsed: (kotlinx.serialization.json.JsonObject) -> Unit = {},
    answer: (CoachQuestion, String) -> Unit = { _, _ -> }, openSource: (String) -> Unit = {},
) {
    val c = RrTheme.colors
    val scroll = rememberScrollState()
    val dragging by scroll.interactionSource.collectIsDraggedAsState()
    var follow by remember { mutableStateOf(true) }
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val reduced = RrTheme.reducedMotion
    // MessageScroller rules: a sent question settles near the top, the reply streams in below it, and the view follows
    // the stream only while it is at the bottom. Leaving the bottom shows "Latest".
    val tops = remember { mutableStateMapOf<String, Int>() }
    var end by remember { mutableIntStateOf(0) }
    var viewport by remember { mutableIntStateOf(0) }
    var settled by remember { mutableStateOf<String?>(null) }
    val lastQuestion = state.messages.lastOrNull { it.mine }?.id
    LaunchedEffect(lastQuestion, state.busy) { if (state.busy && lastQuestion != null && lastQuestion != settled) { settled = lastQuestion; follow = true } }
    LaunchedEffect(settled) {
        val id = settled ?: return@LaunchedEffect
        val target = snapshotFlow { tops[id] }.filterNotNull().first()
        snapshotFlow { scroll.maxValue }.first { it >= target }
        if (reduced) scroll.scrollTo(target) else scroll.animateScrollTo(target, tween(RrMotion.D2, easing = RrMotion.ease))
    }
    LaunchedEffect(dragging) { if (dragging) snapshotFlow { scroll.value >= scroll.maxValue }.collect { follow = it } }
    LaunchedEffect(state.messages.lastOrNull()?.text) { if (follow) scroll.scrollTo(scroll.maxValue) }
    val gutters = with(density) { 28.dp.roundToPx() }
    val room = settled?.let { tops[it] }?.let { top -> (viewport - (end - top) - gutters).coerceAtLeast(0) } ?: 0
    Column(Modifier.fillMaxSize().background(c.bg).windowInsetsPadding(WindowInsets.navigationBars).imePadding()) {
        RrTopBar(onBack = back, center = {
            RrConnectionChip(state.providers.firstOrNull { it.id == state.selected }?.let { it.label + " · " + it.model } ?: stringResource(R.string.career_choose_a_connection_428239), chooseProvider)
        }, actions = {
            RrIconButton(Icons.drawable.ic_ph_dots_three, stringResource(R.string.career_more_for_this_conversation_f3f947), more)
        })
        Column(Modifier.weight(1f).onSizeChanged { viewport = it.height }.verticalScroll(scroll).padding(start = 24.dp, end = 24.dp, top = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (state.loading) CareerLoading() else {
                if (state.error) CareerError(retry)
                state.messages.forEachIndexed { index, m ->
                    if (m.mine) RrUserBubble(m.text, Modifier.onGloballyPositioned { tops[m.id] = it.positionInParent().y.toInt() })
                    else {
                        var actions by remember(m.id) { mutableStateOf(false) }
                        CoachMarkdown(m.text, Modifier.fillMaxWidth().combinedClickable(onClick = {}, onLongClick = { actions = true }, onLongClickLabel = stringResource(R.string.career_reply_options_101219)))
                        RrMenu(actions, { actions = false }) {
                            RrMenuItem(stringResource(R.string.career_copy_af74f7), { copyReply(m.text); actions = false })
                            RrMenuItem(stringResource(R.string.career_share_09ca55), { shareReply(m.text); actions = false })
                        }
                        val used = state.messages.take(index).lastOrNull { it.mine }?.used
                        val sources = coachSources(m.parts)
                        if (used != null || sources.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            if ((used?.get("facts") as? kotlinx.serialization.json.JsonArray).orEmpty().isNotEmpty()) RrUsedChip(stringResource(R.string.career_facts_aeff1b), Icons.drawable.ic_ph_book_open, onClick = { used?.let(contextUsed) })
                            if ((used?.get("stories") as? kotlinx.serialization.json.JsonArray).orEmpty().isNotEmpty()) RrUsedChip(stringResource(R.string.career_stories_67b5fe), Icons.drawable.ic_ph_quotes, onClick = { used?.let(contextUsed) })
                            if (used?.get("preferences").toString() == "true") RrUsedChip(stringResource(R.string.career_preferences_9dfd34), Icons.drawable.ic_ph_target, onClick = { used?.let(contextUsed) })
                            if (used?.get("applications").toString() == "true") RrUsedChip(stringResource(R.string.career_applications_76c74b), Icons.drawable.ic_ph_briefcase, onClick = { used?.let(contextUsed) })
                            sources.forEach { (label, url) -> RrUsedChip(label, Icons.drawable.ic_ph_globe_simple, onClick = { openSource(url) }) }
                        }
                    }
                }
                // The coach's question is answered here, like the builder's assistant; tool approvals still go to the browser.
                state.pendingQuestion()?.let { question ->
                    var ownWords by remember(question.toolCallId) { mutableStateOf(false) }
                    var ownAnswer by remember(question.toolCallId) { mutableStateOf("") }
                    val canAnswer = !state.busy && !state.readOnly
                    RrQuestionCard(question.text, question.answers, { answer(question, it) },
                        ownWordsLabel = stringResource(CoreStrings.string.or_in_your_own_words), onOwnWords = { ownWords = true }, enabled = canAnswer)
                    if (ownWords) RrTextField(ownAnswer, { ownAnswer = it }, label = stringResource(CoreStrings.string.or_in_your_own_words), enabled = canAnswer,
                        trailing = if (ownAnswer.isNotBlank()) ({ RrIconButton(Icons.drawable.ic_ph_arrow_up, stringResource(CoreStrings.string.send), { answer(question, ownAnswer) }, size = RrIconButtonSize.Small, enabled = canAnswer) }) else null)
                }
                if (state.messages.any { message -> message.parts.any { part ->
                    part["state"].toString().trim('"') in setOf("approval-requested", "approval-responded")
                } }) RrCallout(stringResource(R.string.career_continue_browser), tone = RrTone.Info,
                    actionLabel = stringResource(R.string.career_open_in_browser_052269), onAction = more)
                state.pendingFacts.forEach { proposal -> key(proposal.callId) { Folding(visible = true, appear = true) { RememberPrompt(proposal, rememberFact, dismissFact, knowledge) } } }
                if (state.providers.isEmpty() && !state.loading) RrEmptyState(stringResource(R.string.career_connect_an_ai_provider_to_use_the_coach_cd023a), stringResource(R.string.career_nothing_is_sent_until_you_choose_a_connection_for_this_conve_4fe026), actionLabel = stringResource(R.string.career_add_ai_provider_9ce5e6), onAction = setup)
            }
            Box(Modifier.onGloballyPositioned { end = it.positionInParent().y.toInt() })
            if (room > 0) Spacer(Modifier.height(with(density) { room.toDp() }))
        }
        Column(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 12.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            RrAiComposer(state.draft, onDraft, send, stringResource(R.string.career_ask_about_your_next_career_step_ba2404), enabled = !state.readOnly && state.selected != null && (!state.memory || state.knowledgeReady), sending = state.busy, onStop = stop, contextChips = {
                // On: × leaves it out of the next message. Left out: dashed; tap brings it back.
                if (state.memory) RrContextChip(stringResource(R.string.career_knowledge_on_4bf78f), icon = Icons.drawable.ic_ph_book_open, onRemove = { memory(false) })
                else RrContextChip(stringResource(R.string.career_knowledge_off_3697f7), icon = Icons.drawable.ic_ph_book_open, leftOut = true, onClick = { memory(true) })
                if (!state.scoped) {
                    if (state.applications) RrContextChip(stringResource(R.string.career_applications_76c74b), icon = Icons.drawable.ic_ph_briefcase, onRemove = { applications(false) })
                    else RrContextChip(stringResource(R.string.career_applications_76c74b), icon = Icons.drawable.ic_ph_briefcase, leftOut = true, onClick = { applications(true) })
                }
            })
            if (state.memory && !state.knowledgeReady) RrText(if (state.loading) stringResource(R.string.career_loading_knowledge_before_you_send_266b01) else stringResource(R.string.career_knowledge_couldn_t_load_try_again_or_switch_knowledge_off_be_38aa66), style = RrType.small, color = c.ink3)
            if (!follow) RrButton(stringResource(R.string.career_latest_decd7c), { follow = true; scope.launch { scroll.animateScrollTo(scroll.maxValue) } }, variant = RrButtonVariant.Secondary)
            if (state.busy) RrWorkingLabel(listOf(stringResource(R.string.career_working_13b7bf)))
        }
    }
}

/** "Remember “…”?" on info-soft with Remember and Not now; once saved it links to the fact. */
@Composable private fun RememberPrompt(proposal: CoachFact, remember: (CoachFact) -> Unit, dismiss: (String) -> Unit, knowledge: () -> Unit) {
    val c = RrTheme.colors
    Column(Modifier.fillMaxWidth().background(c.infoSoft, RrShape.xl).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        RrText(stringResource(R.string.career_remember_quoted, proposal.fact.text), style = RrType.body, color = c.ink)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            RrButton(if (proposal.savedId == null) stringResource(R.string.career_remember_281f30) else stringResource(R.string.career_view_fact_b34722), { if (proposal.savedId == null) remember(proposal) else knowledge() }, variant = RrButtonVariant.Secondary)
            RrButton(stringResource(R.string.career_not_now_e45714), { dismiss(proposal.callId) }, variant = RrButtonVariant.Ghost)
        }
    }
}

@Composable internal fun KnowledgeScreen(state: FactsState, tab: KnowledgeTab, onTab: (KnowledgeTab) -> Unit, query: String, onQuery: (String) -> Unit,
    category: SaveCareerFactRequestCategory?, onCategory: (SaveCareerFactRequestCategory?) -> Unit, forgotten: Boolean, showForgotten: (Boolean) -> Unit,
    newFact: String, onNewFact: (String) -> Unit, add: () -> Unit, fact: (CareerFact) -> Unit, forget: (CareerFact) -> Unit,
    story: (String?) -> Unit, pull: () -> Unit, memory: (SaveCareerProfileRequestMemoryMode) -> Unit, back: () -> Unit, retry: () -> Unit,
) {
    var options by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).rrNavigationBarsPadding().imePadding()) {
        RrTopBar(onBack = back, actions = {
            RrIconButton(Icons.drawable.ic_ph_plus, stringResource(if (tab == KnowledgeTab.Facts) R.string.career_add_a_fact_6c1785 else R.string.career_add_story_7d30ba), { if (tab == KnowledgeTab.Facts) options = true else story(null) })
            if (state.facts.size > 20 || tab == KnowledgeTab.Stories) RrIconButton(Icons.drawable.ic_ph_dots_three, stringResource(R.string.career_more), { options = true })
        })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            RrPageTitle(stringResource(if (tab == KnowledgeTab.Facts) R.string.career_facts_aeff1b else R.string.career_stories_67b5fe), subtitle = if (tab == KnowledgeTab.Facts) stringResource(R.string.career_facts_intro) else null)
            if (state.loading) CareerLoading() else {
                if (state.error) CareerError(retry)
                if (tab == KnowledgeTab.Facts) {
                    if (state.facts.size > 20) RrSearchField(query, onQuery, stringResource(R.string.career_search_facts_f4ad2d), Modifier.padding(horizontal = 24.dp, vertical = 12.dp))
                    val rows = state.facts.filter { it.status != "forgotten" && (category == null || it.category == category.wireValue) && (query.isBlank() || it.text.contains(query, true)) }
                    val loaded = remember(state.loading) { state.facts.map { it.id }.toSet() }
                    if (rows.none { it.id !in state.pendingForget }) RrEmptyState(if (state.facts.isEmpty()) stringResource(R.string.career_no_facts_yet_8f3622) else stringResource(R.string.career_no_facts_match_try_another_word_or_type_fac4bf), stringResource(R.string.career_add_a_fact_6c1785), Modifier.padding(horizontal = 24.dp), actionLabel = stringResource(R.string.career_pull_facts_from_my_resume_6bd5a2), onAction = pull)
                    rows.groupBy { when (it.category) { "skill" -> R.string.career_skills; "preference" -> R.string.career_preferences_9dfd34; else -> R.string.career_work } }.forEach { (group, facts) ->
                        RrSectionHeading(stringResource(group))
                        RrListGroup { facts.forEachIndexed { index, row -> key(row.id) {
                            Folding(visible = row.id !in state.pendingForget, appear = row.id !in loaded) {
                                RrSwipeRow(endAction = RrSwipeAction(stringResource(R.string.career_forget_03d5d8), Icons.drawable.ic_ph_trash, onCommit = { forget(row) })) {
                                    RrListRow(row.text, subtitle = listOfNotNull(sourceLabel(row.source.kind), row.company).joinToString(" · "), onClick = { fact(row) }, titleMaxLines = Int.MAX_VALUE, divider = index != facts.lastIndex, trailing = { RrRowCaret() })
                                }
                            }
                        } } }
                    }

                } else {
                    Spacer(Modifier.height(20.dp))
                    if (state.stories.isEmpty()) RrEmptyState(stringResource(R.string.career_no_stories_yet_d7ed09), stringResource(R.string.career_build_a_story_from_something_you_did_4ff3b8), Modifier.padding(horizontal = 24.dp))
                    else RrListGroup { state.stories.forEachIndexed { index, row ->
                        RrListRow(row.data.title, subtitle = pluralStringResource(R.plurals.career_used_in_briefings, state.briefingUses[row.id] ?: 0, state.briefingUses[row.id] ?: 0), onClick = { story(row.id) }, leading = { RrDocumentThumbnail() }, divider = index != state.stories.lastIndex, trailing = { RrRowCaret() })
                    } }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
    if (options) RrBottomSheet({ options = false }, title = stringResource(R.string.career_knowledge_dec1fc), initialDetent = 1) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            RrListRow(stringResource(R.string.career_add_a_fact_6c1785), onClick = { options = false; add() })
            RrListRow(stringResource(R.string.career_stories_67b5fe), onClick = { onTab(KnowledgeTab.Stories); options = false })
            RrListRow(stringResource(R.string.career_job_search), onClick = { onTab(KnowledgeTab.Preferences); options = false })
                    RrSectionHeading(stringResource(R.string.career_remember_facts_from_my_messages_323c02))
                    Column(Modifier.padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        val modes = SaveCareerProfileRequestMemoryMode.entries.filter { it != SaveCareerProfileRequestMemoryMode.Unknown }
                        RrSegmentedControl(modes.map { RrSegment(memoryLabel(it.wireValue)) }, modes.indexOf(state.profile?.memoryMode).coerceAtLeast(0), { memory(modes[it]) })
                        RrButton(stringResource(R.string.career_pull_facts_from_my_resume_6bd5a2), pull, variant = RrButtonVariant.GhostAccent)
                        ChoicePicker(category?.let { categoryLabel(it.wireValue) } ?: stringResource(R.string.career_all_6a7208), stringResource(R.string.career_type_3deb74), listOf("" to stringResource(R.string.career_all_6a7208)) + SaveCareerFactRequestCategory.entries.filter { it != SaveCareerFactRequestCategory.Unknown }.map { it.wireValue to categoryLabel(it.wireValue) }, { key -> onCategory(SaveCareerFactRequestCategory.entries.firstOrNull { it.wireValue == key }) })
                        RrSwitchRow(stringResource(R.string.career_show_forgotten_3a0025), forgotten, showForgotten)
                        if (forgotten) state.forgotten.forEach { row -> RrText(stringResource(R.string.career_forgotten_count, row.count.toString(), row.at), style = RrType.small, color = RrTheme.colors.ink3) }
                    }
        }
    }
}
/** Grows in (`d2`) when [appear], folds away when not [visible]; instant with reduced motion. */
@Composable internal fun Folding(visible: Boolean, appear: Boolean = false, content: @Composable () -> Unit) {
    val duration = if (RrTheme.reducedMotion) 0 else RrMotion.D2
    val state = remember { MutableTransitionState(!appear) }
    state.targetState = visible
    AnimatedVisibility(state,
        enter = expandVertically(tween(duration, easing = RrMotion.ease), expandFrom = Alignment.Top) + fadeIn(tween(duration)),
        exit = shrinkVertically(tween(duration, easing = RrMotion.ease), shrinkTowards = Alignment.Top) + fadeOut(tween(duration))) { content() }
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
    var editing by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).rrNavigationBarsPadding().imePadding()) {
        RrTopBar(onBack = back, actions = {
            if (editing != null) RrButton(stringResource(CoreStrings.string.done), { editing = null }, variant = RrButtonVariant.GhostAccent)
            if (state.error) RrButton(stringResource(R.string.career_retry_9f5cd8), retry, variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Small)
            RrIconButton(Icons.drawable.ic_ph_dots_three, stringResource(R.string.career_story_options_89089f), { editing = "menu" })
        })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            if (state.loading) CareerLoading() else state.draft?.let { d ->
                Box(Modifier.clickable { editing = "title" }) {
                    RrPageTitle(d.title, subtitle = pluralStringResource(R.plurals.career_used_in_interview_briefings, state.briefingUses, state.briefingUses), subtitleColor = RrTheme.colors.ink3)
                }
                if (editing == "title") RrTextField(d.title, { change(d.copy(title = it)) }, Modifier.padding(horizontal = 24.dp), label = stringResource(R.string.career_title_768e0c))
                @Composable fun part(key: String, title: String, value: String, update: (String) -> Unit) {
                    RrSectionHeading(title)
                    if (editing == key) RrTextField(value, update, Modifier.padding(horizontal = 24.dp), label = title, singleLine = false)
                    else Box(Modifier.fillMaxWidth().clickable { editing = key }.padding(start = 24.dp, end = 24.dp, top = 4.dp).heightIn(min = 44.dp)) { RrText(value.ifBlank { title }, style = RrType.prose) }
                }
                part("situation", stringResource(R.string.career_situation_30f6fe), d.situation) { change(d.copy(situation = it)) }
                part("action", stringResource(R.string.career_what_i_did), d.action) { change(d.copy(action = it)) }
                part("result", stringResource(R.string.career_result_5faa59), d.result.orEmpty()) { change(d.copy(result = it)) }
                FlowRow(Modifier.padding(start = 24.dp, end = 24.dp, top = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    d.tags.orEmpty().forEach { tag -> RrFilterChip(tag, false, { editing = "tags" }) }
                    if (d.tags.isNullOrEmpty()) RrAddChip(stringResource(R.string.career_tags), { editing = "tags" })
                }
                if (editing == "tags") ChipList(stringResource(R.string.career_tags), d.tags.orEmpty(), stringResource(CoreStrings.string.add), { change(d.copy(tags = it)) })
                if (state.status == SaveState.KeptOnDevice) RrCallout(stringResource(R.string.career_your_changes_are_kept_on_this_device_try_again_when_you_re_o_35ff35), Modifier.padding(24.dp), tone = RrTone.Warn, actionLabel = stringResource(R.string.career_retry_9f5cd8), onAction = retry)

            } ?: RrEmptyState(stringResource(R.string.career_this_story_is_unavailable_or_uses_facts_that_are_switched_of_ab5011), "")
        }
    }
    if (editing in listOf("menu", "details")) RrBottomSheet({ editing = null }, title = stringResource(R.string.career_story_options_89089f), initialDetent = 1) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (editing == "details") state.draft?.let { d ->
                RrTextField(d.task, { change(d.copy(task = it)) }, label = stringResource(R.string.career_task_7bb0dd), singleLine = false)
                RrTextField(d.reflection.orEmpty(), { change(d.copy(reflection = it)) }, label = stringResource(R.string.career_reflection_fda05a), singleLine = false)
            } else {
                RrListRow(stringResource(R.string.career_practice_this_story_8b37ea), onClick = { editing = null; practice() })
                RrListRow(stringResource(R.string.career_link_facts_d38459), onClick = { editing = null; facts() })
                RrListRow(stringResource(R.string.career_task_and_reflection), onClick = { editing = "details" })
                RrListRow(stringResource(R.string.career_more), onClick = { editing = null; more() })
            }
        }
    }

}
