package me.rxresu.feature.documents

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import me.rxresu.core.data.Resource
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.CopyResumeForJobRequest
import me.rxresu.core.network.generated.CopyResumeForJobRequestApplication
import me.rxresu.core.network.generated.CreateCoverLetterRequest
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.network.generated.DocumentType
import me.rxresu.core.network.generated.PurgeDocumentRequest
import me.rxresu.core.network.generated.PutDocumentApplicationRequest
import me.rxresu.core.network.generated.PutDocumentLockRequest
import me.rxresu.core.network.generated.RenameDocumentRequest
import me.rxresu.core.network.generated.SetDocumentTagsRequest
import me.rxresu.core.page.PageSource

data class DocumentActionsUiState(
    val document: DocumentSummary? = null,
    /** Every live document, for tag suggestions and the copy form's resume list. */
    val library: List<DocumentSummary> = emptyList(),
    val applications: List<Application> = emptyList(),
    val username: String? = null,
    val origin: String = "",
) {
    val tags: List<String> get() = library.flatMap { it.tags }.distinct().sorted()

    /** The resume's web page (`/<username>/<slug>`), only while it is public. */
    val publicUrl: String?
        get() {
            val doc = document ?: return null
            val slug = doc.slug ?: return null
            val user = username ?: return null
            if (doc.type != DocumentType.Resume || !doc.isPublic) return null
            return "${origin.trimEnd('/')}/${java.net.URLEncoder.encode(user, "UTF-8")}/${java.net.URLEncoder.encode(slug, "UTF-8")}"
        }
}

/** A job to copy a resume for: an existing application, or a new one saved with the copy. */
sealed interface JobChoice {
    data class Existing(val id: String) : JobChoice
    data class New(val company: String, val role: String, val posting: String) : JobChoice
}

/** D2 and D3 share the document writes: copy for a job, link, tags, lock, rename, duplicate, trash, new letter. */
class DocumentActionsViewModel(private val repos: RrRepositories, private val id: String?) : ViewModel() {
    private val documents = repos.documents

    val state: StateFlow<DocumentActionsUiState> = combine(
        documents.observe(),
        repos.applications.observe().onStart { emit(Resource(loading = true)) },
        repos.account.observeProfile().onStart { emit(Resource(loading = true)) },
        repos.authSession.origin,
    ) { docs, apps, profile, origin ->
        val all = docs.data.orEmpty()
        DocumentActionsUiState(
            document = all.firstOrNull { it.id == id },
            library = all,
            applications = apps.data.orEmpty(),
            username = profile.data?.username,
            origin = origin,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, DocumentActionsUiState())

    suspend fun rename(doc: DocumentSummary, name: String) =
        documents.renameDocument(RenameDocumentRequest(doc.id, name.trim(), doc.type))

    suspend fun setLocked(doc: DocumentSummary, locked: Boolean) =
        documents.putDocumentLock(doc.type, doc.id, PutDocumentLockRequest(locked))

    suspend fun setTags(doc: DocumentSummary, add: Set<String>, remove: Set<String>) =
        documents.setDocumentTags(SetDocumentTagsRequest(doc.id, (doc.tags - remove + add).distinct(), doc.type))

    /** Links the document to an application, or unlinks it with null. */
    suspend fun link(doc: DocumentSummary, applicationId: String?) {
        documents.putDocumentApplication(
            doc.type,
            doc.id,
            PutDocumentApplicationRequest(applicationId),
            if (applicationId == null) RequestOptions(nullFields = setOf("/applicationId")) else RequestOptions(),
        )
    }

    /** Returns the copy's id. */
    suspend fun duplicate(doc: DocumentSummary): String = documents.duplicate(doc.type, doc.id)

    suspend fun trash(doc: DocumentSummary) = documents.trashDocument(PurgeDocumentRequest(doc.id, doc.type))
    suspend fun restore(doc: DocumentSummary) = documents.restoreDocument(PurgeDocumentRequest(doc.id, doc.type))

    /** Copies [resumeId] for a job. Returns the copy's id. */
    suspend fun copyForJob(resumeId: String, job: JobChoice, name: String): String = documents.copyResumeForJob(
        CopyResumeForJobRequest(
            resumeId = resumeId,
            applicationId = (job as? JobChoice.Existing)?.id,
            application = (job as? JobChoice.New)?.let {
                val posting = it.posting.trim()
                val url = posting.takeIf { p -> p.startsWith("http://") || p.startsWith("https://") }
                CopyResumeForJobRequestApplication(company = it.company.trim(), role = it.role.trim(), sourceUrl = url, jobDescription = posting.takeIf { p -> p.isNotEmpty() && url == null })
            },
            name = name.trim().ifEmpty { null },
        ),
    )

    /** Returns the new letter's id. */
    suspend fun newLetter(name: String, resumeId: String? = null, applicationId: String? = null, sourceLetterId: String? = null): String =
        repos.letters.createCoverLetter(CreateCoverLetterRequest(name = name, resumeId = resumeId, applicationId = applicationId, sourceLetterId = sourceLetterId)).id

    /** The PDF on disk (server render, cached per revision). */
    suspend fun pdf(doc: DocumentSummary): java.io.File {
        val source = if (doc.type == DocumentType.Letter) PageSource.Letter(doc.id, doc.updatedAt) else PageSource.Resume(doc.id, doc.updatedAt)
        return repos.pages.render(source).file
    }

    companion object {
        /** "Lumen · Senior product designer", or "Product designer (copy)" without a job. */
        fun suggestedName(source: DocumentSummary?, company: String?, role: String?): String = when {
            !company.isNullOrBlank() && !role.isNullOrBlank() -> "${company.trim()} · ${role.trim()}"
            !company.isNullOrBlank() -> "${source?.name.orEmpty()} · ${company.trim()}".trimStart(' ', '·')
            else -> source?.name?.let { "$it (copy)" }.orEmpty()
        }
    }
}
