package me.rxresu.feature.career

import me.rxresu.core.data.aiApproval
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
    @Test fun coachSourcesOpenOnlyCredentialFreeHttpsUrls() {
        for (url in listOf("javascript:alert(1)", "file:///private/a", "https://user:secret@example.invalid/a", "http://example.invalid")) assertNull(coachSourceUrl(url))
        assertEquals("https://example.invalid/a", coachSourceUrl("https://example.invalid/a"))
        val source = buildJsonObject { put("type", "source-url"); put("url", "https://example.invalid/a") }
        assertEquals(listOf("example.invalid" to "https://example.invalid/a"), coachSources(listOf(source, source)))
    }
    @Test fun briefingCountsUseSavedEvidenceAndIgnoreOtherWork() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        val base = repositories.career.listCareerSavedItems(kind = ListCareerSavedItemsKind.Offer).first()
        val brief = repositories.career.listCareerSavedItems(kind = ListCareerSavedItemsKind.Briefing).first()
        val evidence = brief.evidence.copy(storyIds = listOf("one", "one", "two"))
        assertEquals(mapOf("one" to 2, "two" to 1), storyBriefingUses(listOf(brief.copy(evidence = evidence), brief.copy(id = "second", evidence = evidence.copy(storyIds = listOf("one"))), base.copy(evidence = evidence))))
        assertEquals("—", bonusValue((base.data as Offer).copy(variable = null, variablePercent = null)))
        assertEquals("10.5%", bonusValue((base.data as Offer).copy(variablePercent = 10.5)))
        repositories.close()
    }
    @Test fun duplicateSavesSeparateStoryWithoutChangingOriginal() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        val original = repositories.career.listCareerStories().first()
        val model = StoryViewModel(repositories, CareerDrafts(context, "duplicate", scope = this, io = StandardTestDispatcher(testScheduler)), original.id)
        advanceUntilIdle()
        var duplicate: String? = null
        model.duplicate { duplicate = it }; advanceUntilIdle()
        assertNotNull(duplicate); assertNotEquals(original.id, duplicate)
        val stories = repositories.career.listCareerStories()
        assertEquals(original, stories.first { it.id == original.id })
        assertEquals(original.applicationId, stories.first { it.id == duplicate }.applicationId)
        assertEquals(original.data.copy(applicationId = original.applicationId), stories.first { it.id == duplicate }.data)
        repositories.close()
    }
    @Test fun preferencesDebounceAndSerializeLatestEdit() = runTest {
        val controls = FakeControls(); val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        val model = PreferencesViewModel(repositories, CareerDrafts(context, "test", scope = this, io = StandardTestDispatcher(testScheduler))); advanceUntilIdle()
        val initial = requireNotNull(model.state.value.profile)
        controls.set("updateCareerProfile", FakeMode.Loading)
        model.change(initial.copy(priorities = "Remote work")); advanceTimeBy(500); runCurrent()
        model.change(initial.copy(priorities = "Remote work and mentoring")); advanceTimeBy(500); runCurrent()
        assertEquals("", repositories.career.getCareerProfile().priorities)
        controls.set("updateCareerProfile", FakeMode.Ready); advanceUntilIdle()
        assertEquals("Remote work and mentoring", repositories.career.getCareerProfile().priorities)
        assertEquals(SaveState.Saved, model.state.value.status)
        assertNull(CareerDrafts(context, "test", scope = this, io = StandardTestDispatcher(testScheduler)).read("preferences")); repositories.close()
    }
    @Test fun failedPreferencesKeepWordsAndRecoverWithoutRestoringMemoryChoice() = runTest {
        val controls = FakeControls(); val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        val drafts = CareerDrafts(context, "test", scope = this, io = StandardTestDispatcher(testScheduler)); val model = PreferencesViewModel(repositories, drafts); advanceUntilIdle()
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
        val drafts = CareerDrafts(context, "test", scope = this, io = StandardTestDispatcher(testScheduler)); val model = StoryViewModel(repositories, drafts, StoryboardIds.story); advanceUntilIdle()
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
        val model = PreferencesViewModel(repositories, CareerDrafts(context, "test", scope = this, io = StandardTestDispatcher(testScheduler))); advanceUntilIdle()
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
        val drafts = CareerDrafts(context, "test", scope = this, io = StandardTestDispatcher(testScheduler))
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
        val model = CoachViewModel(repositories, CareerDrafts(context, "test", scope = this, io = StandardTestDispatcher(testScheduler)), null, null, transport); advanceUntilIdle()
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
    @Test fun newConversationStartsOnTheFirstConnectionAndAnswersTheCoachsQuestionInPlace() = runTest {
        val controls = FakeControls()
        val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        controls.responses.value = mapOf("listAiProviders" to ApiJson.encodeToJsonElement(repositories.ai.listAiProviders().map { it.copy(testStatus = "success") }))
        val transport = RecordingCoachTransport().apply { askQuestion = true }
        val model = CoachViewModel(repositories, CareerDrafts(context, "test", scope = this, io = StandardTestDispatcher(testScheduler)), null, null, transport); advanceUntilIdle()
        // As on the web, a new conversation is ready to send on the default connection.
        val provider = model.state.value.providers.first()
        assertEquals(provider.id, model.state.value.selected)
        model.draft("Help me prepare"); model.send(); advanceUntilIdle()
        val question = requireNotNull(model.state.value.pendingQuestion())
        assertEquals("Which interview?", question.text); assertEquals(listOf("Northwind", "Lumen"), question.answers)
        transport.askQuestion = false
        model.answer(question, "Northwind"); advanceUntilIdle()
        val sent = requireNotNull(transport.sent)
        val part = sent.body!!.jsonObject["message"]!!.jsonObject["parts"]!!.jsonArray.single().jsonObject
        assertEquals("question", sent.body!!.jsonObject["message"]!!.jsonObject["id"]!!.jsonPrimitive.content)
        assertEquals("output-available", part["state"]!!.jsonPrimitive.content)
        assertEquals("Northwind", part["output"]!!.jsonPrimitive.content)
        assertEquals(aiApproval(provider), sent.options.headers)
        assertNull(model.state.value.pendingQuestion())
        assertEquals("A reply", model.state.value.messages.last().text)
        repositories.close()
    }
    @Test fun changedCoachRecipientRejectsBeforeDispatchAndRetainsWords() = runTest {
        val controls = FakeControls()
        val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        val providers = repositories.ai.listAiProviders().map { it.copy(testStatus = "success", recipientVersion = "approved-version") }
        controls.responses.value = mapOf("listAiProviders" to ApiJson.encodeToJsonElement(providers))
        val transport = RecordingCoachTransport()
        val model = CoachViewModel(repositories, CareerDrafts(context, "test", scope = this, io = StandardTestDispatcher(testScheduler)), null, null, transport)
        advanceUntilIdle()
        model.provider(model.state.value.providers.first()); advanceUntilIdle()
        controls.responses.value = mapOf("listAiProviders" to ApiJson.encodeToJsonElement(providers.map { it.copy(recipientVersion = "changed-version") }))
        model.draft("Words approved for original destination"); model.send(); advanceUntilIdle()
        assertNull(transport.sent)
        assertEquals("Words approved for original destination", model.state.value.draft)
        assertTrue(model.state.value.error)
        assertFalse(model.state.value.busy)
        assertTrue(model.state.value.connectionChanged)
        model.send(); advanceUntilIdle()
        assertNull(transport.sent)
        val reviewed = model.state.value.providers.first { it.id == model.state.value.selected }
        assertEquals("changed-version", reviewed.recipientVersion)
        model.provider(reviewed); advanceUntilIdle()
        assertFalse(model.state.value.connectionChanged)
        assertFalse(model.state.value.error)
        model.send(); advanceUntilIdle()
        assertEquals(aiApproval(reviewed), requireNotNull(transport.sent).options.headers)
        repositories.close()
    }
    @Test fun changedCoachRecipientBlocksQuestionAnswerUntilReviewed() = runTest {
        val controls = FakeControls()
        val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        val providers = repositories.ai.listAiProviders().map { it.copy(testStatus = "success", recipientVersion = "approved-version") }
        controls.responses.value = mapOf("listAiProviders" to ApiJson.encodeToJsonElement(providers))
        val transport = RecordingCoachTransport().apply { askQuestion = true }
        val model = CoachViewModel(repositories, CareerDrafts(context, "test", scope = this, io = StandardTestDispatcher(testScheduler)), null, null, transport)
        advanceUntilIdle()
        model.draft("Help me prepare"); model.send(); advanceUntilIdle()
        val question = requireNotNull(model.state.value.pendingQuestion())
        transport.sent = null; transport.askQuestion = false
        controls.responses.value = mapOf("listAiProviders" to ApiJson.encodeToJsonElement(providers.map { it.copy(recipientVersion = "changed-version") }))
        model.answer(question, "Northwind"); advanceUntilIdle()
        assertNull(transport.sent)
        assertTrue(model.state.value.connectionChanged)
        assertFalse(model.state.value.busy)
        assertEquals(question, model.state.value.pendingQuestion())
        model.answer(question, "Northwind"); advanceUntilIdle()
        assertNull(transport.sent)
        val reviewed = model.state.value.providers.first { it.id == model.state.value.selected }
        model.provider(reviewed); advanceUntilIdle()
        model.answer(question, "Northwind"); advanceUntilIdle()
        val sent = requireNotNull(transport.sent)
        assertEquals(aiApproval(reviewed), sent.options.headers)
        assertEquals("Northwind", sent.body!!.jsonObject["message"]!!.jsonObject["parts"]!!.jsonArray.single().jsonObject["output"]!!.jsonPrimitive.content)
        assertNull(model.state.value.pendingQuestion())
        repositories.close()
    }
    @Test fun disabledCoachConnectionIsRemovedBeforeDispatch() = runTest {
        val controls = FakeControls()
        val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        val providers = repositories.ai.listAiProviders().map { it.copy(testStatus = "success") }
        controls.responses.value = mapOf("listAiProviders" to ApiJson.encodeToJsonElement(providers))
        val transport = RecordingCoachTransport()
        val model = CoachViewModel(repositories, CareerDrafts(context, "test", scope = this, io = StandardTestDispatcher(testScheduler)), null, null, transport)
        advanceUntilIdle()
        val selected = model.state.value.selected
        controls.responses.value = mapOf("listAiProviders" to ApiJson.encodeToJsonElement(providers.map { if (it.id == selected) it.copy(enabled = false) else it }))
        model.draft("Keep these words"); model.send(); advanceUntilIdle()
        assertNull(transport.sent)
        assertTrue(model.state.value.connectionChanged)
        assertFalse(model.state.value.providers.any { it.id == selected })
        assertEquals("Keep these words", model.state.value.draft)
        repositories.close()
    }
    @Test fun applicationCoachStartsThenReopensThatJobsConversation() = runTest {
        val controls = FakeControls()
        val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        controls.responses.value = mapOf("listAiProviders" to ApiJson.encodeToJsonElement(repositories.ai.listAiProviders().map { it.copy(testStatus = "success") }))
        val drafts = CareerDrafts(context, "test", scope = this, io = StandardTestDispatcher(testScheduler))
        val model = CoachViewModel(repositories, drafts, null, null, RecordingCoachTransport(), applicationId = "application-lumen"); advanceUntilIdle()
        assertNull(model.state.value.thread); assertTrue(model.state.value.scoped)
        model.provider(model.state.value.providers.first()); advanceUntilIdle()
        model.draft("How do I prepare for Lumen?"); model.send(); advanceUntilIdle()
        val started = repositories.assistant.listAgentThreads().first { it.applicationId == "application-lumen" && it.scope == StartAgentThreadRequestScope.Application }
        val transport = RecordingCoachTransport()
        // Another device (no local drafts) finds the job's conversation from the thread list.
        CoachViewModel(repositories, CareerDrafts(context, "another-device", scope = this, io = StandardTestDispatcher(testScheduler)), null, null, transport, applicationId = "application-lumen"); advanceUntilIdle()
        assertEquals(started.id, transport.executed.first { it.operation == "getAgentThread" }.pathParams["id"])
        repositories.close()
    }
}

private class RecordingCoachTransport : ApiTransport {
    var sent: ApiRequest? = null; var fail = false
    /** The next reply asks the user a question (an `ask_user_question` tool call) instead of answering. */
    var askQuestion = false
    val executed = mutableListOf<ApiRequest>()
    private val messages = mutableListOf<JsonElement>()
    override suspend fun execute(request: ApiRequest): JsonElement = buildJsonObject {
        executed += request
        put("thread", ApiSamples.response("startAgentThread")); put("isReadOnly", false); put("messages", JsonArray(messages)); putJsonArray("attachments") {}
    }
    override suspend fun download(request: ApiRequest): BinaryFile = error("No downloads")
    override fun events(request: ApiRequest) = kotlinx.coroutines.flow.flow {
        sent = request
        val message = requireNotNull(request.body).jsonObject.getValue("message")
        messages += message
        if (fail) throw IOException("Lost stream")
        emit(ServerEvent(null, null, """{"type":"text-delta","delta":"A reply"}"""))
        if (message.jsonObject["role"]?.jsonPrimitive?.content == "assistant") { messages.removeAll { it.jsonObject["id"] == message.jsonObject["id"] }; messages += message }
        if (askQuestion) messages += buildJsonObject { put("id", "question"); put("role", "assistant"); putJsonArray("parts") { add(buildJsonObject {
            put("type", "tool-ask_user_question"); put("toolCallId", "q1"); put("state", "input-available")
            putJsonObject("input") { put("question", "Which interview?"); putJsonArray("options") { add(JsonPrimitive("Northwind")); add(JsonPrimitive("Lumen")) } }
        }) } }
        else messages += buildJsonObject { put("id", "reply"); put("role", "assistant"); putJsonArray("parts") { add(buildJsonObject { put("type", "text"); put("text", "A reply") }) } }
    }
}
