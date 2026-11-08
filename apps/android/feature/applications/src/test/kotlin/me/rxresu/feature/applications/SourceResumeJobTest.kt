package me.rxresu.feature.applications

import androidx.lifecycle.SavedStateHandle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.*
import me.rxresu.core.navigation.SaveJob
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.generated.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SourceResumeJobTest {
    @Before fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())
    @After fun reset() = Dispatchers.resetMain()

    private fun model(repos: RrRepositories, documents: DocumentsRepository = repos.documents, handle: SavedStateHandle = SavedStateHandle()): SaveJobViewModel {
        val owner = repos.authSession.state.value as SessionState.SignedIn
        return SaveJobViewModel(repos.applications, documents, repos.time, true, null,
            SaveJob(sourceResumeId = StoryboardIds.resume, sourceAccountScope = owner.accountScope),
            repos.resumes, repos.authSession, handle).apply {
            update { it.copy(role = "Navigation designer", company = "Fictional source company", location = "Remote", salary = "EUR 80,000") }
        }
    }

    @Test fun atomicCopyUsesFlushedSourceAndKeepsOtherJobFields() = runTest {
        FakeRepositories(coroutineScope = backgroundScope).use { repos ->
            val draft = repos.resumes.openDraft(StoryboardIds.resume)
            val original = requireNotNull(draft.state.value.document)
            draft.update(original.copy(data = original.data.copy(basics = original.data.basics.copy(name = "Unsaved source wording"))))
            val before = repos.applications.listApplications().size
            val id = requireNotNull(model(repos).save())
            val copy = repos.resumes.getResume(id)
            assertNotEquals(original.id, copy.id)
            assertEquals("Unsaved source wording", copy.data.basics.name)
            assertEquals("Unsaved source wording", repos.resumes.getResume(original.id).data.basics.name)
            val job = repos.applications.getApplication(requireNotNull(copy.applicationId))
            assertEquals(id, job.resumeId)
            assertEquals("Fictional source company", job.company)
            assertEquals("Remote", job.location)
            assertEquals("EUR 80,000", job.salary)
            assertEquals(before + 1, repos.applications.listApplications().size)
        }
    }

    @Test fun lostCopyResponseRetriesSameIdAfterViewModelRecreation() = runTest {
        FakeRepositories(coroutineScope = backgroundScope).use { repos ->
            val requests = mutableListOf<CopyResumeForJobRequest>()
            val docs = object : DocumentsRepository by repos.documents {
                override suspend fun copyResumeForJob(body: CopyResumeForJobRequest, options: RequestOptions): String {
                    requests += body
                    val id = repos.documents.copyResumeForJob(body, options)
                    if (requests.size == 1) error("Response lost after commit")
                    return id
                }
            }
            val handle = SavedStateHandle()
            val before = repos.applications.listApplications().size
            val first = model(repos, docs, handle)
            assertNull(first.save())
            assertTrue(first.state.value.saveFailed)
            assertEquals("Fictional source company", first.state.value.company)
            val restored = SavedStateHandle(mapOf("copy-id" to handle.get<String>("copy-id")))
            val id = requireNotNull(model(repos, docs, restored).save())
            assertEquals(requests[0], requests[1])
            assertEquals(requests[0].newId, id)
            assertEquals(before + 1, repos.applications.listApplications().size)
        }
    }

    @Test fun failedDraftFlushAndChangedAccountNeverCreateJobOrCopy() = runTest {
        val controls = FakeControls()
        val auth = FakeAuthSession()
        FakeRepositories(controls, authSession = auth, coroutineScope = backgroundScope).use { repos ->
            var copies = 0
            val docs = object : DocumentsRepository by repos.documents {
                override suspend fun copyResumeForJob(body: CopyResumeForJobRequest, options: RequestOptions): String {
                    copies++
                    return repos.documents.copyResumeForJob(body, options)
                }
            }
            val vm = model(repos, docs)
            val draft = repos.resumes.openDraft(StoryboardIds.resume)
            val original = requireNotNull(draft.state.value.document)
            controls.online.value = false
            draft.update(original.copy(data = original.data.copy(basics = original.data.basics.copy(name = "Kept offline"))))
            assertNull(vm.save())
            assertEquals("Kept offline", draft.state.value.document!!.data.basics.name)
            controls.online.value = true
            auth.state.value = SessionState.SignedIn(auth.origin.value, "different-account")
            assertNull(vm.save())
            assertEquals(0, copies)
        }
    }

    @Test fun failedMetadataPatchRetriesExistingAtomicCopyAndChangedPayloadIsRejected() = runTest {
        val controls = FakeControls()
        FakeRepositories(controls, coroutineScope = backgroundScope).use { repos ->
            val vm = model(repos)
            val before = repos.applications.listApplications().size
            controls.set("patchApplication", FakeMode.Error())
            assertNull(vm.save())
            assertTrue(vm.state.value.saveFailed)
            assertEquals(before + 1, repos.applications.listApplications().size)
            controls.set("patchApplication", FakeMode.Ready)
            vm.update { it.copy(company = "Changed retry payload") }
            assertNull(vm.save())
            assertEquals(before + 1, repos.applications.listApplications().size)
            vm.update { it.copy(company = "Fictional source company") }
            val id = requireNotNull(vm.save())
            val applicationId = requireNotNull(repos.resumes.getResume(id).applicationId)
            assertEquals("EUR 80,000", repos.applications.getApplication(applicationId).salary)
            assertEquals(before + 1, repos.applications.listApplications().size)
            repos.applications.trashApplication(applicationId)
            assertNull(vm.save())
            assertEquals(before, repos.applications.listApplications().size)
        }
    }

    @Test fun choosingTrackedJobCopiesSourceWithoutCreatingAnotherJob() = runTest {
        FakeRepositories(coroutineScope = backgroundScope).use { repos ->
            val before = repos.applications.listApplications().size
            val id = requireNotNull(model(repos).save(StoryboardIds.kiln))
            assertEquals(StoryboardIds.kiln, repos.resumes.getResume(id).applicationId)
            assertEquals(before, repos.applications.listApplications().size)
        }
    }
}
