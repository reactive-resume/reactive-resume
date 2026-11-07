package me.rxresu.feature.today

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
import me.rxresu.core.data.ApplicationsRepository
import me.rxresu.core.data.FirstRun
import me.rxresu.core.data.Resource
import me.rxresu.core.data.TodayItem
import me.rxresu.core.data.TodayRepository
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.CareerSchedule
import me.rxresu.core.network.generated.DocumentSummary
import me.rxresu.core.network.generated.Interview
import me.rxresu.core.network.generated.Opportunity

/** One Today row joined with its application, so the screen can show the role, stage dot and interview details. */
data class TodayEntry(
    val item: TodayItem,
    val stage: ApplicationStage? = null,
    val role: String? = null,
    val appliedAt: String? = null,
    val interview: Interview? = null,
)

data class TodayUiState(
    val loading: Boolean = true,
    val offline: Boolean = false,
    val error: Boolean = false,
    val refreshing: Boolean = false,
    val initials: String = "",
    val needsYou: List<TodayEntry> = emptyList(),
    val comingUp: List<TodayEntry> = emptyList(),
    val newRoles: List<Opportunity> = emptyList(),
    val recent: List<DocumentSummary> = emptyList(),
    /** The daily discovery schedule, if any, for the "No new roles" line. */
    val discovery: CareerSchedule? = null,
    val firstRun: FirstRun? = null,
    /** Guest accounts see the "Create account" notice. The API does not expose this yet, so it stays false. */
    val guest: Boolean = false,
    val selectedRoles: Set<String> = emptySet(),
) {
    /** T2: the checklist shows until all four steps are done. */
    val showChecklist: Boolean get() = firstRun?.complete == false
    /** T2's hero and the hidden T1 sections: nothing exists yet. */
    val newAccount: Boolean get() = firstRun?.newAccount == true
}

@OptIn(ExperimentalCoroutinesApi::class)
class TodayViewModel(
    private val today: TodayRepository,
    private val applications: ApplicationsRepository,
    account: AccountRepository,
) : ViewModel() {
    private val reminders = MutableStateFlow<Boolean?>(null)
    private val selection = MutableStateFlow<Set<String>>(emptySet())
    private val refreshing = MutableStateFlow(false)
    /** Items hidden right away while the dismissal reaches the server, so the row folds without waiting. */
    private val hidden = MutableStateFlow<Set<String>>(emptySet())

    val state: StateFlow<TodayUiState> = combine(
        reminders.flatMapLatest { today.observe(it == true) },
        applications.observe().onStart { emit(Resource(loading = true)) },
        account.observeProfile().onStart { emit(Resource(loading = true)) },
        combine(selection, refreshing, hidden, ::Triple),
    ) { snapshot, apps, profile, (selected, refresh, gone) ->
        val data = snapshot.data
        val byId = apps.data.orEmpty().associateBy { it.id }
        TodayUiState(
            loading = data == null && snapshot.loading,
            offline = snapshot.offline,
            error = data == null && snapshot.error != null,
            refreshing = refresh,
            initials = initials(profile.data?.name.orEmpty()),
            needsYou = data?.needsYou.orEmpty().filter { it.id !in gone }.map { join(it, byId) },
            comingUp = data?.comingUp.orEmpty().map { join(it, byId) },
            newRoles = data?.newRoles.orEmpty().filter { it.id !in gone },
            recent = data?.recentDocuments.orEmpty(),
            discovery = data?.schedules.orEmpty().firstOrNull { it.kind == "discovery" },
            firstRun = data?.firstRun,
            selectedRoles = selected,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TodayUiState())

    /** Notification permission, read on every resume. It ticks the "Turn on reminders" step. */
    fun setRemindersEnabled(enabled: Boolean) { reminders.value = enabled }

    suspend fun refresh() {
        refreshing.value = true
        try { today.refresh(); applications.refresh() } finally { refreshing.value = false }
    }

    /** Mark as read. Hides the row at once; restores it when the write fails. */
    suspend fun dismiss(item: TodayItem) {
        hidden.update { it + item.id }
        try { today.dismiss(item) } catch (e: Exception) { hidden.update { it - item.id }; throw e }
    }

    suspend fun undoDismiss(item: TodayItem) {
        today.undoDismiss(item)
        hidden.update { it - item.id }
    }

    suspend fun markRead(notificationId: String) = today.markRead(notificationId)

    suspend fun logFollowUp(applicationId: String) { applications.logApplicationFollowUp(applicationId) }

    /** Returns the new application's id. */
    suspend fun track(role: Opportunity): String {
        val result = today.trackRole(role.id)
        hidden.update { it + role.id }
        return result.applicationId
    }

    suspend fun dismissRole(role: Opportunity) {
        today.dismissRole(role.id)
        hidden.update { it + role.id }
    }

    fun toggleRole(id: String) = selection.update { if (id in it) it - id else it + id }
    fun clearSelection() { selection.value = emptySet() }

    /**
     * Tracks or dismisses every selected role. Roles that fail stay selected, as on the web.
     * Returns (done, failed) counts.
     */
    suspend fun applyToSelection(track: Boolean): Pair<Int, Int> {
        val roles = state.value.newRoles.filter { it.id in selection.value }
        var done = 0
        for (role in roles) {
            val ok = runCatching { if (track) today.trackRole(role.id) else today.dismissRole(role.id) }.isSuccess
            if (ok) {
                done++
                hidden.update { it + role.id }
                selection.update { it - role.id }
            }
        }
        return done to roles.size - done
    }

    private fun join(item: TodayItem, apps: Map<String, Application>): TodayEntry {
        val app = item.applicationId?.let(apps::get) ?: return TodayEntry(item)
        val interview = item.interviewId?.let { id -> app.activity.filterIsInstance<Interview>().firstOrNull { it.id == id } }
        return TodayEntry(item, app.status, app.role, app.appliedAt, interview)
    }

    companion object {
        /** "Alex Morgan" → "AM"; one word → its first letter. */
        fun initials(name: String): String =
            name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.let { listOfNotNull(it.firstOrNull(), it.drop(1).lastOrNull()) }
                .joinToString("") { it.first().uppercase() }
    }
}
