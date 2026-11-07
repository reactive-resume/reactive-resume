package me.rxresu.feature.settings

import androidx.lifecycle.ViewModelStore
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import me.rxresu.core.data.*
import me.rxresu.core.network.generated.*
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class DeveloperViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val store = ViewModelStore()

    @Before
    fun setup() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun teardown() {
        store.clear()
        Dispatchers.resetMain()
    }

    @Test
    fun savingWebKeyClearsSecretWithoutTesting() =
        runTest(dispatcher) {
            val controls = FakeControls()
            controls.responses.value =
                mapOf(
                    "getWebAccessStatus" to
                        JsonObject(
                            ApiSamples.response("getWebAccessStatus").jsonObject +
                                mapOf(
                                    "canSave" to JsonPrimitive(true),
                                    "managed" to JsonPrimitive(false),
                                )
                        )
                )
            val repo = FakeRepositories(controls, coroutineScope = backgroundScope)
            val vm = DeveloperViewModel(repo)
            store.put("vm", vm)
            vm.load("web")
            advanceUntilIdle()
            vm.key("test-web-key")
            vm.saveWeb()
            advanceUntilIdle()
            assertFalse(vm.state.value.error)
            assertEquals("", vm.state.value.key)
            assertNull(vm.state.value.test)
            repo.close()
        }

    @Test
    fun memoryChoicePersistsWithoutChangingSearchPreferences() =
        runTest(dispatcher) {
            val repo = FakeRepositories(coroutineScope = backgroundScope)
            val before = repo.career.getCareerProfile()
            val vm = DeveloperViewModel(repo)
            store.put("vm", vm)
            vm.load("memory")
            advanceUntilIdle()
            vm.memory(SaveCareerProfileRequestMemoryMode.Off)
            advanceUntilIdle()
            val after = repo.career.getCareerProfile()
            assertEquals(SaveCareerProfileRequestMemoryMode.Off, after.memoryMode)
            assertEquals(before.targetRoles, after.targetRoles)
            repo.close()
        }

    @Test
    fun staleLoadDoesNotOverwriteAnotherSection() =
        runTest(dispatcher) {
            val controls = FakeControls()
            controls.set("getWebAccessStatus", FakeMode.Loading)
            val repo = FakeRepositories(controls, coroutineScope = backgroundScope)
            val vm = DeveloperViewModel(repo)
            store.put("vm", vm)
            vm.load("web")
            runCurrent()
            vm.load("keys")
            advanceUntilIdle()
            controls.set("getWebAccessStatus", FakeMode.Ready)
            advanceUntilIdle()
            assertEquals("keys", vm.state.value.section)
            assertFalse(vm.state.value.loading)
            assertNull(vm.state.value.web)
            repo.close()
        }

    @Test
    fun photoReaderRejectsOversizeStreamsAndRetainsExactBytes() {
        val bytes = byteArrayOf(1, 2, 3)
        assertArrayEquals(bytes, readPhoto(bytes.inputStream()))
        assertThrows(IllegalArgumentException::class.java) {
            readPhoto(ByteArray(PHOTO_MAX_BYTES + 1).inputStream())
        }
    }

    @Test
    fun salaryParsingUsesLocaleAndRejectsTrailingText() {
        assertEquals(70000.5, parseSalary("70.000,5", java.util.Locale.GERMANY)!!, 0.0001)
        assertTrue(parseSalary("70000 EUR", java.util.Locale.US)!!.isNaN())
        assertNull(parseSalary("", java.util.Locale.US))
    }
}
