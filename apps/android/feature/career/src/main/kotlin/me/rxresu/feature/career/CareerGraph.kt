@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package me.rxresu.feature.career



import androidx.compose.ui.res.stringResource
import me.rxresu.core.strings.R as CoreStrings


import android.content.ClipData
import android.content.Intent
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import me.rxresu.core.auth.SessionState
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.createSavedStateHandle
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.toRoute
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as Icons
import me.rxresu.core.navigation.*
import me.rxresu.core.network.generated.*
import me.rxresu.core.network.generated.Offer
import me.rxresu.core.strings.CatalogPlurals

/** Registers career destinations without changing the shell's route contract. */
fun NavGraphBuilder.careerGraph(nav: NavController, motion: RrNavMotion) {
    tabRoot<CareerTab>(motion) { CareerRoute(nav) }
    screen<Coach> { entry ->
        val route = entry.toRoute<Coach>()
        // Coach(prompt) is being added to the route by another change. Type-safe routes keep each field in the arguments
        // bundle under its name, so this reads it once it exists and is null until then.
        CoachRoute(nav, route.conversationId, route.applicationId, entry.arguments?.getString("prompt"))
    }
    screen<Knowledge> { KnowledgeRoute(nav, it.toRoute<Knowledge>().tab) }
    screen<me.rxresu.core.navigation.Story> { StoryRoute(nav, it.toRoute<me.rxresu.core.navigation.Story>().id) }
    screen<Offers> { OffersRoute(nav) }
    sheet<ScheduleSheet> { ScheduleRoute(nav, it.toRoute<ScheduleSheet>().id) }
}
@Composable private fun accountKey(repositories: RrRepositories): String? {
    val session by repositories.account.session.collectAsStateWithLifecycle()
    val origin by repositories.authSession.origin.collectAsStateWithLifecycle()
    return (session as? SessionState.SignedIn)?.let { origin + ":" + it.accountScope }
}
@Composable private fun recovery(repositories: RrRepositories): CareerDrafts {
    val context = LocalContext.current; val resources = LocalResources.current
    val owner = accountKey(repositories).orEmpty()
    return remember(owner) { CareerDrafts(context.applicationContext, owner, persisted = {
        val account = repositories.owner()
        if (account != null && owner == repositories.authSession.origin.value + ":" + account) scheduleCareerSync(context.applicationContext, repositories.authSession.origin.value, account)
    }) }
}
private fun browser(context: Context, repositories: RrRepositories, path: String) = CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(repositories.authSession.origin.value + path))
private fun copy(context: Context, text: String) { context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("", text)) }

@Composable private fun CareerRoute(nav: NavController) {
    val repositories = LocalRepositories.current; val context = LocalContext.current; val resources = LocalResources.current
    val scope = rememberCoroutineScope(); val toasts = LocalToasts.current
    val vm = viewModel(key = "career:${accountKey(repositories)}") { CareerViewModel(repositories) }; val state by vm.state.collectAsStateWithLifecycle()
    var all by remember { mutableStateOf(false) }; var schedules by remember { mutableStateOf(false) }
    val openCoach: (String?) -> Unit = { starter -> nav.currentBackStackEntry?.savedStateHandle?.set("coach-starter", starter); nav.navigate(Coach()) }
    CareerScreen(state, { vm.refresh() }, { nav.navigate(Search()) }, { nav.navigate(Settings) }, openCoach, { nav.navigate(Coach(it)) }, { nav.navigate(Knowledge(it)) }, { nav.navigate(Offers) }, { schedules = true },
        { nav.navigate(Knowledge(KnowledgeTab.Stories)) }, { nav.navigate(AiProviderSheet()) }, { all = true })
    if (all) RrBottomSheet({ all = false }, title = stringResource(R.string.career_conversations_07c59b), initialDetent = 1) {
        state.threads.forEach { thread ->
            RrListRow(thread.title, icon = Icons.drawable.ic_ph_chat_circle, onClick = { all = false; nav.navigate(Coach(thread.id)) }, trailing = {
                var menu by remember { mutableStateOf(false) }; var rename by remember { mutableStateOf(false) }
                RrIconButton(Icons.drawable.ic_ph_dots_three, stringResource(R.string.career_conversation_options_db62f1), { menu = true })
                RrMenu(menu, { menu = false }) {
                    RrMenuItem(stringResource(R.string.career_rename_d3f4cb), { menu = false; rename = true })
                    RrMenuItem(stringResource(R.string.career_copy_conversation_4f1cbe), { menu = false; vm.copyConversation(thread.id) { copy(context, it) } })
                    RrMenuItem(stringResource(R.string.career_delete_conversation_de4346), { menu = false; scope.launch { if (toasts.show(resources.getString(R.string.career_delete_conversation_de4346), resources.getString(R.string.career_undo_39fc72)) != RrToastResult.ActionPerformed) vm.deleteThread(thread.id) } }, danger = true)
                }
                if (rename) RenameSheet(thread.title, { rename = false }) { vm.rename(thread.id, it); rename = false }
            })
        }
    }
    if (schedules) RrBottomSheet({ schedules = false }, title = stringResource(R.string.career_schedules_26d9d0), fitContent = true) {
        val time = rememberCareerTime()
        state.schedules.forEach { schedule -> RrListRow(scheduleTitle(schedule.kind) + schedule.query.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty(), subtitle = scheduleStatus(schedule, time), onClick = { schedules = false; nav.navigate(ScheduleSheet(schedule.id)) }, trailing = { RrRowCaret() }) }
        RrButton(stringResource(R.string.career_new_schedule_3e70c3), { schedules = false; nav.navigate(ScheduleSheet()) }, Modifier.fillMaxWidth().padding(16.dp), icon = Icons.drawable.ic_ph_plus)
    }
}
@Composable private fun CoachRoute(nav: NavController, id: String?, applicationId: String?, prompt: String?) {
    val repositories = LocalRepositories.current; val context = LocalContext.current; val resources = LocalResources.current; val drafts = recovery(repositories)
    // Starters arrive as the route's prompt or, from this module's own screens, through the previous entry.
    val starter = remember(id) { prompt ?: nav.previousBackStackEntry?.savedStateHandle?.remove<String>("coach-starter") }
    val vm = viewModel(key = "coach:${accountKey(repositories)}:$id:$applicationId") { CoachViewModel(repositories, drafts, id, starter, applicationId = applicationId, savedState = createSavedStateHandle()) }; val state by vm.state.collectAsStateWithLifecycle()
    val haptic = rememberRrHaptics(); val scope = rememberCoroutineScope(); val toasts = LocalToasts.current
    LaunchedEffect(state.error) { if (state.error) haptic(RrHaptic.Error) }
    LaunchedEffect(state.thread?.id, state.busy, state.error) {
        val thread = state.thread
        if (id == null && thread != null && !state.busy && !state.loading && !state.error && state.messages.isNotEmpty()) {
            if (vm.adoptThread()) nav.navigate(Coach(thread.id, applicationId)) { popUpTo(nav.currentBackStackEntry!!.destination.id) { inclusive = true } }
        }
    }
    var used by remember { mutableStateOf<JsonObject?>(null) }
    var providers by remember { mutableStateOf(false) }; var approveSend by remember { mutableStateOf(false) }; var menu by remember { mutableStateOf(false) }; var rename by remember { mutableStateOf(false) }
    CoachScreen(state, vm::draft, vm::memory, vm::applications, { nav.popBackStack() }, { providers = true }, { menu = true }, { vm.load() }, { nav.navigate(Knowledge()) }, { nav.navigate(AiProviderSheet()) },
        { approveSend = true }, { vm.stop() }, { proposal -> vm.remember(proposal) { haptic(RrHaptic.Success) } }, vm::dismiss, { copy(context, it) }, { text -> context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), null)) }, { used = it })
    used?.let { shared -> RrBottomSheet({ used = null }, title = stringResource(R.string.career_shared_context), initialDetent = 1) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            (shared["facts"] as? JsonArray).orEmpty().forEach { value ->
                val fact = state.facts.firstOrNull { it.id == value.jsonPrimitive.content }
                RrListRow(fact?.text ?: stringResource(R.string.career_fact_since_forgotten), onClick = if (fact != null) { {
                    used = null; nav.currentBackStackEntry?.savedStateHandle?.set("career-fact", fact.id); nav.navigate(Knowledge())
                } } else null)
            }
            (shared["stories"] as? JsonArray).orEmpty().forEach { value ->
                val story = state.stories.firstOrNull { it.id == value.jsonPrimitive.content }
                RrListRow(story?.data?.title ?: stringResource(R.string.career_story_since_deleted), onClick = if (story != null) { { used = null; nav.navigate(me.rxresu.core.navigation.Story(story.id)) } } else null)
            }
            if (shared["preferences"]?.jsonPrimitive?.booleanOrNull == true) RrListRow(stringResource(R.string.career_preferences_9dfd34), onClick = { used = null; nav.navigate(Knowledge(KnowledgeTab.Preferences)) })
            if (shared["applications"]?.jsonPrimitive?.booleanOrNull == true) RrListRow(stringResource(R.string.career_applications_76c74b), onClick = { used = null; nav.navigate(ApplicationsTab()) })
        }
    } }
    if (providers) RrBottomSheet({ providers = false }, title = stringResource(R.string.career_ai_connection_6497f8), fitContent = true) {
        var selected by remember { mutableStateOf(state.providers.firstOrNull { it.id == state.selected }) }
        RrText(stringResource(R.string.career_earlier_messages_and_attachments_in_this_conversation_will_b_256ec2), Modifier.padding(16.dp), style = RrType.small)
        state.providers.forEach { provider -> RrChoiceRow(provider.label + " · " + provider.model, selected?.id == provider.id, { selected = provider }) }
        RrButton(stringResource(R.string.career_use_connection_e48414), { selected?.let { vm.provider(it) }; providers = false }, Modifier.fillMaxWidth().padding(16.dp), enabled = selected != null)
    }
    if (approveSend) RrBottomSheet({ approveSend = false }, title = stringResource(R.string.career_share_data_with_this_connection_628aab), fitContent = true, footer = { SheetFooter {
        RrButton(stringResource(R.string.career_allow_this_operation_6d2eb6), { approveSend = false; haptic(RrHaptic.Light); vm.send() }, Modifier.fillMaxWidth())
    } }) {
        val provider = state.providers.firstOrNull { it.id == state.selected }
        RrText(stringResource(R.string.career_server_1_s_1d7e0c, state.server), Modifier.padding(16.dp), style = RrType.small)
        RrText(stringResource(R.string.career_provider_1_s_08687d, provider?.let { it.label + " · " + listOfNotNull(it.model, it.fastModel, it.capableModel).distinct().joinToString(", ") + " · " + (it.baseURL ?: it.provider.wireValue) }.orEmpty()), Modifier.padding(16.dp), style = RrType.small)
        RrText(stringResource(R.string.career_your_message_conversation_history_and_selected_context_are_s_978784), Modifier.padding(16.dp), style = RrType.small)
    }

    if (menu) RrBottomSheet({ menu = false }, title = stringResource(R.string.career_conversation_options_db62f1), fitContent = true) {
        RrListRow(stringResource(R.string.career_open_in_browser_052269), onClick = { browser(context, repositories, "/dashboard/career/coach" + (state.thread?.id?.let { "/${Uri.encode(it)}" } ?: "")); menu = false })
        RrListRow(stringResource(R.string.career_copy_draft_949942), onClick = { copy(context, state.draft); menu = false })
        if (state.thread != null) {
            RrListRow(stringResource(R.string.career_rename_d3f4cb), onClick = { menu = false; rename = true })
            RrListRow(stringResource(R.string.career_copy_conversation_4f1cbe), onClick = { menu = false; copy(context, state.messages.joinToString("\n\n") { it.text }) })
            RrListRow(stringResource(R.string.career_delete_conversation_de4346), danger = true, onClick = { menu = false; scope.launch { if (toasts.show(resources.getString(R.string.career_delete_conversation_de4346), resources.getString(R.string.career_undo_39fc72)) != RrToastResult.ActionPerformed) vm.delete { nav.popBackStack() } } })
        }
    }
    if (rename) RenameSheet(state.thread?.title.orEmpty(), { rename = false }) { vm.rename(it); rename = false }
}
@Composable private fun RenameSheet(initial: String, close: () -> Unit, save: (String) -> Unit) {
    var title by rememberSaveable { mutableStateOf(initial) }
    RrBottomSheet(close, title = stringResource(R.string.career_rename_d3f4cb), fitContent = true, confirmDiscard = title != initial, footer = { SheetFooter { RrButton(stringResource(R.string.career_save_efc007), { save(title.trim()) }, Modifier.fillMaxWidth(), enabled = title.isNotBlank()) } }) { RrTextField(title, { title = it }, Modifier.padding(16.dp), label = stringResource(R.string.career_title_768e0c)) }
}

@Composable private fun KnowledgeRoute(nav: NavController, initial: KnowledgeTab) {
    val repositories = LocalRepositories.current
    if (initial == KnowledgeTab.Preferences) { PreferencesRoute(nav); return }
    val context = LocalContext.current; val resources = LocalResources.current; val toasts = LocalToasts.current; val scope = rememberCoroutineScope(); val haptic = rememberRrHaptics()
    val vm = viewModel(key = "knowledge:${accountKey(repositories)}") { KnowledgeViewModel(repositories) }; val state by vm.state.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf(initial) }; var query by rememberSaveable { mutableStateOf("") }; var type by remember { mutableStateOf<SaveCareerFactRequestCategory?>(null) }
    var forgotten by rememberSaveable { mutableStateOf(false) }; var newFact by rememberSaveable { mutableStateOf("") }; var selected by remember { mutableStateOf<CareerFact?>(null) }
    var pull by remember { mutableStateOf(false) }; var adding by remember { mutableStateOf(false) }
    val highlighted = remember { nav.previousBackStackEntry?.savedStateHandle?.remove<String>("career-fact") }
    LaunchedEffect(highlighted, state.loading) { if (!state.loading && highlighted != null) selected = state.facts.firstOrNull { it.id == highlighted } }
    val forget: (CareerFact) -> Unit = { fact -> vm.forget(fact) { toasts.show(resources.getString(R.string.career_fact_forgotten_396632), resources.getString(R.string.career_undo_39fc72)) == RrToastResult.ActionPerformed } }
    KnowledgeScreen(state, tab, { if (it == KnowledgeTab.Preferences) nav.navigate(Knowledge(it)) else tab = it }, query, { query = it }, type, { type = it }, forgotten, { forgotten = it }, newFact, { newFact = it },
        { adding = true }, { selected = it }, forget,
        { nav.navigate(me.rxresu.core.navigation.Story(it)) }, { pull = true; vm.chooseResume() }, { vm.memory(it) }, { nav.popBackStack() }, { vm.refresh() })
    selected?.let { fact -> FactSheet(fact, state.applications, state.busy, { selected = null }, { text, category, application -> vm.correct(fact, text, category, application) { selected = null } }, { selected = null; forget(fact) }, { selected = null }, {
        // Fact to story: the coach drafts the five parts from this fact; the prompt is left in the composer, not sent.
        selected = null
        nav.currentBackStackEntry?.savedStateHandle?.set("coach-starter", resources.getString(R.string.career_help_me_turn_an_accomplishment_into_a_situation_task_action__b4a1b4) + "\n\n" + fact.text)
        nav.navigate(Coach())
    }) }
    if (adding) {
        var text by rememberSaveable { mutableStateOf(newFact) }
        var category by remember { mutableStateOf(type ?: SaveCareerFactRequestCategory.Experience) }
        var application by remember { mutableStateOf<String?>(null) }
        RrBottomSheet({ adding = false }, title = stringResource(R.string.career_add_a_fact_6c1785), confirmDiscard = text != newFact, initialDetent = 1, footer = { SheetFooter {
            RrButton(stringResource(R.string.career_add_a_fact_6c1785), { vm.add(text, category, application) { newFact = ""; adding = false; haptic(RrHaptic.Success) } }, Modifier.fillMaxWidth(), enabled = text.isNotBlank() && text.length <= 2000 && !state.busy, loading = state.busy)
        } }) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                RrTextField(text, { text = it }, label = stringResource(R.string.career_fact_e09300), minLines = 3)
                ChoicePicker(categoryLabel(category.wireValue), stringResource(R.string.career_type_3deb74), SaveCareerFactRequestCategory.entries.filter { it != SaveCareerFactRequestCategory.Unknown }.map { it.wireValue to categoryLabel(it.wireValue) }, { value -> category = SaveCareerFactRequestCategory.entries.first { it.wireValue == value } })
                ChoicePicker(state.applications.firstOrNull { it.id == application }?.company ?: stringResource(R.string.career_all_applications_5bba47), stringResource(R.string.career_scope_4651a3), listOf("" to stringResource(R.string.career_all_applications_5bba47)) + state.applications.map { it.id to it.company }, { application = it.ifEmpty { null } })
                if (state.error) CareerError { }
            }
        }
    }
    if (pull) RrBottomSheet({ pull = false }, title = stringResource(R.string.career_pull_facts_from_my_resume_6bd5a2), initialDetent = 1) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.busy) RrWorkingLabel(listOf(stringResource(R.string.career_working_13b7bf)))
            if (state.error) CareerError { vm.chooseResume() }
            val proposals = state.proposals
            if (proposals == null) state.resumes.forEach { resume -> RrListRow(resume.name, onClick = { vm.propose(resume.id) }, trailing = { RrRowCaret() }) }
            else {
                var selectedProposals by remember(proposals) { mutableStateOf(proposals.proposals.indices.toSet()) }
                proposals.proposals.forEachIndexed { i, p -> RrChoiceRow(p.text, i in selectedProposals, { selectedProposals = if (i in selectedProposals) selectedProposals - i else selectedProposals + i }, radio = false) }
                RrButton(stringResource(R.string.career_save_selected_facts_05250c), { vm.saveProposals(selectedProposals) { pull = false; haptic(RrHaptic.Success) } }, enabled = selectedProposals.isNotEmpty() && !state.busy)
            }
        }
    }
}
@Composable private fun FactSheet(fact: CareerFact, applications: List<ApplicationSummary>, busy: Boolean, close: () -> Unit, save: (String, SaveCareerFactRequestCategory, String?) -> Unit, forget: () -> Unit, restore: () -> Unit, draftStory: () -> Unit) {
    var text by rememberSaveable(fact.id) { mutableStateOf(fact.text) }; var application by remember { mutableStateOf(fact.applicationId) }; var category by remember { mutableStateOf(SaveCareerFactRequestCategory.entries.firstOrNull { it.wireValue == fact.category } ?: SaveCareerFactRequestCategory.Experience) }
    RrBottomSheet(close, title = stringResource(R.string.career_correct_this_fact_0cbfa5), initialDetent = 1, confirmDiscard = text != fact.text, footer = { SheetFooter {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { RrButton(if (fact.status == "forgotten") stringResource(R.string.career_remember_281f30) else stringResource(R.string.career_forget_03d5d8), if (fact.status == "forgotten") restore else forget, variant = RrButtonVariant.DangerGhost); RrButton(stringResource(R.string.career_save_efc007), { save(text, category, application) }, Modifier.weight(1f), enabled = text.isNotBlank() && text.length <= 2000 && !busy) }
    } }) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            RrTextField(text, { text = it }, label = stringResource(R.string.career_fact_e09300), singleLine = false, minLines = 3)
            RrText(stringResource(R.string.career_the_original_stays_in_the_history_38c5ee), style = RrType.small, color = RrTheme.colors.ink3)
            ChoicePicker(categoryLabel(category.wireValue), stringResource(R.string.career_type_3deb74), SaveCareerFactRequestCategory.entries.filter { it != SaveCareerFactRequestCategory.Unknown }.map { it.wireValue to categoryLabel(it.wireValue) }, { value -> category = SaveCareerFactRequestCategory.entries.first { it.wireValue == value } })
            ChoicePicker(applications.firstOrNull { it.id == application }?.company ?: stringResource(R.string.career_all_applications_5bba47), stringResource(R.string.career_scope_4651a3), listOf("" to stringResource(R.string.career_all_applications_5bba47)) + applications.map { it.id to it.company }, { application = it.ifEmpty { null } })

            val resources = LocalResources.current
            val stories = fact.usedBy.stories.toInt(); val saved = fact.usedBy.savedItems.toInt()
            RrText(if (stories + saved == 0) stringResource(CoreStrings.string.not_used_in_a_story_or_saved_item_yet) else
                CatalogPlurals.get(resources, CoreStrings.plurals.message_0_plural_one_backs_story_other_backs_stories, stories, stories.toString()) + " · " +
                    CatalogPlurals.get(resources, CoreStrings.plurals.message_0_plural_one_used_in_saved_item_other_used_in_saved_items, saved, saved.toString()), style = RrType.small, color = RrTheme.colors.ink3)
            if (fact.status != "forgotten") RrButton(stringResource(R.string.career_draft_a_story), draftStory, variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Small, icon = Icons.drawable.ic_ph_sparkle)
            val time = rememberCareerTime()
            fact.revisions.forEach { revision -> RrText(listOfNotNull(time.day(revision.at), revision.text).joinToString(" · "), style = RrType.small, color = RrTheme.colors.ink3) }
        }
    }
}

@Composable private fun StoryRoute(nav: NavController, id: String?) {
    val repositories = LocalRepositories.current; val context = LocalContext.current; val resources = LocalResources.current; val drafts = recovery(repositories)
    val vm = viewModel(key = "story:${accountKey(repositories)}:$id") { StoryViewModel(repositories, drafts, id, savedState = createSavedStateHandle()) }; val state by vm.state.collectAsStateWithLifecycle()
    val toasts = LocalToasts.current; val scope = rememberCoroutineScope()
    var more by remember { mutableStateOf(false) }; var link by remember { mutableStateOf(false) }
    StoryScreen(state, vm::change, { vm.save(); nav.popBackStack() }, { vm.save() }, { more = true }, {
        state.draft?.id?.let { browser(context, repositories, "/dashboard/career/knowledge/stories/${Uri.encode(it)}?practice=true") }
    }, { link = true })
    if (more) RrBottomSheet({ more = false }, title = stringResource(R.string.career_story_options_89089f), fitContent = true) {
        RrListRow(stringResource(R.string.career_link_facts_d38459), onClick = { more = false; link = true })
        RrListRow(stringResource(R.string.career_delete_story_5846ec), danger = true, onClick = {
            more = false
            scope.launch { if (toasts.show(resources.getString(R.string.career_story_deleted_7542c6), resources.getString(R.string.career_undo_39fc72)) != RrToastResult.ActionPerformed) vm.delete { nav.popBackStack() } }
        })
    }
    if (link) RrBottomSheet({ link = false }, title = stringResource(R.string.career_link_facts_d38459), initialDetent = 1) {
        Column(Modifier.verticalScroll(rememberScrollState())) { state.facts.forEach { fact ->
            val d = state.draft
            RrChoiceRow(fact.text, fact.id in d?.factIds.orEmpty(), { if (d != null) vm.change(d.copy(factIds = if (fact.id in d.factIds.orEmpty()) d.factIds.orEmpty() - fact.id else d.factIds.orEmpty() + fact.id)) }, radio = false)
        } }
    }
}
@Composable private fun PreferencesRoute(nav: NavController) {
    val repositories = LocalRepositories.current; val drafts = recovery(repositories)
    val vm = viewModel(key = "preferences:${accountKey(repositories)}") { PreferencesViewModel(repositories, drafts, savedState = createSavedStateHandle()) }; val state by vm.state.collectAsStateWithLifecycle()
    var suggestions by remember { mutableStateOf(false) }
    PreferencesScreen(state, vm::change, { vm.save(); nav.popBackStack() }, { vm.save() }, { suggestions = true })
    if (suggestions) RoleSuggestionsSheet(state, { suggestions = false }, { provider, resume, knowledge -> vm.suggest(provider, resume, knowledge) }, { roles -> state.profile?.let { vm.change(it.copy(targetRoles = (it.targetRoles + roles).distinct())) }; suggestions = false })
}
@Composable private fun OffersRoute(nav: NavController) {
    val repositories = LocalRepositories.current; val context = LocalContext.current; val resources = LocalResources.current; val scope = rememberCoroutineScope(); val toast = LocalToasts.current; val haptic = rememberRrHaptics()
    val vm = viewModel(key = "offers:${accountKey(repositories)}") { OffersViewModel(repositories) }; val state by vm.state.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf(false) }; var existing by remember { mutableStateOf<SavedItem?>(null) }
    OffersScreen(state, { nav.popBackStack() }, { vm.refresh() }, { existing = it; editing = true }, { text -> copy(context, text); haptic(RrHaptic.Success); scope.launch { toast.show(resources.getString(R.string.career_questions_copied_050638)) } }, { selected ->
        // Offers are explicit draft context; opening a conversation never sends it.
        val prompt = resources.getString(R.string.career_help_me_weigh_the_offer_i_have_against_what_i_want_bcc192) + "\n\n" + selected.joinToString("\n") { item -> item.application?.company.orEmpty() + ": " + me.rxresu.core.network.ApiJson.encodeToString(Offer.serializer(), item.data as Offer) }
        nav.currentBackStackEntry?.savedStateHandle?.set("coach-starter", prompt); nav.navigate(Coach())
    })
    if (editing) OfferEntrySheet(state, existing, { editing = false }, { application, terms -> vm.save(application, terms, existing) { editing = false; haptic(RrHaptic.Success) } }, { existing?.let { offer ->
        editing = false
        scope.launch { if (toast.show(resources.getString(R.string.career_offer_deleted_27db1e), resources.getString(R.string.career_undo_39fc72)) != RrToastResult.ActionPerformed) vm.delete(offer.id) {} }
    } })
}
@Composable private fun ScheduleRoute(nav: NavController, id: String?) {
    val repositories = LocalRepositories.current; val context = LocalContext.current; val resources = LocalResources.current; val scope = rememberCoroutineScope(); val toast = LocalToasts.current; val haptic = rememberRrHaptics()
    val vm = viewModel(key = "schedule:${accountKey(repositories)}:$id") { ScheduleViewModel(repositories, id) }; val state by vm.state.collectAsStateWithLifecycle()
    ScheduleScreen(state, repositories.time.today(), repositories.time.timezone(), { nav.popBackStack() }, { vm.load() }, { request -> vm.save(request) { haptic(RrHaptic.Success); scope.launch { toast.show(resources.getString(R.string.career_schedule_saved_ce739e)); nav.popBackStack() } } }, {
        scope.launch { if (toast.show(resources.getString(R.string.career_schedule_deleted_89c267), resources.getString(R.string.career_undo_39fc72)) != RrToastResult.ActionPerformed) vm.delete { nav.popBackStack() } }
    })
}
