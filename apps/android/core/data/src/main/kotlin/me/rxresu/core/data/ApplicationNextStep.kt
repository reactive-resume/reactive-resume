package me.rxresu.core.data

import java.time.*
import me.rxresu.core.network.generated.*
import me.rxresu.core.network.generated.Application

/** Matches packages/schema/applications/next-step; labels belong to the feature's string resources. */
enum class NextStepKind { Interview, FollowUp, NoReply, Waiting, InterviewFeedback, NoInterview, Offer, NotApplied, Closed }
data class ApplicationNextStep(val kind: NextStepKind,val at: Instant? = null,val interview: Interview? = null,val days: Long? = null,val overdue: Boolean = false,val note: String = "",val terms: Boolean = false,val afterInterview: Boolean = false)
internal fun parseInstant(value: String?)=value?.let { runCatching { Instant.parse(it) }.getOrNull() }
internal fun canonicalStages(app: Application)=app.activity.filterIsInstance<StageTimelineEntry>().filter { it.canonicalTransition!=false }
internal fun latestStageWrite(app: Application): StageTimelineEntry? {
    var latest:StageTimelineEntry?=null
    for(entry in canonicalStages(app)) {
        val before=latest
        if(before==null || (entry.writeSequence ?: 0)>(before.writeSequence ?: 0) ||
            (entry.writeSequence==null && before.writeSequence==null && entry.at>=before.at)) latest=entry
    }
    return latest
}
fun followUpInstant(app: Application,time: TimeSource): Instant? {
    val instant=parseInstant(app.followUpAt) ?: return null
    val dateOnly=app.followUpDateOnly ?: (instant.toEpochMilli()%86_400_000==0L)
    return if(dateOnly) instant.atZone(ZoneOffset.UTC).toLocalDate().atTime(9,0).atZone(time.timezone()).toInstant() else instant
}
fun applicationNextStep(app: Application,time: TimeSource,offer: Offer? = null,offerKnown: Boolean = false): ApplicationNextStep {
    val now=time.now()
    fun days(from: Instant?)=from?.let { Duration.between(it,now).toDays().coerceAtLeast(0) }
    val stage=canonicalStages(app).filter { it.stage==app.status }.maxByOrNull { it.at }
    val since=if(stage?.dateUnknown==true) null else parseInstant(stage?.at ?: app.appliedAt)
    if(app.status==ApplicationStage.Closed) return ApplicationNextStep(NextStepKind.Closed)
    val follow=followUpInstant(app,time)
    val deadline=offer?.respondBy?.let { parseInstant(it) ?: runCatching { LocalDate.parse(it).atStartOfDay(time.timezone()).toInstant() }.getOrNull() }
    if(app.status==ApplicationStage.Offer) {
        if(deadline==null && follow!=null) return ApplicationNextStep(NextStepKind.FollowUp,follow,overdue=follow<now,note=app.followUpNote.orEmpty())
        return ApplicationNextStep(NextStepKind.Offer,deadline,days=days(since),overdue=deadline?.let { it<now } ?: false,terms=offer!=null || !offerKnown)
    }
    val upcoming=app.activity.filterIsInstance<Interview>().filter { interview -> parseInstant(interview.at)?.plusSeconds((interview.durationMinutes ?: 60)*60)?.let { it>=now }==true }.minByOrNull { it.at }
    if(upcoming!=null) return ApplicationNextStep(NextStepKind.Interview,parseInstant(upcoming.at),upcoming)
    if(follow!=null) return ApplicationNextStep(NextStepKind.FollowUp,follow,overdue=follow<now,note=app.followUpNote.orEmpty())
    if(app.status==ApplicationStage.Saved) return ApplicationNextStep(NextStepKind.NotApplied)
    val visit=latestStageWrite(app)
    val visitSince=if(visit?.dateUnknown==true) null else parseInstant(visit?.at) ?: since
    val contacted=app.activity.filterIsInstance<NoteTimelineEntry>().filter { it.followedUp?.let { followed -> followed.stageEntryId==visit?.id }==true }
        .mapNotNull { parseInstant(it.at) }.filter { it<=now && (visitSince==null || it.epochSecond/86400>=visitSince.epochSecond/86400) }.maxOrNull()
    val quiet=days(contacted ?: visitSince)
    if(app.status in setOf(ApplicationStage.Applied,ApplicationStage.Screening) && quiet!=null && quiet>=10) return ApplicationNextStep(NextStepKind.NoReply,days=quiet)
    if(app.status==ApplicationStage.Interview) {
        val ended=if(visitSince==null) emptyList() else app.activity.filterIsInstance<Interview>().mapNotNull { parseInstant(it.at)?.plusSeconds((it.durationMinutes ?: 60)*60) }.filter { it>=visitSince }
        if(ended.isEmpty()) return ApplicationNextStep(NextStepKind.NoInterview,days=days(since))
        val after=days((ended+listOfNotNull(contacted)).maxOrNull())
        return if(after!=null && after>=10) ApplicationNextStep(NextStepKind.NoReply,days=after,afterInterview=true) else ApplicationNextStep(NextStepKind.InterviewFeedback,days=days(since))
    }
    return ApplicationNextStep(NextStepKind.Waiting,days=days(since))
}
