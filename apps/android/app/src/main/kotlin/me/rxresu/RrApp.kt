package me.rxresu

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.flow.Flow
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.AppPreferences
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.Resource
import kotlinx.coroutines.flow.MutableSharedFlow
import androidx.compose.ui.res.pluralStringResource
import me.rxresu.core.data.ThemePreference
import me.rxresu.core.designsystem.rememberSystemReducedMotion
import me.rxresu.core.designsystem.RrLayout
import me.rxresu.core.designsystem.RrTabBar
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrToastHost
import me.rxresu.core.designsystem.RrToastHostState
import me.rxresu.core.designsystem.rrAppTabs
import me.rxresu.core.navigation.ApplicationsTab
import me.rxresu.core.navigation.CareerTab
import me.rxresu.core.navigation.DocumentsTab
import me.rxresu.core.navigation.LocalBuilderShareMode
import me.rxresu.core.navigation.LocalNavMotion
import me.rxresu.core.navigation.LocalTabReselects
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.LocalWorkspaceTab
import me.rxresu.core.navigation.RrNavMotion
import me.rxresu.core.navigation.TodayTab
import me.rxresu.core.navigation.AtsChecker
import me.rxresu.core.navigation.Import
import me.rxresu.core.navigation.ResetPassword
import me.rxresu.core.navigation.Search
import me.rxresu.core.navigation.SignIn
import me.rxresu.core.navigation.TwoStep
import me.rxresu.core.navigation.Welcome
import me.rxresu.core.navigation.resetTo
import me.rxresu.core.navigation.switchTab
import me.rxresu.core.navigation.tabIndex
import me.rxresu.core.strings.R as S
import me.rxresu.feature.applications.applicationsGraph
import me.rxresu.feature.assistant.assistantGraph
import me.rxresu.feature.auth.authGraph
import me.rxresu.feature.builder.builderGraph
import me.rxresu.feature.career.careerGraph
import me.rxresu.feature.documents.documentsGraph
import me.rxresu.feature.letters.lettersGraph
import me.rxresu.feature.publiclink.publicGraph
import me.rxresu.feature.search.searchGraph
import me.rxresu.feature.settings.settingsGraph
import me.rxresu.feature.share.BuilderShareMode
import me.rxresu.feature.share.shareGraph
import me.rxresu.feature.today.todayGraph
import me.rxresu.feature.workspace.WorkspaceTabContent

private val tabRoutes: List<Any> = listOf(TodayTab, DocumentsTab, ApplicationsTab(), CareerTab)

@Composable
fun RrApp(graph: AppGraph, incoming: Flow<Any>) {
    val session by graph.auth.state.collectAsStateWithLifecycle()
    val prefs by graph.repositories.preferences.values.collectAsStateWithLifecycle(AppPreferences())
    val dark = when (prefs.theme) {
        ThemePreference.Light -> false
        ThemePreference.Dark -> true
        ThemePreference.MatchSystem -> isSystemInDarkTheme()
    }
    val systemReduced = rememberSystemReducedMotion()
    // The system "Remove animations" always wins; the in-app setting can only reduce motion further.
    RrTheme(darkTheme = dark, hapticsEnabled = prefs.haptics, reducedMotion = systemReduced || prefs.reducedMotion == true) {
        val nav = rememberNavController()
        val toasts = remember { RrToastHostState() }
        val motion = RrNavMotion(RrTheme.reducedMotion)
        val entry by nav.currentBackStackEntryAsState()
        val tab = entry?.tabIndex()
        val reselects = remember { MutableSharedFlow<Int>(extraBufferCapacity = 1) }

        if (session == SessionState.Loading) return@RrTheme
        val signedIn = session is SessionState.SignedIn || session is SessionState.Expired
        // Chosen once: later session changes move the back stack (SessionRouting), never the graph's start.
        val start = remember { if (signedIn) TodayTab else Welcome }
        SessionRouting(nav, signedIn)
        // Dates and "today" follow the account's timezone once the profile is known (and after Settings changes it).
        LaunchedEffect(signedIn) {
            if (!signedIn) { graph.accountZone = null; return@LaunchedEffect }
            graph.repositories.account.observeProfile().collect { profile ->
                profile.data?.timezone?.let { id -> graph.accountZone = runCatching { java.time.ZoneId.of(id) }.getOrNull() }
            }
        }
        // Pages belong to one account; the next account starts with an empty cache.
        LaunchedEffect(session) { if (session == SessionState.SignedOut) graph.pagesDir.listFiles()?.forEach { it.deleteRecursively() } }
        LaunchedEffect(nav) {
            incoming.collect { route ->
                val tab = tabFor(route)
                if (tab != null && signedIn) nav.switchTab(tab)
                if (tab != route) nav.navigate(route)
            }
        }

        CompositionLocalProvider(
            LocalRepositories provides graph.repositories,
            LocalToasts provides toasts,
            LocalTabReselects provides reselects,
            LocalNavMotion provides motion,
            LocalBuilderShareMode provides { id, n -> BuilderShareMode(id, n) },
            LocalWorkspaceTab provides { id, t, n -> WorkspaceTabContent(id, t, n) },
        ) {
            Column(
                Modifier
                    .fillMaxSize()
                    .background(RrTheme.colors.bg)
                    // Hardware keyboard: Ctrl+K or / opens Search from anywhere signed in, as on the web.
                    .onPreviewKeyEvent { event ->
                        val search = event.type == KeyEventType.KeyDown && signedIn &&
                            ((event.isCtrlPressed && event.key == Key.K) || (!event.isCtrlPressed && event.key == Key.Slash && tab != null))
                        if (search) nav.navigate(Search())
                        search
                    },
            ) {
                Box(Modifier.weight(1f)) {
                    NavHost(
                        navController = nav,
                        startDestination = start,
                        enterTransition = motion.enter,
                        exitTransition = motion.exit,
                        popEnterTransition = motion.popEnter,
                        popExitTransition = motion.popExit,
                    ) {
                        authGraph(nav, motion, graph.auth)
                        todayGraph(nav, motion)
                        documentsGraph(nav, motion)
                        searchGraph(nav, motion)
                        builderGraph(nav, motion)
                        shareGraph(nav, motion)
                        assistantGraph(nav, motion)
                        lettersGraph(nav, motion)
                        applicationsGraph(nav, motion)
                        careerGraph(nav, motion)
                        settingsGraph(nav, motion, graph.auth)
                        publicGraph(nav, motion)
                    }
                    // Toasts sit above the tab bar or a screen's own mode bar; screens with a mode bar pad via insets.
                    RrToastHost(toasts, Modifier.align(Alignment.BottomCenter).padding(bottom = if (tab == null) RrLayout.tabBar else 0.dp))
                }
                if (tab != null) {
                    // T1: the Today tab shows the Needs-you count while another tab is open.
                    val today by remember(signedIn) { graph.repositories.today.observe() }.collectAsStateWithLifecycle(Resource())
                    val needsYou = today.data?.needsYou?.size?.takeIf { it > 0 && tab != 0 }
                    val tabs = rrAppTabs(stringResource(S.string.today), stringResource(S.string.documents), stringResource(S.string.applications), stringResource(S.string.career))
                    RrTabBar(
                        tabs = tabs.mapIndexed { i, t ->
                            if (i == 0 && needsYou != null) t.copy(badge = "$needsYou", badgeDescription = pluralStringResource(R.plurals.needs_you_badge, needsYou, needsYou)) else t
                        },
                        selectedIndex = tab,
                        onSelect = { nav.switchTab(tabRoutes[it]) },
                        onReselect = { reselects.tryEmit(it) },
                    )
                }
            }
        }
    }
}

/** Sends the person to Welcome when they sign out, and to Today when sign-in completes. */
@Composable
private fun SessionRouting(nav: NavController, signedIn: Boolean) {
    LaunchedEffect(signedIn) {
        val dest = nav.currentBackStackEntry?.destination ?: return@LaunchedEffect
        val onAuth = dest.hasRoute<Welcome>() || dest.hasRoute<SignIn>() || dest.hasRoute<TwoStep>() || dest.hasRoute<ResetPassword>()
        // The ATS checker sends a signed-out person to sign in before importing; pick that import back up.
        val pendingImport = runCatching { nav.getBackStackEntry<AtsChecker>() }.getOrNull()?.savedStateHandle?.get<String>("ats-import")
        if (signedIn && onAuth) {
            nav.resetTo(TodayTab)
            if (pendingImport != null) nav.navigate(Import(pendingImport.ifEmpty { null }))
        }
        if (!signedIn && !onAuth) nav.resetTo(Welcome)
    }
}
