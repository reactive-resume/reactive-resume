package me.rxresu.core.data

import kotlinx.serialization.json.*
import me.rxresu.core.database.*
import me.rxresu.core.network.*

internal fun JsonObject.text(key: String): String? = (get(key) as? JsonPrimitive)?.contentOrNull
internal fun JsonObject.flag(key: String): Boolean = (get(key) as? JsonPrimitive)?.booleanOrNull == true
internal fun JsonObject.with(vararg values: Pair<String,JsonElement?>) = JsonObject(toMutableMap().apply { values.forEach { (k,v) -> this[k]=v ?: JsonNull } })
internal fun parseObject(value: String) = ApiJson.parseToJsonElement(value).jsonObject
internal fun changed(current: JsonObject, baseline: JsonObject) = JsonObject(current.filter { (key,value) -> value!=baseline[key] && !(value==JsonNull && baseline[key]==null) })
internal fun overlayChanged(saved: JsonObject, submitted: JsonObject, current: JsonObject): JsonObject = JsonObject(saved.toMutableMap().apply {
    current.forEach { (key,value) -> if(value!=submitted[key]) this[key]=if(value is JsonObject && submitted[key] is JsonObject && saved[key] is JsonObject) overlayChanged(saved.getValue(key).jsonObject,submitted.getValue(key).jsonObject,value) else value }
})

internal class JsonDraftRemote(private val transport: ApiTransport) : DraftRemote {
    private val resumeFields=setOf("name","slug","tags","isPublic","showDownloadButtons","allowWordDownload","showInSearchEngines","hideContactDetails","isPrimary","data","aiOperationIds")
    private val letterFields=setOf("name","recipient","content","greeting","signOff","recipientName","recipientCompany","letterDate","sourceResumeId","sourceApplicationId","senderLinked","designLinked","style","aiOperationIds")
    private fun fields(kind: String, json: String) = JsonObject(parseObject(json).filterKeys { it in if(kind=="resume") resumeFields else letterFields })
    private fun snapshot(kind: String, raw: JsonElement): DraftDocument {
        val value=raw.jsonObject
        return DraftDocument(value.text("id")!!,value.text("name")!!,value.text(if(kind=="resume") "updatedAt" else "revision")!!,value.flag("isLocked"),raw.toString())
    }
    private suspend fun execute(scope: String, operation: String, method: String, path: String, id: String? = null, body: JsonElement? = null): JsonElement {
        try { return transport.execute(ApiRequest(operation,method,path,if(id!=null) mapOf("id" to id) else emptyMap(),body=body,options=RequestOptions(accountScope=scope))) }
        catch(e: ApiException) { throw DraftFailure(e.code ?: "HTTP_${e.status}",e.message,e) }
    }
    override suspend fun read(scope: String, kind: String, id: String): DraftDocument = snapshot(kind,
        execute(scope,if(kind=="resume") "getResume" else "getCoverLetter","GET",if(kind=="resume") "/resumes/{id}" else "/cover-letters/{id}",id))
    override fun sameContent(kind: String, left: String, right: String): Boolean {
        fun normalize(value: JsonElement): JsonElement = when(value) {
            is JsonObject -> JsonObject(value.filterValues { it!=JsonNull }.mapValues { normalize(it.value) })
            is JsonArray -> JsonArray(value.map(::normalize))
            else -> value
        }
        return normalize(fields(kind,left))==normalize(fields(kind,right))
    }
    override fun merge(kind: String, saved: String, submitted: String, current: String) = overlayChanged(parseObject(saved),fields(kind,submitted),fields(kind,current)).toString()
    override fun acknowledgeDecisions(current: String,submitted: String): String {
        val sent=parseObject(submitted)
        return JsonObject(parseObject(current).filter { (key,value) -> sent[key]!=value }).toString()
    }

    override suspend fun save(record: DraftRecord): DraftDocument {
        val current=parseObject(record.document)
        val before=parseObject(record.baseline)
        val changes=changed(fields(record.kind,record.document),fields(record.kind,record.baseline)).toMutableMap()
        if(record.kind=="letter") {
            changes.remove("sourceResumeId")?.let { changes["resumeId"]=it }
            changes.remove("sourceApplicationId")?.let { changes["applicationId"]=it }
            changes.remove("style")
            val style=current.getValue("style").jsonObject
            val oldStyle=before.getValue("style").jsonObject
            if(!current.flag("senderLinked")) {
                val sender=changed(style.getValue("basics").jsonObject,oldStyle.getValue("basics").jsonObject).toMutableMap()
                val hidden=style.getValue("picture").jsonObject["hidden"]
                if(hidden!=oldStyle.getValue("picture").jsonObject["hidden"]) sender["picture"]=buildJsonObject { put("hidden",hidden ?: JsonNull) }
                if(sender.isNotEmpty()) changes["sender"]=JsonObject(sender)
            }
            val metadata=style.getValue("metadata").jsonObject
            val oldMetadata=oldStyle.getValue("metadata").jsonObject
            if(metadata["template"]!=oldMetadata["template"]) changes["template"]=metadata.getValue("template")
            val page=metadata["page"] as? JsonObject
            val oldPage=oldMetadata["page"] as? JsonObject
            if(page?.get("locale")!=oldPage?.get("locale")) page?.get("locale")?.let { changes["locale"]=it }
            val metadataChanges=changed(metadata,oldMetadata).filterKeys { it in setOf("typography","design") }.toMutableMap()
            if(page!=null && oldPage!=null && page.filterKeys { it!="locale" }!=oldPage.filterKeys { it!="locale" }) metadataChanges["page"]=page
            if(metadataChanges.isNotEmpty()) changes["metadata"]=JsonObject(metadataChanges)
            changes["expectedRevision"]=ApiJson.parseToJsonElement(record.revision)
        } else changes["expectedUpdatedAt"]=JsonPrimitive(record.revision)
        changes["sessionId"]=JsonPrimitive(record.sessionId)
        changes["proposalSafety"]=JsonPrimitive("v1")
        val decisions=parseObject(record.decisions)
        if(decisions.isNotEmpty()) changes["proposalApplications"]=decisions
        val raw=execute(record.accountScope,if(record.kind=="resume") "updateResume" else "updateCoverLetter","PUT",
            if(record.kind=="resume") "/resumes/{id}" else "/cover-letters/{id}",record.documentId,JsonObject(changes))
        return snapshot(record.kind,if(record.kind=="resume") current.with(*raw.jsonObject.toList().toTypedArray()) else raw)
    }
    override suspend fun copy(record: DraftRecord, remember: suspend (String)->Unit): DraftCopy {
        val current=parseObject(record.document)
        val name=(record.name+" (mine)").take(100)
        if(record.kind=="resume") {
            val id=record.copyId ?: execute(record.accountScope,"importResume","POST","/resumes/import",body=buildJsonObject {
                put("data",current.getValue("data")); current["aiOperationIds"]?.let { put("aiOperationIds",it) }
            }).jsonPrimitive.content.also { remember(it) }
            execute(record.accountScope,"updateResume","PUT","/resumes/{id}",id,buildJsonObject {
                put("name",name); put("data",current.getValue("data")); put("tags",current["tags"] ?: JsonArray(emptyList()))
            })
            return DraftCopy(id,name)
        }
        val document=buildJsonObject {
            put("format","reactive-resume-cover-letter"); put("version",1); put("name",name)
            for(key in listOf("recipient","content","greeting","signOff","style","layout","recipientName","recipientCompany","letterDate")) current[key]?.let { put(key,it) }
        }
        val id=record.copyId ?: execute(record.accountScope,"importCoverLetter","POST","/cover-letters/import",body=buildJsonObject {
            put("document",document); current["aiOperationIds"]?.let { put("aiOperationIds",it) }
        }).jsonObject.text("id")!!.also { remember(it) }
        // A newer edit can arrive while a recovery copy uploads: update that same copy before acknowledging it.
        if(record.copyId!=null) {
            val copy=read(record.accountScope,"letter",id)
            val authored=current.with("id" to JsonPrimitive(id),"name" to JsonPrimitive(name),"senderLinked" to JsonPrimitive(false),"designLinked" to JsonPrimitive(false))
            save(record.copy(documentId=id,document=authored.toString(),baseline=copy.json,revision=copy.revision,decisions="{}"))
        }
        return DraftCopy(id,name)
    }
}
