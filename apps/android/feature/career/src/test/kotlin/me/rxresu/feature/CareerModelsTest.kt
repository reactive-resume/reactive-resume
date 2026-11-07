package me.rxresu.feature.career

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.io.IOException
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.*
import me.rxresu.core.network.*
import me.rxresu.core.network.generated.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class CareerModelsTest {
    private val context get() = ApplicationProvider.getApplicationContext<Context>()
    @Before fun setup() { Dispatchers.setMain(StandardTestDispatcher()); java.io.File(context.noBackupFilesDir, "career").deleteRecursively() }
    @After fun cleanup() { Dispatchers.resetMain() }
    @Test fun preferencesDebounceAndSerializeLatestEdit() = runTest {
        val controls = FakeControls(); val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        val model = PreferencesViewModel(repositories, CareerDrafts(context, "test")); advanceUntilIdle()
        val initial = requireNotNull(model.state.value.profile)
        controls.set("updateCareerProfile", FakeMode.Loading)
        model.change(initial.copy(priorities = "Remote work")); advanceTimeBy(500); runCurrent()
        model.change(initial.copy(priorities = "Remote work and mentoring")); advanceTimeBy(500); runCurrent()
        assertEquals("", repositories.career.getCareerProfile().priorities)
        controls.set("updateCareerProfile", FakeMode.Ready); advanceUntilIdle()
        assertEquals("Remote work and mentoring", repositories.career.getCareerProfile().priorities)
        assertEquals(SaveState.Saved, model.state.value.status)
        assertNull(CareerDrafts(context, "test").read("preferences")); repositories.close()
    }
    @Test fun failedPreferencesKeepWordsAndRecoverWithoutRestoringMemoryChoice() = runTest {
        val controls = FakeControls(); val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        val drafts = CareerDrafts(context, "test"); val model = PreferencesViewModel(repositories, drafts); advanceUntilIdle()
        controls.set("updateCareerProfile", FakeMode.Error(IOException("Offline")))
        model.change(requireNotNull(model.state.value.profile).copy(priorities = "Keep these words")); advanceUntilIdle()
        assertEquals(SaveState.KeptOnDevice, model.state.value.status)
        controls.set("updateCareerProfile", FakeMode.Ready)
        repositories.career.updateCareerProfile(SaveCareerProfileRequest(memoryMode = SaveCareerProfileRequestMemoryMode.Off))
        val reopened = PreferencesViewModel(repositories, drafts); advanceUntilIdle()
        assertEquals("Keep these words", reopened.state.value.profile?.priorities)
        assertEquals(SaveCareerProfileRequestMemoryMode.Off, reopened.state.value.profile?.memoryMode)
        reopened.save(); advanceUntilIdle()
        assertEquals("Keep these words", repositories.career.getCareerProfile().priorities)
        assertEquals(SaveCareerProfileRequestMemoryMode.Off, repositories.career.getCareerProfile().memoryMode); repositories.close()
    }
    @Test fun storyFailurePreservesEveryPartAndBackingFacts() = runTest {
        val controls = FakeControls(); val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        val drafts = CareerDrafts(context, "test"); val model = StoryViewModel(repositories, drafts, StoryboardIds.story); advanceUntilIdle()
        val changed = requireNotNull(model.state.value.draft).copy(reflection = "Start with one team", factIds = listOf("fact-0", "fact-1"))
        controls.set("saveCareerStory", FakeMode.Error(IOException("Offline"))); model.change(changed); advanceUntilIdle()
        assertEquals(SaveState.KeptOnDevice, model.state.value.status)
        val reopened = StoryViewModel(repositories, drafts, StoryboardIds.story); advanceUntilIdle()
        assertEquals(changed, reopened.state.value.draft); repositories.close()
    }
    @Test fun factsUndoPrecedesIrreversibleForget() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope); val model = KnowledgeViewModel(repositories); advanceUntilIdle()
        val fact = model.state.value.facts.first()
        val decision = kotlinx.coroutines.CompletableDeferred<Boolean>()
        model.forget(fact) { decision.await() }; runCurrent()
        assertEquals(setOf(fact.id), model.state.value.pendingForget)
        assertEquals("active", repositories.career.listCareerFacts(all = true).first { it.id == fact.id }.status)
        decision.complete(true); advanceUntilIdle()
        assertTrue(model.state.value.pendingForget.isEmpty())
        assertEquals(fact.source, repositories.career.listCareerFacts().first { it.id == fact.id }.source)
        model.forget(fact) { false }; advanceUntilIdle()
        assertEquals("forgotten", repositories.career.listCareerFacts(all = true).first { it.id == fact.id }.status)
        assertFalse(model.state.value.facts.any { it.id == fact.id }); repositories.close()
    }
    @Test fun accountChangePreventsDraftSave() = runTest {
        val session = FakeAuthSession(); val repositories = FakeRepositories(authSession = session, coroutineScope = backgroundScope)
        val model = PreferencesViewModel(repositories, CareerDrafts(context, "test")); advanceUntilIdle()
        model.change(requireNotNull(model.state.value.profile).copy(priorities = "Private draft"))
        session.state.value = SessionState.SignedOut; advanceUntilIdle()
        assertTrue(model.state.value.error); assertEquals("Private draft", model.state.value.profile?.priorities); repositories.close()
    }
    @Test fun wholeSalaryRejectsPartialAndFormattedAmounts() {
        assertEquals(95000.0, parseWholeAmount("95000")!!, 0.0)
        listOf("95,000", "95000.5", "95k", "-1", "Infinity", "1e9", "").forEach { assertNull(parseWholeAmount(it)) }
    }
    @Test fun schedulesRefuseDstGapsAndOverlaps() {
        val zone = ZoneId.of("Europe/Berlin")
        assertNull(zonedScheduleInstant(LocalDate.of(2026, 3, 29), LocalTime.of(2, 30), zone))
        assertNull(zonedScheduleInstant(LocalDate.of(2026, 10, 25), LocalTime.of(2, 30), zone))
        assertEquals("2026-11-09T06:00:00Z", zonedScheduleInstant(LocalDate.of(2026, 11, 9), LocalTime.of(7, 0), zone))
    }
    @Test fun offersNeverCompareDifferentCurrencyOrPayPeriod() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        val offer = repositories.career.listCareerSavedItems(kind = ListCareerSavedItemsKind.Offer).first().data as Offer
        val requirement = repositories.career.getCareerProfile().minBase
        assertEquals(SalaryComparison.Meets, salaryComparison(offer, requirement))
        assertEquals(SalaryComparison.DifferentUnits, salaryComparison(offer.copy(currency = "USD"), requirement))
        assertEquals(SalaryComparison.DifferentUnits, salaryComparison(offer.copy(period = CreateCareerOfferRequestPeriod.Month), requirement))
        assertEquals(SalaryComparison.Unknown, salaryComparison(offer.copy(base = null), requirement)); repositories.close()
    }
    @Test fun newStarterPreservesEarlierConversationsUnsentWords() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        val drafts = CareerDrafts(context, "test")
        drafts.write("coach:new", "Earlier unsent words"); drafts.write("coach:new:thread", "earlier-thread")
        drafts.write("coach:new:message", "earlier-message")
        val model = CoachViewModel(repositories, drafts, null, "New starter", RecordingCoachTransport()); advanceUntilIdle()
        assertEquals("New starter", model.state.value.draft); assertNull(model.state.value.thread)
        assertEquals("Earlier unsent words", drafts.read("coach:earlier-thread"))
        assertEquals("earlier-message", drafts.read("coach:earlier-thread:message")); repositories.close()
    }
    @Test fun openMessagePartsAndNestedStreamKeepText() {
        val raw = ApiJson.parseToJsonElement("""{"messages":[{"id":"m","role":"assistant","parts":[{"type":"text","text":"Kept words"},{"type":"tool-remember_fact","output":{"status":"proposed"}}]}]}""").jsonObject
        assertEquals("Kept words", coachMessages(raw).single().text)
        assertEquals(2, coachMessages(raw).single().parts.size)
        val encoded = JsonPrimitive("data: {\"type\":\"text-delta\",\"delta\":\"hello\"}\n\n").toString()
        assertEquals("hello", coachChunks(encoded).single()["delta"]?.jsonPrimitive?.content)
        assertTrue(coachChunks("data: [DONE]\n").isEmpty())
    }
    @Test fun coachSendsOpenPartsWithPinnedRecipientAndKeepsWordsOnFailure() = runTest {
        val controls = FakeControls()
        val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        // Foundation's storyboard uses "passed"; the published/web provider contract uses "success".
        controls.responses.value = mapOf("listAiProviders" to ApiJson.encodeToJsonElement(repositories.ai.listAiProviders().map { it.copy(testStatus = "success") }))
        val transport = RecordingCoachTransport()
        val model = CoachViewModel(repositories, CareerDrafts(context, "test"), null, null, transport); advanceUntilIdle()
        val provider = model.state.value.providers.first(); model.provider(provider); advanceUntilIdle()
        model.draft("My actual words"); model.send(); advanceUntilIdle()
        val request = requireNotNull(transport.sent)
        assertEquals("My actual words", request.body!!.jsonObject["message"]!!.jsonObject["parts"]!!.jsonArray[0].jsonObject["text"]!!.jsonPrimitive.content)
        assertEquals(aiApproval(provider), request.options.headers)
        assertEquals("A reply", model.state.value.messages.last().text)
        assertEquals("", model.state.value.draft)
        transport.fail = true; model.draft("Keep this on failure"); model.send(); advanceUntilIdle()
        assertEquals("Keep this on failure", model.state.value.draft); assertTrue(model.state.value.error)
        assertFalse(model.state.value.busy)
        transport.fail = false; model.draft("A new unsent thought"); model.send(); advanceUntilIdle()
        assertEquals("A new unsent thought", model.state.value.draft)
        repositories.close()
    }

}

private class RecordingCoachTransport : ApiTransport {
    var sent: ApiRequest? = null; var fail = false
    private val messages = mutableListOf<JsonElement>()
    override suspend fun execute(request: ApiRequest): JsonElement = buildJsonObject {
        put("thread", ApiSamples.response("startAgentThread")); put("isReadOnly", false); put("messages", JsonArray(messages)); putJsonArray("attachments") {}
    }
    override suspend fun download(request: ApiRequest): BinaryFile = error("No downloads")
    override fun events(request: ApiRequest) = kotlinx.coroutines.flow.flow {
        sent = request
        val message = requireNotNull(request.body).jsonObject.getValue("message")
        messages += message
        if (fail) throw IOException("Lost stream")
        emit(ServerEvent(null, null, """{"type":"text-delta","delta":"A reply"}"""))
        messages += buildJsonObject { put("id", "reply"); put("role", "assistant"); putJsonArray("parts") { add(buildJsonObject { put("type", "text"); put("text", "A reply") }) } }
    }
}
