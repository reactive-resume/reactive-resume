package me.rxresu.feature.share

import android.app.Activity
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.*
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as DsR
import me.rxresu.core.strings.R as CoreR
import me.rxresu.core.navigation.*

@Composable internal fun DownloadRoute(route: Download, dismiss: () -> Unit) {
    val repositories = LocalRepositories.current; val vm: ExportViewModel = viewModel { ExportViewModel(repositories, route.id, route.kind) }; val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    DisposableEffect(context, vm) {
        val manager = context.getSystemService(android.net.ConnectivityManager::class.java)
        fun update() { vm.offline(manager.getNetworkCapabilities(manager.activeNetwork)?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED) != true) }
        val callback = object : android.net.ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: android.net.Network) = update()
            override fun onLost(network: android.net.Network) = update()
            override fun onCapabilitiesChanged(network: android.net.Network, capabilities: android.net.NetworkCapabilities) = update()
        }
        update(); manager.registerDefaultNetworkCallback(callback)
        onDispose { manager.unregisterNetworkCallback(callback) }
    }
    val delivering = fileDeliveries(vm.deliveries)
    DownloadSheet(state, route.kind, dismiss, vm::format, vm::name, { vm.export(true) }, { vm.export(false) }, delivering)
}

@Composable internal fun DownloadSheet(state: ExportState, kind: DocumentKind, dismiss: () -> Unit, format: (FileFormat) -> Unit, name: (String) -> Unit, save: () -> Unit, share: () -> Unit, delivering: Boolean = false) {
    RrBottomSheet(dismiss, title = stringResource(R.string.other_formats), fixedHeight = 620.dp, footer = {
        RrFooterBar(inSheet = true) {
            RrButton(stringResource(R.string.p4_save_to_files), { save() }, Modifier.weight(1f), variant = RrButtonVariant.Secondary, size = RrButtonSize.Large, enabled = !state.busy && !delivering)
            RrButton(if (state.busy) stringResource(CoreR.string.generating_pdf) else stringResource(CoreR.string.share), { share() }, Modifier.weight(1f), size = RrButtonSize.Large, loading = state.busy, enabled = !delivering)
        }
    }) { DownloadContent(state, kind, format, name) }
}

/** One native file-delivery owner for document and QR exports. Cancelling SAF drops only remaining files. */
@Composable internal fun fileDeliveries(deliveries: kotlinx.coroutines.flow.Flow<Delivery>): Boolean {
    val resources = androidx.compose.ui.platform.LocalResources.current; val context = LocalContext.current; val scope = rememberCoroutineScope(); val toasts = LocalToasts.current; val haptics = rememberRrHaptics()
    var pair by remember { mutableStateOf(false) }; var pending by remember { mutableStateOf<List<ExportFile>>(emptyList()) }; var saving by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val file = pending.firstOrNull(); val uri = result.data?.data
        if (result.resultCode == Activity.RESULT_OK && uri != null && file != null) scope.launch {
            try {
                withContext(Dispatchers.IO) { requireNotNull(context.contentResolver.openOutputStream(uri)).use { it.write(file.bytes) } }
                pending = pending.drop(1)
                if (pending.isEmpty()) { haptics(RrHaptic.Success); toasts.show(if (pair) resources.getString(R.string.p4_downloaded_your_resume_and_this_letter) else resources.getString(R.string.p4_downloaded_1_s, file.name)) }
            } catch (e: CancellationException) { throw e } catch (_: Exception) { pending = emptyList(); toasts.show(resources.getString(CoreR.string.download_failed_try_again), tone = RrToastTone.Danger) }
            finally { saving = false }
        } else { pending = emptyList(); saving = false }
    }
    LaunchedEffect(pending, saving) { if (pending.isNotEmpty() && !saving) { saving = true; val file = pending.first(); launcher.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE); type = file.mime; putExtra(Intent.EXTRA_TITLE, file.name) }) } }
    LaunchedEffect(deliveries) { deliveries.collect { delivery ->
        try { if (delivery.save) { check(pending.isEmpty()); pair = delivery.files.size > 1; pending = delivery.files } else shareFiles(context, delivery.files, resources.getString(CoreR.string.share)) }
        catch (e: CancellationException) { throw e } catch (_: Exception) { toasts.show(resources.getString(CoreR.string.download_failed_try_again), tone = RrToastTone.Danger) }
    } }
    return pending.isNotEmpty() || saving
}
