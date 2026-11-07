package me.rxresu.core.database

import android.content.Context
import androidx.room.*
import kotlinx.coroutines.flow.Flow

/** Entire server/account identity is supplied by AuthSession.accountScope. No global unscoped rows. */
@Entity(tableName = "drafts", primaryKeys = ["accountScope", "kind", "documentId"])
data class DraftRecord(
    val accountScope: String,
    val kind: String,
    val documentId: String,
    val name: String,
    val baseline: String,
    val document: String,
    val revision: String,
    val sessionId: String,
    val generation: Long = 0,
    val dirty: Boolean = false,
    val locked: Boolean = false,
    val status: String = "saved",
    val copyId: String? = null,
    val recoveredName: String? = null,
    val decisions: String = "{}",
    val applications: String = "{}",
    val failureCode: String? = null,
)

@Entity(tableName = "cached_lists", primaryKeys = ["accountScope", "cacheKey"])
data class CachedList(val accountScope: String, val cacheKey: String, val json: String, val savedAt: Long)

@Dao
abstract class DraftDao {
    @Query("SELECT * FROM drafts WHERE accountScope = :scope AND kind = :kind AND documentId = :id")
    abstract fun observe(scope: String, kind: String, id: String): Flow<DraftRecord?>
    @Query("SELECT * FROM drafts WHERE accountScope = :scope AND kind = :kind AND documentId = :id")
    abstract suspend fun get(scope: String, kind: String, id: String): DraftRecord?
    @Query("SELECT * FROM drafts WHERE accountScope = :scope AND dirty = 1 ORDER BY kind, documentId")
    abstract suspend fun pending(scope: String): List<DraftRecord>
    @Query("SELECT * FROM drafts WHERE accountScope = :scope AND dirty = 1 ORDER BY kind, documentId")
    abstract fun observePending(scope: String): Flow<List<DraftRecord>>
    @Upsert abstract suspend fun put(record: DraftRecord)
    @Query("DELETE FROM drafts WHERE accountScope = :scope")
    abstract suspend fun deleteAccount(scope: String)

    @Transaction
    open suspend fun edit(scope: String, kind: String, id: String, document: String, name: String, decisions: String?, applications: String? = null): DraftRecord {
        val previous = requireNotNull(get(scope,kind,id)) { "Open the document before editing." }
        check(!previous.locked) { "Document is locked. Latest changes remain on this phone." }
        return previous.copy(document=document, name=name, generation=previous.generation+1, dirty=true,
            status="saving", recoveredName=null, copyId=if(previous.dirty) previous.copyId else null, decisions=decisions ?: previous.decisions,
            applications=applications ?: previous.applications).also { put(it) }
    }
    @Transaction
    open suspend fun replaceIfGeneration(expected: DraftRecord, replacement: DraftRecord): Boolean {
        val current=get(expected.accountScope,expected.kind,expected.documentId) ?: return false
        if(current.generation!=expected.generation || current.document!=expected.document || current.baseline!=expected.baseline) return false
        put(replacement); return true
    }
    @Transaction
    open suspend fun mark(scope: String, kind: String, id: String, status: String, locked: Boolean? = null, failureCode: String? = null) {
        get(scope,kind,id)?.let { put(it.copy(status=status,locked=locked ?: it.locked,failureCode=failureCode)) }
    }
    @Transaction
    open suspend fun rememberCopy(scope: String, kind: String, id: String, copyId: String) {
        get(scope,kind,id)?.let { put(it.copy(copyId=copyId)) }
    }
}

@Dao
interface CacheDao {
    @Query("SELECT * FROM cached_lists WHERE accountScope = :scope AND cacheKey = :key")
    fun observe(scope: String, key: String): Flow<CachedList?>
    @Query("SELECT * FROM cached_lists WHERE accountScope = :scope AND cacheKey = :key")
    suspend fun get(scope: String, key: String): CachedList?
    @Upsert suspend fun put(value: CachedList)
    @Query("DELETE FROM cached_lists WHERE accountScope = :scope") suspend fun deleteAccount(scope: String)
}

@Database(entities=[DraftRecord::class,CachedList::class], version=1, exportSchema=true)
abstract class RrDatabase : RoomDatabase() {
    abstract fun drafts(): DraftDao
    abstract fun cache(): CacheDao
    companion object {
        fun open(context: Context): RrDatabase = Room.databaseBuilder(context.applicationContext,RrDatabase::class.java,"reactive-resume.db").build()
    }
}
