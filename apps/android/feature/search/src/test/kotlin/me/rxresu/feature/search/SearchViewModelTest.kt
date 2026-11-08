package me.rxresu.feature.search

import androidx.compose.ui.text.font.FontWeight
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.SearchHit
import me.rxresu.core.data.SearchScope
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SearchViewModelTest {
    private val main = StandardTestDispatcher()
    @Before fun main() = Dispatchers.setMain(main)
    @After fun reset() = Dispatchers.resetMain()

    @Test fun groupsApplicationsThenDocumentsAboveShortcuts() {
        val hits = listOf(
            SearchHit("settings", "Settings", "", "destination"),
            SearchHit("a", "Lumen", "Senior product designer", "application", applicationId = "a"),
            SearchHit("r", "Lumen · Senior", "", "resume", documentId = "r"),
        )
        val groups = SearchViewModel.group("lumen", hits, recent = listOf("kiln"), docs = emptyList(), apps = emptyList())
        assertEquals(listOf(SearchGroupKey.Applications, SearchGroupKey.Documents, SearchGroupKey.GoTo), groups.map { it.key })
        assertEquals("a", groups.first().rows.first().hit.applicationId)
        assertTrue(groups.none { it.rows.any { row -> row.hit.kind == PREPARE || row.hit.kind == ASK } })
    }

    @Test fun recentSearchesOnlyWithAnEmptyQuery() {
        assertEquals(SearchGroupKey.Recent, SearchViewModel.group("", emptyList(), listOf("kiln"), emptyList(), emptyList()).single().key)
        assertTrue(SearchViewModel.group("x", emptyList(), listOf("kiln"), emptyList(), emptyList()).none { it.key == SearchGroupKey.Recent })
    }

    @Test fun highlightsEveryMatchIgnoringCase() {
        val text = highlight("Lumen cover letter for lumen", "lumen")
        assertEquals(listOf(0 until 5, 23 until 28), text.spanStyles.map { it.start until it.end })
        assertTrue(text.spanStyles.all { it.item.fontWeight == FontWeight.SemiBold })
        assertTrue(highlight("Kiln", "").spanStyles.isEmpty())
    }

    @Test fun typingWaitsForThePauseThenSearches() = runTest(main) {
        val repos = FakeRepositories()
        val vm = SearchViewModel(repos.search, repos.documents, repos.applications, SearchScope.Documents)
        val collector = backgroundScope.launchCollect(vm)
        vm.setQuery("lumen")
        assertTrue(vm.state.first { it.query == "lumen" }.loading)
        advanceTimeBy(SearchViewModel.DEBOUNCE_MS + 1)
        val state = vm.state.first { !it.loading }
        assertEquals(listOf(SearchGroupKey.Documents), state.groups.map { it.key })
        assertTrue(state.groups.first().rows.all { it.hit.title.contains("Lumen", ignoreCase = true) })
        assertFalse(state.empty)
        collector.cancel()
    }

    @Test fun noMatchesIsEmpty() = runTest(main) {
        val repos = FakeRepositories()
        val vm = SearchViewModel(repos.search, repos.documents, repos.applications, SearchScope.Documents, debounceMs = 0)
        val collector = backgroundScope.launchCollect(vm)
        vm.setQuery("zzzz")
        assertTrue(vm.state.first { !it.loading && it.query == "zzzz" }.empty)
        collector.cancel()
    }

    @Test fun messageResultsKeepApplicationIdentityAndFollowDocuments() {
        val hits = listOf(
            SearchHit("message", "Thank-you note to Priya", "Draft · Lumen", "message", applicationId = "lumen"),
            SearchHit("resume", "Product designer — Lumen", "", "resume", documentId = "resume"),
        )
        val groups = SearchViewModel.group("lumen", hits, emptyList(), emptyList(), emptyList())
        assertEquals(listOf(SearchGroupKey.Documents, SearchGroupKey.Chats), groups.map { it.key })
        assertEquals("lumen", groups.last().rows.single().hit.applicationId)
    }

    @Test fun scopeStrings() {
        assertEquals(SearchScope.Applications, scopeOf("applications"))
        assertEquals(SearchScope.All, scopeOf(null))
        assertEquals(SearchScope.All, scopeOf("nope"))
    }
}

private fun kotlinx.coroutines.CoroutineScope.launchCollect(vm: SearchViewModel) = launch { vm.state.collect {} }
