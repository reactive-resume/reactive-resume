package me.rxresu.feature.search

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.data.SearchScope
import me.rxresu.core.testing.RrScreenshotTest
import me.rxresu.core.testing.captureScreen
import org.junit.Test

class SearchScreenshotTest : RrScreenshotTest() {
    @Test fun light() = captureScreen("D5-Search", dark = false, wrap = provide(FakeRepositories())) { Search("lumen") }
    @Test fun dark() = captureScreen("D5-Search", dark = true, wrap = provide(FakeRepositories())) { Search("lumen") }
    @Test fun emptyQuery() = captureScreen("D5-Search-empty-query", dark = false, wrap = provide(FakeRepositories())) { Search("") }
    @Test fun noMatches() = captureScreen("D5-Search-no-matches", dark = false, wrap = provide(FakeRepositories())) { Search("zzzz", SearchScope.Documents) }
}

private fun provide(repos: RrRepositories): @Composable (@Composable () -> Unit) -> Unit = { content ->
    CompositionLocalProvider(LocalRepositories provides repos) { content() }
}

@Composable
private fun Search(query: String, scope: SearchScope = SearchScope.All) {
    val repos = LocalRepositories.current
    val vm = remember { SearchViewModel(repos.search, repos.documents, repos.applications, scope, debounceMs = 0).apply { setQuery(query) } }
    val state by vm.state.collectAsState()
    SearchScreen(state, repos.time.now(), repos.time.timezone(), SearchCallbacks())
}
