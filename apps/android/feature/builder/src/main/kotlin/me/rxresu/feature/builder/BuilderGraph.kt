package me.rxresu.feature.builder

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.toRoute
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrToastResult
import me.rxresu.core.designsystem.RrToastTone
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.Assistant
import me.rxresu.core.navigation.Builder
import me.rxresu.core.navigation.BuilderBasics
import me.rxresu.core.navigation.BuilderEntry
import me.rxresu.core.navigation.BuilderMode
import me.rxresu.core.navigation.BuilderMore
import me.rxresu.core.navigation.BuilderRichText
import me.rxresu.core.navigation.CheckTab
import me.rxresu.core.navigation.LocalBuilderShareMode
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.RrNavMotion
import me.rxresu.core.navigation.SettingsAi
import me.rxresu.core.navigation.WriteView
import me.rxresu.core.navigation.screen
import me.rxresu.core.navigation.sheet
import me.rxresu.core.strings.R as S

/** Registers the builder: one screen for all four modes, the entry sheet, rich text and basics. */
fun NavGraphBuilder.builderGraph(nav: NavController, motion: RrNavMotion) {
    screen<Builder> { entry -> BuilderRoute(entry.toRoute(), entry, nav) }
    sheet<BuilderEntry> { entry ->
        val route = entry.toRoute<BuilderEntry>()
        // The builder stays composed under this sheet and shows its toasts, so Undo outlives the sheet.
        EntryRoute(route, builderViewModel(nav, route.resumeId, entry), nav)
    }
    screen<BuilderRichText> { entry ->
        val route = entry.toRoute<BuilderRichText>()
        val vm = builderViewModel(nav, route.resumeId, entry)
        BuilderToasts(vm)
        RichTextRoute(route, vm, nav)
    }
    screen<BuilderBasics> { entry ->
        val route = entry.toRoute<BuilderBasics>()
        val vm = builderViewModel(nav, route.resumeId, entry)
        BuilderToasts(vm)
        BasicsRoute(vm, nav)
    }
}

/**
 * The builder's view model lives on the Builder destination, so the entry sheet, rich text and basics share its draft,
 * undo history and pages. Falls back to [entry] when opened without a builder underneath (deep links).
 */
@Composable
private fun builderViewModel(nav: NavController, resumeId: String, entry: NavBackStackEntry): BuilderViewModel {
    val owner = remember(entry) {
        runCatching { nav.getBackStackEntry<Builder>() }.getOrNull()?.takeIf { it.toRoute<Builder>().resumeId == resumeId } ?: entry
    }
    val repositories = LocalRepositories.current
    val context = LocalContext.current.applicationContext
    return viewModel(viewModelStoreOwner = owner, key = "builder-$resumeId") {
        BuilderViewModel(resumeId, repositories, readPhoto = { uri -> readPhoto(context, uri) })
    }
}

private fun readPhoto(context: Context, uri: Uri): PickedPhoto? = runCatching {
    val resolver = context.contentResolver
    val type = resolver.getType(uri) ?: return null
    if (type !in setOf("image/png", "image/jpeg", "image/webp", "image/gif")) return null
    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } ?: "photo"
    PickedPhoto(resolver.openInputStream(uri)!!.use { it.readBytes() }, name, type)
}.getOrNull()

/** Shows the view model's toasts; Undo undoes the last change. Plays `success` with success toasts. */
@Composable
private fun BuilderToasts(vm: BuilderViewModel) {
    val toasts = LocalToasts.current
    val resources = LocalResources.current
    val haptics = rememberRrHaptics()
    val undo = stringResource(S.string.undo)
    LaunchedEffect(vm) {
        vm.toastEvents.collect { t ->
            if (t.success) haptics(RrHaptic.Success)
            val text = resources.getString(t.text, *t.args.toTypedArray())
            val result = toasts.show(text, if (t.undo) undo else null, if (t.danger) RrToastTone.Danger else RrToastTone.Neutral)
            if (result == RrToastResult.ActionPerformed) vm.undo()
        }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { vm.flush() }
}

@Composable
private fun BuilderRoute(route: Builder, entry: NavBackStackEntry, nav: NavController) {
    val vm = builderViewModel(nav, route.resumeId, entry)
    val state by vm.state.collectAsStateWithLifecycle()
    var mode by rememberSaveable { mutableStateOf(route.mode) }
    var view by rememberSaveable { mutableStateOf(route.view) }
    var group by rememberSaveable { mutableStateOf(route.group) }
    var check by rememberSaveable { mutableStateOf(route.check) }
    var backToCheck by rememberSaveable { mutableStateOf(false) }
    val share = LocalBuilderShareMode.current
    val toasts = LocalToasts.current
    val resources = LocalResources.current
    BuilderToasts(vm)
    // A copy made for a job opens on Job match; this resume stays underneath, as it was.
    LaunchedEffect(vm) { vm.openCopyEvents.collect { id -> nav.navigate(Builder(id, mode = BuilderMode.Check, check = CheckTab.JobMatch)) } }
    LaunchedEffect(state.recoveredCopyName) {
        state.recoveredCopyName?.let { toasts.show(resources.getString(R.string.builder_changes_kept_in, it)) }
    }
    val writeNav = WriteNav(
        entry = { section, item ->
            if (item != null) nav.navigate(BuilderEntry(route.resumeId, section, item))
            else vm.addItem(section) { id -> nav.navigate(BuilderEntry(route.resumeId, section, id)) }
        },
        basics = { nav.navigate(BuilderBasics(route.resumeId)) },
        richText = { s, i, f -> nav.navigate(BuilderRichText(route.resumeId, s, i, f)) },
        check = { mode = BuilderMode.Check; check = CheckTab.Issues },
    )
    BuilderScreen(
        state = state,
        mode = mode,
        onMode = { mode = it; backToCheck = false },
        onBack = { vm.flush(); nav.popBackStack() },
        onUndo = vm::undo,
        onRedo = vm::redo,
        onRetrySave = vm::flush,
        onAssistant = { nav.navigate(Assistant(route.resumeId)) },
        onMore = { nav.navigate(BuilderMore(route.resumeId)) },
    ) { shown ->
        when (shown) {
            BuilderMode.Write -> Box(Modifier.fillMaxSize()) {
                val doc = state.doc
                val checks = state.checks
                // Back from Check's Show on page: issue numbers match the markers on the page.
                val markers = if (backToCheck && doc != null && checks != null) issueViews(doc, checks.findings).mapNotNull { i -> i.target?.let { it to i.number } } else emptyList()
                WriteMode(state, view, { view = it }, vm, writeNav, markers = markers)
                if (backToCheck) {
                    RrButton(
                        stringResource(R.string.builder_back_to_check),
                        { mode = BuilderMode.Check; backToCheck = false; vm.highlight(null) },
                        Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp),
                        RrButtonVariant.Secondary,
                    )
                }
            }
            BuilderMode.Design -> DesignMode(state, group, { group = it }, vm)
            BuilderMode.Check -> CheckMode(
                state, check, { check = it }, vm,
                onShowOnPage = { target -> vm.highlight(target); view = WriteView.Page; mode = BuilderMode.Write; backToCheck = true },
                onWrite = { target -> mode = BuilderMode.Write; writeNav.open(state.doc ?: return@CheckMode, target) { view = WriteView.Outline } },
                onAskAssistant = { nav.navigate(Assistant(route.resumeId)) },
                onSetUpAi = { nav.navigate(SettingsAi) },
            )
            BuilderMode.Share -> share(route.resumeId, nav)
        }
    }
}
