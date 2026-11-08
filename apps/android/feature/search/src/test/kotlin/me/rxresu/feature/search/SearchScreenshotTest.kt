package me.rxresu.feature.search

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import me.rxresu.core.data.SearchHit
import me.rxresu.core.data.StoryboardIds
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.data.SearchScope
import me.rxresu.core.testing.RrScreenshotTest
import me.rxresu.core.testing.captureScreen
import org.junit.Test

class SearchScreenshotTest : RrScreenshotTest() {
    @Test fun rtl() = captureScreen("D5-Search-rtl", false, wrap = provide(FakeRepositories())) {
        CompositionLocalProvider(androidx.compose.ui.platform.LocalLayoutDirection provides androidx.compose.ui.unit.LayoutDirection.Rtl) { StoryboardSearch() }
    }
    @Test fun light() = captureScreen("D5-Search", dark = false, wrap = provide(FakeRepositories())) { StoryboardSearch() }
    @Test fun dark() = captureScreen("D5-Search", dark = true, wrap = provide(FakeRepositories())) { StoryboardSearch() }
    @Test fun fontScale() = captureScreen("D5-Search", dark = false, wrap = provide(FakeRepositories()), fontScale = 2f) { StoryboardSearch() }
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

@Composable
private fun StoryboardSearch() {
    val r = LocalRepositories.current
    val state = remember { runBlocking {
        val app = r.applications.listApplications().first { it.id == StoryboardIds.lumen }
        val docs = r.documents.listDocuments()
        val resume = docs.first { it.id == StoryboardIds.lumenResume }
        val letter = docs.first { it.id == StoryboardIds.lumenLetter }.copy(name = "Letter for Lumen")
        SearchUiState(query = "lumen", groups = listOf(
            SearchGroup(SearchGroupKey.Applications, listOf(SearchRow(SearchHit(app.id, app.company, app.role, "application", applicationId = app.id), application = app))),
            SearchGroup(SearchGroupKey.Documents, listOf(resume, letter).map { doc -> SearchRow(SearchHit(doc.id, doc.name, "", doc.type.wireValue, documentId = doc.id), document = doc) }),
            SearchGroup(SearchGroupKey.Chats, listOf(SearchRow(SearchHit("message-thank-you", "Thank-you note to Priya", "Draft · Lumen", "message", applicationId = app.id)))),
        ))
    } }
    SearchScreen(state, r.time.now(), r.time.timezone(), SearchCallbacks())
}
