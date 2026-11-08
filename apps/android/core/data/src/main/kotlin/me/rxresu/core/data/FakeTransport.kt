package me.rxresu.core.data

import java.io.IOException
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import me.rxresu.core.network.*
import me.rxresu.core.network.generated.ApiSamples

sealed interface FakeMode {
    data object Ready:FakeMode
    data object Empty:FakeMode
    data object Loading:FakeMode
    data class Error(val exception: Exception = ApiException(503,"UNAVAILABLE","Couldn't load. Try again.")):FakeMode
}
class FakeControls(initial: FakeMode = FakeMode.Ready) {
    val mode=MutableStateFlow(initial)
    val operations=MutableStateFlow<Map<String,FakeMode>>(emptyMap())
    /** Per-operation server-shaped values for focused screen states beyond the common storyboard seed. */
    val responses=MutableStateFlow<Map<String,JsonElement>>(emptyMap())
    val online=MutableStateFlow(true)
    /** Resume update stream events ({"mutation":"patch"} is an AI agent); emit after changing the fake server. */
    val resumeUpdates=MutableSharedFlow<me.rxresu.core.network.ServerEvent>(extraBufferCapacity=8)
    fun set(operation: String,mode: FakeMode) { operations.update { it+(operation to mode) } }
    fun reset() { mode.value=FakeMode.Ready;operations.value=emptyMap();responses.value=emptyMap();online.value=true }
    internal suspend fun before(operation: String): FakeMode {
        val state=combine(mode,operations) { all,each -> each[operation] ?: all }.first { it!=FakeMode.Loading }
        if(state is FakeMode.Error) throw state.exception
        if(!online.value) throw IOException("Offline")
        return state
    }
}
object StoryboardIds {
    const val resume="resume-product-designer"
    const val lumenResume="resume-lumen"
    const val lockedResume="resume-design-lead"
    const val lumenLetter="letter-lumen"
    const val lumen="application-lumen"
    const val parcel="application-parcel"
    const val fieldnote="application-fieldnote"
    const val orbital="application-orbital"
    const val kiln="application-kiln"
    const val interview="interview-lumen"
    const val story="story-shared-system"
}

/** One state owner behind the same typed generated APIs used in production. No preview-only repository contracts. */
internal class FakeTransport(val controls: FakeControls,private val time: TimeSource) : ApiTransport {
    private val mutex=Mutex()
    private var sequence=0L
    internal var state: JsonObject=ApiJson.parseToJsonElement(requireNotNull(javaClass.classLoader?.getResourceAsStream("storyboard.json")) { "Storyboard fixture missing." }.bufferedReader().use { it.readText() }).jsonObject
        private set
    private val versions=mutableMapOf<String,MutableList<JsonObject>>()
    private val jobCopies=mutableMapOf<String,Pair<JsonObject,String>>()
    private val values=(state["responses"] as? JsonObject)?.toMutableMap() ?: mutableMapOf<String,JsonElement>()
    init {
        // Sent letters freeze the initial server fixture, before any live draft mutation.
        rows("applications").forEach { app ->
            val letterId=app.text("coverLetterId")
            val versionId=app.text("sentCoverLetterVersionId")
            if(letterId!=null && versionId!=null) {
                val letter=find("letters",letterId)
                versions["letters:$letterId"]=mutableListOf(letter.with("id" to JsonPrimitive(versionId),"name" to JsonPrimitive("Sent to " + app.text("company")),"kind" to JsonPrimitive("sent"),"coverLetterId" to JsonPrimitive(letterId),"snapshot" to letter,"data" to letter,"createdAt" to (app["appliedAt"] ?: letter.getValue("updatedAt"))))
            }
        }
    }
    private fun now()=time.now().plusMillis(++sequence).toString()
    private fun rows(key: String)=(state[key] as? JsonArray).orEmpty().map { it.jsonObject }
    private fun setRows(key: String,rows: List<JsonObject>) { state=state.with(key to JsonArray(rows)) }
    private fun find(table: String,id: String)=rows(table).firstOrNull { it.text("id")==id } ?: throw ApiException(404,"NOT_FOUND","This item is unavailable.")
    private fun put(table: String,row: JsonObject) { val rows=rows(table).toMutableList();val index=rows.indexOfFirst { it["id"]==row["id"] };if(index<0) rows+=row else rows[index]=row;setRows(table,rows) }
    private fun remove(table: String,id: String) { setRows(table,rows(table).filter { it.text("id")!=id }) }
    private fun unlocked(row: JsonObject) { if(row.flag("isLocked")) throw ApiException(403,"LOCKED","Unlock editing before changing this document.") }
    private fun body(request: ApiRequest): JsonObject = (request.bodyWithExplicitNulls() as? JsonObject) ?: JsonObject(request.parts.associate { part -> part.name to if(part.filename==null) runCatching { ApiJson.parseToJsonElement(part.bytes.decodeToString()) }.getOrElse { JsonPrimitive(part.bytes.decodeToString()) } else JsonPrimitive(part.filename) })
    private fun sample(op: String)=ApiSamples.response(op)
    private fun patch(base: JsonElement,fields: JsonObject)=if(base is JsonObject) base.with(*fields.toList().toTypedArray()) else fields
    private fun docs(): List<JsonObject> = (rows("resumes").map { it.with("type" to JsonPrimitive("resume")) }+rows("letters").map { it.with("type" to JsonPrimitive("letter")) }).map { value ->
        val app=rows("applications").firstOrNull { it.text("id")==value.text("applicationId") || it.text("id")==value.text("sourceApplicationId") }
        value.with("editedAt" to (value["editedAt"] ?: value["updatedAt"]),"hasPassword" to (value["hasPassword"] ?: JsonPrimitive(false)),"isPublic" to (value["isPublic"] ?: JsonPrimitive(false)),"isLocked" to (value["isLocked"] ?: JsonPrimitive(false)),"slug" to value["slug"],"recipient" to value["recipient"],"application" to app)
    }
    private fun filtered(request: ApiRequest,items: List<JsonObject>): List<JsonObject> {
        val q=request.query
        val text=(q["q"] ?: q["query"])?.jsonPrimitive?.content.orEmpty()
        val tags=(q["tags"] as? JsonArray).orEmpty()
        return items.filter { row ->
            (text.isBlank() || listOf("name","company","role","text").any { row.text(it)?.contains(text,true)==true }) &&
                (q["status"]==null || row["status"]==q["status"]) && (q["laneId"]==null || row["laneId"]==q["laneId"]) &&
                tags.all { it in (row["tags"] as? JsonArray).orEmpty() }
        }.let { rows -> val sorted=when(q["sort"]?.jsonPrimitive?.content) { "name"->rows.sortedBy { it.text("name") };"created"->rows.sortedByDescending { it.text("createdAt") };else->rows.sortedByDescending { it.text("editedAt") ?: it.text("updatedAt") } };sorted.drop(q["offset"]?.jsonPrimitive?.intOrNull ?: 0).let { if(q["limit"]!=null) it.take(q["limit"]!!.jsonPrimitive.int) else it } }
    }
    override suspend fun execute(request: ApiRequest): JsonElement {
        val mode=controls.before(request.operation)
        controls.responses.value[request.operation]?.let { return it }
        return mutex.withLock { executeLocked(request,mode) }
    }
    private fun executeLocked(request: ApiRequest,mode: FakeMode): JsonElement {
        val op=request.operation.removeSuffix("Multipart")
        val b=body(request)
        val id=request.pathParams["id"] ?: request.pathParams["resumeId"] ?: request.pathParams["applicationId"] ?: b.text("id")
        batchOperation(op,b,id ?: request.pathParams["keyId"])?.let { return it }
        if(mode==FakeMode.Empty && request.method=="GET") {
            val s=sample(op)
            return when(s) { is JsonArray->JsonArray(emptyList());is JsonObject->s.with(*s.filterValues { it is JsonArray }.map { it.key to JsonArray(emptyList()) }.toTypedArray());else->s }
        }
        when(op) {
            "getProfile" -> return state.getValue("profile")
            "updateProfile" -> { state=state.with("profile" to patch(state.getValue("profile"),b));return patch(sample(op),b) }
            "getCareerProfile" -> return state.getValue("careerProfile")
            "saveCareerProfile","updateCareerProfile" -> { state=state.with("careerProfile" to patch(state.getValue("careerProfile"),b));return state.getValue("careerProfile") }
            "getApplicationProfile" -> return state.getValue("applicationProfile")
            "saveApplicationProfile" -> { state=state.with("applicationProfile" to patch(state.getValue("applicationProfile"),b.with("revision" to JsonPrimitive("revision-${++sequence}"),"reviewedAt" to JsonPrimitive(now()))));return state.getValue("applicationProfile") }
            "deleteApplicationProfile" -> { state=state.with("applicationProfile" to JsonNull);return JsonNull }
            "createScopedApiKey","setPassword","deleteAccount" -> throw ApiException(403,"FORBIDDEN","Open Settings in a web browser for this account action.")
            "listDocuments","listDocumentPage","countDocuments" -> {
                val trashed=request.query["trashed"]?.jsonPrimitive?.booleanOrNull ?: false
                val type=request.query["type"]?.jsonPrimitive?.content ?: "all"
                val all=docs().filter { (it["trashedAt"]!=null && it["trashedAt"]!=JsonNull)==trashed && (type=="all" || it.text("type")==type) && (request.query["public"]?.jsonPrimitive?.booleanOrNull!=true || it.flag("isPublic")) }
                val items=filtered(request,all)
                return when(op) { "listDocuments"->JsonArray(items);"listDocumentPage"->patch(sample(op),buildJsonObject { put("items",JsonArray(items));put("total",all.size) });else->patch(sample(op),buildJsonObject { put("resume",all.count { it.text("type")=="resume" });put("letter",all.count { it.text("type")=="letter" });put("trash",docs().count { it["trashedAt"]!=null && it["trashedAt"]!=JsonNull }) }) }
            }
            "getResume","getCoverLetter" -> return find(if(op=="getResume") "resumes" else "letters",id!!)
            "listResumes" -> return JsonArray(filtered(request,rows("resumes").filter { it["trashedAt"]==null || it["trashedAt"]==JsonNull }))
            "listCoverLetters" -> { val all=rows("letters").filter { it["trashedAt"]==null||it["trashedAt"]==JsonNull };return buildJsonObject { put("items",JsonArray(filtered(request,all)));put("total",all.size) } }
            "listApplications","listApplicationSummaries" -> return JsonArray(filtered(request,rows("applications").filter { it["trashedAt"]==null || it["trashedAt"]==JsonNull }))
            "getApplication" -> return find("applications",id!!)
            "listTrashedApplications" -> { val all=rows("applications").filter { it["trashedAt"]!=null && it["trashedAt"]!=JsonNull };return buildJsonObject { put("items",JsonArray(all));put("total",all.size) } }
            "getResumeBySlug" -> return rows("resumes").firstOrNull { it.text("slug")==request.pathParams["slug"] && it.flag("isPublic") } ?: throw ApiException(404,"NOT_FOUND","This resume isn't shared right now.")
            "verifyResumePassword","createResumePasswordVerification" -> return JsonPrimitive(true)
            "checkResumeSlug","getResumeSlugAvailability" -> return patch(sample(op),buildJsonObject { put("available",rows("resumes").none { it.text("slug")==request.query["slug"]?.jsonPrimitive?.content && it.text("id")!=id }) })
            "getResumeChecks" -> return state.getValue("checks")
            "listCareerFacts" -> return JsonArray(filtered(request,rows("facts").filter { request.query["all"]?.jsonPrimitive?.booleanOrNull==true || it.text("status")!="forgotten" }))
            "listCareerStories" -> return JsonArray(rows("stories").filter { request.query["applicationId"]==null || it["applicationId"]==request.query["applicationId"] })
            "listCareerSavedItems" -> return JsonArray(rows("saved").filter { (request.query["applicationId"]==null || it["applicationId"]==request.query["applicationId"]) && (request.query["kind"]==null || it["data"]?.jsonObject?.get("kind")==request.query["kind"]) })
            "listCareerSchedules" -> return state.getValue("schedules")
            "listCareerNotifications" -> return state.getValue("notifications")
            "readCareerNotification" -> { put("notifications",find("notifications",id!!).with("readAt" to JsonPrimitive(now())));return JsonNull }
            "listCareerOpportunities" -> return JsonArray(rows("opportunities").filter { !it.containsKey("dismissedAt") || it["dismissedAt"]==JsonNull })
            "dismissCareerOpportunity" -> { put("opportunities",find("opportunities",id!!).with("dismissedAt" to JsonPrimitive(now())));return JsonNull }
            "trackCareerOpportunity" -> { val opportunity=find("opportunities",id!!);val appId="application-fake-${++sequence}";put("applications",patch(sample("getApplication"),opportunity.with("id" to JsonPrimitive(appId),"status" to JsonPrimitive("saved"))).jsonObject);put("opportunities",opportunity.with("trackedApplicationId" to JsonPrimitive(appId)));return patch(sample(op),buildJsonObject { put("applicationId",appId);put("id",appId) }) }
            "getCareerWorkspace" -> return values["workspace:$id"] ?: (state["workspaces"] as? JsonObject)?.get(id) ?: state.getValue("workspace")
            "saveCareerWorkspace" -> { val next=patch(values["workspace:$id"] ?: state.getValue("workspace"),b);values["workspace:$id"]=next;return next }
            "getCareerFitEvidence" -> return buildJsonObject { put("usable",true) }
            "listAiProviders" -> return state.getValue("providers")
            "listAgentThreads" -> return state.getValue("threads")
            "startAgentThread" -> { val thread=patch(sample(op),b.with("id" to JsonPrimitive("thread-${++sequence}"),"title" to (b["title"] ?: JsonPrimitive("New conversation")))).jsonObject;put("threads",thread);return thread }
            "getAgentThread" -> return patch(sample(op),buildJsonObject { put("thread",find("threads",id!!));put("messages",values["messages:$id"] ?: (state["messages"] as? JsonObject)?.get(id) ?: JsonArray(emptyList())) })
            "updateAgentThread" -> { val thread=patch(find("threads",id!!),b).jsonObject;put("threads",thread);return thread }
            "deleteAgentThread" -> { remove("threads",id!!);return JsonNull }
            "setDefaultAiProvider" -> { setRows("providers",rows("providers").map { it.with("isDefault" to JsonPrimitive(it.text("id")==id)) });return find("providers",id!!) }
            "testAiProvider","createAiProviderTest" -> { val provider=find("providers",id!!).with("testStatus" to JsonPrimitive("success"),"testError" to JsonNull);put("providers",provider);return patch(sample(op),provider) }
            "getResumeStatistics" -> return patch(sample(op),buildJsonObject { put("isPublic",true);put("views",128);put("downloads",14) })
            "getResumeDailyStatistics" -> {
                val heights = listOf(20,15,30,25,10,35,45,30,20,25,55,100,70,40,30,20,15,35,25,45,30,15,20,40)
                val views = heights.map { it*128.0/heights.sum() }.toMutableList()
                views[views.lastIndex] = 128.0-views.dropLast(1).sum()
                return JsonArray(views.mapIndexed { day, count -> buildJsonObject { put("date",time.today().minusDays((views.lastIndex-day).toLong()).toString());put("views",count);put("downloads",if(day<14) 1 else 0) } })
            }
            "getApplicationStats" -> return buildJsonObject {
                val apps=rows("applications").filter { it["trashedAt"]==null||it["trashedAt"]==JsonNull }
                put("total",apps.size)
                put("byStage",JsonArray(apps.groupingBy { it.text("status").orEmpty() }.eachCount().map { (status,count) -> buildJsonObject { put("status",status);put("count",count) } }))
                put("bySource",JsonArray(apps.groupingBy { it.text("source").orEmpty() }.eachCount().map { (source,count) -> buildJsonObject { put("source",source);put("count",count) } }))
            }
            "listFeedbackLinks" -> return JsonArray(rows("feedbackLinks").filter { request.query["resumeId"]==null || it["resumeId"]==request.query["resumeId"] })
            "getFeedbackLink" -> return find("feedbackLinks",id!!)
            "createFeedbackLink" -> {
                val link=rows("feedbackLinks").first().with(*b.toList().toTypedArray()).with("id" to JsonPrimitive("feedback-${++sequence}"),"url" to JsonPrimitive("https://example.invalid/feedback/$sequence"),"status" to JsonPrimitive("active"),"comments" to JsonArray(emptyList()),"events" to JsonArray(emptyList()),"commentCount" to JsonPrimitive(0),"openCommentCount" to JsonPrimitive(0))
                put("feedbackLinks",link);return link
            }
            "revokeFeedbackLink" -> { val link=find("feedbackLinks",id!!).with("status" to JsonPrimitive("revoked"),"revokedAt" to JsonPrimitive(now()));put("feedbackLinks",link);return patch(sample(op),link) }
            "resolveFeedbackComment" -> {
                val link=find("feedbackLinks",id!!)
                val comments=(link["comments"] as? JsonArray).orEmpty().map { if(it.jsonObject.text("id")==request.pathParams["commentId"]) it.jsonObject.with("resolvedAt" to if(b.flag("resolved")) JsonPrimitive(now()) else JsonNull) else it }
                put("feedbackLinks",link.with("comments" to JsonArray(comments)));return patch(sample(op),buildJsonObject { put("resolved",b.flag("resolved")) })
            }
            "viewFeedbackLink" -> return patch(sample(op),buildJsonObject { put("ownerName","Alex Morgan");put("resumeName","Product designer");put("data",rows("resumes").first().getValue("data"));put("comments",rows("feedbackLinks").first()["comments"] ?: JsonArray(emptyList())) })
            "commentOnFeedbackLink" -> {
                val link=rows("feedbackLinks").first()
                val comment=b.with("id" to JsonPrimitive("comment-${++sequence}"),"linkId" to link["id"],"createdAt" to JsonPrimitive(now()),"resolvedAt" to JsonNull)
                put("feedbackLinks",link.with("comments" to JsonArray((link["comments"] as? JsonArray).orEmpty()+comment),"commentCount" to JsonPrimitive((link["commentCount"]?.jsonPrimitive?.intOrNull ?: 0)+1)))
                return patch(sample(op),comment)
            }
            "getFeatureFlags" -> return patch(sample(op),buildJsonObject { put("appUrl","https://example.invalid");put("smtpEnabled",true);put("careerSchedulingEnabled",true);put("customDomains",true) })
            "listResumeTags","listApplicationTags" -> return JsonArray(rows(if(op=="listResumeTags") "resumes" else "applications").flatMap { (it["tags"] as? JsonArray).orEmpty() }.distinct())
            "suggestDuplicateDocumentName" -> return JsonPrimitive(docs().first { it.text("id")==id }.text("name")+" (copy)")
            "copyResumeForJob","createDocumentCopy" -> {
                val retryId=b.text("newId")
                val requestedJob=b["application"] as? JsonObject
                val existingJob=b.text("applicationId")?.let { find("applications",it).also { job ->
                    if(job["trashedAt"]!=null && job["trashedAt"]!=JsonNull) throw ApiException(404,"NOT_FOUND","This job is unavailable.")
                } }
                if(existingJob!=null && requestedJob!=null) throw ApiException(400,"BAD_REQUEST","Choose one job.")
                retryId?.let { key -> jobCopies[key]?.let { (request,jobId) ->
                    if(request!=b) throw ApiException(409,"CONFLICT","This copy request changed.")
                    val copy=find("resumes",key)
                    val job=find("applications",jobId)
                    if(copy.text("applicationId")!=jobId || (copy["trashedAt"]!=null && copy["trashedAt"]!=JsonNull) || (job["trashedAt"]!=null && job["trashedAt"]!=JsonNull)) throw ApiException(409,"CONFLICT","The linked job changed.")
                    return JsonPrimitive(key)
                } }
                val original=find("resumes",b.text("resumeId") ?: b.text("id")!!)
                if(original["trashedAt"]!=null && original["trashedAt"]!=JsonNull) throw ApiException(404,"NOT_FOUND","This resume is unavailable.")
                if(retryId!=null && (rows("resumes")+rows("applications")).any { it.text("id")==retryId }) throw ApiException(409,"CONFLICT","This ID is already used.")
                val copyId=retryId ?: "resume-copy-${++sequence}"
                val jobId=existingJob?.text("id") ?: requestedJob?.let { fields ->
                    val jobId="application-copy-${++sequence}"
                    val base=sample("getApplication").jsonObject
                    put("applications",patch(base,fields.with("id" to JsonPrimitive(jobId),"resumeId" to JsonPrimitive(copyId),"status" to JsonPrimitive("saved"),"trashedAt" to JsonNull,"createdAt" to JsonPrimitive(now()),"updatedAt" to JsonPrimitive(now()),"activity" to JsonArray(emptyList()),"salary" to JsonNull,"coverLetterId" to JsonNull,"sentResumeVersionId" to JsonNull)).jsonObject)
                    jobId
                }
                put("resumes",original.with("id" to JsonPrimitive(copyId),"name" to (b["name"] ?: JsonPrimitive(original.text("name")+" (copy)")),"applicationId" to (jobId?.let(::JsonPrimitive) ?: JsonNull),"isLocked" to JsonPrimitive(false),"isPublic" to JsonPrimitive(false)))
                if(existingJob!=null && existingJob["sentResumeVersionId"] in listOf(null,JsonNull) && (existingJob.text("resumeId")==null || existingJob.text("status")=="saved")) put("applications",existingJob.with("resumeId" to JsonPrimitive(copyId)))
                if(retryId!=null && jobId!=null) jobCopies[retryId]=b to jobId
                return JsonPrimitive(copyId)
            }
            "getApplicationLanes" -> return values["lanes"] ?: buildJsonObject { put("revision",1);put("lanes",JsonArray(listOf("saved","applied","screening","interview","offer","closed").mapIndexed { index,stage -> buildJsonObject { put("id","lane-$stage");put("category",stage);put("label",stage.replaceFirstChar(Char::uppercase));put("systemKey",stage);put("closedReason",JsonNull);put("color","#337344");put("position",index);put("sortOrder",index);put("retiredAt",JsonNull) } })) }
            "createApplicationLane","updateApplicationLane","reorderApplicationLanes","retireApplicationLane" -> {
                val current=executeLocked(ApiRequest("getApplicationLanes","GET","/applications/lanes"),FakeMode.Ready).jsonObject
                var lanes=current.getValue("lanes").jsonArray.map { it.jsonObject }
                when(op) {
                    "createApplicationLane" -> lanes=lanes+buildJsonObject { put("id","lane-fake-${++sequence}");put("category",b["category"] ?: JsonPrimitive("saved"));put("label",b["label"] ?: JsonNull);put("color",b["color"] ?: JsonPrimitive("#337344"));put("systemKey",JsonNull);put("closedReason",JsonNull);put("retiredAt",JsonNull);put("position",lanes.size) }
                    "updateApplicationLane" -> lanes=lanes.map { if(it.text("id")==id) patch(it,b).jsonObject else it }
                    "retireApplicationLane" -> lanes=lanes.map { if(it.text("id")==id) it.with("retiredAt" to JsonPrimitive(now())) else it }
                    else -> { val ids=(b["ids"] ?: b["laneIds"]) as? JsonArray; if(ids!=null) lanes=lanes.sortedBy { ids.indexOf(it["id"]) }.mapIndexed { index,lane -> lane.with("position" to JsonPrimitive(index)) } }
                }
                return current.with("revision" to JsonPrimitive(current.getValue("revision").jsonPrimitive.long+1),"lanes" to JsonArray(lanes)).also { values["lanes"]=it }
            }
        }
        // Shared document operations have both legacy and noun-based REST routes.
        val table=when { request.path.startsWith("/resumes/")->"resumes";request.path.startsWith("/cover-letters/")->"letters";request.path.startsWith("/documents/")->if((request.pathParams["type"] ?: b.text("type"))=="letter") "letters" else "resumes";else->null }
        val docId=id ?: b.text("resumeId")
        if(table!=null && docId!=null && !op.contains("Version") && !op.contains("Restoration")) {
            val old=find(table,docId)
            when(op) {
                "updateResume","patchResumeMetadata","patchResume","updateCoverLetter","patchCoverLetter" -> {
                    unlocked(old)
                    val expected=b.text(if(table=="resumes") "expectedUpdatedAt" else "expectedRevision")
                    if(expected!=null && expected!=old.text(if(table=="resumes") "updatedAt" else "revision")) throw ApiException(409,if(table=="resumes") "RESUME_VERSION_CONFLICT" else "CONFLICT","This document changed elsewhere.")
                    var change=if(b["operations"] is JsonArray) applyPatch(old,b.getValue("operations").jsonArray) else patch(old,b).jsonObject
                    if(table=="letters") {
                        if(b.containsKey("resumeId")) change=change.with("sourceResumeId" to b["resumeId"])
                        if(b.containsKey("applicationId")) change=change.with("sourceApplicationId" to b["applicationId"])
                    }
                    val next=change.with("updatedAt" to JsonPrimitive(now()),"revision" to JsonPrimitive((old["revision"] as? JsonPrimitive)?.longOrNull?.plus(1) ?: 1))
                    put(table,next);return if(table=="resumes") JsonObject(next.filterKeys { it!="applicationId" }) else next
                }
                "renameDocument","patchDocumentName" -> { unlocked(old);put(table,old.with("name" to b["name"]));return JsonNull }
                "setDocumentTags","putDocumentTags" -> { unlocked(old);put(table,old.with("tags" to b["tags"]));return JsonNull }
                "lockDocument","putDocumentLock","setResumeLocked","putResumeLock" -> { val next=old.with("isLocked" to (b["isLocked"] ?: b["locked"] ?: JsonPrimitive(true)),"updatedAt" to JsonPrimitive(now()));put(table,next);return if(op in setOf("setResumeLocked","putResumeLock")) next else JsonNull }
                "trashDocument","putDocumentTrash","deleteResume","deleteCoverLetter" -> { unlocked(old);put(table,old.with("trashedAt" to JsonPrimitive(now())));return JsonNull }
                "restoreDocument","deleteDocumentTrash" -> { put(table,old.with("trashedAt" to JsonNull));return JsonNull }
                "purgeDocument","deleteDocumentPermanently" -> { check(old["trashedAt"]!=null && old["trashedAt"]!=JsonNull);remove(table,docId);return JsonNull }
                "duplicateResume","createResumeCopy","duplicateCoverLetter","createCoverLetterCopy" -> { val copyId="${table}-copy-${++sequence}";val copy=old.with("id" to JsonPrimitive(copyId),"name" to (b["name"] ?: JsonPrimitive(old.text("name")+" (copy)")),"isLocked" to JsonPrimitive(false),"isPublic" to JsonPrimitive(false),"createdAt" to JsonPrimitive(now()),"updatedAt" to JsonPrimitive(now()));put(table,copy);return if(table=="resumes") JsonPrimitive(copyId) else copy }
                "setResumePassword" -> { val next=old.with("hasPassword" to JsonPrimitive(true));put(table,next);return next }
                "removeResumePassword" -> { val next=old.with("hasPassword" to JsonPrimitive(false));put(table,next);return next }
                "linkDocumentApplication","putDocumentApplication" -> { val next=old.with(if(table=="resumes") "applicationId" to b["applicationId"] else "sourceApplicationId" to b["applicationId"]);put(table,next);return patch(sample(op),next) }
                "exportCoverLetter" -> return old.with("format" to JsonPrimitive("reactive-resume-cover-letter"),"version" to JsonPrimitive(1))
                "refreshCoverLetterStyle","createCoverLetterStyleRefresh" -> return old
            }
        }
        if(op in setOf("createResume","importResume","createResumeImport","importResumeFile","createCoverLetter","importCoverLetter","createCoverLetterImport","createApplication")) {
            val target=if(op.contains("Application")) "applications" else if(op.contains("CoverLetter")) "letters" else "resumes"
            val newId=b.text("newId") ?: "$target-fake-${++sequence}"
            val base=if(target=="applications") sample("getApplication") else rows(target).first()
            val input=(b["document"] as? JsonObject) ?: b
            val next=patch(base,input.with("id" to JsonPrimitive(newId),"isLocked" to JsonPrimitive(false),"trashedAt" to JsonNull,"createdAt" to JsonPrimitive(now()),"updatedAt" to JsonPrimitive(now()),"revision" to JsonPrimitive(1),"name" to (input["name"] ?: JsonPrimitive("Untitled")))).jsonObject
            put(target,next)
            return if(target in setOf("resumes","applications")) JsonPrimitive(newId) else next
        }
        if(request.path.contains("/versions")) return versionOperation(request,op,id!!,b)
        val collections=mapOf("CareerFact" to "facts","CareerStory" to "stories","CareerSchedule" to "schedules","CareerOffer" to "saved","CareerSavedItem" to "saved","AiProvider" to "providers")
        collections.entries.firstOrNull { op.contains(it.key) }?.let { (_,target) ->
            when {
                op.startsWith("delete") || op.startsWith("forget") -> { if(op.startsWith("forget")) put(target,find(target,id!!).with("status" to JsonPrimitive("forgotten"))) else remove(target,id!!);return JsonNull }
                op.startsWith("save") || op.startsWith("create") || op.startsWith("update") || op.startsWith("correct") -> {
                    val newId=id ?: b.text("id") ?: "$target-${++sequence}"
                    val base=rows(target).firstOrNull { it.text("id")==newId } ?: rows(target).firstOrNull() ?: sample(op) as? JsonObject ?: JsonObject(emptyMap())
                    var next=patch(base,b.with("id" to JsonPrimitive(newId),"createdAt" to (base["createdAt"] ?: JsonPrimitive(now())),"updatedAt" to JsonPrimitive(now()))).jsonObject
                    if(target=="stories") next=next.with("data" to patch(base["data"] ?: JsonObject(emptyMap()),b))
                    if(target=="saved") next=next.with("data" to patch(base["data"] ?: JsonObject(emptyMap()),b.with("kind" to JsonPrimitive("offer"))))
                    put(target,next);return if(sample(op)==JsonNull) JsonNull else next
                }
            }
        }
        if(request.path.startsWith("/applications/")) return applicationOperation(request,op,id,b)
        if(op=="generateCareerWork") {
            val kind=(b["task"] as? JsonObject)?.text("task") ?: b.text("task") ?: "fit"
            val saved=rows("saved").firstOrNull { it["data"]?.jsonObject?.text("kind")==kind }
            return patch(sample(op),buildJsonObject { put("item",saved ?: JsonNull) })
        }
        if(op=="improveLine" || op=="createImprovement") return patch(sample(op),buildJsonObject { put("text","Created and scaled a design system adopted by six product teams, cutting interface defects by a third.") })
        // Stateless checks, exports, disclosures and consent receipts use generated structural responses.
        return values[op] ?: sample(op)
    }
    private fun batchOperation(op: String,b: JsonObject,id: String?): JsonElement? {
        when(op) {
            "restoreDocuments","purgeDocuments" -> {
                val selected=(b["documents"] as? JsonArray).orEmpty()
                for(document in selected) {
                    val row=document.jsonObject;val table=if(row.text("type")=="letter") "letters" else "resumes"
                    val id=row.text("id")!!
                    if(op=="restoreDocuments") put(table,find(table,id).with("trashedAt" to JsonNull)) else remove(table,id)
                }
                return patch(sample(op),buildJsonObject { put(if(op=="restoreDocuments") "restored" else "deleted",selected.size) })
            }
            "emptyDocumentTrash","purgeExpiredDocuments" -> {
                var count=0
                for(table in listOf("resumes","letters")) setRows(table,rows(table).filter { row ->
                    val date=parseInstant(row.text("trashedAt"))
                    val purge=date!=null && (op=="emptyDocumentTrash" || date<time.now().minus(java.time.Duration.ofDays(30)))
                    if(purge) count++;!purge
                })
                return if(op=="purgeExpiredDocuments") JsonNull else buildJsonObject { put("deleted",count) }
            }
            "trashApplications","deleteApplications","bulkDeleteApplications","patchApplications","bulkUpdateApplications" -> {
                val ids=(b["ids"] as? JsonArray).orEmpty().map { it.jsonPrimitive.content }
                for(id in ids) {
                    val old=find("applications",id)
                    val next=if(op in setOf("patchApplications","bulkUpdateApplications")) {
                        patch(old,JsonObject(b.filterKeys { it in setOf("status","closedReason","laneId") })).jsonObject.with("tags" to JsonArray(((old["tags"] as? JsonArray).orEmpty()+(b["addTags"] as? JsonArray).orEmpty()).distinct()))
                    } else old.with("trashedAt" to JsonPrimitive(now()))
                    put("applications",next)
                }
                return patch(sample(op),buildJsonObject { put("updated",ids.size);put("deleted",ids.size);put("trashed",ids.size) })
            }
            "saveWebAccessKey" -> { values["webAccessKey"]=b;return JsonNull }
            "deleteWebAccessKey" -> { values.remove("webAccessKey");return JsonNull }
            "createFile" -> return patch(sample(op),buildJsonObject { put("url","https://example.invalid/preview-file");put("path","preview-file");put("contentType","image/jpeg") })
            "deleteStoredFile" -> return JsonNull
            "deleteApiKey","deleteConnectedApplication" -> {
                val listOperation=if(op=="deleteApiKey") "listApiKeys" else "listConnectedApplications"
                val key=if(op=="deleteApiKey") "apiKeys" else "connections"
                if(id!=null) values[listOperation]?.jsonObject?.let { value ->
                    val rows=value.getValue(key).jsonArray.filter { it.jsonObject.text("id")!=id }
                    values[listOperation]=value.with(key to JsonArray(rows)).let { if(key=="apiKeys") it.with("total" to JsonPrimitive(rows.size)) else it }
                }
                return sample(op)
            }
        }
        return null
    }
    private fun versionOperation(request: ApiRequest,op: String,id: String,b: JsonObject): JsonElement {
        val table=if(op.contains("CoverLetter")) "letters" else "resumes"
        val rows=versions.getOrPut("$table:$id") { mutableListOf(find(table,id).with("id" to JsonPrimitive("version-sent-lumen"),"name" to JsonPrimitive("Sent to Lumen"),"label" to JsonPrimitive("Sent to Lumen"),"kind" to JsonPrimitive("named"),"resumeId" to JsonPrimitive(id),"coverLetterId" to JsonPrimitive(id),"snapshot" to find(table,id),"data" to (find(table,id)["data"] ?: find(table,id)))) }
        val versionId=request.pathParams["versionId"]
        return when {
            op.startsWith("list") -> JsonArray(rows)
            op.startsWith("create") && !op.contains("Restoration") -> find(table,id).with("id" to JsonPrimitive("version-${++sequence}"),"label" to b["label"],"name" to b["name"],"kind" to JsonPrimitive("named"),"snapshot" to find(table,id),"data" to (find(table,id)["data"] ?: find(table,id)),"resumeId" to JsonPrimitive(id),"coverLetterId" to JsonPrimitive(id)).also { rows+=it }
            op.startsWith("rename") -> rows.first { it.text("id")==versionId }.with(*b.toList().toTypedArray()).also { next -> rows[rows.indexOfFirst { it.text("id")==versionId }]=next }
            op.startsWith("delete") -> { rows.removeAll { it.text("id")==versionId };JsonNull }
            op.startsWith("restore") || op.contains("Restoration") -> { val version=rows.first { it.text("id")==versionId };val snapshot=(version["snapshot"] as? JsonObject) ?: version;put(table,snapshot.with("id" to JsonPrimitive(id),"updatedAt" to JsonPrimitive(now())));find(table,id) }
            else -> rows.firstOrNull { it.text("id")==versionId } ?: throw ApiException(404,"NOT_FOUND","Version unavailable.")
        }
    }
    private fun applicationOperation(request: ApiRequest,op: String,id: String?,b: JsonObject): JsonElement {
        if(id==null) return sample(op)
        val old=find("applications",id)
        val next=when {
            op in setOf("patchApplication","updateApplication") -> {
                var result=patch(old,b).jsonObject
                if(b["status"]!=null && b["status"]!=old["status"]) result=result.with("activity" to JsonArray((old["activity"] as? JsonArray).orEmpty()+buildJsonObject { put("id","stage-${++sequence}");put("type","stage");put("at",now());put("stage",b.getValue("status"));put("canonicalTransition",true);put("writeSequence",sequence) }))
                result
            }
            op=="trashApplication" || op=="deleteApplication" -> old.with("trashedAt" to JsonPrimitive(now()))
            op=="restoreApplication" -> old.with("trashedAt" to JsonNull)
            op=="purgeApplication" -> { remove("applications",id);return JsonNull }
            op=="logApplicationFollowUp" -> old.with("followUpAt" to JsonNull,"activity" to JsonArray((old["activity"] as? JsonArray).orEmpty()+buildJsonObject { put("id","follow-up-${++sequence}");put("at",now());put("type","note");put("text","Followed up") }))
            op=="addApplicationNote" -> old.with("activity" to JsonArray((old["activity"] as? JsonArray).orEmpty()+b.with("id" to JsonPrimitive("note-${++sequence}"),"at" to JsonPrimitive(now()),"type" to JsonPrimitive("note"))))
            op=="addApplicationInterview" -> old.with("activity" to JsonArray((old["activity"] as? JsonArray).orEmpty()+b.with("id" to JsonPrimitive("interview-${++sequence}"),"type" to JsonPrimitive("interview"))))
            op.contains("Interview") || op.contains("TimelineEntry") -> old.with("activity" to JsonArray((old["activity"] as? JsonArray).orEmpty().mapNotNull { entry -> if(entry.jsonObject.text("id")!=request.pathParams["entryId"]) entry else if(op.startsWith("delete")) null else patch(entry,b) }))
            op=="attachApplicationDocument" -> if(request.pathParams["kind"]=="resume") old.with("resumeFileName" to JsonPrimitive(request.parts.first().filename.orEmpty()),"resumeFileUrl" to JsonPrimitive("https://example.invalid/preview-file")) else old.with("coverLetterName" to JsonPrimitive(request.parts.first().filename.orEmpty()),"coverLetterUrl" to JsonPrimitive("https://example.invalid/preview-file"))
            op=="removeApplicationDocument" -> if(request.pathParams["kind"]=="resume") old.with("resumeFileName" to JsonNull,"resumeFileUrl" to JsonNull) else old.with("coverLetterName" to JsonNull,"coverLetterUrl" to JsonNull)
            op=="deleteApplicationContact" -> old.with("contacts" to JsonArray((old["contacts"] as? JsonArray).orEmpty().filterIndexed { index,_ -> index!=request.pathParams["index"]?.toInt() }))
            else -> return sample(op)
        }.with("updatedAt" to JsonPrimitive(now()))
        put("applications",next)
        return if(op in setOf("deleteApplication","trashApplication","restoreApplication","deleteApplicationContact")) JsonNull else next
    }
    private fun applyPatch(old: JsonObject,patches: JsonArray): JsonObject {
        fun apply(node: JsonElement,segments: List<String>,operation: String,value: JsonElement?): JsonElement {
            if(segments.isEmpty()) return value ?: JsonNull
            val key=segments.first();val rest=segments.drop(1)
            return when(node) {
                is JsonObject -> JsonObject(node.toMutableMap().apply { if(rest.isEmpty() && operation=="remove") remove(key) else this[key]=apply(this[key] ?: JsonObject(emptyMap()),rest,operation,value) })
                is JsonArray -> JsonArray(node.toMutableList().apply { val index=if(key=="-") size else key.toInt();if(rest.isEmpty()) when(operation) {"remove"->removeAt(index);"add"->add(index,value ?: JsonNull);else->this[index]=value ?: JsonNull} else this[index]=apply(this[index],rest,operation,value) })
                else -> error("Patch path is not a container.")
            }
        }
        return patches.fold(old as JsonElement) { node,p -> val v=p.jsonObject;val op=v.text("op")!!;require(op in setOf("add","replace","remove"));apply(node,v.text("path")!!.trimStart('/').split('/').map { it.replace("~1","/").replace("~0","~") },op,v["value"]) }.jsonObject
    }
    override suspend fun download(request: ApiRequest): BinaryFile {
        controls.before(request.operation)
        val table=if(request.path.startsWith("/cover-letters/")) "letters" else "resumes"
        val document=find(table,request.pathParams["id"] ?: rows(table).first().text("id")!!)
        val format=request.pathParams["format"] ?: "pdf"
        return fakeExport(format,"Alex Morgan · "+document.text("name"),document.toString())
    }
    override fun events(request: ApiRequest): Flow<ServerEvent> = flow {
        controls.before(request.operation)
        emit(ServerEvent("1","message",buildJsonObject { put("type","text-delta");put("delta","Your message is kept. Review proposed edits before applying them.") }.toString()))
        emit(ServerEvent("2","done","{}"))
    }
}
