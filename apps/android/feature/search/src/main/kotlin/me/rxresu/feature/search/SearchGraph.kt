package me.rxresu.feature.search

import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import kotlinx.coroutines.launch
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.SearchScope
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.navigation.Application
import me.rxresu.core.navigation.Assistant
import me.rxresu.core.navigation.AtsChecker
import me.rxresu.core.navigation.Builder
import me.rxresu.core.navigation.Coach
import me.rxresu.core.navigation.Knowledge
import me.rxresu.core.navigation.KnowledgeTab
import me.rxresu.core.navigation.Letter
import me.rxresu.core.navigation.NewDocument
import me.rxresu.core.navigation.Offers
import me.rxresu.core.navigation.RrNavMotion
import me.rxresu.core.navigation.SaveJob
import me.rxresu.core.navigation.Search
import me.rxresu.core.navigation.Settings
import me.rxresu.core.navigation.SettingsPreferences
import me.rxresu.core.navigation.Story
import me.rxresu.core.navigation.Trash
import me.rxresu.core.navigation.WorkspaceTab

/** Registers D5. Presented with a quick fade (d2) rather than a slide, so the field appears where the icon was. */
fun NavGraphBuilder.searchGraph(nav: NavController, motion: RrNavMotion) {
    composable<Search>(
        enterTransition = { fadeIn(tween(RrMotion.D2, easing = RrMotion.ease)) },
        exitTransition = { fadeOut(tween(RrMotion.exit(RrMotion.D2), easing = RrMotion.ease)) },
        popEnterTransition = { fadeIn(tween(RrMotion.D2, easing = RrMotion.ease)) },
        popExitTransition = { fadeOut(tween(RrMotion.exit(RrMotion.D2), easing = RrMotion.ease)) },
    ) { entry -> SearchRoute(nav, entry.toRoute()) }
}

/** Route scope strings ("documents", "applications", "career", "settings") → repository scope. */
internal fun scopeOf(value: String?): SearchScope = SearchScope.entries.firstOrNull { it.name.equals(value, ignoreCase = true) } ?: SearchScope.All

@Composable
private fun SearchRoute(nav: NavController, route: Search) {
    val repos = LocalRepositories.current
    val vm = viewModel { SearchViewModel(repos.search, repos.documents, repos.applications, scopeOf(route.scope)) }
    val state by vm.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    fun open(row: SearchRow) {
        val hit = row.hit
        if (hit.kind == RECENT) { vm.setQuery(hit.title); return }
        scope.launch { runCatching { vm.remember() } }
        val target: Any? = when (hit.kind) {
            "resume" -> hit.documentId?.let { Builder(it) }
            "letter" -> hit.documentId?.let { Letter(it) }
            "application" -> hit.applicationId?.let { Application(it) }
            PREPARE -> hit.applicationId?.let { Application(it, WorkspaceTab.Prepare) }
            "thread" -> if (hit.documentId != null) Assistant(hit.documentId!!, hit.id) else Coach(hit.id)
            "fact" -> Knowledge(KnowledgeTab.Facts)
            "story" -> Story(hit.id)
            ASK -> Coach()
            else -> when (hit.id) {
                "settings" -> Settings
                "knowledge" -> Knowledge()
                "offers" -> Offers
                "ats-checker" -> AtsChecker()
                "trash" -> Trash()
                "new-letter" -> NewDocument
                "save-job" -> SaveJob()
                "theme", "language" -> SettingsPreferences
                else -> null
            }
        }
        target?.let { nav.navigate(it) }
    }

    SearchScreen(
        state,
        repos.time.now(),
        repos.time.timezone(),
        SearchCallbacks(
            onQuery = vm::setQuery,
            onScope = vm::setScope,
            onOpen = ::open,
            onSubmit = { state.first?.let(::open) },
            onShowAll = vm::expand,
            onCancel = { nav.popBackStack() },
        ),
    )
}
