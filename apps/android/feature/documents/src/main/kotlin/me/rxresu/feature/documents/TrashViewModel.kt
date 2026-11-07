package me.rxresu.feature.documents

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import me.rxresu.core.data.ApplicationsRepository
import me.rxresu.core.data.DocumentQuery
import me.rxresu.core.data.DocumentsRepository
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.network.generated.ListTrashedApplicationsResponseItemsItem
import me.rxresu.core.network.generated.PurgeApplicationRequest
import me.rxresu.core.network.generated.PurgeDocumentRequest
import me.rxresu.core.network.generated.PurgeDocumentsRequest

typealias TrashedApplication = ListTrashedApplicationsResponseItemsItem

data class TrashUiState(
    val loading: Boolean = true,
    val error: Boolean = false,
    val offline: Boolean = false,
    val documents: List<DocumentSummary> = emptyList(),
    val applications: List<TrashedApplication> = emptyList(),
    val selection: Set<String> = emptySet(),
)

/** D6: one Trash for documents (30 days) and applications (kept until deleted). */
class TrashViewModel(
    private val documents: DocumentsRepository,
    private val applications: ApplicationsRepository,
) : ViewModel() {
    private val trashedApps = MutableStateFlow<List<TrashedApplication>>(emptyList())
    private val selection = MutableStateFlow<Set<String>>(emptySet())
    private val hidden = MutableStateFlow<Set<String>>(emptySet())

    val state: StateFlow<TrashUiState> = combine(
        documents.observe(DocumentQuery(trashed = true)),
        trashedApps,
        selection,
        hidden,
    ) { docs, apps, selected, gone ->
        TrashUiState(
            loading = docs.data == null && docs.error == null,
            error = docs.data == null && docs.error != null,
            offline = docs.offline,
            documents = docs.data.orEmpty().filter { it.id !in gone },
            applications = apps.filter { it.id !in gone },
            selection = selected,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TrashUiState())

    init { viewModelScope.launch { loadApplications() } }

    suspend fun loadApplications() {
        runCatching { applications.listTrashedApplications() }.onSuccess { trashedApps.value = it.items }
    }

    fun toggle(id: String) = selection.update { if (id in it) it - id else it + id }
    fun clearSelection() { selection.value = emptySet() }

    suspend fun restore(doc: DocumentSummary) = hiding(doc.id) { documents.restoreDocument(PurgeDocumentRequest(doc.id, doc.type)) }
    suspend fun purge(doc: DocumentSummary) = hiding(doc.id) { documents.purgeDocument(PurgeDocumentRequest(doc.id, doc.type)) }

    suspend fun restore(app: TrashedApplication) = hiding(app.id) { applications.restoreApplication(app.id, PurgeApplicationRequest(app.trashedAt)) }
    suspend fun purge(app: TrashedApplication) = hiding(app.id) { applications.purgeApplication(app.id, PurgeApplicationRequest(app.trashedAt)) }

    /** Restores or deletes the selected documents. Returns how many changed. */
    suspend fun applyToSelection(restore: Boolean): Int {
        val docs = state.value.documents.filter { it.id in selection.value }
        if (docs.isEmpty()) return 0
        val body = PurgeDocumentsRequest(docs.map { PurgeDocumentRequest(it.id, it.type) })
        hidden.update { it + docs.map { d -> d.id } }
        return try {
            val count = if (restore) documents.restoreDocuments(body).restored.toInt() else documents.purgeDocuments(body).deleted.toInt()
            selection.value = emptySet()
            count
        } catch (e: Exception) {
            hidden.update { it - docs.map { d -> d.id }.toSet() }
            throw e
        }
    }

    /** Deletes every document in Trash. Returns how many. */
    suspend fun empty(): Long = documents.emptyDocumentTrash().deleted

    private suspend fun hiding(id: String, write: suspend () -> Unit) {
        hidden.update { it + id }
        try {
            write()
            if (trashedApps.value.any { it.id == id }) trashedApps.update { list -> list.filterNot { it.id == id } }
        } catch (e: Exception) {
            hidden.update { it - id }
            throw e
        }
    }
}
