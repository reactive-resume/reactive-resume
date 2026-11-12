package me.rxresu.core.data

import java.io.IOException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import me.rxresu.core.auth.SessionState
import me.rxresu.core.network.AccountChangedException
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.MessageDraft
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SearchRepositoryTest {
    @Test fun savedMessageTitleAndBodiesSearchThroughProductionOwner()=runTest {
        val controls=FakeControls()
        FakeRepositories(controls=controls,coroutineScope=backgroundScope).use { r ->
            val saved=r.career.listCareerSavedItems().first { it.data is MessageDraft }
            val message=(saved.data as MessageDraft).copy(title="Subject needle",message="Incoming needle",reply="Outgoing needle")
            controls.responses.value=mapOf("listCareerSavedItems" to ApiJson.encodeToJsonElement(listOf(saved.copy(title="Saved needle",data=message))))
            for(query in listOf("saved NEEDLE","subject needle","incoming needle","outgoing needle")) {
                val result=r.search.search(query,SearchScope.Career).first { !it.loading }
                assertNull(result.error)
                assertEquals(SearchHit(saved.id,"Saved needle","Outgoing needle","message",applicationId=StoryboardIds.fieldnote),result.data!!.single())
            }
            assertTrue(r.search.search("no such message",SearchScope.Career).first { !it.loading }.data!!.isEmpty())
        }
    }

    @Test fun storyboardSavedMessageAppearsInAllAndCareerButNotOtherFilters()=runTest {
        FakeRepositories(coroutineScope=backgroundScope).use { r ->
            for(scope in listOf(SearchScope.All,SearchScope.Career)) {
                val hit=r.search.search("check in",scope).first { !it.loading }.data!!.single()
                assertEquals("saved-message-fieldnote",hit.id)
                assertEquals("message",hit.kind)
                assertEquals(StoryboardIds.fieldnote,hit.applicationId)
            }
            for(scope in listOf(SearchScope.Documents,SearchScope.Applications,SearchScope.Settings)) {
                assertTrue(r.search.search("check in",scope).first { !it.loading }.data!!.isEmpty())
            }
        }
    }

    @Test fun cachedSavedMessagesStayWithTheirAccountWhenOffline()=runTest {
        val controls=FakeControls();val auth=FakeAuthSession()
        FakeRepositories(controls=controls,authSession=auth,coroutineScope=backgroundScope).use { r ->
            val online=r.search.search("check in",SearchScope.Career).first { !it.loading }
            assertFalse(online.offline)
            controls.set("listCareerSavedItems",FakeMode.Error(IOException("Offline")))
            val savedCache=r.search.search("check in",SearchScope.Career).first { !it.loading }
            assertEquals(online.data,savedCache.data)
            assertTrue(savedCache.offline)
            assertNull(savedCache.error)
            controls.online.value=false
            val cached=r.search.search("check in",SearchScope.Career).first { !it.loading }
            assertEquals(online.data,cached.data)
            assertTrue(cached.offline)
            auth.state.value=SessionState.SignedIn(auth.origin.value,"other-account")
            val other=r.search.search("check in",SearchScope.Career).first { !it.loading }
            assertTrue(other.data!!.isEmpty())
            assertTrue(other.offline)
            assertTrue(other.error is IOException)
        }
    }

    @Test fun accountSwitchDuringSavedMessageReadDiscardsResults()=runTest {
        val controls=FakeControls();val auth=FakeAuthSession()
        controls.set("listCareerSavedItems",FakeMode.Loading)
        FakeRepositories(controls=controls,authSession=auth,coroutineScope=backgroundScope).use { r ->
            val pending=async { runCatching { r.search.search("check in",SearchScope.Career).first { !it.loading } } }
            runCurrent();assertFalse(pending.isCompleted)
            auth.state.value=SessionState.SignedIn(auth.origin.value,"other-account")
            controls.set("listCareerSavedItems",FakeMode.Ready)
            assertTrue(pending.await().exceptionOrNull() is AccountChangedException)
        }
    }

    @Test fun cancelledSavedMessageReadDoesNotEmitResults()=runTest {
        val controls=FakeControls()
        controls.set("listCareerSavedItems",FakeMode.Loading)
        FakeRepositories(controls=controls,coroutineScope=backgroundScope).use { r ->
            val pending=async { r.search.search("check in",SearchScope.Career).first { !it.loading } }
            runCurrent();assertFalse(pending.isCompleted)
            pending.cancelAndJoin()
            assertTrue(pending.isCancelled)
        }
    }

    @Test fun unknownSavedDataIsNotInterpretedAsAMessage()=runTest {
        val controls=FakeControls()
        FakeRepositories(controls=controls,coroutineScope=backgroundScope).use { r ->
            val saved=ApiJson.encodeToJsonElement(r.career.listCareerSavedItems().first { it.data is MessageDraft }).jsonObject
            controls.responses.value=mapOf("listCareerSavedItems" to JsonArray(listOf(JsonObject(saved+(
                "data" to buildJsonObject { put("kind","future-kind");put("reply","check in") }
            )))))
            val result=r.search.search("check in",SearchScope.Career).first { !it.loading }
            assertNull(result.error)
            assertTrue(result.data!!.isEmpty())
        }
    }
}
