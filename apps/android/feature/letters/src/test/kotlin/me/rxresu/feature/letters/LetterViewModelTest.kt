package me.rxresu.feature.letters

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
}
