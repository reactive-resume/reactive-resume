package me.rxresu.feature.share

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import me.rxresu.core.data.*
import me.rxresu.core.network.generated.*

internal data class ShareState(
    val draft: DraftState<Resume> = DraftState(null),
    val loading: Boolean = true, val busy: Boolean = false, val failed: Boolean = false,
    val username: String = "", val origin: String = "", val slug: String = "", val slugTaken: Boolean = false,
    val checking: Boolean = false, val slugInvalid: Boolean = false,
    val primaryLoaded: Boolean = false, val otherPrimary: ResumeSummary? = null,
    val daily: List<GetResumeDailyStatisticsResponseItem> = emptyList(),
    val links: List<CreateFeedbackLinkResponse> = emptyList(),
    val versions: List<ResumeVersionSummary> = emptyList(),
    val domain: GetCustomDomainResponse? = null,
    val link: GetFeedbackLinkResponse? = null,
    val applications: List<Application> = emptyList(),
) {
    val resume get() = draft.document
    val url get() = "${origin.trimEnd('/')}/${android.net.Uri.encode(username)}/${android.net.Uri.encode(resume?.slug.orEmpty())}"
    val shortUrl get() = "${origin.trimEnd('/')}/${android.net.Uri.encode(username)}"
    val views get() = daily.takeLast(30).sumOf { it.views }.toLong()
    val downloads get() = daily.takeLast(30).sumOf { it.downloads }.toLong()
    val editable get() = !busy && resume != null && !draft.locked && resume?.isLocked != true
}

internal class ShareViewModel(private val repositories: RrRepositories, private val id: String) : ViewModel() {
    private val mutable = MutableStateFlow(ShareState())
    val state = mutable.asStateFlow()
    private var draft: DocumentDraft<Resume>? = null
    private val writes = Mutex()
    private var slugJob: Job? = null
    init {
        viewModelScope.launch {
            try {
                val handle = repositories.resumes.openDraft(id)
                draft = handle
                launch { handle.state.collect { saved -> mutable.update { it.copy(draft = saved, loading = false,
                    slug = if (it.slug == it.resume?.slug || it.loading) saved.document?.slug.orEmpty() else it.slug) } } }
                launch { repositories.account.observeProfile().collect { profile -> profile.data?.let { value -> mutable.update { it.copy(username = value.username) } } } }
                val session = repositories.account.session.value
                val server = when (session) { is me.rxresu.core.auth.SessionState.SignedIn -> session.server; else -> "" }
                mutable.update { it.copy(origin = server) }
                refresh()
            } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(loading = false, failed = true) } }
        }
    }
    fun retry() { viewModelScope.launch { refresh() } }
    private suspend fun refresh() {
        mutable.update { it.copy(failed = false, primaryLoaded = false) }
        supervisorScope {
            suspend fun attempt(action: suspend () -> Unit) { try { action() } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } } }
            listOf(
                launch { attempt { val flags = repositories.platform.getFeatureFlags(); flags.aliasUrl?.let { alias -> mutable.update { it.copy(origin = alias) } } } },
                launch { attempt { val resumes = repositories.resumes.listResumes(); mutable.update { it.copy(primaryLoaded = true, otherPrimary = resumes.firstOrNull { other -> other.isPrimary && other.id != id }) } } },
                launch { attempt { val v = repositories.resumes.getResumeDailyStatistics(id, 30); mutable.update { it.copy(daily = v) } } },
                launch { attempt { val v = repositories.resumes.listFeedbackLinks(id); mutable.update { it.copy(links = v) } } },
                launch { attempt { val v = repositories.resumes.listResumeVersions(id); mutable.update { it.copy(versions = v) } } },
                launch { attempt { val v = repositories.resumes.getCustomDomain(); mutable.update { it.copy(domain = v) } } },
                launch { attempt { val v = repositories.applications.listApplications(); mutable.update { it.copy(applications = v) } } },
            ).joinAll()
        }
    }
    fun write(change: (Resume) -> UpdateResumeRequest, done: () -> Unit = {}) = action {
        draft!!.writeMetadata { before -> before.withWriteResult(repositories.resumes.updateResume(id, change(before).copy(expectedUpdatedAt = before.updatedAt))) }
        done()
    }
    fun credit(show: Boolean) = action {
        val handle = requireNotNull(draft); val before = requireNotNull(handle.state.value.document)
        check(!before.isLocked)
        handle.update(before.copy(data = before.data.copy(metadata = before.data.metadata.copy(web = CreateDocxParseResponseMetadataWeb(show)))))
    }
    fun slug(value: String) {
        val normalized = value.lowercase().replace(' ', '-')
        slugJob?.cancel()
        mutable.update { it.copy(slug = normalized, slugInvalid = !validSlug(normalized), slugTaken = false, checking = validSlug(normalized) && normalized != it.resume?.slug) }
        if (!validSlug(normalized) || normalized == state.value.resume?.slug) return
        slugJob = viewModelScope.launch {
            delay(300)
            try {
                val result = repositories.resumes.checkResumeSlug(id, normalized)
                if (state.value.slug != normalized) return@launch
                val available = result.status == CheckResumeSlugResponseStatus.Available
                mutable.update { it.copy(slugTaken = !available) }
                if (available) writes.withLock {
                    draft!!.writeMetadata { before -> before.withWriteResult(repositories.resumes.updateResume(id, UpdateResumeRequest(slug = normalized, expectedUpdatedAt = before.updatedAt))) }
                }
            } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } }
            finally { if (state.value.slug == normalized) mutable.update { it.copy(checking = false) } }
        }
    }
    fun password(value: String?, done: () -> Unit) = action {
        draft!!.writeMetadata { before -> before.withWriteResult(if (value == null) repositories.resumes.removeResumePassword(id, RemoveResumePasswordRequest(JsonPrimitive(before.updatedAt))) else repositories.resumes.setResumePassword(id, SetResumePasswordRequest(JsonPrimitive(before.updatedAt), value))) }
        done()
    }
    fun domain(host: String) = action { val result = repositories.resumes.setCustomDomain(SetCustomDomainRequest(host)); mutable.update { it.copy(domain = result) } }
    fun verifyDomain() = action { val result = repositories.resumes.verifyCustomDomain(); mutable.update { it.copy(domain = result) } }
    fun removeDomain() = action { repositories.resumes.removeCustomDomain(); mutable.update { it.copy(domain = null) } }
    fun feedback(label: String, comments: Boolean, days: Int, applications: List<String>, done: (String) -> Unit) = action {
        val expiry = if (days == 0) null else repositories.time.now().plusSeconds(days * 86400L).toString()
        val link = repositories.resumes.createFeedbackLink(CreateFeedbackLinkRequest(comments, applications, expiry, label, id))
        mutable.update { it.copy(links = listOf(link) + it.links) }; done(link.url)
    }
    fun link(id: String) = action { val value = repositories.resumes.getFeedbackLink(id); mutable.update { it.copy(link = value) } }
    fun closeLink() { mutable.update { it.copy(link = null) } }
    fun revoke(id: String, done: () -> Unit) = action { repositories.resumes.revokeFeedbackLink(id); mutable.update { it.copy(link = null) }; refresh(); done() }
    fun nameVersion(name: String, version: String? = null, done: () -> Unit) = action {
        draft!!.flush()
        check(draft!!.state.value.status == me.rxresu.core.database.SaveStatus.Saved)
        if (version == null) repositories.resumes.createResumeVersion(id, PatchDocumentNameRequest(name)) else repositories.resumes.renameResumeVersion(id, version, PatchDocumentNameRequest(name))
        refresh(); done()
    }
    fun deleteVersion(version: String, done: () -> Unit) = action { repositories.resumes.deleteResumeVersion(id, version); refresh(); done() }
    fun restore(version: String, done: () -> Unit) = action {
        draft!!.writeMetadata { before ->
            check(!before.isLocked)
            before.withWriteResult(repositories.resumes.restoreResumeVersion(id, version, RestoreResumeVersionRequest(PatchResumeRequestProposalSafety.V1)))
        }
        draft!!.refresh(); refresh(); done()
    }
    fun lock(done: () -> Unit) = action {
        draft!!.writeMetadata { before -> before.withWriteResult(repositories.resumes.setResumeLocked(id, PutResumeLockRequest(JsonPrimitive(before.updatedAt), !before.isLocked))) }
        draft!!.refresh(); done()
    }
    fun notes(value: String, done: () -> Unit) = action {
        val handle = requireNotNull(draft); val before = requireNotNull(handle.state.value.document)
        handle.update(before.copy(data = before.data.copy(metadata = before.data.metadata.copy(notes = value)))); handle.flush(); done()
    }
    fun duplicate(done: (String) -> Unit) = action { draft!!.flush(); check(draft!!.state.value.status == me.rxresu.core.database.SaveStatus.Saved); done(repositories.resumes.duplicateResume(id)) }
    fun trash(done: () -> Unit) = action { draft!!.flush(); check(state.value.resume?.isLocked == false); repositories.documents.trashDocument(PurgeDocumentRequest(id, DocumentType.Resume)); done() }
    fun untrash() = action { repositories.documents.restoreDocument(PurgeDocumentRequest(id, DocumentType.Resume)) }
    private fun action(block: suspend () -> Unit) = viewModelScope.launch {
        writes.withLock {
            mutable.update { it.copy(busy = true, failed = false) }
            try { block() } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } }
            finally { mutable.update { it.copy(busy = false) } }
        }
    }
}
internal fun validSlug(value: String) = value.length in 1..64 && Regex("[a-z0-9]+(?:-[a-z0-9]+)*").matches(value)
