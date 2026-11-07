package me.rxresu.core.data

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.*
import me.rxresu.core.auth.AuthSession
import me.rxresu.core.database.*
import me.rxresu.core.network.*

internal class PersistentDocumentDraft<T>(
    private val owner: String,private val kind: String,private val id: String,
    private val queue: DraftQueue,private val dao: DraftDao,private val remote: DraftRemote,
    private val auth: AuthSession,private val serializer: KSerializer<T>,private val parentScope: CoroutineScope,
    initial: DraftRecord,
    private val updates: (() -> Flow<ServerEvent>)? = null,
) : DocumentDraft<T> {
    private val scope=CoroutineScope(parentScope.coroutineContext+SupervisorJob(parentScope.coroutineContext[Job]))
    private val mutex=Mutex()
    private data class Checkpoint<T>(val document: T,val applications: JsonObject)
    private val undo=ArrayDeque<Checkpoint<T>>();private val redo=ArrayDeque<Checkpoint<T>>()
    private var autosave: Job?=null
    private var closed=false
    private var editing=false
    internal val isClosed get()=closed
    private var generation=initial.generation
    private var unpersistedDecisions=JsonObject(emptyMap())
    private var retained=from(initial)
    private val mutable=MutableStateFlow(retained)
    override val state=mutable.asStateFlow()
    private fun from(record: DraftRecord)=DraftState(ApiJson.decodeFromString(serializer,record.document),record.saveStatus(),record.locked,undo.isNotEmpty(),redo.isNotEmpty(),record.copyId,record.recoveredName,proposalApplications=parseObject(record.applications))
    private fun guard() { check(!closed && auth.state.value.scope()==owner) { "Draft account changed or draft closed." } }
    private fun publish(value: DraftState<T>) {
        retained=value
        if(auth.state.value.scope()==owner) mutable.value=value
    }
    init {
        scope.launch {
            auth.state.map { it.scope() }.distinctUntilChanged().collect { account ->
                if(account!=owner) { autosave?.cancel();mutable.value=DraftState(null) }
                else mutable.value=retained
            }
        }
        scope.launch { queue.observe(owner,kind,id).collect { row ->
            if(row!=null && row.generation>=generation && retained.error==null) {
                generation=row.generation
                publish(from(row))
            }
        } }
        if(initial.dirty) autosave=scope.launch { queue.flush(owner,kind,id) }
        if(updates!=null) scope.launch {
            auth.state.collectLatest { session ->
                if(session !is me.rxresu.core.auth.SessionState.SignedIn || session.accountScope!=owner) return@collectLatest
                while(isActive) {
                    try { updates.invoke().collect { queue.refresh(owner,kind,id,deferClean=editing) } }
                    catch(e: CancellationException) { throw e }
                    catch(_: java.io.IOException) { /* Reconnect without logging authored event payloads. */ }
                    delay(2500)
                }
            }
        }
    }
    override suspend fun update(value: T,proposalApplications: JsonObject?) = mutex.withLock {
        guard();check(!state.value.locked) { "Document is locked." }
        val before=mutable.value.document
        if(before==value && proposalApplications==null) return@withLock
        if(before!=null) { undo.addLast(Checkpoint(before,retained.proposalApplications));if(undo.size>200) undo.removeFirst() }
        redo.clear();persist(value,proposalApplications)
    }
    private suspend fun persist(value: T,decisions: JsonObject? = null) {
        fun keepCleared(next: JsonElement,before: JsonElement?): JsonElement = when {
            next is JsonObject && before is JsonObject -> JsonObject(next.mapValues { (key,child) -> keepCleared(child,before[key]) }+before.keys.filter { it !in next }.associateWith { JsonNull })
            next is JsonArray && before is JsonArray -> JsonArray(next.mapIndexed { index,child ->
                val id=(child as? JsonObject)?.get("id")
                val previous=if(id==null) before.getOrNull(index) else before.firstOrNull { (it as? JsonObject)?.get("id")==id }
                keepCleared(child,previous)
            })
            else -> next
        }
        val raw=keepCleared(ApiJson.encodeToJsonElement(serializer,value),retained.document?.let { ApiJson.encodeToJsonElement(serializer,it) }).jsonObject
        val previous=retained.proposalApplications
        val applications=if(decisions==null) previous else JsonObject(previous+decisions)
        require(applications.values.all { it is JsonPrimitive && (it.isString || it.booleanOrNull!=null) }) { "Proposal decisions must be reviewed wording or boolean marks." }
        val additions=applications.filter { (key,value) -> previous[key]!=value }
        unpersistedDecisions=JsonObject(unpersistedDecisions+additions)
        generation++
        publish(retained.copy(document=value,status=SaveStatus.Saving,canUndo=undo.isNotEmpty(),canRedo=redo.isNotEmpty(),error=null,proposalApplications=applications))
        try {
            val pending=JsonObject(parseObject(dao.get(owner,kind,id)?.decisions ?: "{}")+unpersistedDecisions)
            generation=queue.edit(owner,kind,id,raw.toString(),raw.text("name").orEmpty(),pending.toString(),applications.toString()).generation
            unpersistedDecisions=JsonObject(emptyMap())
        }
        catch(e: CancellationException) { throw e } catch(e: Exception) { publish(retained.copy(status=SaveStatus.CouldntSave,error=e));throw e }
        // Durability is immediate; only network traffic is debounced.
        autosave?.cancel();autosave=scope.launch { delay(if(kind=="resume") 500 else 800);scope.launch { queue.flush(owner,kind,id) } }
    }
    override suspend fun undo() = mutex.withLock {
        guard();if(undo.isEmpty() || state.value.locked) return@withLock
        mutable.value.document?.let { redo.addLast(Checkpoint(it,retained.proposalApplications)) }
        val checkpoint=undo.removeLast()
        persist(checkpoint.document,JsonObject(retained.proposalApplications.keys.associateWith { JsonPrimitive(false) }+checkpoint.applications))
    }
    override suspend fun redo() = mutex.withLock {
        guard();if(redo.isEmpty() || state.value.locked) return@withLock
        mutable.value.document?.let { undo.addLast(Checkpoint(it,retained.proposalApplications)) }
        val checkpoint=redo.removeLast()
        persist(checkpoint.document,JsonObject(retained.proposalApplications.keys.associateWith { JsonPrimitive(false) }+checkpoint.applications))
    }
    override suspend fun flush() {
        guard();autosave?.cancel()
        if(retained.error!=null) {
            val value=requireNotNull(retained.document)
            persist(value)
            autosave?.cancel()
        }
        queue.flush(owner,kind,id)
    }
    override suspend fun refresh() { guard();queue.refresh(owner,kind,id,deferClean=editing) }
    override suspend fun setEditing(editing: Boolean) {
        guard();this.editing=editing
        if(!editing) { flush();refresh() }
    }
    override suspend fun writeMetadata(write: suspend (T)->T): T = mutex.withLock {
        guard();autosave?.cancel();queue.flush(owner,kind,id);guard()
        val before=requireNotNull(dao.get(owner,kind,id))
        check(!before.dirty || before.locked) { "Save your changes before continuing." }
        val written=write(ApiJson.decodeFromString(serializer,before.baseline));guard()
        val raw=ApiJson.encodeToJsonElement(serializer,written).jsonObject
        val latest=requireNotNull(dao.get(owner,kind,id))
        if(latest.baseline==before.baseline && (!latest.dirty || remote.sameContent(kind,before.baseline,raw.toString()))) {
            val merged=remote.merge(kind,raw.toString(),before.baseline,latest.document)
            dao.replaceIfGeneration(latest,latest.copy(baseline=raw.toString(),document=merged,revision=raw.text(if(kind=="resume") "updatedAt" else "revision")!!,locked=raw.flag("isLocked"),status=if(latest.dirty) "saving" else "saved"))
            fun rebase(value: Checkpoint<T>)=value.copy(document=ApiJson.decodeFromString(serializer,remote.merge(kind,ApiJson.encodeToString(serializer,value.document),before.baseline,raw.toString())))
            val previousUndo=undo.map(::rebase);undo.clear();undo.addAll(previousUndo)
            val previousRedo=redo.map(::rebase);redo.clear();redo.addAll(previousRedo)
        }
        if(latest.dirty) autosave=scope.launch { queue.flush(owner,kind,id) }
        written
    }
    override suspend fun close() {
        if(closed) return
        guard()
        // An unwritable disk cannot make navigation drop the only in-memory copy.
        state.value.error?.let { throw it }
        flush();closed=true;scope.cancel()
    }
}

/** Builder and assistant receive the same save/undo owner for an account/document. The builder layout closes it. */
internal class DraftRegistry(private val create: suspend(String,String,String)->PersistentDocumentDraft<*>) {
    private val mutex=Mutex()
    private val handles=mutableMapOf<Triple<String,String,String>,PersistentDocumentDraft<*>>()
    suspend fun open(owner: String,kind: String,id: String): DocumentDraft<*> = mutex.withLock {
        val key=Triple(owner,kind,id)
        handles[key]?.takeUnless { it.isClosed } ?: create(owner,kind,id).also { handles[key]=it }
    }
}
