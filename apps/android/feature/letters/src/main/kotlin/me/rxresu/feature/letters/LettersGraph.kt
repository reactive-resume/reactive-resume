package me.rxresu.feature.letters

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import kotlinx.coroutines.launch
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import me.rxresu.core.auth.SessionState
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.*
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.designsystem.*
import me.rxresu.core.strings.R as CoreR
import me.rxresu.core.designsystem.R as DsR
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.text.input.TextFieldValue
import me.rxresu.core.navigation.*
import me.rxresu.core.network.generated.*

fun NavGraphBuilder.lettersGraph(nav: NavController, motion: RrNavMotion) {
    screen<LetterHistory> { entry ->
        val route = entry.toRoute<LetterHistory>()
        val owner = remember(entry) { nav.getBackStackEntry<Letter>().also { check(it.toRoute<Letter>().letterId == route.letterId) } }
        val vm: LetterViewModel = viewModel(viewModelStoreOwner = owner) { error("Letter editor must own its draft") }
        val state by vm.state.collectAsStateWithLifecycle()
        var naming by remember { mutableStateOf(false) }; var rename by remember { mutableStateOf<String?>(null) }; var restoring by remember { mutableStateOf<String?>(null) }; var deleting by remember { mutableStateOf<String?>(null) }
        Box {
            LetterVersionsScreen(state, { nav.popBackStack() }, { rename = null; naming = true }, { restoring = it }, { rename = it; naming = true }, { deleting = it })
            if (naming) LetterTextSheet(stringResource(CoreR.string.name_this_version), rename?.let { id -> state.versions.firstOrNull { it.id == id }?.name }.orEmpty(), state, { name -> vm.nameVersion(name, rename) { naming = false } }, { naming = false })
            restoring?.let { version -> LetterRestoreSheet(state, { vm.restore(version) { restoring = null } }, { restoring = null }) }
            deleting?.let { version -> RrAlertDialog(stringResource(CoreR.string.delete), stringResource(CoreR.string.named_versions_are_kept_until_you_delete_them_this_can_t_be_undone), stringResource(CoreR.string.delete), { vm.deleteVersion(version) { deleting = null } }, { deleting = null }, confirm = RrDialogConfirm.HoldToDelete) }
        }
    }

    screen<LetterDesignPicker> { entry ->
        val route = entry.toRoute<LetterDesignPicker>()
        val owner = remember(entry) { nav.getBackStackEntry<Letter>().also { check(it.toRoute<Letter>().letterId == route.letterId) } }
        val vm: LetterViewModel = viewModel(viewModelStoreOwner = owner) { error("Letter editor must own its draft") }
        val state by vm.state.collectAsStateWithLifecycle()
        val dismiss = { nav.popBackStack(); Unit }
        if (state.letter?.designLinked == true && route.picker in setOf("type", "page", "color")) {
            LetterPickerScreen(stringResource(R.string.match_resume), dismiss) {
                RrSwitchRow(stringResource(R.string.match_resume), true, { vm.designLinked(false) {} }, subtitle = stringResource(CoreR.string.the_letter_keeps_a_design_of_its_own), enabled = state.editable)
            }
        } else when (route.picker) {
            "type" -> LetterTypeSheet(state, { vm.design(it) }, { vm.font(it) }, dismiss)
            "page" -> LetterPageSheet(state, { vm.design(it) }, dismiss)
            "color" -> LetterColorSheet(state, { vm.color(it) }, dismiss)
            else -> LetterDesignPickerScreen(state, route.picker, vm, dismiss)
        }
    }

    screen<Letter> { entry ->
        val route = entry.toRoute<Letter>(); val repositories = LocalRepositories.current
        val versionId = route.versionId
        if (versionId != null) {
            val vm: LetterSnapshotViewModel = viewModel { LetterSnapshotViewModel(repositories, route.letterId, versionId) }
            val state by vm.state.collectAsStateWithLifecycle()
            LetterScreen(state, LetterMode.Write, false, { action -> when (action) {
                "retry" -> vm.retry()
                "current" -> nav.navigate(Letter(route.letterId))
            } }, {}, {}, { nav.popBackStack() })
            return@screen
        }
        val context = LocalContext.current
        val session by repositories.authSession.state.collectAsStateWithLifecycle()
        val account = session as? SessionState.SignedIn
        val recovery = remember(entry, account) { account?.let { LetterDraftRecovery(context.applicationContext, it.server + ":" + it.accountScope + ":" + route.letterId) } }
        val vm: LetterViewModel = viewModel { LetterViewModel(repositories, route.letterId, recovery) }; val state by vm.state.collectAsStateWithLifecycle()
        var mode by remember { mutableStateOf(route.mode) }; var details by remember { mutableStateOf(false) }; var form by remember { mutableStateOf<String?>(null) }
        val haptics = rememberRrHaptics()
        val scope = rememberCoroutineScope(); val toasts = LocalToasts.current; val resources = androidx.compose.ui.platform.LocalResources.current
        val back = { vm.leave { nav.popBackStack() }; Unit }
        BackHandler(onBack = back)
        Box {
            // The body editor is full screen; the letter screen under it leaves composition (and TalkBack) meanwhile.
            if (form != "body") LetterScreen(state, mode, details, { action -> when (action) {
                "focus" -> vm.focus(true)
                "blur" -> vm.focus(false)
                "preview" -> nav.navigate(PagePreview(route.letterId, DocumentKind.Letter))
                "more" -> nav.navigate(BuilderMore(route.letterId, DocumentKind.Letter))
                "template", "type", "color", "page", "language", "letterhead", "signature" -> nav.navigate(LetterDesignPicker(route.letterId, action))
                "undo" -> vm.undo()
                "draft" -> vm.generate()
                "generate" -> vm.generate()
                "retry-draft" -> vm.retryDraft()
                "shorter" -> vm.generate(CreateCoverLetterDraftRequestVariant.Shorter)
                "personal" -> vm.generate(CreateCoverLetterDraftRequestVariant.Personal)
                "stop-draft" -> vm.stopDraft()
                "keep-draft" -> vm.keepDraft()
                "discard-draft" -> vm.discardDraft()
                "copy-draft" -> vm.draftCopy { nav.navigate(Letter(it)) }
                "recovery" -> state.draft.recoveredCopyId?.let { nav.navigate(Letter(it)) }
                "retry" -> vm.retry()
                "write" -> mode = LetterMode.Write
                "design" -> mode = LetterMode.Design
                "export" -> nav.navigate(Download(route.letterId, DocumentKind.Letter))
                "details" -> { details = true; haptics(RrHaptic.Light) }
                "hide-details" -> details = false
                "resume-design" -> state.letter?.sourceResumeId?.let { nav.navigate(Builder(it, mode = BuilderMode.Design)) }
                "assistant" -> vm.assistant(null) { thread -> nav.navigate(Assistant(state.letter?.sourceResumeId.orEmpty(), thread)) }
                else -> if (action.startsWith("assistant:")) {
                    vm.assistant(null) { thread -> nav.navigate(Assistant(state.letter?.sourceResumeId.orEmpty(), thread, prompt = action.removePrefix("assistant:"))) }
                } else if (action.startsWith("draft-version:")) vm.previousDraft(action.removePrefix("draft-version:").toInt()) else { form = action; if (action in listOf("recipient", "body")) vm.focus(true) }
            } }, { linked -> vm.designLinked(linked) { haptics(RrHaptic.Success) } }, { vm.pageFormat(it) }, back, { value -> vm.edit({ it.copy(content = value) }) })
            val dismiss = { form = null; vm.focus(false); Unit }
            val menuAction: (String) -> Unit = { action -> when (action) {
                    "versions" -> { dismiss(); nav.navigate(LetterHistory(route.letterId)) }
                    "lock" -> vm.lock(dismiss)
                    "duplicate" -> vm.duplicate { nav.navigate(Letter(it)); dismiss() }
                    "export" -> { dismiss(); nav.navigate(Download(route.letterId, DocumentKind.Letter)) }
                    "trash" -> vm.trash { scope.launch {
                        if (toasts.show(resources.getString(CoreR.string.moved_to_trash), resources.getString(CoreR.string.reconsider_a_rejected_edit_undo)) == RrToastResult.ActionPerformed) vm.untrash() else nav.popBackStack()
                    } }
                    else -> form = action
                } }
            val menuResult by entry.savedStateHandle.getStateFlow<String?>("letter-menu-action", null).collectAsStateWithLifecycle()
            LaunchedEffect(menuResult) { menuResult?.let { menuAction(it); entry.savedStateHandle["letter-menu-action"] = null } }
            when (form) {
                "copy-job" -> RrBottomSheet(dismiss, title = stringResource(CoreR.string.copy_for_a_job), initialDetent = 1) { state.applications.forEach { app -> RrListRow(app.company, subtitle = app.role, onClick = { vm.copyForJob(app.id) { nav.navigate(Letter(it)); dismiss() } }, enabled = state.editable) } }
                "translate" -> RrBottomSheet(dismiss, title = stringResource(CoreR.string.translate_into), initialDetent = 1) { java.util.Locale.getAvailableLocales().filter { it.toLanguageTag() != "und" }.distinctBy { it.toLanguageTag() }.sortedBy { it.displayName }.forEach { locale -> RrListRow(locale.displayName, onClick = { vm.translateCopy(locale.toLanguageTag()) { copy, thread -> nav.navigate(Letter(copy)); nav.navigate(Assistant(state.letter?.sourceResumeId.orEmpty(), thread, prompt = "Translate this letter into " + locale.displayName + ". Propose the translation for review; keep facts and meaning.")); dismiss() } }) } }
                "rename" -> LetterTextSheet(stringResource(CoreR.string.rename), state.letter?.name.orEmpty(), state, { text -> vm.metadata({ PatchCoverLetterRequest(expectedRevision = it.revision, name = text) }, dismiss) }, dismiss)
                "recipient" -> RecipientSheet(state, { recipient, date, greeting, signoff -> vm.edit({ it.copy(recipient = recipient, letterDate = date.ifBlank { null }, greeting = greeting, signOff = signoff) }, dismiss) }, dismiss)
                "greeting", "signoff" -> RecipientSheet(state, { recipient, date, greeting, signoff -> vm.edit({ it.copy(recipient = recipient, letterDate = date.ifBlank { null }, greeting = greeting, signOff = signoff) }, dismiss) }, dismiss)
                "body" -> LetterBodyEditor(state, { content -> vm.edit({ it.copy(content = content) }, dismiss) }, dismiss)
                "resume" -> RrBottomSheet(dismiss, title = stringResource(CoreR.string.resume), initialDetent = 1) { state.resumes.forEach { resume -> RrListRow(resume.name, onClick = { vm.linkResume(resume.id, dismiss) }) }; RrListRow(stringResource(CoreR.string.entry_header_accent_none), onClick = { vm.edit({ it.copy(sourceResumeId = null, designLinked = false) }, dismiss) }) }
                "application" -> RrBottomSheet(dismiss, title = stringResource(CoreR.string.application), initialDetent = 1) { state.applications.forEach { app -> RrListRow(app.company, subtitle = app.role, onClick = { vm.linkApplication(app.id, dismiss) }) }; RrListRow(stringResource(CoreR.string.entry_header_accent_none), onClick = { vm.linkApplication(null, dismiss) }) }

            }
        }
    }
}
/** Shared document-menu entry point using the letter editor's draft owner. */
@Composable fun LetterMoreRoute(letterId: String, nav: NavController, entry: NavBackStackEntry) {
    val owner = remember(entry, letterId) { nav.getBackStackEntry<Letter>().also { check(it.toRoute<Letter>().letterId == letterId) } }
    val vm: LetterViewModel = viewModel(viewModelStoreOwner = owner) { error("Letter editor must own its draft") }
    val state by vm.state.collectAsStateWithLifecycle()
    LetterMoreMenu(state, { nav.popBackStack() }) { action ->
        owner.savedStateHandle["letter-menu-action"] = action
        nav.popBackStack()
    }
}

@Composable internal fun LetterTextSheet(title: String, initial: String, state: LetterState, save: (String) -> Unit, dismiss: () -> Unit) {
    var text by remember(initial) { mutableStateOf(initial) }
    RrBottomSheet(dismiss, title = title, confirmDiscard = text != initial, footer = { RrButton(stringResource(CoreR.string.save), { save(text) }, Modifier.fillMaxWidth().padding(16.dp), loading = state.busy, enabled = text.isNotBlank() && !state.busy) }) { RrTextField(text, { text = it }, Modifier.padding(16.dp), label = title); if (state.failed) RrCallout(stringResource(CoreR.string.couldn_t_save_your_wording_your_text_is_still_here_try_again), tone = RrTone.Danger) }
}
@Composable private fun RecipientSheet(state: LetterState, save: (String, String, String, String) -> Unit, dismiss: () -> Unit) {
    val letter = state.letter ?: return
    var recipient by remember { mutableStateOf(letter.recipient) }; var date by remember { mutableStateOf(letter.letterDate.orEmpty()) }; var greeting by remember { mutableStateOf(letter.greeting.orEmpty()) }; var signoff by remember { mutableStateOf(letter.signOff.orEmpty()) }
    RrBottomSheet(dismiss, title = stringResource(R.string.p4_letter_details), initialDetent = 1, confirmDiscard = recipient != letter.recipient || date != letter.letterDate.orEmpty() || greeting != letter.greeting.orEmpty() || signoff != letter.signOff.orEmpty(), footer = { RrButton(stringResource(CoreR.string.save), { save(recipient, date, greeting, signoff) }, Modifier.fillMaxWidth().padding(16.dp), loading = state.busy, enabled = state.editable) }) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { RrTextField(recipient, { recipient = it }, label = stringResource(CoreR.string.recipient)); RrTextField(date, { date = it }, label = stringResource(CoreR.string.date)); RrTextField(greeting, { greeting = it }, label = stringResource(CoreR.string.greeting)); RrTextField(signoff, { signoff = it }, label = stringResource(CoreR.string.sign_off)); if (state.failed) RrCallout(stringResource(CoreR.string.couldn_t_save_your_wording_your_text_is_still_here_try_again), tone = RrTone.Danger) }
    }
}
/**
 * L1 body: the full-screen rich-text editor (B4 pattern), shared with the builder. Bold, italic, lists and links write
 * the HTML the web's editor stores; lines left alone keep their exact markup. A body the editor can't hold without loss
 * (quotes, tables, nested lists) stays read-only. Leaving with unsaved words asks first; a failed save keeps them here.
 */
@Composable internal fun LetterBodyEditor(state: LetterState, save: (String) -> Unit, dismiss: () -> Unit) {
    val letter = state.letter ?: return
    val c = RrTheme.colors
    val editable = remember(letter.content) { RrRichDoc.editable(letter.content) }
    val baseline = remember(letter.id) { RrRichDoc.parse(letter.content).toHtml() }
    var rich by remember(letter.id) { mutableStateOf(RrRichDoc.parse(letter.content)) }
    var value by remember(letter.id) { mutableStateOf(TextFieldValue(rich.text)) }
    var askDiscard by remember { mutableStateOf(false) }
    val dirty = editable && rich.toHtml() != baseline
    val close = { if (dirty) askDiscard = true else dismiss() }
    BackHandler(onBack = close)
    Column(Modifier.fillMaxSize().background(c.bg)) {
        RrTopBar(stringResource(R.string.p4_letter_content), onBack = close) {
            if (editable) RrButton(stringResource(CoreR.string.save), { save(rich.toHtml()) }, Modifier.padding(end = 10.dp), RrButtonVariant.Secondary, loading = state.busy, enabled = state.editable && !state.busy)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            if (state.failed) RrCallout(stringResource(CoreR.string.couldn_t_save_your_wording_your_text_is_still_here_try_again), Modifier.padding(16.dp), tone = RrTone.Danger)
            if (editable) RrRichTextField(value, rich, { next, doc -> rich = doc; value = next }, Modifier.fillMaxWidth().padding(16.dp), readOnly = !state.editable)
            else {
                RrText(android.text.Html.fromHtml(letter.content, android.text.Html.FROM_HTML_MODE_LEGACY).toString(), Modifier.padding(16.dp), style = RrType.body)
                RrCallout(stringResource(R.string.p4_rich_text_editing_is_not_available_on_this_device_yet_your_formatting_is_kept), Modifier.padding(16.dp))
            }
        }
        if (editable) RrRichTextToolbar(rich, value.selection, { rich = it }, Modifier.fillMaxWidth().background(c.surface).imePadding().navigationBarsPadding().padding(horizontal = 6.dp, vertical = 6.dp), enabled = state.editable)
    }
    if (askDiscard) RrAlertDialog(stringResource(DsR.string.ds_discard_changes_title), stringResource(DsR.string.ds_discard_changes_body), stringResource(DsR.string.ds_discard),
        onConfirm = { askDiscard = false; dismiss() }, onDismissRequest = { askDiscard = false }, dismissLabel = stringResource(DsR.string.ds_keep_editing), confirm = RrDialogConfirm.Danger)
}
