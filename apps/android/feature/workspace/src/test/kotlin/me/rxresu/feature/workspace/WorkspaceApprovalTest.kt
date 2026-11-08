package me.rxresu.feature.workspace

import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import me.rxresu.core.data.*
import me.rxresu.core.network.*
import me.rxresu.core.network.generated.*
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class WorkspaceApprovalTest {
    private val dispatcher = StandardTestDispatcher()
    @Before fun main() = Dispatchers.setMain(dispatcher)
    @After fun reset() = Dispatchers.resetMain()

    private class Recorder : VoiceRecorder {
        override fun start() = Unit
        override fun level() = 0
        override fun stop() = byteArrayOf(1, 2, 3)
        override fun cancel() = Unit
    }

    @Test fun everyWorkspaceSendUsesDisclosedRecipientAndConflictKeepsWords() = runTest(dispatcher) {
        val base = FakeRepositories()
        val original = base.ai.listAiProviders().first { it.isDefault }
        var shown = original
        val calls = mutableListOf<ApiRequest>()
        val transport = object : ApiTransport {
            override suspend fun execute(request: ApiRequest): JsonElement {
                calls += request
                throw ApiException(409, "CONFLICT", "Your AI destination changed. Nothing was sent; review the connection and try again.")
            }
            override fun events(request: ApiRequest) = emptyFlow<ServerEvent>()
            override suspend fun download(request: ApiRequest): BinaryFile = error("unused")
        }
        val api = CareerApi(transport)
        val appsApi = ApplicationsApi(transport)
        val workspace = object : WorkspaceRepository by base.workspace {
            override suspend fun generateCareerWork(body: GenerateCareerWorkRequest, options: RequestOptions) = api.generateCareerWork(body, options)
            override suspend fun aiDraftApplicationMessage(id: String, body: AiDraftApplicationMessageRequest, options: RequestOptions) = appsApi.aiDraftApplicationMessage(id, body, options)
            override suspend fun transcribeCareerAnswer(providerId: String, model: String, applicationId: String?, audio: UploadPart, options: RequestOptions) = api.transcribeCareerAnswer(providerId, model, applicationId, audio, options)
        }
        val ai = object : AiRepository by base.ai {
            override suspend fun listAiProviders(limit: Long?, offset: Long?, options: RequestOptions) = listOf(shown)
        }
        val repos = base.replacing(workspace = workspace, ai = ai)
        val fit = FitViewModel(repos, StoryboardIds.lumen)
        val prepare = PrepareViewModel(repos, StoryboardIds.lumen)
        val messages = MessagesViewModel(repos, StoryboardIds.lumen)
        val practice = PractiseViewModel(repos, StoryboardIds.lumen, { listOf("Question") }, Recorder(), { testScheduler.currentTime })
        val debrief = DebriefViewModel(repos, StoryboardIds.lumen, Recorder(), { testScheduler.currentTime })
        advanceUntilIdle()
        shown = original.copy(label = "Renewed disclosure", recipientVersion = "changed-url")
        fit.check(Locale.UK)
        prepare.generate(Locale.UK)
        messages.select(MessageKind.Reply); messages.editPasted("My employer message"); messages.draft(Locale.UK)
        practice.type(); practice.editAnswer("My practice words"); practice.feedback(Locale.UK)
        debrief.setQuestion("My question"); debrief.setAnswer("My debrief words"); debrief.setLanded(CreateCareerOfferResponseDataDebriefLanded.entries.first()); debrief.review(Locale.UK)
        advanceUntilIdle()
        assertEquals(5, calls.size)
        calls.forEach { assertEquals(aiApproval(original), it.options.headers) }
        assertEquals("My employer message", (messages.state.value as Load.Ready).value.pasted)
        assertEquals("My practice words", ((practice.state.value as Load.Ready).value.phase as AnswerPhase.Review).text)
        assertEquals("My debrief words", (debrief.state.value as Load.Ready).value.answer)
        assertTrue((fit.state.value as Load.Ready).value.context.destinationChanged)
        assertEquals(shown.recipientVersion, (prepare.state.value as Load.Ready).value.context.provider?.recipientVersion)
        assertEquals(5, calls.size) // renewal never dispatches a retry
        messages.select(MessageKind.FollowUp); messages.editBody("My follow-up words"); messages.draft(Locale.UK)
        advanceUntilIdle()
        assertEquals(aiApproval(shown), calls.last().options.headers)
        assertEquals("My follow-up words", (messages.state.value as Load.Ready).value.followUp)

        practice.record(); practice.stopRecording()
        debrief.record(); debrief.stopRecording()
        advanceUntilIdle()
        val voice = calls.filter { it.operation == "transcribeCareerAnswer" }
        assertEquals(2, voice.size)
        voice.forEach { request ->
            val approval = ApiJson.parseToJsonElement(request.options.headers.getValue("x-ai-destination")).jsonArray
            assertEquals(JsonPrimitive(shown.id), approval[0])
            assertEquals(JsonPrimitive(shown.recipientVersion), approval[1])
            assertEquals("transcription", approval[2].jsonObject.getValue("kind").jsonPrimitive.content)
            assertEquals("gpt-4o-mini-transcribe", approval[2].jsonObject.getValue("model").jsonPrimitive.content)
            assertTrue(request.parts.single { it.name == "audio" }.bytes.contentEquals(byteArrayOf(1, 2, 3)))
        }
        practice.transcribe(); debrief.transcribe(); advanceUntilIdle()
        assertEquals(4, calls.count { it.operation == "transcribeCareerAnswer" })
    }

    @Test fun sourceActionsRejectUntrustedSchemesAndCredentials() {
        assertTrue(safeSourceUrl("https://example.com/research"))
        assertFalse(safeSourceUrl("javascript:alert(1)"))
        assertFalse(safeSourceUrl("file:///private/data"))
        assertFalse(safeSourceUrl("https://user:password@example.com"))
        assertFalse(safeSourceUrl("https:///missing-host"))
    }
}

internal fun RrRepositories.replacing(workspace: WorkspaceRepository = this.workspace, ai: AiRepository = this.ai, applications: ApplicationsRepository = this.applications) = RrRepositories(
    account, documents, resumes, letters, applications, checks, ai, assistant, workspace, career, search, publicResume,
    platform, preferences, today, drafts, pages, authSession, time,
)
