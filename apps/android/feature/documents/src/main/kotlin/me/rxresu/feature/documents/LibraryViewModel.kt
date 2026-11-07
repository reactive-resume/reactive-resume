package me.rxresu.feature.documents

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import me.rxresu.core.data.AccountRepository
import me.rxresu.core.data.DocumentQuery
import me.rxresu.core.data.DocumentsRepository
import me.rxresu.core.data.Resource
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.network.generated.DocumentType
import me.rxresu.core.network.generated.ListDocumentsSort
import me.rxresu.core.network.generated.PurgeDocumentRequest
import me.rxresu.core.network.generated.SetDocumentTagsRequest

enum class LibraryType { All, Resume, Letter }

data class LibraryFilters(
    val type: LibraryType = LibraryType.All,
    val tag: String? = null,
    val sort: ListDocumentsSort = ListDocumentsSort.Edited,
    val grid: Boolean = true,
) {
    val active: Boolean get() = type != LibraryType.All || tag != null
}

data class LibraryUiState(
    val loading: Boolean = true,
    val offline: Boolean = false,
    val error: Boolean = false,
    val refreshing: Boolean = false,
    val initials: String = "",
    /** Every document in the library (before type and tag filters). */
    val all: List<DocumentSummary> = emptyList(),
    /** What the grid shows. */
    val documents: List<DocumentSummary> = emptyList(),
    val filters: LibraryFilters = LibraryFilters(),
    val selection: Set<String> = emptySet(),
) {
    val resumes: Int get() = all.count { it.type == DocumentType.Resume }
    val letters: Int get() = all.count { it.type == DocumentType.Letter }
    val tags: List<String> get() = all.flatMap { it.tags }.distinct().sorted()
    val selecting: Boolean get() = selection.isNotEmpty()
    val selected: List<DocumentSummary> get() = all.filter { it.id in selection }
}

/** D1: one live query of the library, filtered by type and tag on device so the counts stay whole. */
@OptIn(ExperimentalCoroutinesApi::class)
class LibraryViewModel(
    private val documents: DocumentsRepository,
    account: AccountRepository,
) : ViewModel() {
    private val filters = MutableStateFlow(LibraryFilters())
    private val selection = MutableStateFlow<Set<String>>(emptySet())
    private val refreshing = MutableStateFlow(false)
    /** Rows leave at once when moved to Trash; the next refresh confirms it. */
    private val hidden = MutableStateFlow<Set<String>>(emptySet())

    val state: StateFlow<LibraryUiState> = combine(
        filters.flatMapLatest { f -> documents.observe(DocumentQuery(sort = f.sort.wireValue)) },
        filters,
        account.observeProfile().onStart { emit(Resource(loading = true)) },
        combine(selection, refreshing, hidden, ::Triple),
    ) { docs, f, profile, (selected, refresh, gone) ->
        val all = docs.data.orEmpty().filter { it.id !in gone }
        LibraryUiState(
            loading = docs.data == null && docs.error == null,
            offline = docs.offline,
            error = docs.data == null && docs.error != null,
            refreshing = refresh,
            initials = initials(profile.data?.name.orEmpty()),
            all = all,
            documents = filter(all, f),
            filters = f,
            selection = selected.filterTo(mutableSetOf()) { id -> all.any { it.id == id } },
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), LibraryUiState())

    fun setType(type: LibraryType) = filters.update { it.copy(type = type) }
    fun setTag(tag: String?) = filters.update { it.copy(tag = tag) }
    fun setSort(sort: ListDocumentsSort) = filters.update { it.copy(sort = sort) }
    fun setGrid(grid: Boolean) = filters.update { it.copy(grid = grid) }
    fun clearFilters() = filters.update { it.copy(type = LibraryType.All, tag = null) }

    fun toggle(id: String) = selection.update { if (id in it) it - id else it + id }
    fun select(id: String) = selection.update { it + id }
    fun clearSelection() { selection.value = emptySet() }

    suspend fun refresh() {
        refreshing.value = true
        try { documents.refresh() } finally { refreshing.value = false }
    }

    suspend fun trash(doc: DocumentSummary) {
        hidden.update { it + doc.id }
        try {
            documents.trashDocument(PurgeDocumentRequest(doc.id, doc.type))
        } catch (e: Exception) {
            hidden.update { it - doc.id }
            throw e
        }
    }

    suspend fun restore(doc: DocumentSummary) {
        documents.restoreDocument(PurgeDocumentRequest(doc.id, doc.type))
        hidden.update { it - doc.id }
    }

    /** Moves the selection to Trash, skipping locked documents. Returns the documents moved. */
    suspend fun trashSelection(): List<DocumentSummary> {
        val moved = mutableListOf<DocumentSummary>()
        for (doc in state.value.selected.filterNot { it.isLocked }) {
            if (runCatching { trash(doc) }.isSuccess) moved += doc
        }
        selection.update { ids -> ids - moved.map { it.id }.toSet() }
        return moved
    }

    /** Adds and removes tags across the selection (locked documents are skipped). */
    suspend fun setTags(docs: List<DocumentSummary>, add: Set<String>, remove: Set<String>) {
        for (doc in docs.filterNot { it.isLocked }) {
            val next = (doc.tags - remove + add).distinct()
            if (next != doc.tags) documents.setDocumentTags(SetDocumentTagsRequest(doc.id, next, doc.type))
        }
    }

    companion object {
        fun filter(all: List<DocumentSummary>, f: LibraryFilters): List<DocumentSummary> = all.filter { doc ->
            (f.type == LibraryType.All || (f.type == LibraryType.Resume) == (doc.type == DocumentType.Resume)) &&
                (f.tag == null || f.tag in doc.tags)
        }

        fun initials(name: String): String =
            name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.let { listOfNotNull(it.firstOrNull(), it.drop(1).lastOrNull()) }
                .joinToString("") { it.first().uppercase() }
    }
}
