package me.rxresu.feature.letters

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import me.rxresu.core.network.*
import me.rxresu.core.network.generated.*
import kotlinx.coroutines.test.*
import me.rxresu.core.data.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class) @Config(sdk = [36])
class LetterViewModelTest {
    @Before fun setup() { Dispatchers.setMain(StandardTestDispatcher()) }
    @After fun teardown() { Dispatchers.resetMain() }
    @Test fun contentIsDurableBeforeNetworkSave() = runTest {
        val controls = FakeControls(); val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        try {
            val vm = LetterViewModel(repositories, StoryboardIds.lumenLetter); runCurrent(); controls.online.value = false
            vm.edit({ it.copy(content = "My words offline") }); runCurrent()
            assertEquals("My words offline", repositories.letters.openDraft(StoryboardIds.lumenLetter).state.value.document!!.content)
        } finally { repositories.close() }
    }
    @Test fun designFailureKeepsOwnWords() = runTest {
        val controls = FakeControls(); val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        try {
            val vm = LetterViewModel(repositories, StoryboardIds.lumenLetter); runCurrent(); val before = vm.state.value.letter!!
            controls.set("updateCoverLetter", FakeMode.Error()); vm.designLinked(!before.designLinked) {}; runCurrent()
            assertEquals(before.content, vm.state.value.letter!!.content); assertEquals(before.designLinked, vm.state.value.letter!!.designLinked); assertTrue(vm.state.value.failed)
        } finally { repositories.close() }
    }
    @Test fun explicitLeaveClosesOwnedHandle() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val vm = LetterViewModel(repositories, StoryboardIds.lumenLetter); runCurrent(); val handle = repositories.letters.openDraft(StoryboardIds.lumenLetter)
            var left = false; vm.leave { left = true }; runCurrent(); assertTrue(left)
            assertTrue(runCatching { handle.update(handle.state.value.document!!) }.isFailure)
        } finally { repositories.close() }
    }
    @Test fun unlinkResumePersistsNull() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val vm = LetterViewModel(repositories, StoryboardIds.lumenLetter); runCurrent()
            vm.linkResume(null) {}; runCurrent(); advanceTimeBy(801); runCurrent()
            assertNull(repositories.letters.getCoverLetter(StoryboardIds.lumenLetter).sourceResumeId)
        } finally { repositories.close() }
    }
    @Test fun automaticVersionsCannotBeRenamedOrDeleted() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val version = base.letters.listCoverLetterVersions(StoryboardIds.lumenLetter).first().copy(kind = GetCoverLetterVersionResponseKind.Auto)
            var renamed = false; var deleted = false
            val guarded = object : LettersRepository by base.letters {
                override suspend fun listCoverLetterVersions(id: String, limit: Long?, offset: Long?, options: RequestOptions) = listOf(version)
                override suspend fun renameCoverLetterVersion(id: String, versionId: String, body: PatchDocumentNameRequest, options: RequestOptions): LetterVersionSummary { renamed = true; return version }
                override suspend fun deleteCoverLetterVersion(id: String, versionId: String, options: RequestOptions) { deleted = true }
            }
            val repositories = with(base) { RrRepositories(account, documents, resumes, guarded, applications, checks, ai, assistant, workspace, career, search, publicResume, platform, preferences, today, drafts, pages, authSession, time) }
            val vm = LetterViewModel(repositories, StoryboardIds.lumenLetter); runCurrent()
            vm.nameVersion("Changed", version.id) {}; runCurrent(); assertTrue(vm.state.value.failed); assertFalse(renamed)
            vm.deleteVersion(version.id) {}; runCurrent(); assertTrue(vm.state.value.failed); assertFalse(deleted)
        } finally { base.close() }
    }
    private fun streamed(base: RrRepositories, fail: Boolean = false, ai: AiRepository = base.ai, refuse: () -> Boolean = { false }, onOptions: (RequestOptions) -> Unit = {}, onRequest: (DraftCoverLetterRequest?) -> Unit = {}): RrRepositories {
        val letters = object : LettersRepository by base.letters {
            override fun draftCoverLetter(id: String, body: DraftCoverLetterRequest?, options: RequestOptions): Flow<ServerEvent> = flow {
                onOptions(options)
                if (refuse()) throw ApiException(409, "CONFLICT", "Your AI destination changed. Nothing was sent; review the connection and try again.")
                assertEquals(true, body?.includeProvenance); onRequest(body)
                emit(ServerEvent(null, "message", "{\"aiOperationId\":\"operation\"}")); delay(100)
                emit(ServerEvent(null, "message", JsonPrimitive("My draft & ").toString())); delay(100)
                check(!fail)
                emit(ServerEvent(null, "message", JsonPrimitive("my facts").toString())); emit(ServerEvent(null, "done", "null"))
            }
        }
        return RrRepositories(base.account, base.documents, base.resumes, letters, base.applications, base.checks, ai, base.assistant, base.workspace, base.career, base.search, base.publicResume, base.platform, base.preferences, base.today, base.drafts, base.pages, base.authSession, base.time)
    }
    @Test fun generatedDraftNeverAppliesSilentlyAndKeepIsUndoable() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val vm = LetterViewModel(streamed(base), StoryboardIds.lumenLetter, io = StandardTestDispatcher(testScheduler)); runCurrent(); val before = vm.state.value.letter!!.content
            vm.generate(); runCurrent(); assertTrue(vm.state.value.aiDraft!!.generating); advanceTimeBy(201); runCurrent()
            assertEquals(before, vm.state.value.letter!!.content); assertEquals("My draft & my facts", vm.state.value.aiDraft!!.text)
            vm.keepDraft(); runCurrent(); assertNull(vm.state.value.aiDraft); assertEquals("<p>My draft &amp; my facts</p>", vm.state.value.letter!!.content)
            assertTrue(vm.state.value.letter!!.aiOperationIds!!.contains("operation")); vm.undo(); runCurrent(); assertEquals(before, vm.state.value.letter!!.content)
        } finally { base.close() }
    }
    @Test fun streamFailureAndDiscardKeepAuthoredLetter() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val vm = LetterViewModel(streamed(base, fail = true), StoryboardIds.lumenLetter, io = StandardTestDispatcher(testScheduler)); runCurrent(); val before = vm.state.value.letter!!.content
            vm.generate(); advanceTimeBy(201); runCurrent(); assertTrue(vm.state.value.aiDraft!!.failed); assertEquals("My draft & ", vm.state.value.aiDraft!!.text); assertEquals(before, vm.state.value.letter!!.content)
            vm.discardDraft(); runCurrent(); assertNull(vm.state.value.aiDraft); assertEquals(before, vm.state.value.letter!!.content)
        } finally { base.close() }
    }
    @Test fun changedLetterBlocksKeepAndRecoverySurvivesRecreation() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        val context = ApplicationProvider.getApplicationContext<Context>(); val recovery = LetterDraftRecovery(context, "test-recovery")
        try {
            recovery.write(null)
            val vm = LetterViewModel(streamed(base), StoryboardIds.lumenLetter, recovery, StandardTestDispatcher(testScheduler)); runCurrent(); vm.generate(); advanceTimeBy(201); runCurrent()
            vm.edit({ it.copy(content = "Words typed meanwhile") }); runCurrent(); vm.keepDraft(); runCurrent()
            assertTrue(vm.state.value.failed); assertEquals("Words typed meanwhile", vm.state.value.letter!!.content); assertNotNull(vm.state.value.aiDraft)
            val restored = LetterViewModel(streamed(base), StoryboardIds.lumenLetter, recovery, StandardTestDispatcher(testScheduler)); runCurrent()
            assertEquals("My draft & my facts", restored.state.value.aiDraft!!.text); assertEquals(listOf("operation"), restored.state.value.aiDraft!!.operationIds)
        } finally { recovery.write(null); base.close() }
    }
    @Test fun blockHitRegionsUseOnlyUnambiguousActualText() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val letter = base.letters.getCoverLetter(StoryboardIds.lumenLetter).copy(content = "<p>Body text</p>", greeting = "Hello", signOff = "Bye", recipient = "Team")
            val blocks = letterBlocks(letter, listOf(listOf(LetterRun("Body text", .1f, .3f, .9f, .4f), LetterRun("Hello", .1f, .2f, .4f, .25f), LetterRun("Not in the letter", .1f, .8f, .4f, .9f))))
            assertEquals(listOf("body", "greeting"), blocks.map { it.field }); assertTrue(blocks.first().contains(.5f, .35f)); assertFalse(blocks.first().contains(.5f, .7f))
            assertTrue(letterBlocks(letter.copy(greeting = "Body text"), listOf(listOf(LetterRun("Body text", 0f, 0f, 1f, 1f)))).isEmpty())
        } finally { base.close() }
    }
    @Test fun colorFormatsAndContrastStayReadable() {
        assertEquals("#AABBCC", letterHex("#abc")); assertEquals("#2F5A8A", letterHex("rgba(47, 90, 138, 1)")); assertNull(letterHex("rgba(999, 0, 0, 1)")); assertNull(letterHex("#nothex"))
        assertEquals(21.0, letterContrast("#000000"), 0.01); assertTrue(letterContrast(darkerLetterColor("#FFFFFF")) >= 4.6)
    }
    @Test fun retryRepeatsFailedDraftVariant() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val requests = mutableListOf<CreateCoverLetterDraftRequestVariant?>()
            val vm = LetterViewModel(streamed(base, true) { requests += it?.variant }, StoryboardIds.lumenLetter, io = StandardTestDispatcher(testScheduler)); runCurrent()
            vm.generate(CreateCoverLetterDraftRequestVariant.Personal); advanceTimeBy(201); runCurrent(); vm.retryDraft(); advanceTimeBy(201); runCurrent()
            assertEquals(listOf(CreateCoverLetterDraftRequestVariant.Personal, CreateCoverLetterDraftRequestVariant.Personal), requests)
        } finally { base.close() }
    }

    @Test fun draftCarriesTheShownApprovalAndAChangedDestinationRenewsItKeepingTheLetter() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val shown = base.ai.listAiProviders().first { it.enabled && it.testStatus == "success" }.copy(isDefault = true)
            var list = listOf(shown); var refuse = false; val sent = mutableListOf<RequestOptions>()
            val ai = object : AiRepository by base.ai { override suspend fun listAiProviders(limit: Long?, offset: Long?, options: RequestOptions) = list }
            val vm = LetterViewModel(streamed(base, ai = ai, refuse = { refuse }, onOptions = { sent += it }), StoryboardIds.lumenLetter, io = StandardTestDispatcher(testScheduler)); runCurrent()
            assertEquals(shown, vm.state.value.provider); val before = vm.state.value.letter!!.content
            // The connection's address changes elsewhere after the disclosure was shown.
            list = listOf(shown.copy(recipientVersion = shown.recipientVersion + "-changed")); refuse = true
            vm.generate(); advanceTimeBy(201); runCurrent()
            assertEquals(aiApproval(shown), sent.single().headers)
            assertTrue(vm.state.value.aiDraft!!.failed); assertTrue(vm.state.value.aiDraft!!.destinationChanged)
            assertEquals(shown.recipientVersion + "-changed", vm.state.value.provider!!.recipientVersion); assertEquals(before, vm.state.value.letter!!.content)
            refuse = false; vm.retryDraft(); advanceTimeBy(201); runCurrent()
            assertEquals(aiApproval(vm.state.value.provider!!), sent.last().headers); assertEquals("My draft & my facts", vm.state.value.aiDraft!!.text)
        } finally { base.close() }
    }

    /** Two pages, so the letter's second page can be inspected. */
    private class TwoPages : me.rxresu.core.page.PageRenderer {
        override suspend fun render(source: me.rxresu.core.page.PageSource) = me.rxresu.core.page.RenderedDocument(source, java.io.File.createTempFile("letter", ".pdf"), 2)
        override suspend fun lastGood(source: me.rxresu.core.page.PageSource): me.rxresu.core.page.RenderedDocument? = null
        override suspend fun page(document: me.rxresu.core.page.RenderedDocument, index: Int, widthPx: Int): android.graphics.Bitmap = android.graphics.Bitmap.createBitmap(10, 14, android.graphics.Bitmap.Config.ARGB_8888)
    }
    @Test fun everyPageOfALongLetterRenders() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val repositories = with(base) { RrRepositories(account, documents, resumes, letters, applications, checks, ai, assistant, workspace, career, search, publicResume, platform, preferences, today, drafts, TwoPages(), authSession, time) }
            val vm = LetterViewModel(repositories, StoryboardIds.lumenLetter, io = StandardTestDispatcher(testScheduler)); runCurrent(); advanceTimeBy(1_000); runCurrent()
            assertEquals(2, vm.state.value.pages.size); assertEquals(2, vm.state.value.pageCount)
        } finally { base.close() }
    }
}
