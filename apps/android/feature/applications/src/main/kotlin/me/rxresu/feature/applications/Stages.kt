package me.rxresu.feature.applications

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import me.rxresu.core.designsystem.RrStage
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.CreateApplicationLaneResponseLanesItem
import me.rxresu.core.network.generated.PatchApplicationClosedReason
import me.rxresu.core.network.generated.StageTimelineEntry
import me.rxresu.core.strings.R as S

/** A lane as the screens read it (packages/schema lanes). Custom lanes map onto a canonical category. */
typealias Lane = CreateApplicationLaneResponseLanesItem

/** The standard stages an application moves through; Closed ends it from any of them. */
internal val Pipeline = listOf(ApplicationStage.Saved, ApplicationStage.Applied, ApplicationStage.Screening, ApplicationStage.Interview, ApplicationStage.Offer)

/** List group order (web LIST_ORDER): what needs you first, closed last. */
internal val ListOrder = listOf(ApplicationStage.Interview, ApplicationStage.Offer, ApplicationStage.Screening, ApplicationStage.Applied, ApplicationStage.Saved, ApplicationStage.Closed)

internal val ClosedReasons = listOf(
    PatchApplicationClosedReason.Accepted,
    PatchApplicationClosedReason.NotSelected,
    PatchApplicationClosedReason.Withdrew,
    PatchApplicationClosedReason.AcceptedOther,
    PatchApplicationClosedReason.NoResponse,
)

internal fun ApplicationStage.rr(): RrStage = when (this) {
    ApplicationStage.Saved, ApplicationStage.Unknown -> RrStage.Saved
    ApplicationStage.Applied -> RrStage.Applied
    ApplicationStage.Screening -> RrStage.Screening
    ApplicationStage.Interview -> RrStage.Interview
    ApplicationStage.Offer -> RrStage.Offer
    ApplicationStage.Closed -> RrStage.Closed
}

@Composable
internal fun stageLabel(stage: ApplicationStage): String = stringResource(
    when (stage) {
        ApplicationStage.Saved, ApplicationStage.Unknown -> S.string.saved
        ApplicationStage.Applied -> S.string.applied
        ApplicationStage.Screening -> S.string.screening
        ApplicationStage.Interview -> S.string.interview
        ApplicationStage.Offer -> S.string.offer
        ApplicationStage.Closed -> S.string.closed
    },
)

@Composable
internal fun closedReasonLabel(reason: PatchApplicationClosedReason): String = stringResource(
    when (reason) {
        PatchApplicationClosedReason.Accepted -> S.string.accepted_offer
        PatchApplicationClosedReason.NotSelected -> S.string.not_selected
        PatchApplicationClosedReason.Withdrew -> S.string.i_withdrew
        PatchApplicationClosedReason.AcceptedOther -> S.string.accepted_another_offer
        PatchApplicationClosedReason.NoResponse, PatchApplicationClosedReason.Unknown -> S.string.no_response
    },
)

/** A lane's name: the owner's label, or the stage's own name. */
@Composable
internal fun laneLabel(lane: Lane): String = lane.label ?: stageLabel(lane.category)

/** Active (not retired) lanes in the owner's order. */
internal fun activeLanes(lanes: List<Lane>): List<Lane> = lanes.filter { it.retiredAt == null }.sortedBy { it.position }

/** The lane an application shows in: its own lane, else its category's default. Never a retired lane. */
internal fun displayLane(lanes: List<Lane>, app: Application): Lane? {
    val own = lanes.firstOrNull { it.id == app.laneId && it.retiredAt == null && it.category == app.status }
    return own ?: categoryLane(lanes, app.status)
}

/** The default lane of a category: its system lane, else its first active lane. */
internal fun categoryLane(lanes: List<Lane>, category: ApplicationStage): Lane? =
    activeLanes(lanes).let { active -> active.firstOrNull { it.systemKey == category } ?: active.firstOrNull { it.category == category } }

/** The next open lane after [current] in the owner's order; null at the end (Offer). */
internal fun nextLane(lanes: List<Lane>, current: Lane?): Lane? {
    val open = activeLanes(lanes).filter { it.category != ApplicationStage.Closed }
    val index = open.indexOfFirst { it.id == current?.id }
    return if (index == -1) null else open.getOrNull(index + 1)
}

/** The next canonical stage when the server has no lanes yet (older servers). */
internal fun nextStage(stage: ApplicationStage): ApplicationStage? =
    Pipeline.indexOf(stage).takeIf { it >= 0 }?.let { Pipeline.getOrNull(it + 1) }

/** The stage an application was in before it closed (for Reopen); Applied when unknown. */
internal fun stageBeforeClosed(app: Application): ApplicationStage =
    app.activity.filterIsInstance<StageTimelineEntry>()
        .filter { it.stage != ApplicationStage.Closed && it.stage in Pipeline }
        .maxByOrNull { it.at }?.stage ?: ApplicationStage.Applied

/** Two initials from a person's name ("Priya Shah" → "PS"). */
internal fun initials(name: String): String =
    name.split(' ', '-').filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "?" }
