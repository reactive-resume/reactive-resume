package me.rxresu.core.database

import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Payload is the complete document; adapters own editable fields, revisions, and normalized server echoes. */
data class DraftDocument(val id: String, val name: String, val revision: String, val locked: Boolean, val json: String)
data class DraftCopy(val id: String, val name: String)
class DraftFailure(val code: String, message: String, cause: Throwable? = null) : IOException(message,cause)

interface DraftRemote {
    suspend fun read(scope: String, kind: String, id: String): DraftDocument
    suspend fun save(record: DraftRecord): DraftDocument
    /** Must persist the newly created ID via remember before any subsequent network write. */
    suspend fun copy(record: DraftRecord, remember: suspend (String) -> Unit): DraftCopy
    fun sameContent(kind: String, left: String, right: String): Boolean
    fun merge(kind: String, saved: String, submitted: String, current: String): String
    fun acknowledgeDecisions(current: String,submitted: String): String = if(current==submitted) "{}" else current
}

enum class SaveStatus { Saved, Saving, Offline, CouldntSave, Locked, Conflict, Recovered }
fun DraftRecord.saveStatus(): SaveStatus = when(status) {
    "saving" -> SaveStatus.Saving
    "offline" -> SaveStatus.Offline
    "locked" -> SaveStatus.Locked
    "conflict" -> SaveStatus.Conflict
    "recovered" -> SaveStatus.Recovered
    "error" -> SaveStatus.CouldntSave
    else -> SaveStatus.Saved
}

/** Durable edit-before-send owner. Network calls never hold a Room transaction or block typing. */
class DraftQueue(
    private val dao: DraftDao,
    private val remote: DraftRemote,
    private val currentScope: () -> String?,
    private val online: () -> Boolean,
    private val schedule: (String) -> Unit = {},
) {
    private val locks = ConcurrentHashMap<String,Mutex>()
    private fun lock(scope: String, kind: String, id: String) = locks.getOrPut("$scope\u0000$kind\u0000$id") { Mutex() }
    private fun owner(scope: String) { check(currentScope()==scope) { "Draft account changed." } }
    fun observe(scope: String, kind: String, id: String): Flow<DraftRecord?> = dao.observe(scope,kind,id)
    fun pending(scope: String) = dao.observePending(scope)

    suspend fun open(scope: String, kind: String, id: String): DraftRecord = lock(scope,kind,id).withLock {
        owner(scope)
        val local=dao.get(scope,kind,id)
        if(local!=null && (!online() || local.dirty)) return@withLock local
        val read=try { remote.read(scope,kind,id) } catch(e: CancellationException) { throw e } catch(e: IOException) { return@withLock local ?: throw e }
        owner(scope)
        val loaded=DraftRecord(scope,kind,id,read.name,read.json,read.json,read.revision,local?.sessionId ?: UUID.randomUUID().toString(),locked=read.locked)
        if(local==null) dao.put(loaded) else dao.replaceIfGeneration(local,loaded)
        requireNotNull(dao.get(scope,kind,id))
    }
    /** Caller keeps its in-memory value when this throws (full/unwritable disk is never 'saved'). */
    suspend fun edit(scope: String, kind: String, id: String, document: String, name: String, decisions: String? = null, applications: String? = null): DraftRecord {
        owner(scope)
        val alreadyQueued=dao.get(scope,kind,id)?.dirty==true
        val result=dao.edit(scope,kind,id,document,name,decisions,applications)
        if(!online()) dao.mark(scope,kind,id,"offline")
        if(!alreadyQueued) schedule(scope)
        return result
    }
    suspend fun refresh(scope: String, kind: String, id: String, deferClean: Boolean = false) = lock(scope,kind,id).withLock {
        owner(scope)
        val before=dao.get(scope,kind,id) ?: return@withLock
        val read=remote.read(scope,kind,id); owner(scope)
        val current=dao.get(scope,kind,id) ?: return@withLock
        if(current.dirty) {
            // A lock-only change may advance the revision; a content change must still conflict at save.
            val same=remote.sameContent(kind,read.json,current.baseline)
            dao.replaceIfGeneration(current,current.copy(locked=read.locked,
                baseline=if(same) read.json else current.baseline, revision=if(same) read.revision else current.revision,
                status=if(read.locked) "locked" else if(online()) "saving" else "offline"))
        } else if(deferClean) {
            dao.mark(scope,kind,id,current.status,read.locked)
        } else if(current.generation==before.generation) {
            dao.replaceIfGeneration(current,current.copy(name=read.name,baseline=read.json,document=read.json,revision=read.revision,locked=read.locked,status="saved"))
        }
    }
    /** Returns false only for retryable failures. Locked/conflicting records stay durable and visible. */
    suspend fun sync(scope: String): Boolean {
        if(currentScope()!=scope) return true
        var complete=true
        for(record in dao.pending(scope)) {
            if(currentScope()!=scope) return true
            if(!flush(scope,record.kind,record.documentId)) complete=false
        }
        return complete
    }
    suspend fun flush(scope: String, kind: String, id: String): Boolean = lock(scope,kind,id).withLock {
        while(currentScope()==scope) {
            val submitted=dao.get(scope,kind,id) ?: return@withLock true
            if(!submitted.dirty) return@withLock true
            if(!online()) { dao.mark(scope,kind,id,"offline"); return@withLock false }
            try {
                val read=remote.read(scope,kind,id); owner(scope)
                if(read.locked) { dao.mark(scope,kind,id,"locked",true); return@withLock true }
                if(read.revision!=submitted.revision && !remote.sameContent(kind,read.json,submitted.baseline)) {
                    // Lost response: equality is acknowledgement only when there are no unacknowledged decisions.
                    if(remote.sameContent(kind,read.json,submitted.document) && submitted.decisions=="{}") acknowledge(submitted,read)
                    else { recover(scope,kind,id); return@withLock true }
                } else {
                    dao.mark(scope,kind,id,"saving",false)
                    val saved=remote.save(submitted.copy(baseline=read.json,revision=read.revision)); owner(scope)
                    acknowledge(submitted,saved)
                }
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) {
                if(currentScope()!=scope) return@withLock true
                val code=(e as? DraftFailure)?.code
                when(code) {
                    "RESUME_VERSION_CONFLICT", "CONFLICT", "CURRENT_CLIENT_REQUIRED" -> {
                        dao.mark(scope,kind,id,"conflict",failureCode=code)
                        try { recover(scope,kind,id); return@withLock true }
                        catch(cancel: CancellationException) { throw cancel }
                        catch(failure: Exception) { dao.mark(scope,kind,id,"error",failureCode=code); return@withLock false }
                    }
                    "LOCKED", "RESUME_LOCKED", "COVER_LETTER_LOCKED" -> { dao.mark(scope,kind,id,"locked",true,code); return@withLock true }
                    else -> { dao.mark(scope,kind,id,if(online()) "error" else "offline",failureCode=code); return@withLock false }
                }
            }
        }
        true
    }
    private suspend fun acknowledge(submitted: DraftRecord, saved: DraftDocument) {
        while(currentScope()==submitted.accountScope) {
            val current=dao.get(submitted.accountScope,submitted.kind,submitted.documentId) ?: return
            val newer=current.generation!=submitted.generation
            val merged=if(newer) remote.merge(current.kind,saved.json,submitted.document,current.document) else saved.json
            if(dao.replaceIfGeneration(current,current.copy(baseline=saved.json,document=merged,revision=saved.revision,
                dirty=newer,locked=saved.locked,status=if(newer) "saving" else "saved",decisions=remote.acknowledgeDecisions(current.decisions,submitted.decisions),failureCode=null))) return
        }
    }
    private suspend fun recover(scope: String, kind: String, id: String) {
        while(currentScope()==scope) {
            val current=dao.get(scope,kind,id) ?: return
            dao.mark(scope,kind,id,"conflict")
            val copy=remote.copy(current) { copyId -> owner(scope); dao.rememberCopy(scope,kind,id,copyId) }
            owner(scope)
            val remoteDocument=remote.read(scope,kind,id); owner(scope)
            val latest=dao.get(scope,kind,id) ?: return
            if(latest.generation!=current.generation) continue
            if(dao.replaceIfGeneration(latest,latest.copy(name=remoteDocument.name,baseline=remoteDocument.json,document=remoteDocument.json,
                revision=remoteDocument.revision,dirty=false,locked=remoteDocument.locked,status="recovered",copyId=copy.id,
                recoveredName=copy.name,decisions="{}",applications="{}",failureCode=null))) return
        }
    }
}
