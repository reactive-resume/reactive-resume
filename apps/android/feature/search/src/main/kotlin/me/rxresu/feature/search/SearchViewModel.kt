package me.rxresu.feature.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import me.rxresu.core.data.ApplicationsRepository
import me.rxresu.core.data.DocumentsRepository
import me.rxresu.core.data.Resource
import me.rxresu.core.data.SearchHit
import me.rxresu.core.data.SearchRepository
import me.rxresu.core.data.SearchScope
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.DocumentSummary

/** Result groups, in the order they show. Content ranks above Go to… and Actions. */
enum class SearchGroupKey { Recent, Documents, Applications, Chats, Career, GoTo, Actions }

/** One result row. Derived rows (Prepare for…, Ask the coach) have no [hit] payload beyond their id and title. */
data class SearchRow(
    val hit: SearchHit,
    val document: DocumentSummary? = null,
    val application: Application? = null,
)

data class SearchGroup(val key: SearchGroupKey, val rows: List<SearchRow>)

data class SearchUiState(
    val query: String = "",
    val scope: SearchScope = SearchScope.All,
    val loading: Boolean = false,
    val offline: Boolean = false,
    val failed: Boolean = false,
    val groups: List<SearchGroup> = emptyList(),
    val expanded: Set<SearchGroupKey> = emptySet(),
) {
    /** The row the Search key opens. */
    val first: SearchRow? get() = groups.firstOrNull { it.key != SearchGroupKey.Recent }?.rows?.firstOrNull()
    val empty: Boolean get() = query.isNotBlank() && !loading && groups.all { g -> g.rows.all { it.hit.kind == ASK } }
}

internal const val PREPARE = "prepare"
internal const val ASK = "ask"
internal const val RECENT = "recent"

/** D5: searches as the person types (no animation, no haptics while typing). */
@OptIn(ExperimentalCoroutinesApi::class, FlowPreview::class)
class SearchViewModel(
    private val search: SearchRepository,
    documents: DocumentsRepository,
    applications: ApplicationsRepository,
    scope: SearchScope,
    debounceMs: Long = DEBOUNCE_MS,
) : ViewModel() {
    private val query = MutableStateFlow("")
    private val scope = MutableStateFlow(scope)
    private val expanded = MutableStateFlow<Set<SearchGroupKey>>(emptySet())

    private val results = combine(query.debounce { if (it.isBlank()) 0L else debounceMs }, this.scope) { q, s -> q to s }
        .flatMapLatest { (q, s) -> search.search(q.trim(), s).map { Triple(q, s, it) } }

    val state: StateFlow<SearchUiState> = combine(
        results,
        search.recentSearches,
        documents.observe().onStart { emit(Resource()) },
        applications.observe().onStart { emit(Resource()) },
        combine(query, this.scope, expanded, ::Triple),
    ) { (q, s, hits), recent, docs, apps, (typed, currentScope, open) ->
        val stale = q != typed || s != currentScope
        SearchUiState(
            query = typed,
            scope = currentScope,
            loading = hits.loading || stale && typed.isNotBlank(),
            offline = hits.offline,
            failed = hits.error != null && !hits.offline && hits.data.isNullOrEmpty(),
            groups = group(typed.trim(), hits.data.orEmpty(), recent, docs.data.orEmpty(), apps.data.orEmpty()),
            expanded = open,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SearchUiState(scope = scope))

    fun setQuery(text: String) { query.value = text; expanded.value = emptySet() }
    fun setScope(value: SearchScope) { scope.value = value; expanded.value = emptySet() }
    fun expand(key: SearchGroupKey) = expanded.update { it + key }

    /** Keeps the query in Recent searches. */
    suspend fun remember() = search.remember(query.value)

    companion object {
        const val DEBOUNCE_MS = 200L

        fun group(query: String, hits: List<SearchHit>, recent: List<String>, docs: List<DocumentSummary>, apps: List<Application>): List<SearchGroup> {
            val byDoc = docs.associateBy { it.id }
            val byApp = apps.associateBy { it.id }
            val buckets = linkedMapOf<SearchGroupKey, MutableList<SearchRow>>()
            fun add(key: SearchGroupKey, row: SearchRow) { buckets.getOrPut(key) { mutableListOf() } += row }
            if (query.isEmpty()) recent.forEach { add(SearchGroupKey.Recent, SearchRow(SearchHit(it, it, "", RECENT))) }
            for (hit in hits) {
                val key = when (hit.kind) {
                    "resume", "letter" -> SearchGroupKey.Documents
                    "application" -> SearchGroupKey.Applications
                    "thread" -> SearchGroupKey.Chats
                    "fact", "story" -> SearchGroupKey.Career
                    "destination" -> SearchGroupKey.GoTo
                    else -> SearchGroupKey.Actions
                }
                add(key, SearchRow(hit, hit.documentId?.let(byDoc::get), hit.applicationId?.let(byApp::get)))
            }
            if (query.isNotEmpty()) {
                // Matching applications offer their next step; any query can go to the coach.
                hits.filter { it.kind == "application" }.take(1).forEach { app ->
                    add(SearchGroupKey.Actions, SearchRow(SearchHit("$PREPARE:${app.id}", app.title, "", PREPARE, applicationId = app.applicationId)))
                }
                add(SearchGroupKey.Actions, SearchRow(SearchHit(ASK, query, "", ASK)))
            }
            return SearchGroupKey.entries.mapNotNull { key -> buckets[key]?.let { SearchGroup(key, it) } }
        }
    }
}
