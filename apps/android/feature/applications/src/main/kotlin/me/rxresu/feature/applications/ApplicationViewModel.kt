package me.rxresu.feature.applications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import me.rxresu.core.data.ApplicationNextStep
import me.rxresu.core.data.ApplicationQuery
import me.rxresu.core.data.ApplicationsRepository
import me.rxresu.core.data.CareerRepository
import me.rxresu.core.data.ResumeRepository
import me.rxresu.core.data.DocumentsRepository
import me.rxresu.core.data.TimeSource
import me.rxresu.core.data.applicationNextStep
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.Interview
import me.rxresu.core.network.generated.Offer
import me.rxresu.core.network.generated.PatchApplicationRequest
import me.rxresu.core.network.generated.AddApplicationNoteRequest
import me.rxresu.core.network.generated.SavedItem
import me.rxresu.core.network.generated.MessageDraft

/** Names of what was sent, for "What you sent". */
internal data class SentDocuments(val resumeName: String? = null, val resumeVersion: String? = null, val letterName: String? = null)

internal data class ApplicationState(
    val app: Application? = null,
    val lanes: List<Lane> = emptyList(),
    val offer: Offer? = null,
    val offerKnown: Boolean = false,
    val saved: List<SavedItem> = emptyList(),
    val sent: SentDocuments = SentDocuments(),
    val loading: Boolean = true,
    val offline: Boolean = false,
    val failed: Boolean = false,
    val now: Instant = Instant.EPOCH,
) {
    fun nextStep(time: TimeSource): ApplicationNextStep? = app?.let { applicationNextStep(it, time, offer, offerKnown) }

    /** The interview a workspace is about: the next one to come, else one that ended in the last day (web shell). */
    val interview: Interview? get() {
        val all = app?.activity?.filterIsInstance<Interview>()?.sortedBy { it.at } ?: return null
        fun end(i: Interview) = Instant.parse(i.at).plusSeconds((i.durationMinutes ?: 60) * 60)
        return all.firstOrNull { end(it) >= now } ?: all.lastOrNull { now.toEpochMilli() - end(it).toEpochMilli() < DAY_MS }
    }

    /** Messages shows a badge while the newest read message waits for a decision. */
    val unreadMessages: Int get() = (saved.maxByOrNull { if (it.data is MessageDraft) it.createdAt else "" }?.data as? MessageDraft)
        ?.let { if (it.changes.isNotEmpty() && it.applied == null) 1 else 0 } ?: 0
}

internal class ApplicationViewModel(
    private val apps: ApplicationsRepository,
    private val career: CareerRepository,
    private val resumes: ResumeRepository,
    private val documents: DocumentsRepository,
    val time: TimeSource,
    val id: String,
) : ViewModel() {
    private val extras = MutableStateFlow(ApplicationState())
    val moves = ApplicationMoves(apps)

    val state: StateFlow<ApplicationState> = combine(apps.observe(ApplicationQuery(showClosed = true)), extras) { list, extra ->
        val app = list.data?.firstOrNull { it.id == id }
        extra.copy(
            app = app ?: extra.app,
            loading = list.data == null && list.loading,
            offline = list.offline,
            failed = app == null && extra.app == null && list.error != null,
            now = time.now(),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ApplicationState(now = time.now()))

    init { load() }

    private fun load() = viewModelScope.launch {
        runCatching { apps.getApplicationLanes().lanes }.onSuccess { lanes -> extras.value = extras.value.copy(lanes = lanes) }
        val saved = runCatching { career.listCareerSavedItems(applicationId = id) }.getOrNull()
        val offer = saved?.filter { it.data is Offer && !it.outdated }?.maxByOrNull { it.createdAt }?.data as? Offer
        extras.value = extras.value.copy(saved = saved.orEmpty(), offer = offer, offerKnown = saved != null)
        val app = runCatching { apps.getApplication(id) }.getOrNull() ?: return@launch
        val docs = runCatching { documents.listDocuments() }.getOrNull()
        val version = app.sentResumeVersionId?.let { vid -> app.resumeId?.let { rid -> runCatching { resumes.listResumeVersions(rid).firstOrNull { it.id == vid }?.name }.getOrNull() } }
        extras.value = extras.value.copy(
            sent = SentDocuments(
                resumeName = docs?.firstOrNull { it.id == app.resumeId }?.name,
                resumeVersion = version,
                letterName = docs?.firstOrNull { it.id == app.coverLetterId }?.name,
            ),
        )
    }

    fun retry() {
        viewModelScope.launch { runCatching { apps.refresh() } }
        load()
    }

    /** Runs a write and reports whether it worked; the list observer picks up the new row. */
    suspend fun write(block: suspend () -> Unit): Boolean = try {
        block(); true
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        false
    }

    suspend fun logFollowUp() = write { apps.logApplicationFollowUp(id) }
    suspend fun addNote(text: String) = write { apps.addApplicationNote(id, AddApplicationNoteRequest(text = text)) }
    suspend fun patch(body: PatchApplicationRequest, clear: Set<String> = emptySet()) =
        write { apps.patchApplication(id, body, RequestOptions(nullFields = clear)) }

    suspend fun reopen(): Boolean {
        val app = state.value.app ?: return false
        val stage = stageBeforeClosed(app)
        return write { moves.move(id, categoryLane(state.value.lanes, stage), stage) }
    }

    /** Trash returns the trash stamp Undo needs, or null when it failed. */
    suspend fun trash(): Result<String?> = runCatching { moves.trash(id) }.onFailure { if (it is CancellationException) throw it }

    suspend fun untrash(stamp: String?) = write { moves.untrash(id, stamp) }
}
