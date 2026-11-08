package me.rxresu.feature.builder

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import me.rxresu.core.data.AiRepository
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.data.aiApproval
import me.rxresu.core.network.ApiException
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.generated.CreateImprovementRequestAction
import me.rxresu.core.network.generated.ImproveLineRequest
import me.rxresu.core.network.generated.ImproveLineResponse
import me.rxresu.core.network.generated.TestAiProviderResponse
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Improve sends the approval of the provider it disclosed; a changed destination renews the disclosure, keeps the words. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class BuilderAiApprovalTest {
    @After fun tearDown() = Dispatchers.resetMain()

    @Test fun improveCarriesTheShownApprovalAndA409RenewsTheDisclosureKeepingTheWords() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val fake = FakeRepositories(coroutineScope = backgroundScope)
        var version = "v1"
        val sent = mutableListOf<RequestOptions>()
        val ai = object : AiRepository by fake.ai {
            override suspend fun listAiProviders(limit: Long?, offset: Long?, options: RequestOptions): List<TestAiProviderResponse> =
                fake.ai.listAiProviders(limit, offset, options).map { it.copy(recipientVersion = version) }

            override suspend fun improveLine(body: ImproveLineRequest, options: RequestOptions): ImproveLineResponse {
                sent += options
                throw ApiException(409, "CONFLICT", "Your AI destination changed. Nothing was sent; review the connection and try again.")
            }
        }
        val repositories = with(fake) {
            RrRepositories(account, documents, resumes, letters, applications, checks, ai, assistant, workspace, career, search, publicResume, platform, preferences, today, drafts, pages, authSession, time, dispose = ::close)
        }
        val vm = BuilderViewModel(StoryboardIds.resume, repositories, readText = { listOf(emptyList()) }, io = StandardTestDispatcher(testScheduler))
        vm.loadAiProvider()
        advanceUntilIdle()
        val shown = vm.state.value.aiProvider!!
        assertEquals("v1", shown.recipientVersion)

        // The connection is edited elsewhere after the disclosure was shown.
        version = "v2"
        vm.improve("Led the redesign", "", "experience", CreateImprovementRequestAction.Verb, "Keep it under ten words")
        advanceUntilIdle()

        assertEquals(aiApproval(shown.id, "v1"), sent.single().headers)
        val failed = vm.state.value.improve as ImproveState.Failed
        assertTrue(failed.destinationChanged)
        assertEquals("Led the redesign", failed.asked.line)
        assertEquals("Keep it under ten words", failed.asked.request)
        assertEquals("v2", vm.state.value.aiProvider!!.recipientVersion)

        // Try again goes to the renewed destination, with its approval.
        vm.improve(failed.asked.line, "", "experience", failed.asked.action, failed.asked.request)
        advanceUntilIdle()
        assertEquals(aiApproval(shown.id, "v2"), sent.last().headers)
        repositories.close()
    }
}
