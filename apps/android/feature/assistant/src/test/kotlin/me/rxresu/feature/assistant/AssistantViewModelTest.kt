package me.rxresu.feature.assistant

import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import me.rxresu.core.data.*
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
    @Test fun unsupportedClientCannotDropAuthoredMessage() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val vm = AssistantViewModel(repositories, StoryboardIds.resume, null); runCurrent()
            vm.input("Keep my words exactly"); vm.send(); runCurrent()
            assertEquals("Keep my words exactly", vm.state.value.input); assertTrue(vm.state.value.failed); assertFalse(vm.state.value.streaming)
        } finally { repositories.close() }
    }
    @Test fun wordingSaveCannotApplyDocumentWithoutReceiptProof() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        try {
            val vm = AssistantViewModel(repositories, StoryboardIds.resume, null); runCurrent()
            val before = repositories.resumes.openDraft(StoryboardIds.resume).state.value.document
            vm.decide(listOf("proposal"), Decision.Pending, "My wording"); runCurrent()
            assertTrue(vm.state.value.failed); assertEquals(before, repositories.resumes.openDraft(StoryboardIds.resume).state.value.document)
        } finally { repositories.close() }
    }
    @Test fun contextTogglesAreExplicit() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        try { val vm = AssistantViewModel(repositories, StoryboardIds.resume, null); runCurrent(); vm.context(false, false); assertFalse(vm.state.value.documentContext); assertFalse(vm.state.value.postingContext) } finally { repositories.close() }
    }
}
