package me.rxresu.core.data

import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.*
import me.rxresu.core.network.generated.Application

@Serializable
enum class TodayKind { Briefing, Interview, Offer, FollowUp, Notification }
@Serializable
data class TodayItem(val id: String,val applicationId: String?,val company: String,val title: String,val at: String?,val kind: TodayKind,val interviewId: String? = null,val notificationId: String? = null,val briefingReady: Boolean = false)
@Serializable
data class FirstRun(val hasDocument: Boolean,val hasApplication: Boolean,val hasPreferences: Boolean,val remindersEnabled: Boolean) {
    val complete get()=hasDocument && hasApplication && hasPreferences && remindersEnabled
    val newAccount get()=!hasDocument && !hasApplication && !hasPreferences
}
@Serializable
data class TodaySnapshot(val needsYou: List<TodayItem>,val comingUp: List<TodayItem>,val newRoles: List<Opportunity>,val recentDocuments: List<DocumentSummary>,val schedules: List<CareerSchedule>,val firstRun: FirstRun)
interface TodayRepository {
    fun observe(remindersEnabled: Boolean = false): Flow<Resource<TodaySnapshot>>
    suspend fun refresh()
    suspend fun markRead(notificationId: String)
    suspend fun trackRole(id: String): TrackCareerOpportunityResponse
    suspend fun dismissRole(id: String)
    suspend fun dismiss(item: TodayItem)
    suspend fun undoDismiss(item: TodayItem)
}

/** Pure composition, shared by the real repository, previews, widgets, and host tests. */
fun composeToday(
    applications: List<Application>,documents: List<DocumentSummary>,saved: List<SavedItem>,
    notifications: List<CareerNotification>,opportunities: List<Opportunity>,schedules: List<CareerSchedule>,
    profile: CareerProfile,time: TimeSource,remindersEnabled: Boolean,
): TodaySnapshot {
    val now=time.now()
    val end=time.today().plusDays(8).atStartOfDay(time.timezone()).toInstant()
    val needs=mutableListOf<TodayItem>(); val coming=mutableListOf<TodayItem>()
    fun instant(value: String?)=value?.let { runCatching { Instant.parse(it) }.getOrNull() }
    val active=applications.filter { it.status!=ApplicationStage.Closed && it.trashedAt==null }
    for(app in active) {
        for(interview in app.activity.filterIsInstance<Interview>()) {
            val at=instant(interview.at) ?: continue
            if(at.plusSeconds((interview.durationMinutes ?: 60)*60)<now || at>=end) continue
            val briefing=saved.any { it.applicationId==app.id && it.interviewId==interview.id && it.data is Briefing && !it.outdated }
            val item=TodayItem("interview:${interview.id}",app.id,app.company,interview.kind.wireValue,interview.at,if(briefing) TodayKind.Briefing else TodayKind.Interview,interview.id,briefingReady=briefing)
            if(briefing || Duration.between(now,at)<=Duration.ofHours(48)) needs+=item else coming+=item
        }
        val next=applicationNextStep(app,time)
        if(next.kind==NextStepKind.NoReply || next.kind==NextStepKind.FollowUp) {
            val item=TodayItem("follow-up:${app.id}",app.id,app.company,"Follow up",next.at?.toString(),TodayKind.FollowUp)
            if(next.at==null || next.at<=now.plus(Duration.ofDays(1))) needs+=item else if(next.at<end) coming+=item
        }
    }
    // Only the newest terms for each application determine the deadline; versions never duplicate reminders.
    saved.filter { it.data is Offer && !it.outdated && active.any { app -> app.id==it.applicationId && app.status==ApplicationStage.Offer } }
        .groupBy { it.applicationId }.values.mapNotNull { it.maxByOrNull { row -> row.createdAt } }.forEach { row ->
            val offer=row.data as Offer
            val date=offer.respondBy?.let { runCatching { java.time.LocalDate.parse(it.take(10)) }.getOrNull() }
            if(date!=null && date<=time.today().plusDays(7)) {
                val app=active.firstOrNull { it.id==row.applicationId }
                needs+=TodayItem("offer:${row.id}",row.applicationId,app?.company.orEmpty(),"Reply to the offer",date.atStartOfDay(time.timezone()).toInstant().toString(),TodayKind.Offer)
            }
        }
    notifications.filter { it.readAt==null }.forEach { notification ->
        val noticeType=ApiJson.encodeToJsonElement(notification.notice).jsonObject.text("type").orEmpty()
        val existing=needs.indexOfFirst { it.applicationId==notification.applicationId && (it.kind.name.lowercase()==noticeType || (it.kind==TodayKind.FollowUp && noticeType=="followup")) }
        if(existing>=0) needs[existing]=needs[existing].copy(notificationId=notification.id)
        else if(notification.applicationId==null || needs.none { it.applicationId==notification.applicationId }) needs+=TodayItem("notification:${notification.id}",notification.applicationId,"",notification.title,notification.createdAt,TodayKind.Notification,notificationId=notification.id)
    }
    return TodaySnapshot(needs.sortedWith(compareBy<TodayItem> { when(it.kind) { TodayKind.Briefing->0;TodayKind.Offer->1;TodayKind.FollowUp->2;else->3 } }.thenBy { it.at }),coming.sortedBy { it.at },opportunities.filter { it.dismissedAt==null && it.trackedApplicationId==null },documents.filter { it.trashedAt==null }.sortedByDescending { it.editedAt }.take(3),schedules,
        FirstRun(documents.any { it.trashedAt==null },applications.isNotEmpty(),profile.targetRoles.isNotEmpty() || profile.locations.isNotEmpty() || profile.priorities.isNotBlank(),remindersEnabled))
}

internal class RealTodayRepository(private val store: RepositoryStore) : TodayRepository {
    private val apps=ApplicationsApi(store)
    private val docs=DocumentsApi(store)
    private val career=CareerApi(store)
    override fun observe(remindersEnabled: Boolean)=store.observe("today:$remindersEnabled",TodaySnapshot.serializer()) {
        val owner=requireNotNull(store.auth.state.value.scope())
        val marks=store.cache.get(owner,"today-read")?.let(::parseObject) ?: JsonObject(emptyMap())
        val notifications=career.listCareerNotifications().map { notification -> if(marks["notification:${notification.id}"]==JsonPrimitive(false)) notification.copy(readAt=null) else notification }
        val result=composeToday(apps.listApplications(),docs.listDocuments(),career.listCareerSavedItems(),notifications,career.listCareerOpportunities(),career.listCareerSchedules(),career.getCareerProfile(),store.time,remindersEnabled)
        result.copy(needsYou=result.needsYou.filter { marks[it.id]!=JsonPrimitive(true) })
    }
    override suspend fun refresh()=store.refresh()
    override suspend fun markRead(notificationId: String)=career.readCareerNotification(notificationId)
    override suspend fun trackRole(id: String)=career.trackCareerOpportunity(id)
    override suspend fun dismissRole(id: String)=career.dismissCareerOpportunity(id)
    override suspend fun dismiss(item: TodayItem) {
        item.notificationId?.let { career.readCareerNotification(it) }
        mark(item,true)
    }
    override suspend fun undoDismiss(item: TodayItem)=mark(item,false)
    private suspend fun mark(item: TodayItem,read: Boolean) {
        val owner=requireNotNull(store.auth.state.value.scope())
        val previous=store.cache.get(owner,"today-read")?.let(::parseObject) ?: JsonObject(emptyMap())
        val next=previous.with(item.id to JsonPrimitive(read))
        val marked=if(item.notificationId==null) next else next.with("notification:${item.notificationId}" to JsonPrimitive(read))
        store.cache.put(owner,"today-read",marked.toString());store.refresh()
    }
}
