// The app shell's shared pieces: how destinations are registered, how they move, and the app-wide locals features
// read (toasts, the slots other modules fill). :app builds the NavHost; features register into it.
package me.rxresu.core.navigation

import androidx.compose.animation.AnimatedContentScope
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.filter
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.IntOffset
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptionsBuilder
import androidx.navigation.compose.composable
import androidx.navigation.compose.dialog
import androidx.compose.ui.window.DialogProperties
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrToastHostState

/** Re-taps of the selected tab (0 Today … 3 Career), emitted by the tab bar. Collect with [OnTabReselected]. */
val LocalTabReselects = staticCompositionLocalOf<SharedFlow<Int>> { MutableSharedFlow() }

/** Runs [action] (usually scroll to top) when the person re-taps tab [index] while it is selected. */
@Composable
fun OnTabReselected(index: Int, action: suspend () -> Unit) {
    val reselects = LocalTabReselects.current
    val current by rememberUpdatedState(action)
    LaunchedEffect(reselects, index) { reselects.filter { it == index }.collect { current() } }
}

/** App-wide toast host. Features call `LocalToasts.current.show(...)` from a coroutine. */
val LocalToasts = staticCompositionLocalOf<RrToastHostState> { error("LocalToasts not provided") }

/** Builder Share mode (B11), drawn inside the builder screen under its mode bar. Filled by :feature:share. */
val LocalBuilderShareMode = staticCompositionLocalOf<@Composable (resumeId: String, nav: NavController) -> Unit> { { _, _ -> } }

/** Workspace tab content (W1–W5) inside the Application screen (J6). Filled by :feature:workspace. */
val LocalWorkspaceTab = staticCompositionLocalOf<@Composable (applicationId: String, tab: WorkspaceTab, nav: NavController) -> Unit> { { _, _, _ -> } }

/**
 * Motion for the NavHost (boards/Motion.png, Choreography). Stack push: the new screen slides in from the trailing
 * edge (mirrors in RTL) over d3 ease, the old one shifts 30%. Exits take 70% of the entry. Reduced motion: no movement.
 */
class RrNavMotion(private val reduced: Boolean) {
    private val push = tween<IntOffset>(RrMotion.D3, easing = RrMotion.ease)
    private val pop = tween<IntOffset>(RrMotion.exit(RrMotion.D3), easing = RrMotion.ease)

    val enter: AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
        if (reduced) EnterTransition.None else slideIntoContainer(AnimatedContentTransitionScope.SlideDirection.Start, push)
    }
    val exit: AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
        if (reduced) ExitTransition.None
        else slideOutOfContainer(AnimatedContentTransitionScope.SlideDirection.Start, push) { it * 3 / 10 }
    }
    val popEnter: AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
        if (reduced) EnterTransition.None
        else slideIntoContainer(AnimatedContentTransitionScope.SlideDirection.End, pop) { it * 3 / 10 }
    }
    val popExit: AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
        if (reduced) ExitTransition.None else slideOutOfContainer(AnimatedContentTransitionScope.SlideDirection.End, pop)
    }

    /** Tab switch: fade through. Old content fades out (140 ms), then the new one fades up 6 dp over d2. */
    val tabEnter: AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
        if (reduced) EnterTransition.None
        else fadeIn(tween(RrMotion.D2, delayMillis = 140, easing = RrMotion.ease)) +
            slideInVertically(tween(RrMotion.D2, delayMillis = 140, easing = RrMotion.ease)) { 18 }
    }
    val tabExit: AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
        if (reduced) ExitTransition.None else fadeOut(tween(140, easing = RrMotion.ease))
    }

    /** Full-screen modals (Settings, consent): slide up d3, dismiss down. */
    val modalEnter: AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
        if (reduced) fadeIn(tween(RrMotion.D1)) else slideInVertically(tween(RrMotion.D3, easing = RrMotion.ease)) { it }
    }
    val modalExit: AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
        if (reduced) fadeOut(tween(RrMotion.D1))
        else slideOutVertically(tween(RrMotion.exit(RrMotion.D3), easing = RrMotion.ease)) { it }
    }
}

/** The NavHost's motion, provided by :app so feature graphs can opt into tab or modal motion. */
val LocalNavMotion = staticCompositionLocalOf { RrNavMotion(reduced = false) }

/** A pushed screen (default stack motion). */
inline fun <reified T : Any> NavGraphBuilder.screen(
    noinline content: @Composable AnimatedContentScope.(NavBackStackEntry) -> Unit,
) = composable<T>(content = content)

/** A tab root: fade-through motion between tabs; pushes from it still slide. */
inline fun <reified T : Any> NavGraphBuilder.tabRoot(
    motion: RrNavMotion,
    noinline content: @Composable AnimatedContentScope.(NavBackStackEntry) -> Unit,
) = composable<T>(
    enterTransition = { if (initialState.isTabRoot()) motion.tabEnter(this) else motion.popEnter(this) },
    exitTransition = { if (targetState.isTabRoot()) motion.tabExit(this) else motion.exit(this) },
    popEnterTransition = motion.popEnter,
    content = content,
)

/** A full-screen modal (Settings graph root, consent): slides up and down. */
inline fun <reified T : Any> NavGraphBuilder.modal(
    motion: RrNavMotion,
    noinline content: @Composable AnimatedContentScope.(NavBackStackEntry) -> Unit,
) = composable<T>(enterTransition = motion.modalEnter, popExitTransition = motion.modalExit, content = content)

/**
 * A bottom-sheet destination: a full-window dialog that draws `RrBottomSheet` (scrim, detents, drag to dismiss).
 * Back is handled by the sheet so a dirty form can ask "Discard changes?" first. Close by popping the back stack from
 * `onDismissRequest`.
 */
inline fun <reified T : Any> NavGraphBuilder.sheet(noinline content: @Composable (NavBackStackEntry) -> Unit) =
    dialog<T>(
        dialogProperties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
            dismissOnBackPress = false,
            dismissOnClickOutside = false,
        ),
        content = content,
    )

private val tabRoutes = listOf(TodayTab::class, DocumentsTab::class, ApplicationsTab::class, CareerTab::class)

/** True when the entry is one of the four tab roots (the tab bar shows only there). */
fun NavBackStackEntry.isTabRoot(): Boolean = tabIndex() != null

/** 0 Today, 1 Documents, 2 Applications, 3 Career, or null. */
fun NavBackStackEntry.tabIndex(): Int? {
    val route = destination.route ?: return null
    return tabRoutes.indexOfFirst { route.startsWith(it.qualifiedName!!) }.takeIf { it >= 0 }
}

/** Switches tabs the standard way: one copy of each tab root, state saved and restored. */
fun NavController.switchTab(route: Any) = navigate(route) {
    popUpTo(graph.startDestinationId) { saveState = true }
    launchSingleTop = true
    restoreState = true
}

/** Replaces the whole back stack (sign-in done, sign-out). */
fun NavController.resetTo(route: Any) = navigate(route) { popUpTo(0) { inclusive = true } }

/** Used by graphs that open a route only once (e.g. a sheet already on top). */
fun NavOptionsBuilder.single() { launchSingleTop = true }
