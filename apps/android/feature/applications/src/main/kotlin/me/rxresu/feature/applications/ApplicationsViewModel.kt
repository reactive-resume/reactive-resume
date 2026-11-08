package me.rxresu.feature.applications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import me.rxresu.core.data.AccountRepository
import me.rxresu.core.data.ApplicationInsights
import me.rxresu.core.data.ApplicationNextStep
import me.rxresu.core.data.ApplicationQuery
import me.rxresu.core.data.ApplicationsRepository
import me.rxresu.core.data.CalendarItem
import me.rxresu.core.data.CareerRepository
import me.rxresu.core.data.DocumentsRepository
import me.rxresu.core.data.TimeSource
import me.rxresu.core.data.applicationNextStep
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.Briefing
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.network.generated.ListCareerSavedItemsKind
import me.rxresu.core.network.generated.Offer
import me.rxresu.core.network.generated.PatchApplicationClosedReason
import me.rxresu.core.network.generated.PatchApplicationsRequest
import me.rxresu.core.network.generated.TrashApplicationsRequest

/** Filters shared by List, Board, Calendar and Insights (web: search, tags, Needs you, Show closed). */
internal data class ApplicationFilters(val text: String = "", val tags: Set<String> = emptySet(), val needsYou: Boolean = false, val showClosed: Boolean = false, val stage: ApplicationStage? = null)

/** One row: the application and its next step, worked out once. */
internal data class Row(val app: Application, val step: ApplicationNextStep, val attention: Boolean)

internal data class ApplicationsState(
    val rows: List<Row>? = null,
    val all: List<Application> = emptyList(),
    val lanes: List<Lane> = emptyList(),
    val tags: List<String> = emptyList(),
    val resumes: Map<String, DocumentSummary> = emptyMap(),
    val briefings: Set<String> = emptySet(),
    val calendar: List<CalendarItem> = emptyList(),
    val insights: ApplicationInsights? = null,
    val filters: ApplicationFilters = ApplicationFilters(),
    val needsYouCount: Int = 0,
    val initials: String = "",
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val offline: Boolean = false,
    val failed: Boolean = false,
    val now: Instant = Instant.EPOCH,
) {
    /** Open applications exist but every one is closed (web: "All your applications are closed"). */
    val allClosed: Boolean get() = all.isNotEmpty() && all.all { it.status == ApplicationStage.Closed } && !filters.showClosed
}

internal class ApplicationsViewModel(
    private val apps: ApplicationsRepository,
    private val career: CareerRepository,
    private val documents: DocumentsRepository,
    private val account: AccountRepository,
    val time: TimeSource,
) : ViewModel() {
    private val filters = MutableStateFlow(ApplicationFilters())
    private val extra = MutableStateFlow(ApplicationsState())
    private val offers = MutableStateFlow<Map<String, Offer>>(emptyMap())
    val moves = ApplicationMoves(apps)

    val state: StateFlow<ApplicationsState> = combine(apps.observe(ApplicationQuery(showClosed = true)), filters, extra, offers) { res, f, e, o ->
        val now = time.now()
        val all = res.data
        val rows = all?.map { app -> applicationNextStep(app, time, o[app.id], offerKnown = true).let { Row(app, it, needsAttention(it, now)) } }
        e.copy(
            all = all.orEmpty(),
            rows = rows?.let { filterRows(it, f) },
            filters = f,
            needsYouCount = rows?.count { it.attention && it.app.status != ApplicationStage.Closed } ?: 0,
            loading = all == null && res.loading,
            offline = res.offline,
            failed = all == null && res.error != null,
            now = now,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ApplicationsState(now = time.now()))

    init {
        load()
        // Calendar and Insights follow the list: reload them whenever applications change.
        viewModelScope.launch {
            apps.observe(ApplicationQuery(showClosed = true)).map { it.data }.distinctUntilChanged().collect { if (it != null) loadDerived() }
        }
        viewModelScope.launch {
            account.observeProfile().collect { p -> p.data?.let { extra.value = extra.value.copy(initials = initials(it.name.ifBlank { it.username })) } }
        }
    }

    private fun load() = viewModelScope.launch {
        runCatching { apps.getApplicationLanes().lanes }.onSuccess { extra.value = extra.value.copy(lanes = it) }
        runCatching { apps.listApplicationTags() }.onSuccess { extra.value = extra.value.copy(tags = it) }
        runCatching { documents.listDocuments(trashed = false) }.onSuccess { docs -> extra.value = extra.value.copy(resumes = docs.associateBy { it.id }) }
        runCatching { career.listCareerSavedItems(kind = ListCareerSavedItemsKind.Offer) }.onSuccess { items ->
            offers.value = items.filter { it.data is Offer && !it.outdated && it.applicationId != null }.sortedBy { it.createdAt }
                .associate { it.applicationId!! to it.data as Offer }
        }
        runCatching { career.listCareerSavedItems(kind = ListCareerSavedItemsKind.Briefing) }.onSuccess { items ->
            extra.value = extra.value.copy(briefings = items.filter { it.data is Briefing && !it.outdated }.mapNotNull { it.interviewId }.toSet())
        }
    }

    private suspend fun loadDerived() {
        runCatching { apps.calendar() }.onSuccess { extra.value = extra.value.copy(calendar = it) }
        val f = filters.value
        runCatching { apps.insights(ApplicationQuery(text = f.text, tags = f.tags.toList(), showClosed = true)) }.onSuccess { extra.value = extra.value.copy(insights = it) }
    }

    fun setFilters(f: ApplicationFilters) {
        val textOrTags = f.text != filters.value.text || f.tags != filters.value.tags
        filters.value = f
        if (textOrTags) viewModelScope.launch { loadDerived() }
    }

    fun refresh() = viewModelScope.launch {
        extra.value = extra.value.copy(refreshing = true)
        runCatching { apps.refresh() }
        load().join()
        loadDerived()
        extra.value = extra.value.copy(refreshing = false)
    }

    suspend fun <T> attempt(block: suspend () -> T): Result<T> = try {
        Result.success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.failure(e)
    }

    suspend fun bulkMove(ids: List<String>, lane: Lane?, stage: ApplicationStage, reason: PatchApplicationClosedReason? = null) =
        attempt { apps.bulkUpdateApplications(PatchApplicationsRequest(ids = ids, laneId = lane?.id, status = lane?.category ?: stage, closedReason = reason)) }

    suspend fun bulkTag(ids: List<String>, tags: List<String>) = attempt { apps.bulkUpdateApplications(PatchApplicationsRequest(ids = ids, addTags = tags)) }

    suspend fun bulkTrash(ids: List<String>) = attempt { apps.trashApplications(TrashApplicationsRequest(ids)) }
}

/** List filtering (web list-view): search words, every chosen tag, Needs you, closed only when shown. */
internal fun filterRows(rows: List<Row>, f: ApplicationFilters): List<Row> = rows.filter { row ->
    val app = row.app
    (f.showClosed || app.status != ApplicationStage.Closed || f.stage == ApplicationStage.Closed) &&
        (f.stage == null || app.status == f.stage) &&
        (!f.needsYou || row.attention) &&
        app.tags.containsAll(f.tags) &&
        (f.text.isBlank() || listOfNotNull(app.company, app.role, app.location, app.notes).any { it.contains(f.text.trim(), ignoreCase = true) })
}

/** Stage groups retain the repository's requested application order within each lane. */
internal fun groupRows(rows: List<Row>, lanes: List<Lane>): List<Pair<Lane?, List<Row>>> {
    val order = activeLanes(lanes)
    return ListOrder.flatMap { stage ->
        val inStage = rows.filter { it.app.status == stage }
        val laneGroups = order.filter { it.category == stage }.map { lane -> lane to inStage.filter { displayLane(lanes, it.app)?.id == lane.id } }
        val unplaced = inStage.filter { r -> laneGroups.none { (_, rs) -> r in rs } }
        (laneGroups + listOf<Pair<Lane?, List<Row>>>(null to unplaced)).filter { it.second.isNotEmpty() }
            .map { (lane, rs) -> lane to rs }
    }
}
