package me.rxresu.feature.builder

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.toRoute
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrToastResult
import me.rxresu.core.designsystem.RrToastTone
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.Assistant
import me.rxresu.core.navigation.Builder
import me.rxresu.core.navigation.BuilderBasics
import me.rxresu.core.navigation.BuilderEntry
import me.rxresu.core.navigation.BuilderSection
import me.rxresu.core.navigation.BuilderDesign
import me.rxresu.core.navigation.BuilderMode
import me.rxresu.core.navigation.BuilderMore
import me.rxresu.core.navigation.BuilderRichText
import me.rxresu.core.navigation.CheckTab
import me.rxresu.core.navigation.LocalBuilderShareMode
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.RrNavMotion
import me.rxresu.core.navigation.SettingsAi
import me.rxresu.core.navigation.screen
import me.rxresu.core.navigation.sheet
import me.rxresu.core.strings.R as S

/** Registers the dock roots and pushed editors. */
fun NavGraphBuilder.builderGraph(nav: NavController, motion: RrNavMotion) {
    pagePreviewGraph(nav, motion)
    screen<Builder> { entry -> BuilderRoute(entry.toRoute(), entry, nav) }
    screen<BuilderEntry> { entry ->
        val route = entry.toRoute<BuilderEntry>()
        // Pushed editors retain the builder destination’s draft owner.
        val vm = builderViewModel(nav, route.resumeId, entry)
        BuilderToasts(vm)
        EntryRoute(route, vm, nav)
    }
    screen<BuilderSection> { entry ->
        val route = entry.toRoute<BuilderSection>()
        val vm = builderViewModel(nav, route.resumeId, entry)
        BuilderToasts(vm)
        SectionRoute(route, vm, nav)
    }
    screen<BuilderDesign> { entry ->
        val route = entry.toRoute<BuilderDesign>()
        val vm = builderViewModel(nav, route.resumeId, entry)
        val state by vm.state.collectAsStateWithLifecycle()
        BuilderToasts(vm)
        BuilderDesignRoute(route, state, vm, nav)
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
 * The builder's view model lives on the Builder destination, so pushed editors share its draft,
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
internal fun BuilderToasts(vm: BuilderViewModel) {
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
    var check by rememberSaveable { mutableStateOf(route.check) }
    val previewIssue by entry.savedStateHandle.getStateFlow<Int?>("preview-issue-number", null).collectAsStateWithLifecycle()
    LaunchedEffect(previewIssue) {
        if (previewIssue != null) {
            mode = BuilderMode.Check
            check = CheckTab.Issues
            entry.savedStateHandle["preview-issue-number"] = null
        }
    }
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
        section = { nav.navigate(BuilderSection(route.resumeId, it)) },
    )
    BuilderScreen(
        state = state,
        mode = mode,
        onMode = { mode = it },
        onBack = { vm.flush(); nav.popBackStack() },
        onUndo = vm::undo,
        onRedo = vm::redo,
        onRetrySave = vm::flush,
        onAssistant = { nav.navigate(Assistant(route.resumeId)) },
        onMore = { nav.navigate(BuilderMore(route.resumeId)) },
        onDismissOutsideChange = vm::dismissOutsideChange,
    ) { shown ->
        when (shown) {
            BuilderMode.Write -> OverviewScreen(state, vm, writeNav,
                onSection = { nav.navigate(BuilderSection(route.resumeId, it)) },
                onPreview = { nav.navigate(me.rxresu.core.navigation.PagePreview(route.resumeId)) })
            BuilderMode.Design -> DesignOverview(state, vm,
                onPicker = { nav.navigate(BuilderDesign(route.resumeId, it)) },
                onPreview = { nav.navigate(me.rxresu.core.navigation.PagePreview(route.resumeId)) })
            BuilderMode.Check -> CheckMode(
                state, check, { check = it }, vm,
                onShowOnPage = { target ->
                    nav.navigate(me.rxresu.core.navigation.PagePreview(route.resumeId, section = when (target) { is BlockTarget.Section -> target.key; is BlockTarget.Item -> target.section; else -> null }, itemId = (target as? BlockTarget.Item)?.itemId,
                        issueNumber = if (check == CheckTab.Issues) state.doc?.let { doc -> state.checks?.findings?.indexOfFirst { CheckPointer.target(doc, it.pointer) == target }?.takeIf { it >= 0 }?.plus(1) } else null))
                },
                onWrite = { target -> mode = BuilderMode.Write; writeNav.open(state.doc ?: return@CheckMode, target) {} },
                onAskAssistant = { prompt -> nav.navigate(Assistant(route.resumeId, prompt = prompt)) },
                onSetUpAi = { nav.navigate(SettingsAi) },
                onOpenApplication = { nav.navigate(me.rxresu.core.navigation.Application(it)) },
            )
            BuilderMode.Share -> share(route.resumeId, nav)
        }
    }
}
