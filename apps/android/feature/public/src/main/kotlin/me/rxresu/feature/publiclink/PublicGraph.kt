package me.rxresu.feature.publiclink

import androidx.compose.ui.res.stringResource
import me.rxresu.core.strings.R as CoreStrings

import android.content.Intent
import android.app.Application
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.toRoute
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.*
import me.rxresu.core.page.PageSource
import me.rxresu.core.page.RenderedDocument

/** Public screens can be opened without an account. */
fun NavGraphBuilder.publicGraph(nav: NavController, motion: RrNavMotion) {
    modal<PublicResume>(motion) { PublicRoute(nav, it.toRoute<PublicResume>().url) }
    screen<AtsChecker> { AtsRoute(nav, it.toRoute<AtsChecker>().fileUri) }
}

@Composable private fun PublicRoute(nav: NavController, url: String) {
    val repositories = LocalRepositories.current; val context = LocalContext.current; val resources = LocalResources.current
    val origin by repositories.authSession.origin.collectAsStateWithLifecycle()
    val session by repositories.account.session.collectAsStateWithLifecycle()
    val account = (session as? SessionState.SignedIn)?.accountScope.orEmpty()
    val vm = viewModel(key = "public:$url:$origin:$account") { PublicViewModel(repositories, url) }; val state by vm.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope(); val toasts = LocalToasts.current; val haptic = rememberRrHaptics()
    var comments by remember { mutableStateOf(false) }
    val saveFile = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        val file = state.document?.file
        if (uri != null && file != null) scope.launch {
            try { withContext(Dispatchers.IO) { requireNotNull(context.contentResolver.openOutputStream(uri)).use { out -> file.inputStream().use { it.copyTo(out) } } }; haptic(RrHaptic.Success) }
            catch (_: Exception) { toasts.show(resources.getString(R.string.public_couldn_t_save_try_again_292c60)) }
        }
    }
    PublicScreen(state, state.address?.url ?: url, repositories.pages, vm::password, vm::load, { nav.popBackStack() }, {
        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, state.address?.url ?: url), null))
    }, { saveFile.launch("resume.pdf") }, {
        state.address?.let { address -> CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(address.origin + "/api/resumes/" + Uri.encode(address.username) + "/" + Uri.encode(address.slug) + "/docx")) }
    }, { state.resume?.let { nav.navigate(Builder(it.id)) } }, { CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(state.address?.url ?: url)) }, { comments = true })
    if (comments) FeedbackSheet(state, { comments = false }) { name, comment, done -> vm.comment(name, comment) { done(); haptic(RrHaptic.Success); scope.launch { toasts.show(resources.getString(R.string.public_comment_sent_to_1_s_f3c2b2, state.feedback?.ownerName.orEmpty())) } } }
}

@Composable private fun AtsRoute(nav: NavController, fileUri: String?) {
    val context = LocalContext.current; val resources = LocalResources.current; val repositories = LocalRepositories.current
    val origin by repositories.authSession.origin.collectAsStateWithLifecycle()
    val vm = viewModel(key = "ats:$origin") { AtsViewModel(context.applicationContext as Application, repositories) }; val state by vm.state.collectAsStateWithLifecycle()
    val haptic = rememberRrHaptics(); val scope = rememberCoroutineScope(); val toasts = LocalToasts.current
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { runCatching { context.contentResolver.takePersistableUriPermission(it, Intent.FLAG_GRANT_READ_URI_PERMISSION) }; vm.choose(it.toString()) }
    }
    LaunchedEffect(fileUri) { fileUri?.let(vm::choose) }
    LaunchedEffect(state.result, state.problem) {
        if ((state.result?.score ?: 0.0) >= 80) haptic(RrHaptic.Success)
        if (state.problem == PdfProblem.Unreadable || state.problem == PdfProblem.Password) haptic(RrHaptic.Error)
    }
    var document by remember(state.selected) { mutableStateOf<RenderedDocument?>(null) }
    LaunchedEffect(state.selected) { state.selected?.let { selected -> withContext(Dispatchers.IO) {
        runCatching { ParcelFileDescriptor.open(selected.file, ParcelFileDescriptor.MODE_READ_ONLY).use { fd -> PdfRenderer(fd).use { it.pageCount } } }.getOrNull()
    }?.let { count ->
        // shortcut: PageSource has no local-file variant; this URL is metadata only until core adds one.
        document = RenderedDocument(PageSource.Public("https://example.invalid/sample/pdf"), selected.file, count) } } }
    val openImport: (String?) -> Unit = { uri ->
        val route = Import(uri)
        if (repositories.account.session.value !is SessionState.SignedIn) { nav.currentBackStackEntry?.savedStateHandle?.set("ats-import", uri.orEmpty()); nav.navigate(SignIn()) }
        else nav.navigate(route)
    }
    AtsScreen(state, repositories.pages, document, { nav.popBackStack() }, { picker.launch(arrayOf("application/pdf")) }, {
        scope.launch {
            try {
                val file = withContext(Dispatchers.IO) { File(File(context.cacheDir, "public-samples").apply { mkdirs() }, "sample-resume.pdf").apply { context.assets.open("sample-resume.pdf").use { input -> outputStream().use { input.copyTo(it) } } } }
                val uri = FileProvider.getUriForFile(context, context.packageName + ".public-files", file)
                vm.choose(uri.toString())
            } catch (_: Exception) { toasts.show(resources.getString(R.string.public_this_file_could_not_be_read_try_another_pdf_148f35)) }
        }
    }, vm::posting, vm::check, { openImport(state.selected?.uri) }, { nav.navigate(NewDocument()) }, {
        CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(repositories.authSession.origin.value + "/ats-checker"))
    }, { openImport(null) })
}

/** Separate manifest key so other features can own their own FileProvider roots. */
class PublicFilesProvider : FileProvider()
