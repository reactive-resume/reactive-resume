package me.rxresu.feature.settings

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import me.rxresu.core.auth.AuthService
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.designsystem.*
import me.rxresu.core.navigation.*
import me.rxresu.core.strings.R as CR

fun NavGraphBuilder.settingsGraph(nav: NavController, motion: RrNavMotion, auth: AuthService) {
    modal<Settings>(motion) { entry ->
        val repositories = LocalRepositories.current
        val vm: SettingsViewModel = viewModel(entry) { SettingsViewModel(repositories, auth) }
        val s by vm.state.collectAsStateWithLifecycle()
        val server by auth.origin.collectAsStateWithLifecycle()
        LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.reloadProviders() }
        val browser = rememberBrowser(auth)
        val context = LocalContext.current
        val appVersion = remember {
            context.packageManager.getPackageInfo(context.packageName, 0).let {
                "${it.versionName} (${if (Build.VERSION.SDK_INT >= 28) it.longVersionCode else it.versionCode.toLong()})"
            }
        }
        SettingsScreen(s, server, appVersion, { nav.popBackStack() }, { nav.navigate(it) }, browser)
    }
    screen<SettingsAccount> { entry ->
        val repositories = LocalRepositories.current
        val owner = remember(entry) { nav.getBackStackEntry<Settings>() }
        val vm: SettingsViewModel = viewModel(owner) { SettingsViewModel(repositories, auth) }
        val s by vm.state.collectAsStateWithLifecycle()
        val server by auth.origin.collectAsStateWithLifecycle()
        val haptic = rememberRrHaptics()
        val lifecycle = LocalLifecycleOwner.current
        LaunchedEffect(vm, lifecycle) {
            lifecycle.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
                vm.accountSaved.collect { haptic(RrHaptic.Success) }
            }
        }
        val browser = rememberBrowser(auth)
        val context = LocalContext.current
        val scope = rememberCoroutineScope()
        val toasts = LocalToasts.current
        val failure = stringResource(CR.string.couldn_t_save_try_again)
        val referencesOnly =
            stringResource(
                CR.string
                    .this_server_exports_file_references_only_update_it_to_include_uploaded_files
            )
        val skipped =
            stringResource(
                CR.string.some_uploaded_files_were_skipped_check_upload_manifest_json_in_the_archive
            )
        var archive by remember { mutableStateOf<JsonObject?>(null) }
        val destination =
            rememberLauncherForActivityResult(
                ActivityResultContracts.CreateDocument("application/zip")
            ) { uri ->
                val contents = archive
                archive = null
                if (uri != null && contents != null)
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) {
                                requireNotNull(context.contentResolver.openOutputStream(uri)).use {
                                    writeAccountArchive(contents, it)
                                }
                            }
                            context.startActivity(
                                Intent.createChooser(
                                    Intent(Intent.ACTION_SEND)
                                        .setType("application/zip")
                                        .putExtra(Intent.EXTRA_STREAM, uri)
                                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                                    null,
                                )
                            )
                            val uploads = contents["uploads"] as? JsonObject
                            if (uploads == null) toasts.show(referencesOnly)
                            else if (uploads["skipped"]?.jsonArray?.isNotEmpty() == true)
                                toasts.show(skipped)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (_: Exception) {
                            toasts.show(failure)
                        }
                    }
            }
        val photo =
            rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
                if (uri != null)
                    scope.launch {
                        try {
                            val type = context.contentResolver.getType(uri).orEmpty()
                            val bytes =
                                withContext(Dispatchers.IO) {
                                    requireNotNull(context.contentResolver.openInputStream(uri))
                                        .use { readPhoto(it) }
                                }
                            vm.uploadPhoto(bytes, type)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (_: Exception) {
                            toasts.show(failure)
                        }
                    }
            }
        LaunchedEffect(vm) {
            vm.exports.collect {
                archive = it
                destination.launch("reactive-resume-account.zip")
            }
        }
        val partial =
            stringResource(CR.string.signed_out_but_some_data_on_this_device_couldn_t_be_removed)
        val failed = stringResource(CR.string.couldn_t_sign_out_try_again)
        AccountScreen(
            s,
            server,
            { nav.popBackStack() },
            vm::updateAccount,
            { vm.signOut { incomplete -> toasts.show(if (incomplete) partial else failed) } },
            browser,
            vm::exportAccount,
            { photo.launch("image/*") },
            vm::removePhoto,
        )
    }
    screen<SettingsPreferences> { entry ->
        val repositories = LocalRepositories.current
        val owner = remember(entry) { nav.getBackStackEntry<Settings>() }
        val vm: SettingsViewModel = viewModel(owner) { SettingsViewModel(repositories, auth) }
        val s by vm.state.collectAsStateWithLifecycle()
        val server by auth.origin.collectAsStateWithLifecycle()
        PreferencesScreen(
            s,
            { nav.popBackStack() },
            vm::preference,
            vm::updateAccount,
            rememberBrowser(auth),
        )
    }
    screen<SettingsProfile> { entry ->
        val repositories = LocalRepositories.current
        val vm: ProfileViewModel = viewModel { ProfileViewModel(repositories.account) }
        val s by vm.state.collectAsStateWithLifecycle()
        val server by auth.origin.collectAsStateWithLifecycle()
        val owner = remember(entry) { nav.getBackStackEntry<Settings>() }
        val account: SettingsViewModel = viewModel(owner) { SettingsViewModel(repositories, auth) }
        val settings by account.state.collectAsStateWithLifecycle()
        ProfileScreen(
            s,
            vm::edit,
            vm::save,
            vm::reload,
            vm::delete,
            { nav.popBackStack() },
            timezone = settings.account?.timezone ?: "UTC",
        )
    }
    screen<SettingsAi> { entry ->
        val repositories = LocalRepositories.current
        val owner = remember(entry) { nav.getBackStackEntry<Settings>() }
        val vm: SettingsViewModel = viewModel(owner) { SettingsViewModel(repositories, auth) }
        val s by vm.state.collectAsStateWithLifecycle()
        val server by auth.origin.collectAsStateWithLifecycle()
        LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.reloadProviders() }
        val developer: DeveloperViewModel = viewModel { DeveloperViewModel(repositories) }
        val detail by developer.state.collectAsStateWithLifecycle()
        var section by remember { mutableStateOf<String?>(null) }
        val browser = rememberBrowser(auth)
        AiScreen(
            s,
            { nav.popBackStack() },
            { nav.navigate(AiProviderSheet(it)) },
            vm::reloadProviders,
            browser,
            server,
        ) {
            section = it
            developer.load(it)
        }
        if (section != null)
            DeveloperScreen(
                detail,
                developer::key,
                developer::provider,
                developer::saveWeb,
                developer::testWeb,
                developer::removeWeb,
                developer::memory,
                developer::disconnect,
                { section?.let(developer::load) },
                { section = null },
                browser,
                server,
            )
    }
    sheet<AiProviderSheet> { entry ->
        val repositories = LocalRepositories.current
        val id = entry.toRoute<AiProviderSheet>().providerId
        val vm: ProviderViewModel = viewModel { ProviderViewModel(repositories.ai, id) }
        val s by vm.state.collectAsStateWithLifecycle()
        val server by auth.origin.collectAsStateWithLifecycle()
        LaunchedEffect(s.finished) { if (s.finished) nav.popBackStack() }
        ProviderScreen(
            s,
            vm::edit,
            vm::choose,
            { vm.save() },
            vm::test,
            vm::makeDefault,
            vm::delete,
            { nav.popBackStack() },
            rememberBrowser(auth),
        )
    }
}

@Composable
private fun rememberBrowser(auth: AuthService): (String) -> Unit {
    val activity = LocalActivity.current
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()
    val failure = stringResource(CR.string.couldn_t_save_try_again)
    return { url ->
        try {
            activity?.let { auth.openBrowser(it, Uri.parse(url)) }
        } catch (_: Exception) {
            scope.launch { toasts.show(failure) }
        }
    }
}

/** Bound bytes before upload, including streams without a trustworthy reported size. */
internal fun readPhoto(input: java.io.InputStream): ByteArray {
    val limit = PHOTO_MAX_BYTES
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    while (output.size() <= limit) {
        val count = input.read(buffer, 0, minOf(buffer.size, limit + 1 - output.size()))
        if (count < 0) break
        output.write(buffer, 0, count)
    }
    require(output.size() <= limit)
    return output.toByteArray()
}
