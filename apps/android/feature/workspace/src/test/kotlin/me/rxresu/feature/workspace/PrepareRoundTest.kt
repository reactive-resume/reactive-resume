package me.rxresu.feature.workspace

import java.util.Locale
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import me.rxresu.core.data.*
import me.rxresu.core.network.*
import me.rxresu.core.network.generated.*
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class PrepareRoundTest {
    private val dispatcher = StandardTestDispatcher()
    @Before fun main() = Dispatchers.setMain(dispatcher)
    @After fun reset() = Dispatchers.resetMain()

    @Test fun roundSelectionSurvivesReloadAndLateGenerationCannotReplaceAnotherRound() = runTest(dispatcher) {
        val base = FakeRepositories()
        val app = base.applications.getApplication(StoryboardIds.lumen)
        val first = app.interviews().first()
        val second = first.copy(id = "round-two", at = "2026-11-13T09:00:00Z")
        val briefing = base.workspace.listCareerSavedItems(applicationId = app.id).first { it.data is Briefing }
        val saved = listOf(
            briefing.copy(id = "brief-one", interviewId = first.id, data = (briefing.data as Briefing).copy(headline = "First round")),
            briefing.copy(id = "brief-two", interviewId = second.id, data = (briefing.data as Briefing).copy(headline = "Second round")),
        )
        lateinit var pending: Continuation<GenerateCareerWorkResponse>
        var requestedRound: String? = null
        val applications = object : ApplicationsRepository by base.applications {
            override suspend fun getApplication(id: String, options: RequestOptions) = app.copy(activity = listOf(first, second))
        }
        val workspace = object : WorkspaceRepository by base.workspace {
            override suspend fun listCareerSavedItems(applicationId: String?, scope: ListCareerSavedItemsScope?, kind: ListCareerSavedItemsKind?, options: RequestOptions) = saved
            override suspend fun generateCareerWork(body: GenerateCareerWorkRequest, options: RequestOptions): GenerateCareerWorkResponse {
                requestedRound = (body.task as GenerateCareerWorkRequestTaskBriefing).interviewId
                return suspendCoroutine { pending = it }
            }
        }
        val vm = PrepareViewModel(base.replacing(workspace = workspace, applications = applications), app.id)
        runCurrent()
        vm.generate(Locale.UK); runCurrent()
        assertEquals(first.id, requestedRound)
        vm.selectRound(second.id)
        assertEquals("Second round", (vm.state.value as Load.Ready).value.briefing?.headline)
        val generated = ApiJson.decodeFromJsonElement(CreateCareerOfferResponse.serializer(), ApiJson.encodeToJsonElement(SavedItem.serializer(), saved.first()))
        pending.resume(GenerateCareerWorkResponse(item = generated.copy(data = (briefing.data as Briefing).copy(headline = "Late first"))))
        runCurrent()
        assertEquals(second.id, (vm.state.value as Load.Ready).value.interview?.id)
        assertEquals("Second round", (vm.state.value as Load.Ready).value.briefing?.headline)
        vm.selectRound(first.id)
        assertEquals("Late first", (vm.state.value as Load.Ready).value.briefing?.headline)
        vm.selectRound(second.id)
        vm.load(); runCurrent()
        assertEquals(second.id, (vm.state.value as Load.Ready).value.interview?.id)
        assertEquals("Second round", (vm.state.value as Load.Ready).value.briefing?.headline)
    }
}
