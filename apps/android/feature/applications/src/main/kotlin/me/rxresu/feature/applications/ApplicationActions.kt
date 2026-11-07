package me.rxresu.feature.applications

import me.rxresu.core.data.ApplicationsRepository
import me.rxresu.core.network.ApiException
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.PatchApplicationClosedReason
import me.rxresu.core.network.generated.PatchApplicationRequest
import me.rxresu.core.network.generated.PurgeApplicationRequest

/** Why a write failed, in the words the sheets show. */
internal enum class WriteError { StagesChanged, Failed }

internal fun Throwable.writeError(): WriteError =
    if (this is ApiException && (status == 409 || code == "CONFLICT")) WriteError.StagesChanged else WriteError.Failed

/** Where an application stands, so a move can be undone exactly. */
internal data class StageSnapshot(val status: ApplicationStage, val laneId: String?, val closedReason: PatchApplicationClosedReason?)

internal fun Application.snapshot() = StageSnapshot(status, laneId, closedReason)

/**
 * Stage moves, trash and their Undo, shared by the list swipe, the board drop and the Move sheet. Sends the lane and
 * its category together (the server checks they agree; older servers read the category).
 */
internal class ApplicationMoves(private val apps: ApplicationsRepository) {
    suspend fun move(id: String, lane: Lane?, stage: ApplicationStage, reason: PatchApplicationClosedReason? = null): Application =
        apps.patchApplication(
            id,
            PatchApplicationRequest(laneId = lane?.id, status = lane?.category ?: stage, closedReason = reason),
        )

    suspend fun restore(id: String, to: StageSnapshot): Application = apps.patchApplication(
        id,
        PatchApplicationRequest(laneId = to.laneId, status = to.status, closedReason = to.closedReason),
        // Reopening clears the closure outcome explicitly.
        if (to.closedReason == null) RequestOptions(nullFields = setOf("/closedReason")) else RequestOptions(),
    )

    suspend fun bulk(body: me.rxresu.core.network.generated.PatchApplicationsRequest) = apps.bulkUpdateApplications(body)

    /** Moves to Trash and returns what Undo needs. */
    suspend fun trash(id: String): String? {
        apps.trashApplication(id)
        return runCatching { apps.getApplication(id).trashedAt }.getOrNull()
    }

    suspend fun untrash(id: String, trashedAt: String?) {
        apps.restoreApplication(id, PurgeApplicationRequest(trashedAt ?: ""))
    }
}
