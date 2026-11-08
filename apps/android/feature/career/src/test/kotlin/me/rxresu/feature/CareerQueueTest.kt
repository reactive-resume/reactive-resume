package me.rxresu.feature.career

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import java.io.File
import java.io.IOException
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.*
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

class CareerTestApplication : Application(), RepositoriesProvider { override lateinit var repositories: RrRepositories }

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = CareerTestApplication::class)
class CareerQueueTest {
    private val context get() = ApplicationProvider.getApplicationContext<CareerTestApplication>()
    @Before fun setup() { Dispatchers.setMain(StandardTestDispatcher()); File(context.noBackupFilesDir, "career").deleteRecursively() }
    @After fun cleanup() { Dispatchers.resetMain() }

    @Test fun typingCoalescesOffCallerAndFinalWriteSurvivesScreenDisposal() = runTest {
        var writes = 0
        val drafts = CareerDrafts(context, "test", this, StandardTestDispatcher(testScheduler)) { writes++ }
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        val model = PreferencesViewModel(repositories, drafts)
        val store = androidx.lifecycle.ViewModelStore().apply { put("editor", model) }
        advanceUntilIdle()
        val initial = requireNotNull(model.state.value.profile)
        repeat(200) { model.change(initial.copy(priorities = "Words $it")) }
        assertEquals(0, writes)
        assertFalse(File(context.noBackupFilesDir, "career").exists())
        store.clear()
        advanceUntilIdle()
        assertEquals(1, writes)
        val restored = CareerDrafts(context, "test", this, StandardTestDispatcher(testScheduler)).read("preferences")!!
        assertEquals("Words 199", ApiJson.decodeFromString(CareerProfile.serializer(), restored).priorities)
        repositories.close()
    }

    @Test fun fsyncRunsOffMainThread() = runBlocking {
        val main = android.os.Looper.getMainLooper().thread
        val drafts = CareerDrafts(context, "real-io", persisted = { assertNotSame(main, Thread.currentThread()) })
        drafts.enqueue("story", "Words", "story").await()
        assertEquals("Words", drafts.read("story"))
    }

    @Test fun failedPersistenceRetainsWordsAndNeverClaimsDeviceSave() = runTest {
        val scope = CoroutineScope(SupervisorJob() + StandardTestDispatcher(testScheduler))
        try {
            val repositories = FakeRepositories(coroutineScope = backgroundScope)
            val drafts = CareerDrafts(context, "storage-failure", scope, StandardTestDispatcher(testScheduler))
            val model = PreferencesViewModel(repositories, drafts)
            advanceUntilIdle()
            File(context.noBackupFilesDir, "career").writeText("Not a directory")
            model.change(requireNotNull(model.state.value.profile).copy(priorities = "Keep these words"))
            advanceUntilIdle()
            assertEquals("Keep these words", model.state.value.profile?.priorities)
            assertEquals(SaveState.Failed, model.state.value.status)
            assertTrue(model.state.value.error)
            repositories.close()
        } finally { scope.cancel() }
    }

    @Test fun preQueueRecoveryMigratesIncludingInterruptedAtomicWriteButNeverSendsCoach() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        val profile = repositories.career.getCareerProfile().copy(priorities = "Older recovery")
        val story = SaveCareerStoryRequest(action = "Action", situation = "Situation", task = "Task", title = "Earlier story", id = "legacy-story")
        fun hash(value: String) = java.security.MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
        val directory = File(context.noBackupFilesDir, "career/" + hash("legacy")).apply { mkdirs() }
        File(directory, hash("preferences") + ".json.bak").writeText(ApiJson.encodeToString(CareerProfile.serializer(), profile))
        File(directory, hash("story:new") + ".json").writeText(ApiJson.encodeToString(SaveCareerStoryRequest.serializer(), story))
        File(directory, hash("coach:new") + ".json").writeText("Unsent coaching question")
        val drafts = CareerDrafts(context, "legacy", this, StandardTestDispatcher(testScheduler))
        val queued = drafts.queued()
        assertEquals(setOf("preferences", "story"), queued.map { it.kind }.toSet())
        assertEquals(2, queued.size)
        assertEquals("Unsent coaching question", drafts.read("coach:new"))
        queued.forEach { drafts.acknowledge(it) }
        assertTrue(drafts.queued().isEmpty())
        repositories.close()
    }

    @Test fun restartWorkerRetriesOfflineQueueWithoutOpeningCareerAndRespectsAccount() = runTest {
        val controls = FakeControls()
        val session = FakeAuthSession()
        val repositories = FakeRepositories(controls, authSession = session, coroutineScope = backgroundScope)
        context.repositories = repositories
        val owner = requireNotNull(repositories.owner())
        val origin = repositories.authSession.origin.value
        val drafts = CareerDrafts(context, "$origin:$owner", this, StandardTestDispatcher(testScheduler))
        val profile = repositories.career.getCareerProfile().copy(priorities = "Keep my final words")
        drafts.enqueue("preferences", ApiJson.encodeToString(CareerProfile.serializer(), profile), "preferences").await()
        val story = SaveCareerStoryRequest(action = "Listen", situation = "Change", task = "Lead", title = "My story", id = "test-story", result = "Kept result")
        drafts.enqueue("story:new", ApiJson.encodeToString(SaveCareerStoryRequest.serializer(), story), "story").await()
        suspend fun worker() = TestListenableWorkerBuilder<CareerSyncWorker>(context).setInputData(workDataOf("owner" to owner, "origin" to origin)).build().doWork()
        controls.online.value = false
        assertEquals(ListenableWorker.Result.retry(), worker())
        assertEquals(2, drafts.queued().size)
        controls.online.value = true
        val signedIn = session.state.value
        session.state.value = SessionState.SignedOut
        assertEquals(ListenableWorker.Result.success(), worker())
        assertEquals(2, drafts.queued().size)
        session.state.value = signedIn
        // A fresh worker reads only disk; there is no screen/view model left to retry.
        assertEquals(ListenableWorker.Result.success(), worker())
        assertEquals("Keep my final words", repositories.career.getCareerProfile().priorities)
        assertTrue(repositories.career.listCareerStories().any { it.id == story.id && it.data.result == "Kept result" })
        assertTrue(drafts.queued().isEmpty())
        repositories.close()
    }

    @Test fun olderResponseCannotAcknowledgeNewerEdit() = runTest {
        val drafts = CareerDrafts(context, "test", this, StandardTestDispatcher(testScheduler))
        drafts.enqueue("preferences", "Before", "preferences").await()
        val before = drafts.queued().single()
        drafts.enqueue("preferences", "Final words", "preferences").await()
        drafts.acknowledge(before)
        assertEquals("Final words", drafts.queued().single().value)
        assertNull(CareerDrafts(context, "other-account", this, StandardTestDispatcher(testScheduler)).read("preferences"))
    }

    @Test fun processRestorationKeepsLastInputBeforeDiskDispatcherRuns() = runTest {
        val controls = FakeControls()
        val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        val initial = repositories.career.getCareerProfile().copy(priorities = "Last words from saved activity state")
        val handle = androidx.lifecycle.SavedStateHandle(mapOf("draft" to ApiJson.encodeToString(CareerProfile.serializer(), initial)))
        controls.online.value = false
        val drafts = CareerDrafts(context, "test", this, StandardTestDispatcher(testScheduler))
        val model = PreferencesViewModel(repositories, drafts, handle)
        advanceUntilIdle()
        assertEquals(initial.priorities, model.state.value.profile?.priorities)
        assertEquals(initial.priorities, ApiJson.decodeFromString(CareerProfile.serializer(), drafts.read("preferences")!!).priorities)
        repositories.close()
    }

    @Test fun offlineReopenShowsRecoveryBeforeAnyRemoteReadSucceeds() = runTest {
        val controls = FakeControls()
        val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        val drafts = CareerDrafts(context, "test", this, StandardTestDispatcher(testScheduler))
        val profile = repositories.career.getCareerProfile().copy(priorities = "Offline preferences")
        drafts.write("preferences", ApiJson.encodeToString(CareerProfile.serializer(), profile))
        val story = SaveCareerStoryRequest(action = "Offline action", situation = "Situation", task = "Task", title = "Offline story", id = "test-story")
        drafts.write("story:test-story", ApiJson.encodeToString(SaveCareerStoryRequest.serializer(), story))
        controls.online.value = false
        val preferences = PreferencesViewModel(repositories, drafts)
        val editor = StoryViewModel(repositories, drafts, "test-story")
        advanceUntilIdle()
        assertEquals("Offline preferences", preferences.state.value.profile?.priorities)
        assertEquals(story, editor.state.value.draft)
        assertFalse(preferences.state.value.loading)
        assertFalse(editor.state.value.loading)
        repositories.close()
    }
}
