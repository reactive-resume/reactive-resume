package me.rxresu.feature.settings

import androidx.lifecycle.ViewModelStore
import java.io.IOException
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import me.rxresu.core.data.*
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class NextStepsViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val store = ViewModelStore()
    @Before fun setup() { Dispatchers.setMain(dispatcher) }
    @After fun teardown() { store.clear(); Dispatchers.resetMain() }

    @Test
    fun stepsListResumesOrApplicationsAndRecoverFromFailure() = runTest(dispatcher) {
        val controls = FakeControls()
        val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        val vm = NextStepsViewModel(repositories).also { store.put("vm", it) }
        vm.choose(NextStep.Improve)
        assertTrue(vm.state.value.loading)
        advanceUntilIdle()
        val resumes = repositories.documents.listDocuments().filter { it.type == me.rxresu.core.network.generated.DocumentType.Resume }
        assertEquals(resumes.map { it.id }, vm.state.value.choices.map { it.id })
        controls.set("listApplicationSummaries", FakeMode.Error(IOException("Offline")))
        vm.choose(NextStep.Fit); advanceUntilIdle()
        assertTrue(vm.state.value.error)
        controls.set("listApplicationSummaries", FakeMode.Ready)
        vm.retry(); advanceUntilIdle()
        assertFalse(vm.state.value.error)
        assertEquals(repositories.applications.listApplicationSummaries().map { it.id }, vm.state.value.choices.map { it.id })
        vm.choose(null)
        assertNull(vm.state.value.step)
        repositories.close()
    }
}
