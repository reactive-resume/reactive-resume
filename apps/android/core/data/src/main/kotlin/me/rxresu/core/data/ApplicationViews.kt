package me.rxresu.core.data

import java.time.*
import java.time.temporal.WeekFields
import me.rxresu.core.network.generated.*
import me.rxresu.core.network.generated.Application

internal fun filterApplications(items: List<Application>,query: ApplicationQuery): List<Application> = items.filter { app ->
    app.trashedAt==null && (query.showClosed || app.status!=ApplicationStage.Closed) &&
        (query.stage==null || app.status==query.stage) && (query.laneId==null || app.laneId==query.laneId) &&
        app.tags.containsAll(query.tags) && (query.text.isBlank() || listOfNotNull(app.company,app.role,app.location,app.notes).any { it.contains(query.text,true) })
}.let { rows -> when(query.sort) { ApplicationSort.Activity->rows.sortedByDescending { it.updatedAt };ApplicationSort.Company->rows.sortedBy { it.company.lowercase() };ApplicationSort.Created->rows.sortedByDescending { it.createdAt } } }

internal fun calendarItems(apps: List<Application>,saved: List<SavedItem>,time: TimeSource): List<CalendarItem> = buildList {
    apps.filter { it.trashedAt==null && it.status!=ApplicationStage.Closed }.forEach { app ->
        app.activity.filterIsInstance<Interview>().forEach { interview -> add(CalendarItem(interview.id,app.id,app.company,interview.kind.wireValue,interview.at,"interview",interview.timezone,interview.durationMinutes)) }
        followUpInstant(app,time)?.toString()?.let { add(CalendarItem("follow-up:${app.id}",app.id,app.company,app.followUpNote ?: "Follow up",it,"follow-up")) }
        saved.filter { it.applicationId==app.id && it.data is Offer && !it.outdated }.maxByOrNull { it.createdAt }?.let { row ->
            (row.data as Offer).respondBy?.let { date -> runCatching { LocalDate.parse(date.take(10)).atStartOfDay(time.timezone()).toInstant().toString() }.getOrNull()?.let { add(CalendarItem("offer:${row.id}",app.id,app.company,"Respond to offer",it,"offer")) } }
        }
    }
}.sortedBy { it.at }

/** Mirrors packages/schema/applications/outcomes, including closed/undated and lane-only history. */
internal fun applicationInsights(apps: List<Application>,time: TimeSource): ApplicationInsights {
    val pipeline=listOf(ApplicationStage.Saved,ApplicationStage.Applied,ApplicationStage.Screening,ApplicationStage.Interview,ApplicationStage.Offer)
    fun furthest(app: Application)=(canonicalStages(app).map { it.stage }+app.status).maxOf { pipeline.indexOf(it) }
    fun sentAt(app: Application): Instant? {
        val stages=canonicalStages(app)
        val applied=stages.filter { it.dateUnknown!=true && it.stage==ApplicationStage.Applied }.minByOrNull { it.at }
        if(applied!=null) return parseInstant(applied.at)
        return if((app.status==ApplicationStage.Applied || stages.isEmpty()) && stages.none { it.dateUnknown==true }) parseInstant(app.appliedAt) else null
    }
    val sent=apps.filter { furthest(it)>=1 }
    val replies=sent.mapNotNull { app ->
        val since=sentAt(app)
        val reply=app.activity.filterIsInstance<StageTimelineEntry>().sortedWith(compareByDescending<StageTimelineEntry> { it.dateUnknown==true }.thenBy { it.at }).firstOrNull { entry ->
            (entry.dateUnknown==true || since==null || parseInstant(entry.at)?.let { it>=since }==true) &&
            ((entry.canonicalTransition!=false && entry.stage in setOf(ApplicationStage.Screening,ApplicationStage.Interview,ApplicationStage.Offer)) ||
                entry.stage==ApplicationStage.Closed && (entry.closedReason?.wireValue ?: app.closedReason?.wireValue)=="not-selected")
        } ?: return@mapNotNull null
        app to reply
    }
    val delays=replies.mapNotNull { (app,reply) -> val from=sentAt(app);val to=parseInstant(reply.at);if(from==null || to==null || reply.dateUnknown==true) null else kotlin.math.round(Duration.between(from,to).toMillis()/86400000.0) }.sorted()
    val median=if(delays.isEmpty()) null else (delays[(delays.size-1)/2]+delays[delays.size/2])/2
    val weekStart=time.today().with(java.time.temporal.TemporalAdjusters.previousOrSame(DayOfWeek.SUNDAY))
    val weeks=(7 downTo 0).associate { weekStart.minusWeeks(it.toLong()).toString() to 0 }.toMutableMap()
    for(app in sent) sentAt(app)?.atZone(time.timezone())?.toLocalDate()?.with(java.time.temporal.TemporalAdjusters.previousOrSame(DayOfWeek.SUNDAY))?.toString()?.let { if(it in weeks) weeks[it]=weeks.getValue(it)+1 }
    return ApplicationInsights(apps.size,replies.size,median,pipeline.drop(1).associateWith { stage -> sent.count { furthest(it)>=pipeline.indexOf(stage) } },weeks,apps.mapNotNull { it.source?.takeIf(String::isNotBlank) }.groupingBy { it }.eachCount(),apps.count { it.status==ApplicationStage.Closed })
}
