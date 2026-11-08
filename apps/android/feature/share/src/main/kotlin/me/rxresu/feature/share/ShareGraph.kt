package me.rxresu.feature.share

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.core.net.toUri
import kotlinx.serialization.Serializable
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.activity.compose.BackHandler
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.*
import kotlinx.coroutines.*
import me.rxresu.core.data.*
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as DsR
import me.rxresu.core.strings.R as CoreR
import me.rxresu.core.navigation.*
import me.rxresu.core.network.generated.*

fun NavGraphBuilder.shareGraph(nav: NavController, motion: RrNavMotion) {
    modal<PagePreview>(motion) { entry -> PagePreviewRoute(entry.toRoute<PagePreview>(), nav) }
    screen<WebPageSettings> { entry ->
        val route = entry.toRoute<WebPageSettings>(); val vm = shareModel(route.resumeId); val state by vm.state.collectAsStateWithLifecycle()
        var form by remember { mutableStateOf<String?>(null) }
        val resources = androidx.compose.ui.platform.LocalResources.current; val context = LocalContext.current; val accent = RrTheme.colors.accent.toArgb()
        Box {
            WebPageScreen(state, { nav.popBackStack() }, { CustomTabsIntent.Builder().setDefaultColorSchemeParams(androidx.browser.customtabs.CustomTabColorSchemeParams.Builder().setToolbarColor(accent).build()).build().launchUrl(context, state.url.toUri()) }, vm::slug,
                { setting, value -> when (setting) {
                    "primary" -> if (value) form = "primary" else vm.write({ UpdateResumeRequest(isPrimary = false) })
                    "credit" -> vm.credit(value)
                    else -> vm.write({ when (setting) { "contact" -> UpdateResumeRequest(hideContactDetails = value); "search" -> UpdateResumeRequest(showInSearchEngines = value); "pdf" -> UpdateResumeRequest(showDownloadButtons = value); else -> UpdateResumeRequest(allowWordDownload = value) } })
                } }, { nav.navigate(ResumeDomainSettings(route.resumeId)) }, { form = if (state.resume?.hasPassword == true) "remove-password" else "password" }, { vm.retry() })
            when (form) {
                "primary" -> ConfirmSheet(stringResource(CoreR.string.make_this_your_primary_resume), state.otherPrimary?.let { stringResource(CoreR.string.message_0_stops_being_your_primary_resume, it.name) } ?: stringResource(R.string.p4_your_short_link_will_open_this_resume), stringResource(CoreR.string.make_primary), { vm.write({ UpdateResumeRequest(isPrimary = true) }) { form = null } }, { form = null })
                "password" -> PasswordScreen(state, { value -> vm.password(value) { form = null } }, { form = null })
                "remove-password" -> ConfirmSheet(stringResource(CoreR.string.remove_the_password), stringResource(CoreR.string.anyone_with_the_link_will_be_able_to_view_your_resume), stringResource(CoreR.string.remove_password), { vm.password(null) { form = null } }, { form = null })
            }
        }
    }
    screen<ResumeDomainSettings> { entry ->
        val vm = shareModel(entry.toRoute<ResumeDomainSettings>().resumeId); val state by vm.state.collectAsStateWithLifecycle()
        DomainScreen(state, vm, { nav.popBackStack() })
    }
    screen<Visitors> { entry ->
        val vm = shareModel(entry.toRoute<Visitors>().resumeId); val state by vm.state.collectAsStateWithLifecycle()
        var create by remember { mutableStateOf(false) }
        val refresh by entry.savedStateHandle.getStateFlow("feedback-refresh", false).collectAsStateWithLifecycle()
        LaunchedEffect(refresh) { if (refresh) { vm.retry(); entry.savedStateHandle["feedback-refresh"] = false } }
        val resources = androidx.compose.ui.platform.LocalResources.current; val context = LocalContext.current
        Box {
            VisitorsScreen(state, { nav.popBackStack() }, { create = true }, { nav.navigate(ResumeFeedbackDetail(entry.toRoute<Visitors>().resumeId, it)) }, { vm.retry() })
            if (create) FeedbackForm(state, { label, comments, days, apps -> vm.feedback(label, comments, days, apps) { url -> create = false; shareLink(context, url, resources.getString(CoreR.string.share)) } }, { create = false })
        }
    }
    screen<ResumeFeedbackDetail> { entry ->
        val route = entry.toRoute<ResumeFeedbackDetail>(); val vm = shareModel(route.resumeId); val state by vm.state.collectAsStateWithLifecycle()
        val context = LocalContext.current; val resources = androidx.compose.ui.platform.LocalResources.current; val scope = rememberCoroutineScope(); val toasts = LocalToasts.current; val haptics = rememberRrHaptics()
        var revoke by remember { mutableStateOf(false) }
        LaunchedEffect(route.linkId) { vm.link(route.linkId) }
        Box {
            Column(Modifier.fillMaxSize().background(RrTheme.colors.bg)) {
                RrTopBar(state.link?.label ?: stringResource(CoreR.string.feedback_links), onBack = { nav.popBackStack() })
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).navigationBarsPadding()) {
                    val link = state.link
                    if (link == null) { if (state.failed) Failure { vm.link(route.linkId) } else RrSkeletonText(Modifier.padding(16.dp), lines = 6) }
                    else {
                        RrSectionHeader(stringResource(CoreR.string.comments))
                        link.comments.sortedByDescending { it.createdAt }.forEach { comment ->
                            RrListRow(comment.authorName, subtitle = comment.body)
                            RrSwitchRow(stringResource(R.string.p4_resolved), comment.resolvedAt != null, { vm.resolveComment(comment.id, it) }, enabled = !state.busy)
                        }
                        if (state.failed) Failure { vm.link(route.linkId) }
                        RrSectionHeader(stringResource(CoreR.string.activity))
                        link.events.sortedByDescending { it.createdAt }.forEach { event -> RrListRow(event.type.wireValue, subtitle = event.createdAt) }
                        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            RrButton(stringResource(R.string.p4_copy_link), { copy(context, link.url); haptics(RrHaptic.Success); scope.launch { toasts.show(resources.getString(CoreR.string.link_copied)) } }, variant = RrButtonVariant.Secondary)
                            RrButton(stringResource(CoreR.string.turn_off_link), { revoke = true }, variant = RrButtonVariant.DangerGhost, enabled = link.revokedAt == null && !state.busy)
                        }
                    }
                }
            }
            if (revoke) ConfirmSheet(stringResource(CoreR.string.turn_off_this_link), stringResource(R.string.p4_it_stops_opening_at_once_comments_already_left_are_kept), stringResource(R.string.p4_turn_off_link_68), { vm.revoke(route.linkId) { nav.previousBackStackEntry?.savedStateHandle?.set("feedback-refresh", true); nav.popBackStack() } }, { revoke = false })
        }
    }
    sheet<Download> { entry -> DownloadRoute(entry.toRoute<Download>(), { nav.popBackStack() }) }
    screen<Versions> { entry ->
        val vm = shareModel(entry.toRoute<Versions>().resumeId); val state by vm.state.collectAsStateWithLifecycle()
        var selected by remember { mutableStateOf<String?>(null) }; var naming by remember { mutableStateOf(false) }; var rename by remember { mutableStateOf<String?>(null) }; var deleting by remember { mutableStateOf<String?>(null) }; var restoring by remember { mutableStateOf<String?>(null) }
        val restoreResult by entry.savedStateHandle.getStateFlow<String?>("preview-restore-version", null).collectAsStateWithLifecycle()
        LaunchedEffect(restoreResult) { restoreResult?.let { restoring = it; entry.savedStateHandle["preview-restore-version"] = null } }
        Box {
            VersionsScreen(state, selected, { version -> selected = version; if (version != null) nav.navigate(PagePreview(entry.toRoute<Versions>().resumeId, versionId = version)) }, { nav.popBackStack() }, { rename = it; naming = true }, { restoring = it }, { deleting = it })
            if (naming) TextSheet(stringResource(CoreR.string.name_this_version), "", stringResource(CoreR.string.save), state.busy, state.failed, { value -> vm.nameVersion(value, rename) { naming = false } }, { naming = false })
            deleting?.let { version -> RrAlertDialog(stringResource(R.string.p4_delete_version), stringResource(CoreR.string.named_versions_are_kept_until_you_delete_them_this_can_t_be_undone), stringResource(CoreR.string.delete), { vm.deleteVersion(version) { deleting = null; if (selected == version) selected = null } }, { deleting = null }, confirm = RrDialogConfirm.HoldToDelete) }
            restoring?.let { version -> ConfirmSheet(stringResource(CoreR.string.restore_this_version_2cef126bc0), stringResource(R.string.p4_your_current_resume_will_be_kept_as_a_version_before_restoring), stringResource(CoreR.string.restore_this_version), { vm.restore(version) { restoring = null; selected = null } }, { restoring = null }) }
        }
    }
    sheet<BuilderMore> { entry -> ResumeMoreRoute(entry.toRoute<BuilderMore>().resumeId, nav) }
}

@Composable internal fun shareModel(id: String): ShareViewModel { val repositories = LocalRepositories.current; return viewModel(key = "share-$id") { ShareViewModel(repositories, id) } }

@Composable fun ResumeMoreRoute(id: String, nav: NavController) {
    val repositories = LocalRepositories.current; val vm = shareModel(id); val state by vm.state.collectAsStateWithLifecycle()
    var form by remember { mutableStateOf<String?>(null) }; val resources = androidx.compose.ui.platform.LocalResources.current; val context = LocalContext.current; val scope = rememberCoroutineScope(); val toasts = LocalToasts.current
    val notesBaseline = remember(form) { state.resume?.data?.metadata?.notes.orEmpty() }
    Box {
        if (form != "notes") RrBottomSheet({ nav.popBackStack() }, fixedHeight = 790.dp, title = state.resume?.name) {
            MoreContent(state) { action -> when (action) {
                "lock" -> vm.lock {}
                "rename", "notes", "tags", "translate", "job" -> form = action
                "duplicate" -> vm.duplicate { nav.navigate(Builder(it)) }
                "print" -> scope.launch { try { val draft = repositories.resumes.openDraft(id); draft.flush(); check(draft.state.value.status == me.rxresu.core.database.SaveStatus.Saved); val value = requireNotNull(draft.state.value.document); val pdf = repositories.pages.render(me.rxresu.core.page.PageSource.Resume(id, value.updatedAt)); printPdf(context, pdf.file, value.name, pdf.pageCount) } catch (e: CancellationException) { throw e } catch (_: Exception) { toasts.show(resources.getString(CoreR.string.download_failed_try_again), tone = RrToastTone.Danger) } }
                "trash" -> vm.trash { scope.launch { if (toasts.show(resources.getString(CoreR.string.moved_to_trash), resources.getString(CoreR.string.reconsider_a_rejected_edit_undo)) == RrToastResult.ActionPerformed) vm.untrash() else nav.popBackStack() } }
                "retry" -> vm.retry()
            } }
        }
        when (form) {
            "rename" -> TextSheet(stringResource(CoreR.string.rename), state.resume?.name.orEmpty(), stringResource(CoreR.string.save), state.busy, state.failed, { value -> vm.write({ UpdateResumeRequest(name = value) }) { form = null } }, { form = null })
            "tags" -> TextSheet(stringResource(CoreR.string.tags), state.resume?.tags?.joinToString(", ").orEmpty(), stringResource(CoreR.string.save), state.busy, state.failed, { value -> vm.write({ UpdateResumeRequest(tags = value.split(',').map { it.trim() }.filter { it.isNotEmpty() }) }) { form = null } }, { form = null })
            "notes" -> PrivateNotesScreen(notesBaseline, state.busy, state.failed, { value -> vm.notes(value, notesBaseline) { form = null } }, { form = null })
            "translate" -> LanguageCopySheet(state, { locale -> vm.languageCopy(locale) { copy, prompt ->
                nav.navigate(Builder(copy))
                nav.navigate(Assistant(copy, prompt = prompt))
                form = null
            } }, { form = null })
            "job" -> RrBottomSheet({ form = null }, title = stringResource(CoreR.string.copy_for_a_job), initialDetent = 1) {
                state.applications.forEach { app -> RrListRow(app.company, subtitle = app.role, onClick = { scope.launch { try { val draft = repositories.resumes.openDraft(id); draft.flush(); check(draft.state.value.status == me.rxresu.core.database.SaveStatus.Saved); val copy = repositories.documents.copyResumeForJob(CopyResumeForJobRequest(applicationId = app.id, resumeId = id)); nav.navigate(Builder(copy)); form = null } catch (e: CancellationException) { throw e } catch (_: Exception) { toasts.show(resources.getString(CoreR.string.couldn_t_save_your_changes_try_again_before_continuing), tone = RrToastTone.Danger) } } }) }
            }
        }
    }
}

@Composable internal fun TextSheet(title: String, initial: String, label: String, busy: Boolean, failed: Boolean, save: (String) -> Unit, dismiss: () -> Unit, multiline: Boolean = false) {
    var text by remember(initial) { mutableStateOf(initial) }
    RrBottomSheet(dismiss, title = title, initialDetent = if (multiline) 1 else 0, confirmDiscard = text != initial, footer = {
        RrButton(label, { save(if (multiline) text else text.trim()) }, Modifier.fillMaxWidth().padding(16.dp), enabled = !busy && (multiline || text.isNotBlank()), loading = busy)
    }) {
        RrTextField(text, { text = it }, Modifier.padding(16.dp), label = title, singleLine = !multiline, minLines = if (multiline) 10 else 1)
        if (failed) Failure {}
    }
}
@Composable internal fun ConfirmSheet(title: String, message: String, label: String, confirm: () -> Unit, dismiss: () -> Unit) {
    RrBottomSheet(dismiss, title = title, fitContent = true, footer = { Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { RrButton(stringResource(CoreR.string.cancel), dismiss, variant = RrButtonVariant.Secondary); RrButton(label, confirm) } }) { RrText(message, Modifier.padding(horizontal = 16.dp), style = RrType.body) }
}
@Composable internal fun PasswordScreen(state: ShareState, save: (String) -> Unit, dismiss: () -> Unit) {
    var password by rememberSaveable { mutableStateOf("") }; var confirm by rememberSaveable { mutableStateOf("") }; var discard by remember { mutableStateOf(false) }
    val close = { if (password.isNotEmpty() || confirm.isNotEmpty()) discard = true else dismiss() }
    BackHandler(onBack = close)
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).imePadding()) {
        RrTopBar(onBack = close)
        RrPageTitle(stringResource(CoreR.string.set_password))
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            RrTextField(password, { password = it }, label = stringResource(CoreR.string.password), visualTransformation = PasswordVisualTransformation())
            RrTextField(confirm, { confirm = it }, label = stringResource(CoreR.string.confirm_password), visualTransformation = PasswordVisualTransformation())
            if (state.failed) Failure {}
        }
        RrFooterBar { RrButton(stringResource(CoreR.string.set_password), { save(password) }, Modifier.weight(1f), enabled = password.length >= 6 && password == confirm && !state.busy, loading = state.busy) }
    }
    if (discard) RrAlertDialog(stringResource(DsR.string.ds_discard_changes_title), stringResource(DsR.string.ds_discard_changes_body), stringResource(DsR.string.ds_discard), { discard = false; dismiss() }, { discard = false }, dismissLabel = stringResource(DsR.string.ds_keep_editing), confirm = RrDialogConfirm.Danger)
}

@Composable internal fun PrivateNotesScreen(initial: String, busy: Boolean, failed: Boolean, save: (String) -> Unit, dismiss: () -> Unit) {
    var text by rememberSaveable { mutableStateOf(initial) }; var discard by remember { mutableStateOf(false) }
    val close = { if (text != initial) discard = true else dismiss() }
    BackHandler(onBack = close)
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).imePadding()) {
        RrTopBar(onBack = close)
        RrPageTitle(stringResource(CoreR.string.notes), subtitle = stringResource(R.string.p4_only_you_can_see_these))
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(24.dp)) {
            RrTextField(text, { text = it }, label = stringResource(CoreR.string.notes), singleLine = false, minLines = 10)
            if (failed) RrCallout(stringResource(CoreR.string.couldn_t_save_your_wording_your_text_is_still_here_try_again), tone = RrTone.Danger)
        }
        RrFooterBar { RrButton(stringResource(CoreR.string.save), { save(text) }, Modifier.weight(1f), enabled = !busy, loading = busy) }
    }
    if (discard) RrAlertDialog(stringResource(DsR.string.ds_discard_changes_title), stringResource(DsR.string.ds_discard_changes_body), stringResource(DsR.string.ds_discard), { discard = false; dismiss() }, { discard = false }, dismissLabel = stringResource(DsR.string.ds_keep_editing), confirm = RrDialogConfirm.Danger)
}

@Composable private fun DomainScreen(state: ShareState, vm: ShareViewModel, dismiss: () -> Unit) {
    val resources = androidx.compose.ui.platform.LocalResources.current; val context = LocalContext.current
    val haptics = rememberRrHaptics(); val toasts = LocalToasts.current
    var previouslyVerified by remember { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(state.domain?.verified) { if (previouslyVerified == false && state.domain?.verified == true) { haptics(RrHaptic.Success); toasts.show(resources.getString(R.string.p4_domain_connected)) }; previouslyVerified = state.domain?.verified }
    var hostname by remember { mutableStateOf(state.domain?.hostname.orEmpty()) }; var remove by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg)) {
        RrTopBar(stringResource(CoreR.string.your_domain), onBack = dismiss)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).navigationBarsPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (!state.customDomains) { RrCallout(stringResource(R.string.p4_domains_unavailable), actionLabel = if (state.failed) stringResource(CoreR.string.try_again) else null, onAction = if (state.failed) ({ vm.retry() }) else null); return@Column }
            RrTextField(hostname, { hostname = it }, label = stringResource(R.string.p4_domain), mono = true, ltr = true)
            RrButton(stringResource(CoreR.string.connect), { vm.domain(hostname.trim()) }, enabled = hostname.isNotBlank() && !state.busy)
            if (state.olacvSuggestion && state.domain == null) {
                RrText(stringResource(R.string.p4_ola_disclosure), style = RrType.small)
                RrButton(stringResource(R.string.p4_register_ola), { CustomTabsIntent.Builder().build().launchUrl(context, ("https://ola.cv/?domain=" + android.net.Uri.encode(hostname.trim())).toUri()) }, variant = RrButtonVariant.Secondary, enabled = hostname.trim().endsWith(".cv", ignoreCase = true))
                RrButton(stringResource(R.string.p4_copy_code), { copy(context, "RX") }, variant = RrButtonVariant.Secondary)
            }
            state.domain?.let { domain ->
                RrText(if (domain.verified) stringResource(R.string.p4_connected) else stringResource(R.string.p4_add_these_dns_records_at_your_domain_provider))
                domain.records.forEach { record -> RrListRow(record.type.wireValue + " " + record.name, subtitle = record.value, onClick = { copy(context, record.value) }) }
                RrButton(stringResource(CoreR.string.check_dns), { vm.verifyDomain() }, variant = RrButtonVariant.Secondary, enabled = !state.busy)
                RrButton(stringResource(CoreR.string.remove_domain), { remove = true }, variant = RrButtonVariant.DangerGhost)
            }
            if (state.failed) Failure { vm.verifyDomain() }
        }
    }
    if (remove) ConfirmSheet(stringResource(R.string.p4_remove_domain_145), stringResource(R.string.p4_your_domain_will_stop_opening_your_resume), stringResource(CoreR.string.remove_domain), { vm.removeDomain(); remove = false }, { remove = false })
}
@Composable private fun FeedbackForm(state: ShareState, save: (String, Boolean, Int, List<String>) -> Unit, dismiss: () -> Unit) {
    var label by remember { mutableStateOf("") }; var comments by remember { mutableStateOf(true) }; var days by remember { mutableIntStateOf(30) }; var applications by remember { mutableStateOf(setOf<String>()) }
    RrBottomSheet(dismiss, title = stringResource(CoreR.string.new_feedback_link), initialDetent = 1, confirmDiscard = label.isNotEmpty(), footer = { RrButton(stringResource(CoreR.string.make_link), { save(label, comments, days, applications.toList()) }, Modifier.fillMaxWidth().padding(16.dp), enabled = label.isNotBlank() && !state.busy, loading = state.busy) }) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            RrTextField(label, { label = it }, label = stringResource(CoreR.string.who_is_it_for), helper = stringResource(R.string.p4_for_example_careers_office_only_you_see_this))
            RrSwitchRow(stringResource(CoreR.string.allow_comments), comments, { comments = it })
            RrText(stringResource(CoreR.string.link_expires), style = RrType.fieldLabel)
            RrSegmentedControl(listOf(RrSegment(stringResource(CoreR.string.never)), RrSegment(stringResource(CoreR.string.message_7_days)), RrSegment(stringResource(CoreR.string.message_30_days)), RrSegment(stringResource(CoreR.string.message_90_days))), listOf(0, 7, 30, 90).indexOf(days), { days = listOf(0, 7, 30, 90)[it] })
            RrText(stringResource(R.string.p4_share_application_progress), style = RrType.label)
            RrText(stringResource(R.string.p4_stages_and_dates_only), style = RrType.small)
            state.applications.forEach { app -> RrSwitchRow(app.company + " · " + app.role, app.id in applications, { checked -> applications = if (checked) applications + app.id else applications - app.id }) }
            if (state.failed) Failure {}
        }
    }
}
internal fun copy(context: Context, text: String) { (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("", text)) }

@Serializable private data class ResumeDomainSettings(val resumeId: String)

@Serializable private data class ResumeFeedbackDetail(val resumeId: String, val linkId: String)

@Composable private fun LanguageCopySheet(state: ShareState, create: (ImportResumeFileLocale) -> Unit, dismiss: () -> Unit) {
    var selected by remember { mutableStateOf<ImportResumeFileLocale?>(null) }
    RrBottomSheet(dismiss, title = stringResource(CoreR.string.translate_into), initialDetent = 1, footer = {
        RrButton(stringResource(R.string.p4_create_language_copy), { selected?.let(create) }, Modifier.fillMaxWidth().padding(16.dp), enabled = selected != null && !state.busy, loading = state.busy)
    }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
            RrText(stringResource(R.string.p4_language_copy_disclosure), style = RrType.small)
            ImportResumeFileLocale.entries.filter { it != ImportResumeFileLocale.Unknown && it.wireValue != state.resume?.data?.metadata?.page?.locale }.forEach { locale ->
                RrListRow(java.util.Locale.forLanguageTag(locale.wireValue).displayName, selected = selected == locale, enabled = !state.busy, onClick = { selected = locale })
            }
            if (state.failed) Failure {}
        }
    }
}
