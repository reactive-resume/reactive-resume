package me.rxresu.feature.letters

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.*
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.*
import me.rxresu.core.network.generated.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class) @Config(sdk = [36])
class LetterSnapshotTest {
    @Before fun setup() { Dispatchers.setMain(StandardTestDispatcher()) }
    @After fun teardown() { Dispatchers.resetMain() }

    @Test fun exactVersionsSurviveDifferentLiveBodyWithoutOpeningDrafts() = runTest {
        val base = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val id = StoryboardIds.lumenLetter
            val sent = base.letters.getCoverLetterVersion(id, "letter-version-lumen")
            val original = base.letters.getCoverLetter(id)
            base.letters.updateCoverLetter(id, PatchCoverLetterRequest(expectedRevision = original.revision, content = "<p>Second saved body.</p>"))
            val named = base.letters.createCoverLetterVersion(id, PatchDocumentNameRequest("Second submission"))
            val latest = base.letters.getCoverLetter(id)
            base.letters.updateCoverLetter(id, PatchCoverLetterRequest(expectedRevision = latest.revision, content = "<p>Current editable body.</p>"))
            val noDraft = object : LettersRepository by base.letters {
                override suspend fun openDraft(id: String): DocumentDraft<CoverLetter> = error("Snapshots must never open a draft")
                override suspend fun getCoverLetter(id: String, options: me.rxresu.core.network.RequestOptions): CoverLetter = error("Snapshots must never read live content")
            }
            val repositories = with(base) { RrRepositories(account, documents, resumes, noDraft, applications, checks, ai, assistant, workspace, career, search, publicResume, platform, preferences, today, drafts, pages, authSession, time) }
            val first = LetterSnapshotViewModel(repositories, id, sent.id)
            val second = LetterSnapshotViewModel(repositories, id, named.id)
            runCurrent()
            assertEquals(sent.data.content, first.state.value.letter?.content)
            assertEquals("<p>Second saved body.</p>", second.state.value.letter?.content)
            assertEquals(sent.id, first.state.value.snapshotVersionId)
            assertEquals(named.id, second.state.value.snapshotVersionId)
            assertNotEquals(first.state.value.letter?.id, second.state.value.letter?.id)
            assertFalse(first.state.value.editable)
            assertFalse(second.state.value.editable)
            assertEquals("<p>Current editable body.</p>", base.letters.getCoverLetter(id).content)
            assertTrue(base.drafts.pending().first().isEmpty())
        } finally { base.close() }
    }

    @Test fun missingOrWrongDocumentVersionDoesNotFallBackToLiveLetter() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        try {
            listOf(StoryboardIds.lumenLetter to "missing-version", "missing-letter" to "letter-version-lumen").forEach { (letter, version) ->
                val vm = LetterSnapshotViewModel(repositories, letter, version)
                runCurrent()
                assertTrue(vm.state.value.failed)
                assertNull(vm.state.value.letter)
                assertEquals(version, vm.state.value.snapshotVersionId)
            }
        } finally { repositories.close() }
    }

    @Test fun accountAndServerChangesClearLoadedSnapshotAndRejectRetry() = runTest {
        listOf(false, true).forEach { changeServer ->
            val auth = FakeAuthSession()
            val repositories = FakeRepositories(authSession = auth, coroutineScope = backgroundScope)
            try {
                val vm = LetterSnapshotViewModel(repositories, StoryboardIds.lumenLetter, "letter-version-lumen")
                runCurrent()
                assertNotNull(vm.state.value.letter)
                if (changeServer) auth.origin.value = "https://other.invalid" else auth.state.value = SessionState.SignedIn(auth.origin.value, "other-account")
                runCurrent()
                assertNull(vm.state.value.letter)
                vm.retry(); runCurrent()
                assertNull(vm.state.value.letter)
                assertTrue(vm.state.value.failed)
            } finally { repositories.close() }
        }
    }

    @Test fun accountChangeDuringVersionRequestNeverPublishesOldBody() = runTest {
        val controls = FakeControls().apply { set("getCoverLetterVersion", FakeMode.Loading) }
        val auth = FakeAuthSession()
        val repositories = FakeRepositories(controls, authSession = auth, coroutineScope = backgroundScope)
        try {
            val vm = LetterSnapshotViewModel(repositories, StoryboardIds.lumenLetter, "letter-version-lumen")
            runCurrent()
            assertTrue(vm.state.value.loading)
            auth.state.value = SessionState.SignedOut
            runCurrent()
            controls.set("getCoverLetterVersion", FakeMode.Ready)
            runCurrent()
            assertNull(vm.state.value.letter)
            assertTrue(vm.state.value.failed)
        } finally { repositories.close() }
    }
}
