package me.rxresu.feature.assistant

import androidx.navigation.NavDestination.Companion.hasRoute
import android.provider.OpenableColumns
import androidx.core.net.toUri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.*
import kotlinx.coroutines.*
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.designsystem.*
import me.rxresu.core.strings.R as CoreR
import me.rxresu.core.navigation.*

fun NavGraphBuilder.assistantGraph(nav: NavController, motion: RrNavMotion) {
    modal<Assistant>(motion) { entry ->
        val route = entry.toRoute<Assistant>(); val repositories = LocalRepositories.current
        val owner = remember(entry) { assistantOwner(nav, entry) }
        val vm: AssistantViewModel = viewModel(viewModelStoreOwner = owner, key = "assistant-${route.resumeId}") { AssistantViewModel(repositories, route.resumeId, route.threadId) }; val state by vm.state.collectAsStateWithLifecycle()
        LaunchedEffect(vm, route.threadId, route.prompt) {
            route.threadId?.let { if (it != vm.state.value.threadId) vm.thread(it) }
            route.prompt?.let(vm::input)
        }
        // Back from connection setup (S6) or anywhere else: the picker and Send see the new connection, the draft stays.
        androidx.lifecycle.compose.LifecycleEventEffect(androidx.lifecycle.Lifecycle.Event.ON_RESUME) { vm.refreshProviders() }
        val resources = androidx.compose.ui.platform.LocalResources.current; val context = LocalContext.current; val scope = rememberCoroutineScope(); val toasts = LocalToasts.current
        var picker by remember { mutableStateOf<String?>(null) }
        val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) scope.launch {
            try {
                val file = withContext(Dispatchers.IO) {
                    val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                        check(cursor.moveToFirst()); val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE); if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) check(cursor.getLong(sizeIndex) <= 25L * 1024 * 1024)
                        cursor.getString(cursor.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME))
                    } ?: "Attachment"
                    val bytes = requireNotNull(context.contentResolver.openInputStream(uri)).use { readAttachment(it) }; check(bytes.size <= 25 * 1024 * 1024)
                    Triple(name, context.contentResolver.getType(uri) ?: "application/octet-stream", bytes)
                }
                vm.attach(file.first, file.second, file.third)
            } catch (e: CancellationException) { throw e } catch (_: Exception) { toasts.show(resources.getString(R.string.p4_files_can_be_up_to_25_mb), tone = RrToastTone.Danger) }
        } }
        Box {
            AssistantScreen(state, { nav.popBackStack() }, vm::input, vm::send, { vm.stop() }, { doc, posting -> vm.context(doc, posting) }) { action -> when {
                action == "attach" -> launcher.launch(arrayOf("application/pdf", "text/plain", "image/*", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
                action == "providers" || action == "history" -> picker = action
                action == "setup" -> nav.navigate(AiProviderSheet())
                action == "proposals" -> state.threadId?.let { thread -> nav.navigate(AssistantProposals(route.resumeId, thread)) }
                action == "continue" -> vm.continueReply()
                action.startsWith("answer:") -> action.removePrefix("answer:").split(":", limit = 2).let { if (it.size == 2) vm.answer(it[0], it[1]) }
                action.startsWith("approve:") -> vm.approve(action.removePrefix("approve:"), true)
                action.startsWith("deny:") -> vm.approve(action.removePrefix("deny:"), false)
                action.startsWith("source:") -> runCatching { val uri = action.removePrefix("source:").toUri(); require(uri.scheme in setOf("https", "http") && !uri.host.isNullOrBlank()); context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, uri)) }
                action.startsWith("remove:") -> vm.removeAttachment(action.removePrefix("remove:"))
            } }
            when (picker) {
                "providers" -> RrBottomSheet({ picker = null }, title = stringResource(CoreR.string.choose_a_connection), fitContent = true) { state.providers.forEach { provider -> RrListRow(provider.label, subtitle = provider.model, onClick = { vm.provider(provider.id); picker = null }) }; RrListRow(stringResource(R.string.p4_add_connection), onClick = { nav.navigate(AiProviderSheet()) }) }
                "history" -> RrBottomSheet({ picker = null }, title = stringResource(CoreR.string.past_conversations), initialDetent = 1) { state.threads.filter { it.coverLetterId == state.letterId && (state.letterId != null || it.workingResumeId == route.resumeId || it.sourceResumeId == route.resumeId) }.forEach { thread -> RrListRow(thread.title, subtitle = thread.lastMessageAt, onClick = { vm.thread(thread.id); picker = null }) } }
            }
        }
    }
    screen<AssistantProposals> { entry ->
        val route = entry.toRoute<AssistantProposals>(); val repositories = LocalRepositories.current
        val owner = remember(entry) { assistantOwner(nav, entry) }
        val vm: AssistantViewModel = viewModel(viewModelStoreOwner = owner, key = "assistant-${route.resumeId}") { AssistantViewModel(repositories, route.resumeId, route.threadId) }
        val state by vm.state.collectAsStateWithLifecycle()
        ProposalsScreen(state, { nav.popBackStack() }, { ids, decision, wording -> vm.decide(ids, decision, wording) }, { nav.popBackStack() }, { proposal ->
            nav.navigate(PagePreview(state.documentId.ifEmpty { route.resumeId }, kind = if (state.letterId != null) DocumentKind.Letter else DocumentKind.Resume, section = proposal.section, itemId = proposal.item))
        }, { proposal, text -> vm.decide(listOf(proposal.id), Decision.Pending, text, proposal.after) }, vm::editWording, vm::wording, vm::cancelWording)
    }
}

internal fun readAttachment(input: java.io.InputStream): ByteArray {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        check(output.size() + count <= 25 * 1024 * 1024)
        output.write(buffer, 0, count)
    }
    return output.toByteArray()
}

/** Floating-window destinations are removed on a screen push; document entry keeps review state alive. */
private fun assistantOwner(nav: NavController, entry: NavBackStackEntry): NavBackStackEntry {
    val routeId = when { entry.destination.hasRoute<Assistant>() -> entry.toRoute<Assistant>().resumeId; else -> entry.toRoute<AssistantProposals>().resumeId }
    val builder = runCatching { nav.getBackStackEntry<Builder>() }.getOrNull()?.takeIf { it.toRoute<Builder>().resumeId == routeId }
    if (builder != null) return builder
    runCatching { nav.getBackStackEntry<Letter>() }.getOrNull()?.let { return it }
    return runCatching { nav.getBackStackEntry<Assistant>() }.getOrNull() ?: entry
}
