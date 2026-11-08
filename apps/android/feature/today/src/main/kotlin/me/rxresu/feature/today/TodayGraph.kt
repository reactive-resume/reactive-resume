package me.rxresu.feature.today

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings as AndroidSettings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.lazy.rememberLazyListState
import me.rxresu.core.navigation.OnTabReselected
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import kotlinx.coroutines.launch
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.NotificationCategory
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrToastResult
import me.rxresu.core.designsystem.RrToastTone
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.Application
import me.rxresu.core.navigation.ApplicationsTab
import me.rxresu.core.navigation.ApplicationsView
import me.rxresu.core.navigation.Builder
import me.rxresu.core.navigation.KnowledgeTab
import me.rxresu.core.navigation.Knowledge
import me.rxresu.core.navigation.Letter
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.NewDocument
import me.rxresu.core.navigation.Offers
import me.rxresu.core.navigation.RrNavMotion
import me.rxresu.core.navigation.SaveJob
import me.rxresu.core.navigation.ScheduleSheet
import me.rxresu.core.navigation.Search
import me.rxresu.core.navigation.Settings
import me.rxresu.core.navigation.SignIn
import me.rxresu.core.navigation.TodayTab
import me.rxresu.core.navigation.switchTab
import me.rxresu.core.navigation.tabRoot
import me.rxresu.core.network.generated.DocumentType
import me.rxresu.core.strings.R as S

/** Registers T1/T2 (one destination: the first-run checklist is a state of Today). */
fun NavGraphBuilder.todayGraph(nav: NavController, motion: RrNavMotion) {
    tabRoot<TodayTab>(motion) { TodayRoute(nav) }
}

@Composable
internal fun TodayRoute(nav: NavController) {
    val repos = LocalRepositories.current
    val vm = viewModel { TodayViewModel(repos.today, repos.applications, repos.account) }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()
    val haptics = rememberRrHaptics()
    val context = LocalContext.current
    val res = LocalResources.current
    val listState = rememberLazyListState()
    OnTabReselected(0) { listState.animateScrollToItem(0) }

    var denied by rememberSaveable { mutableStateOf(false) }
    LifecycleResumeEffect(Unit) {
        vm.setRemindersEnabled(NotificationManagerCompat.from(context).areNotificationsEnabled())
        onPauseOrDispose {}
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            vm.setRemindersEnabled(true)
            scope.launch {
                repos.preferences.setNotification(NotificationCategory.InterviewsAndBriefings, true)
                repos.preferences.setNotification(NotificationCategory.FollowUps, true)
                repos.preferences.setNotification(NotificationCategory.OfferDeadlines, true)
            }
        } else {
            denied = true
        }
    }

    // `success` when a checklist row ticks while Today is on screen.
    val ticked = state.firstRun?.let { listOf(it.hasDocument, it.hasApplication, it.hasPreferences, it.remindersEnabled).count { done -> done } }
    var lastTicked by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(ticked) {
        val last = lastTicked
        if (ticked != null && last != null && ticked > last) haptics(RrHaptic.Success)
        if (ticked != null) lastTicked = ticked
    }

    fun failed(message: Int) = toasts.post(res.getString(message), tone = RrToastTone.Danger)

    val actions = TodayActions(
        onSearch = { nav.navigate(Search()) },
        onSettings = { nav.navigate(Settings) },
        onRefresh = { scope.launch { runCatching { vm.refresh() } } },
        onRetry = { scope.launch { runCatching { vm.refresh() } } },
        onOpenApplication = { id, tab -> nav.navigate(Application(id, tab)) },
        onNotification = { entry ->
            scope.launch { entry.item.notificationId?.let { runCatching { vm.markRead(it) } } }
            entry.item.applicationId?.let { nav.navigate(Application(it)) }
        },
        onCompareOffers = { nav.navigate(Offers) },
        onLogFollowUp = { id -> scope.launch { runCatching { vm.logFollowUp(id) } } },
        onMarkRead = { item ->
            scope.launch {
                try {
                    vm.dismiss(item)
                } catch (e: Exception) {
                    failed(R.string.today_mark_read_failed)
                    return@launch
                }
                toasts.post(res.getString(R.string.today_marked_read), res.getString(R.string.today_undo)) {
                    if (it == RrToastResult.ActionPerformed) runCatching { vm.undoDismiss(item) }
                }
            }
        },
        onCalendar = { nav.switchTab(ApplicationsTab(ApplicationsView.Calendar)) },
        onTrack = { role ->
            scope.launch {
                val id = try { vm.track(role) } catch (e: Exception) { failed(R.string.today_track_failed); return@launch }
                haptics(RrHaptic.Success)
                toasts.post(res.getString(R.string.today_saved_role, role.company), res.getString(R.string.today_open)) {
                    if (it == RrToastResult.ActionPerformed) nav.navigate(Application(id))
                }
            }
        },
        onNotForMe = { role ->
            scope.launch {
                try { vm.dismissRole(role) } catch (e: Exception) { failed(R.string.today_hide_failed); return@launch }
                toasts.post(res.getString(R.string.today_hidden_role))
            }
        },
        onToggleRole = vm::toggleRole,
        onClearSelection = vm::clearSelection,
        onApplySelection = { track ->
            scope.launch {
                val (done, failed) = vm.applyToSelection(track)
                if (track && done > 0) haptics(RrHaptic.Success)
                if (failed > 0) toasts.post(res.getString(R.string.today_selection_partial, done.toString(), failed.toString()), tone = RrToastTone.Danger)
            }
        },
        onOpenSchedule = { id -> nav.navigate(ScheduleSheet(id)) },
        onOpenDocument = { doc -> nav.navigate(if (doc.type == DocumentType.Letter) Letter(doc.id) else Builder(doc.id)) },
        onNew = { nav.navigate(NewDocument()) },
        onSaveJob = { nav.navigate(SaveJob()) },
        onPreferences = { nav.navigate(Knowledge(KnowledgeTab.Preferences)) },
        onTurnOnReminders = {
            if (Build.VERSION.SDK_INT >= 33) permission.launch(Manifest.permission.POST_NOTIFICATIONS) else openNotificationSettings(context)
        },
        onOpenSystemSettings = { openNotificationSettings(context) },
        onCreateAccount = { nav.navigate(SignIn(register = true)) },
    )
    TodayScreen(state, repos.time.now(), repos.time.timezone(), actions, remindersDenied = denied, listState = listState)
}

private fun openNotificationSettings(context: android.content.Context) {
    context.startActivity(
        Intent(AndroidSettings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(AndroidSettings.EXTRA_APP_PACKAGE, context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}
