package me.rxresu.feature.assistant

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import me.rxresu.core.data.*
import me.rxresu.core.database.SaveStatus
import me.rxresu.core.network.*
import me.rxresu.core.network.generated.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class) @Config(sdk = [36])
class AssistantViewModelTest {
    @Before fun setup() { Dispatchers.setMain(StandardTestDispatcher()) }
    @After fun teardown() { Dispatchers.resetMain() }
    private class Agent(val base: RrRepositories, val draft: DocumentDraft<Resume>) : AssistantRepository by base.assistant {
        var stored = ApiJson.decodeFromJsonElement(AgentConversation.serializer(), ApiSamples.response("getAgentThread")).let { it.copy(thread = it.thread.copy(id = "thread", aiProviderId = "provider", workingResumeId = StoryboardIds.resume)) }
        val sent = mutableListOf<SendAgentMessageRequest>()
        val sentOptions = mutableListOf<RequestOptions>()
        var refuseDestination = false
        var ai: AiRepository = base.ai
        var failSend = false; var failRead = false; var loseWordingRead = false; var reads = 0
        override suspend fun startAgentThread(body: StartAgentThreadRequest, options: RequestOptions): StartAgentThreadResponse { stored = stored.copy(thread = stored.thread.copy(aiProviderId = body.aiProviderId)); return stored.thread }
        override suspend fun getAgentThread(id: String, options: RequestOptions): AgentConversation { reads++; check(!failRead); return stored }
        override fun sendAgentMessage(body: SendAgentMessageRequest, options: RequestOptions): Flow<ServerEvent> = flow {
            sentOptions += options
            if (refuseDestination) throw ApiException(409, "CONFLICT", "Your AI destination changed. Nothing was sent; review the connection and try again.")
            sent += body
            stored = stored.copy(messages = stored.messages.filterNot { it.id == body.message.id } + body.message)
            delay(100)
            emit(wire("data: {\"type\":\"start\",\"messageId\":\"reply\"}\n\n"))
            emit(wire("data: {\"type\":\"text-delta\",\"id\":\"text\",\"delta\":\"A reply\"}\n\n"))
            check(!failSend)
            stored = stored.copy(messages = stored.messages + SendAgentMessageRequestMessage("reply", parts = listOf(part("text", buildJsonObject { put("text", "A reply") })), role = AiTailorResumeForApplicationResponseConversationMessagesItemRole.Assistant))
            emit(wire("data: {\"type\":\"finish\"}\n\ndata: [DONE]\n\n")); emit(ServerEvent(null, "done", "null"))
        }
        override fun resumeAgentMessages(threadId: String, options: RequestOptions): Flow<ServerEvent> = flow { delay(100); emit(wire("data: {\"type\":\"start\",\"messageId\":\"reply\"}\n\ndata: {\"type\":\"text-delta\",\"delta\":\"Complete\"}\n\ndata: [DONE]\n\n")); stored = stored.copy(messages = stored.messages.map { if (it.id == "reply") it.copy(parts = listOf(part("text", buildJsonObject { put("text", "Complete") }))) else it }, thread = stored.thread.copy(activeRunId = null)) }
        fun proposal(after: String = "<p>After</p>", status: String = "pending") {
            val before = draft.state.value.document!!.data.summary.content
            stored = stored.copy(messages = listOf(SendAgentMessageRequestMessage("reply", parts = listOf(part("tool-propose_edits", buildJsonObject {
                put("toolCallId", "tool"); put("state", "output-available"); put("output", buildJsonObject { put("edits", buildJsonArray { add(buildJsonObject {
                    put("id", "edit"); put("before", before); put("after", after); put("status", status); put("location", "Summary"); put("target", buildJsonObject { put("sectionId", "summary"); put("field", "content") })
                }) }) })
            })), role = AiTailorResumeForApplicationResponseConversationMessagesItemRole.Assistant)))
        }
        private fun change(edit: (JsonObject) -> JsonObject) { stored = stored.copy(messages = stored.messages.map { message -> message.copy(parts = message.parts.map { p ->
            val output = p.extraFields["output"] as? JsonObject
            if (p.type != "tool-propose_edits" || output == null) p else p.copy(extraFields = JsonObject(p.extraFields + ("output" to JsonObject(output + ("edits" to JsonArray(output.getValue("edits").jsonArray.map { edit(it.jsonObject) }))))))
        }) }) }
        override suspend fun setAgentEditStatus(body: SetAgentEditStatusRequest, options: RequestOptions): SetAgentEditStatusResponse {
            body.edits.forEach { request -> change { edit -> if (edit.text("id") != request.id) edit else JsonObject(edit + buildJsonObject { put("status", request.status.wireValue); request.text?.let { put("after", "<p>" + it.trim() + "</p>"); put("edited", true) } }) } }
            if (loseWordingRead) failRead = true
            return SetAgentEditStatusResponse(0.0, 1.0)
        }
        val handle = object : DocumentDraft<Resume> by draft {
            override suspend fun flush() { draft.flush(); draft.state.first { it.status != SaveStatus.Saving }; if (draft.state.value.status == SaveStatus.Saved) change { edit ->
                draft.state.value.proposalApplications[edit.text("id")]?.let { mark -> JsonObject(edit + ("status" to JsonPrimitive(if (mark == JsonPrimitive(false)) "pending" else "accepted"))) } ?: edit
            } }
        }
        fun repositories() = RrRepositories(base.account, base.documents, object : ResumeRepository by base.resumes { override suspend fun openDraft(id: String) = handle }, base.letters, base.applications, base.checks, ai, this, base.workspace, base.career, base.search, base.publicResume, base.platform, base.preferences, base.today, base.drafts, base.pages, base.authSession, base.time)
        companion object { fun wire(text: String) = ServerEvent(null, "message", JsonPrimitive(text).toString()) }
    }
    @Test fun sendsTextAndContextWithOneStableRetryId() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val agent = Agent(base, base.resumes.openDraft(StoryboardIds.resume)); val vm = AssistantViewModel(agent.repositories(), StoryboardIds.resume, null); runCurrent()
            vm.context(false, true); vm.input("Keep my words exactly"); agent.failSend = true; vm.send(); vm.send(); runCurrent(); advanceTimeBy(101); runCurrent()
            assertEquals(1, agent.sent.size); assertEquals("Keep my words exactly", vm.state.value.input); assertTrue(vm.state.value.failed)
            val json = ApiJson.encodeToJsonElement(SendAgentMessageRequest.serializer(), agent.sent.single()).jsonObject
            assertEquals("Keep my words exactly", json["message"]!!.jsonObject["parts"]!!.jsonArray[0].jsonObject.text("text")); assertEquals(false, agent.sent.single().context?.document)
            agent.failSend = false; vm.send(); advanceTimeBy(101); runCurrent()
            assertEquals(agent.sent[0].message.id, agent.sent[1].message.id); assertEquals("", vm.state.value.input); assertFalse(vm.state.value.failed); assertEquals("A reply", vm.state.value.content.reply)
            assertEquals(1, vm.state.value.content.messages.count { it.role == AiTailorResumeForApplicationResponseConversationMessagesItemRole.User })
        } finally { base.close() }
    }
    @Test fun storedHistoryRemainsReadableWithoutProviderAndReadOnlyCannotSend() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val agent = Agent(base, base.resumes.openDraft(StoryboardIds.resume)); agent.stored = agent.stored.copy(isReadOnly = true, messages = listOf(SendAgentMessageRequestMessage("reply", parts = listOf(part("text", buildJsonObject { put("text", "Persisted reply") })), role = AiTailorResumeForApplicationResponseConversationMessagesItemRole.Assistant)))
            val vm = AssistantViewModel(agent.repositories(), StoryboardIds.resume, "thread"); runCurrent(); assertEquals("Persisted reply", vm.state.value.content.reply); assertTrue(vm.state.value.locked)
            vm.input("Retained"); vm.send(); runCurrent(); assertTrue(agent.sent.isEmpty()); assertEquals("Retained", vm.state.value.input)
        } finally { base.close() }
    }
    @Test fun activeRunResumesAndFreshHistoryWins() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val agent = Agent(base, base.resumes.openDraft(StoryboardIds.resume)); agent.stored = agent.stored.copy(thread = agent.stored.thread.copy(activeRunId = "run"), messages = listOf(SendAgentMessageRequestMessage("reply", parts = listOf(part("text", buildJsonObject { put("text", "Partial") })), role = AiTailorResumeForApplicationResponseConversationMessagesItemRole.Assistant)))
            val vm = AssistantViewModel(agent.repositories(), StoryboardIds.resume, "thread"); runCurrent(); assertTrue(vm.state.value.streaming); advanceTimeBy(101); runCurrent()
            assertEquals("Complete", vm.state.value.content.reply); assertEquals(1, vm.state.value.content.messages.size); assertFalse(vm.state.value.streaming)
        } finally { base.close() }
    }
    @Test fun wordingRequiresFreshReadAndNeverAppliesContent() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val agent = Agent(base, base.resumes.openDraft(StoryboardIds.resume)); agent.proposal(); val before = agent.draft.state.value.document
            val vm = AssistantViewModel(agent.repositories(), StoryboardIds.resume, "thread"); runCurrent(); vm.decide(listOf("edit"), Decision.Pending, "My wording"); runCurrent()
            assertFalse(vm.state.value.failed); assertEquals("edit", vm.state.value.wordingSavedId); assertEquals("<p>My wording</p>", vm.state.value.proposals.single().after); assertEquals(before, agent.draft.state.value.document)
            assertTrue(agent.reads >= 3)
        } finally { base.close() }
    }
    @Test fun lostWordingReceiptCannotConfirmOrApply() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val agent = Agent(base, base.resumes.openDraft(StoryboardIds.resume)); agent.proposal(); val before = agent.draft.state.value.document
            val vm = AssistantViewModel(agent.repositories(), StoryboardIds.resume, "thread"); runCurrent(); agent.loseWordingRead = true; vm.decide(listOf("edit"), Decision.Pending, "My wording"); runCurrent()
            assertTrue(vm.state.value.failed); assertNull(vm.state.value.wordingSavedId); assertEquals(before, agent.draft.state.value.document)
        } finally { base.close() }
    }
    @Test fun acceptsViaDocumentSaveThenUndoRestoresWordsAndReceipts() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val agent = Agent(base, base.resumes.openDraft(StoryboardIds.resume)); agent.proposal(); val before = agent.draft.state.value.document!!.data
            val vm = AssistantViewModel(agent.repositories(), StoryboardIds.resume, "thread"); runCurrent(); vm.decide(listOf("edit"), Decision.Accepted); runCurrent()
            assertFalse(vm.state.value.failed); assertEquals(Decision.Accepted, vm.state.value.proposals.single().decision); assertEquals("<p>After</p>", agent.draft.state.value.document!!.data.summary.content)
            vm.decide(listOf("edit"), Decision.Pending); runCurrent(); assertFalse(vm.state.value.failed); assertEquals(before, agent.draft.state.value.document!!.data); assertEquals(Decision.Pending, vm.state.value.proposals.single().decision)
        } finally { base.close() }
    }
    @Test fun changedWordingOnAnotherDeviceBlocksReviewedAcceptance() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val agent = Agent(base, base.resumes.openDraft(StoryboardIds.resume)); agent.proposal(); val before = agent.draft.state.value.document
            val vm = AssistantViewModel(agent.repositories(), StoryboardIds.resume, "thread"); runCurrent(); agent.proposal("<p>Other device</p>"); vm.decide(listOf("edit"), Decision.Accepted); runCurrent()
            assertTrue(vm.state.value.failed); assertEquals(before, agent.draft.state.value.document); assertEquals("<p>Other device</p>", vm.state.value.proposals.single().after)
        } finally { base.close() }
    }
    @Test fun failedDocumentSaveDoesNotClaimAcceptance() = runTest {
        val controls = FakeControls(); val base = FakeRepositories(controls, coroutineScope = backgroundScope)
        try {
            val agent = Agent(base, base.resumes.openDraft(StoryboardIds.resume)); agent.proposal(); val vm = AssistantViewModel(agent.repositories(), StoryboardIds.resume, "thread"); runCurrent()
            controls.online.value = false; vm.decide(listOf("edit"), Decision.Accepted); runCurrent()
            assertTrue(vm.state.value.failed); assertEquals(Decision.Pending, vm.state.value.proposals.single().decision)
        } finally { base.close() }
    }
    @Test fun rejectAndUndoPersistWithoutDocumentMutation() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val agent = Agent(base, base.resumes.openDraft(StoryboardIds.resume)); agent.proposal(); val before = agent.draft.state.value.document
            val vm = AssistantViewModel(agent.repositories(), StoryboardIds.resume, "thread"); runCurrent(); vm.decide(listOf("edit"), Decision.Rejected); runCurrent(); assertEquals(Decision.Rejected, vm.state.value.proposals.single().decision)
            vm.decide(listOf("edit"), Decision.Pending); runCurrent(); assertEquals(Decision.Pending, vm.state.value.proposals.single().decision); assertEquals(before, agent.draft.state.value.document)
        } finally { base.close() }
    }
    @Test fun questionAnswerContinuesSameAssistantMessageAndKeepsWordsOnFailure() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val agent = Agent(base, base.resumes.openDraft(StoryboardIds.resume)); agent.stored = agent.stored.copy(thread = agent.stored.thread.copy(aiProviderId = base.ai.listAiProviders().first().id), messages = listOf(SendAgentMessageRequestMessage("question", parts = listOf(part("tool-ask_user_question", buildJsonObject { put("toolCallId", "question-tool"); put("state", "input-available"); put("input", buildJsonObject { put("question", "Did you lead it?"); put("options", buildJsonArray { add("Yes") }) }) })), role = AiTailorResumeForApplicationResponseConversationMessagesItemRole.Assistant)))
            val vm = AssistantViewModel(agent.repositories(), StoryboardIds.resume, "thread"); runCurrent(); agent.failSend = true; vm.answer("question-tool", "I took part"); advanceTimeBy(101); runCurrent()
            val sent = agent.sent.single().message; assertEquals("question", sent.id); assertEquals(AiTailorResumeForApplicationResponseConversationMessagesItemRole.Assistant, sent.role); assertEquals("I took part", sent.parts.single().extraFields.text("output")); assertEquals("I took part", vm.state.value.input); assertTrue(vm.state.value.failed)
        } finally { base.close() }
    }
    @Test fun undoAcceptedPassageKeepsLaterUnrelatedEdits() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val agent = Agent(base, base.resumes.openDraft(StoryboardIds.resume)); agent.proposal(); val original = agent.draft.state.value.document!!.data.summary.content
            val vm = AssistantViewModel(agent.repositories(), StoryboardIds.resume, "thread"); runCurrent(); vm.decide(listOf("edit"), Decision.Accepted); runCurrent()
            val current = agent.draft.state.value.document!!; agent.draft.update(current.copy(data = current.data.copy(metadata = current.data.metadata.copy(notes = "Later private note")))); runCurrent()
            vm.decide(listOf("edit"), Decision.Pending); runCurrent(); assertFalse(vm.state.value.failed); assertEquals(original, agent.draft.state.value.document!!.data.summary.content); assertEquals("Later private note", agent.draft.state.value.document!!.data.metadata.notes)
        } finally { base.close() }
    }
    @Test fun failedWordingRetryCannotOverwriteNewerReviewedBaseline() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val agent = Agent(base, base.resumes.openDraft(StoryboardIds.resume)); agent.proposal(); val vm = AssistantViewModel(agent.repositories(), StoryboardIds.resume, "thread"); runCurrent()
            agent.proposal("<p>Other device</p>"); vm.decide(listOf("edit"), Decision.Pending, "My wording", "<p>After</p>"); runCurrent(); assertTrue(vm.state.value.failed)
            vm.decide(listOf("edit"), Decision.Pending, "My wording", "<p>After</p>"); runCurrent(); assertTrue(vm.state.value.failed); assertEquals("<p>Other device</p>", conversationContent(agent.stored.messages).proposals.single().after)
        } finally { base.close() }
    }

    /** Connections whose list and recipient version the test changes, as another device would. */
    private class Connections(val base: AiRepository) : AiRepository by base {
        var list: List<TestAiProviderResponse>? = null
        override suspend fun listAiProviders(limit: Long?, offset: Long?, options: RequestOptions) = list ?: base.listAiProviders(limit, offset, options)
    }

    @Test fun sendCarriesTheShownApprovalAndAChangedDestinationRenewsItKeepingTheWords() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val agent = Agent(base, base.resumes.openDraft(StoryboardIds.resume)); val connections = Connections(base.ai); agent.ai = connections
            val shown = base.ai.listAiProviders().first(); connections.list = listOf(shown.copy(isDefault = true))
            val vm = AssistantViewModel(agent.repositories(), StoryboardIds.resume, null); runCurrent()
            assertEquals(shown.id, vm.state.value.provider!!.id)
            // The connection's address changes elsewhere after the disclosure was shown.
            connections.list = listOf(shown.copy(isDefault = true, recipientVersion = shown.recipientVersion + "-changed")); agent.refuseDestination = true
            vm.input("Keep my words"); vm.send(); runCurrent(); advanceTimeBy(101); runCurrent()
            assertEquals(aiApproval(shown), agent.sentOptions.single().headers)
            assertTrue(vm.state.value.failed); assertTrue(vm.state.value.destinationChanged); assertEquals("Keep my words", vm.state.value.input)
            assertEquals(shown.recipientVersion + "-changed", vm.state.value.provider!!.recipientVersion)
            // Retry goes out with the renewed approval.
            agent.refuseDestination = false; vm.send(); runCurrent(); advanceTimeBy(101); runCurrent()
            assertEquals(aiApproval(vm.state.value.provider!!), agent.sentOptions.last().headers); assertFalse(vm.state.value.destinationChanged)
        } finally { base.close() }
    }

    @Test fun returningFromConnectionSetupPicksUpTheNewConnectionKeepingTheDraft() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val agent = Agent(base, base.resumes.openDraft(StoryboardIds.resume)); val connections = Connections(base.ai); agent.ai = connections
            connections.list = emptyList()
            val vm = AssistantViewModel(agent.repositories(), StoryboardIds.resume, null); runCurrent()
            vm.input("My question"); assertNull(vm.state.value.provider)
            connections.list = listOf(base.ai.listAiProviders().first())
            vm.refreshProviders(); runCurrent()
            assertNotNull(vm.state.value.provider); assertEquals("My question", vm.state.value.input)
            vm.send(); runCurrent(); advanceTimeBy(101); runCurrent()
            assertEquals(1, agent.sent.size)
            // A second connection keeps the chosen one selected.
            val chosen = vm.state.value.providerId
            connections.list = connections.list!! + base.ai.listAiProviders().first().copy(id = "second", isDefault = true)
            vm.refreshProviders(); runCurrent()
            assertEquals(chosen, vm.state.value.providerId); assertEquals(2, vm.state.value.providers.size)
        } finally { base.close() }
    }

    @Test fun wordingDraftOutlivesAFailedSaveAndClearsOnlyWhenSaved() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val agent = Agent(base, base.resumes.openDraft(StoryboardIds.resume)); agent.proposal()
            val vm = AssistantViewModel(agent.repositories(), StoryboardIds.resume, "thread"); runCurrent()
            val proposal = vm.state.value.proposals.single()
            vm.editWording(proposal); vm.wording("My own wording"); assertTrue(vm.state.value.wording!!.dirty)
            agent.failRead = true; vm.decide(listOf(proposal.id), Decision.Pending, "My own wording", proposal.after); runCurrent()
            assertTrue(vm.state.value.failed); assertEquals("My own wording", vm.state.value.wording!!.text)
            // Reopening the edit (after closing Proposals or coming back from the location) recovers the words.
            vm.editWording(vm.state.value.proposals.single()); assertEquals("My own wording", vm.state.value.wording!!.text)
            agent.failRead = false
            vm.decide(listOf(proposal.id), Decision.Pending, "My own wording", proposal.after); runCurrent()
            assertFalse(vm.state.value.failed); assertNull(vm.state.value.wording)
        } finally { base.close() }
    }
}
