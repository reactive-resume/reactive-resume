package me.rxresu.core.database

import androidx.room.Room
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35])
class DraftQueueTest {
    private lateinit var db:RrDatabase
    private var account:String?="alice"
    private var online=true
    private lateinit var remote:Remote
    private fun queue()=DraftQueue(db.drafts(),remote,{account},{online})
    @Before fun setup() { db=Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(),RrDatabase::class.java).build();remote=Remote() }
    @After fun close()=db.close()
    private class Remote:DraftRemote {
        var document=DraftDocument("r1","Product designer","1",false,"original")
        val saved=mutableListOf<String>();val copied=mutableListOf<String>()
        var onSave:(suspend()->Unit)?=null
        var onCopy:(suspend()->Unit)?=null
        var failAfterCopy=false
        override suspend fun read(scope: String,kind: String,id: String)=document
        override suspend fun save(record: DraftRecord):DraftDocument {
            onSave?.invoke()
            if(document.locked) throw DraftFailure("LOCKED","Locked while saving")
            if(document.revision!=record.revision) throw DraftFailure("RESUME_VERSION_CONFLICT","Changed elsewhere")
            saved+=record.document
            document=document.copy(json=record.document,revision=(document.revision.toInt()+1).toString())
            return document
        }
        override suspend fun copy(record: DraftRecord,remember: suspend(String)->Unit):DraftCopy {
            val id=record.copyId ?: "copy-1".also { remember(it) }
            copied+=record.document
            onCopy?.invoke()
            if(failAfterCopy) { failAfterCopy=false;throw java.io.IOException("Lost copy response") }
            return DraftCopy(id,record.name+" (mine)")
        }
        override fun sameContent(kind: String,left: String,right: String)=left==right
        override fun merge(kind: String,saved: String,submitted: String,current: String)=if(submitted==current) saved else current
    }
    @Test fun offlineQueueSurvivesRecreationAndPartitionsAccounts()=runTest {
        val q=queue();q.open("alice","resume","r1");online=false
        q.edit("alice","resume","r1","my edit","Product designer")
        assertEquals(SaveStatus.Offline,db.drafts().get("alice","resume","r1")!!.saveStatus())
        assertTrue(queue().open("alice","resume","r1").dirty)
        account="bob";online=true
        assertTrue(queue().sync("bob"));assertTrue(remote.saved.isEmpty())
        assertTrue(db.drafts().pending("bob").isEmpty());assertEquals(1,db.drafts().pending("alice").size)
        account="alice";assertTrue(queue().sync("alice"));assertEquals(listOf("my edit"),remote.saved)
        assertFalse(db.drafts().get("alice","resume","r1")!!.dirty)
    }
    @Test fun editsDuringSaveAreNotAcknowledgedByOlderResponse()=runTest {
        val q=queue();q.open("alice","resume","r1");q.edit("alice","resume","r1","first","Product designer")
        val started=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>()
        remote.onSave={ if(!started.isCompleted) { started.complete(Unit);release.await() } }
        val saving=async { q.flush("alice","resume","r1") }
        started.await();q.edit("alice","resume","r1","second","Product designer");release.complete(Unit)
        assertTrue(saving.await());assertEquals(listOf("first","second"),remote.saved)
        assertEquals("second",db.drafts().get("alice","resume","r1")!!.document)
    }
    @Test fun conflictKeepsMineAsCopyBeforeLoadingServerAndRemembersCopyAcrossRetry()=runTest {
        val q=queue();q.open("alice","resume","r1");q.edit("alice","resume","r1","mine","Product designer")
        remote.document=remote.document.copy(json="theirs",revision="2");remote.failAfterCopy=true
        assertFalse(q.flush("alice","resume","r1"))
        val pending=db.drafts().get("alice","resume","r1")!!
        assertEquals("copy-1",pending.copyId);assertEquals("mine",pending.document);assertTrue(pending.dirty)
        assertTrue(q.flush("alice","resume","r1"))
        val result=db.drafts().get("alice","resume","r1")!!
        assertEquals("theirs",result.document);assertEquals("Product designer (mine)",result.recoveredName)
        assertEquals(SaveStatus.Recovered,result.saveStatus());assertFalse(result.dirty);assertTrue(remote.saved.isEmpty())
    }
    @Test fun newEditsDuringRecoveryReachSameCopyBeforeOriginalIsReplaced()=runTest {
        val q=queue();q.open("alice","letter","r1");q.edit("alice","letter","r1","mine","Lumen cover letter")
        remote.document=remote.document.copy(json="theirs",revision="2")
        var changed=false
        remote.onCopy={ if(!changed) { changed=true;q.edit("alice","letter","r1","latest","Lumen cover letter") } }
        assertTrue(q.flush("alice","letter","r1"))
        assertEquals(listOf("mine","latest"),remote.copied)
        assertEquals("theirs",db.drafts().get("alice","letter","r1")!!.document)
    }
    @Test fun lockDuringSaveRetainsDraftAndUnlockResumesWithoutConflictCopy()=runTest {
        val q=queue();q.open("alice","resume","r1");q.edit("alice","resume","r1","mine","Product designer")
        remote.onSave={ remote.document=remote.document.copy(locked=true,revision="2");remote.onSave=null }
        assertTrue(q.flush("alice","resume","r1"))
        val waiting=db.drafts().get("alice","resume","r1")!!
        assertEquals("mine",waiting.document);assertEquals(SaveStatus.Locked,waiting.saveStatus());assertTrue(waiting.dirty)
        remote.document=remote.document.copy(locked=false,revision="3")
        q.refresh("alice","resume","r1");assertTrue(q.flush("alice","resume","r1"))
        assertEquals(listOf("mine"),remote.saved);assertTrue(remote.copied.isEmpty())
    }
    @Test fun sessionChangeDuringWriteLeavesOldAccountsQueueIntact()=runTest {
        val q=queue();q.open("alice","resume","r1");q.edit("alice","resume","r1","mine","Product designer")
        remote.onSave={ account="bob" }
        q.flush("alice","resume","r1")
        assertTrue(db.drafts().get("alice","resume","r1")!!.dirty)
        assertTrue(db.drafts().observePending("bob").first().isEmpty())
    }
    @Test fun cachesNeverCrossAccountScope()=runTest {
        db.cache().put(CachedList("alice","documents","private",0))
        assertNull(db.cache().get("bob","documents"));assertEquals("private",db.cache().get("alice","documents")!!.json)
        db.cache().deleteAccount("bob");assertNotNull(db.cache().get("alice","documents"))
    }
}
