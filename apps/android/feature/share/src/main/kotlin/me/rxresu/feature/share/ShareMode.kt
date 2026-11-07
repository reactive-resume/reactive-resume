package me.rxresu.feature.share

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import kotlinx.coroutines.launch
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.designsystem.*
import me.rxresu.core.strings.R as CoreR
import me.rxresu.core.navigation.*
import me.rxresu.core.network.generated.UpdateResumeRequest

/** Content only: builder owns top bar, mode bar, and draft close. */
@Composable fun BuilderShareMode(resumeId: String, nav: NavController) {
    val vm = shareModel(resumeId); val state by vm.state.collectAsStateWithLifecycle()
    val repositories = LocalRepositories.current
    val exporter: ExportViewModel = viewModel(key = "share-export-$resumeId") { ExportViewModel(repositories, resumeId, DocumentKind.Resume) }
    val export by exporter.state.collectAsStateWithLifecycle()
    val resources = androidx.compose.ui.platform.LocalResources.current; val context = LocalContext.current; val scope = rememberCoroutineScope(); val toasts = LocalToasts.current; val haptics = rememberRrHaptics()
    var publish by remember { mutableStateOf(false) }; var qr by remember { mutableStateOf(false) }
    LaunchedEffect(exporter) { exporter.deliveries.collect { delivery -> try { shareFiles(context, delivery.files, resources.getString(CoreR.string.share_pdf)) } catch (_: Exception) { toasts.show(resources.getString(CoreR.string.download_failed_try_again), tone = RrToastTone.Danger) } } }
    Box {
        ShareContent(state) { action -> when (action) {
            ShareAction.Pdf -> exporter.export(false)
            ShareAction.Formats -> nav.navigate(Download(resumeId, DocumentKind.Resume))
            ShareAction.Web -> nav.navigate(WebPageSettings(resumeId))
            ShareAction.Visitors -> nav.navigate(Visitors(resumeId))
            ShareAction.Versions -> nav.navigate(Versions(resumeId))
            ShareAction.Copy, ShareAction.ShortLink -> { copy(context, if (action == ShareAction.Copy) state.url else state.shortUrl); haptics(RrHaptic.Success); scope.launch { toasts.show(resources.getString(CoreR.string.link_copied)) } }
            ShareAction.Qr -> qr = true
            ShareAction.Publish -> if (state.resume?.isPublic == true) vm.write({ UpdateResumeRequest(isPublic = false) }) { scope.launch { if (toasts.show(resources.getString(R.string.p4_link_turned_off_the_address_is_kept), resources.getString(CoreR.string.reconsider_a_rejected_edit_undo)) == RrToastResult.ActionPerformed) vm.write({ UpdateResumeRequest(isPublic = true) }) } } else publish = true
        } }
        if (publish) RrBottomSheet({ publish = false }, title = stringResource(CoreR.string.public_link), footer = {
            RrButton(stringResource(R.string.p4_publish), { vm.write({ UpdateResumeRequest(isPublic = true) }) { publish = false; haptics(RrHaptic.Success); scope.launch { toasts.show(resources.getString(R.string.p4_your_web_page_is_live)) } } }, androidx.compose.ui.Modifier.fillMaxWidth().padding(16.dp), enabled = !state.busy && !state.checking && validSlug(state.slug) && state.slug == state.resume?.slug && state.username.isNotBlank())
        }) {
            RrTextField(state.slug, vm::slug, androidx.compose.ui.Modifier.padding(16.dp), label = stringResource(CoreR.string.address), helper = state.url, mono = true, ltr = true, error = if (state.slugTaken || state.slugInvalid) stringResource(CoreR.string.use_latin_letters_az_numbers_and_single_dashes) else null)
        }
        if (qr) QrSheet(state.url) { qr = false }
        if (export.busy) RrWorkingLabel(listOf(stringResource(CoreR.string.preparing)))
        if (export.failed) RrCallout(stringResource(CoreR.string.download_failed_try_again), tone = RrTone.Danger, actionLabel = stringResource(CoreR.string.try_again), onAction = { exporter.export(false) })
    }
}
