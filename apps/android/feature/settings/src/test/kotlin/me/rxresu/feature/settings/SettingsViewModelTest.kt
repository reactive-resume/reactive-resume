package me.rxresu.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelStore
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.JsonPrimitive
import me.rxresu.core.data.*
import me.rxresu.core.network.generated.*
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class SettingsViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val store = ViewModelStore()

    @Before
    fun setup() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        store.clear()
        Dispatchers.resetMain()
    }

    private fun <T : ViewModel> own(vm: T): T {
        store.put("test", vm)
        return vm
    }

    @Test
    fun profileSavesReviewedRevisionAndReloads() =
        runTest(dispatcher) {
            val repo = FakeRepositories(coroutineScope = backgroundScope)
            var request: SaveApplicationProfileRequest? = null
            val account =
                object : AccountRepository by repo.account {
                    override suspend fun saveApplicationProfile(
                        body: SaveApplicationProfileRequest,
                        options: me.rxresu.core.network.RequestOptions,
                    ): ApplicationProfile {
                        request = body
                        return repo.account.saveApplicationProfile(body, options)
                    }
                }
            val vm = own(ProfileViewModel(account))
            advanceUntilIdle()
            val revision = vm.state.value.record?.revision
            vm.edit { it.copy(givenName = "Updated") }
            assertTrue(vm.state.value.dirty)
            vm.save()
            advanceUntilIdle()
            assertEquals(revision, request?.expectedRevision)
            assertEquals("Updated", repo.account.getApplicationProfile()?.data?.givenName)
            assertFalse(vm.state.value.dirty)
            vm.edit { it.copy(givenName = "Discard me") }
            vm.reload()
            advanceUntilIdle()
            assertEquals("Updated", vm.state.value.draft.givenName)
            repo.close()
        }

    @Test
    fun failedProfileSavePreservesAuthoredDataAndRevision() =
        runTest(dispatcher) {
            val controls = FakeControls()
            val repo = FakeRepositories(controls, coroutineScope = backgroundScope)
            val vm = own(ProfileViewModel(repo.account))
            advanceUntilIdle()
            val revision = vm.state.value.record?.revision
            vm.edit { it.copy(givenName = "Keep me") }
            controls.set("saveApplicationProfile", FakeMode.Error())
            vm.save()
            advanceUntilIdle()
            assertTrue(vm.state.value.error)
            assertTrue(vm.state.value.dirty)
            assertEquals("Keep me", vm.state.value.draft.givenName)
            assertEquals(revision, vm.state.value.record?.revision)
            repo.close()
        }

    @Test
    fun invalidSalaryAndEmailCannotSave() {
        assertFalse(validProfile(ProfileData(email = JsonPrimitive("broken"))))
        assertFalse(validProfile(ProfileData(requestedSalary = Salary(amount = 70000.0))))
        assertFalse(
            validProfile(
                ProfileData(
                    requestedSalary =
                        Salary(
                            amount = Double.NaN,
                            currency = "EUR",
                            period = CreateCareerOfferRequestPeriod.Year,
                        )
                )
            )
        )
        assertTrue(
            validProfile(
                ProfileData(
                    email = JsonPrimitive("alex@example.invalid"),
                    requestedSalary = Salary(70000.0, "EUR", CreateCareerOfferRequestPeriod.Year),
                )
            )
        )
    }

    @Test
    fun destinationChangeNeverReusesSavedKey() =
        runTest(dispatcher) {
            val repo = FakeRepositories(coroutineScope = backgroundScope)
            val item = repo.ai.listAiProviders().first()
            assertEquals(
                "recipient",
                providerProblem(
                    ProviderState(
                        original = item,
                        provider = item.provider,
                        label = item.label,
                        model = item.model,
                        baseURL = "https://other.example.invalid/v1",
                    )
                ),
            )
            repo.close()
        }

    @Test
    fun managedProviderCannotEditOrDelete() =
        runTest(dispatcher) {
            val repo = FakeRepositories(coroutineScope = backgroundScope)
            val item = repo.ai.listAiProviders().first().copy(managed = true)
            var deleted = false
            val ai =
                object : AiRepository by repo.ai {
                    override suspend fun listAiProviders(
                        limit: Long?,
                        offset: Long?,
                        options: me.rxresu.core.network.RequestOptions,
                    ) = listOf(item)

                    override suspend fun deleteAiProvider(
                        id: String,
                        options: me.rxresu.core.network.RequestOptions,
                    ) {
                        deleted = true
                    }
                }
            val vm = own(ProviderViewModel(ai, item.id))
            advanceUntilIdle()
            vm.edit { it.copy(key = "new-key") }
            vm.delete()
            advanceUntilIdle()
            assertEquals("", vm.state.value.key)
            assertFalse(deleted)
            repo.close()
        }

    @Test
    fun failedTestCannotBecomeDefault() =
        runTest(dispatcher) {
            val repo = FakeRepositories(coroutineScope = backgroundScope)
            val item =
                repo.ai.listAiProviders().first().copy(testStatus = "failure", isDefault = false)
            var defaulted = false
            val ai =
                object : AiRepository by repo.ai {
                    override suspend fun listAiProviders(
                        limit: Long?,
                        offset: Long?,
                        options: me.rxresu.core.network.RequestOptions,
                    ) = listOf(item)

                    override suspend fun setDefaultAiProvider(
                        id: String,
                        options: me.rxresu.core.network.RequestOptions,
                    ): TestAiProviderResponse {
                        defaulted = true
                        return item
                    }
                }
            val vm = own(ProviderViewModel(ai, item.id))
            advanceUntilIdle()
            vm.makeDefault()
            advanceUntilIdle()
            assertFalse(defaulted)
            repo.close()
        }

    @Test
    fun missingKeyAndMalformedUrlBlocked() {
        val s = ProviderState(label = "Work", model = "model")
        assertEquals("key", providerProblem(s))
        assertEquals("url", providerProblem(s.copy(baseURL = "file:///private", key = "key")))
        assertEquals(
            "url",
            providerProblem(s.copy(baseURL = "https://user:password@example.invalid", key = "key")),
        )
        assertEquals("model", providerProblem(s.copy(model = "", key = "key")))
    }

    @Test
    fun providerSaveClearsSecretAndKeepsSavedModel() =
        runTest(dispatcher) {
            val repo = FakeRepositories(coroutineScope = backgroundScope)
            val item = repo.ai.listAiProviders().first()
            val vm = own(ProviderViewModel(repo.ai, item.id))
            advanceUntilIdle()
            vm.edit { it.copy(key = "test-key", model = "custom-model") }
            vm.save()
            advanceUntilIdle()
            assertEquals("", vm.state.value.key)
            assertEquals("custom-model", vm.state.value.original?.model)
            assertTrue(vm.state.value.finished)
            repo.close()
        }

    @Test
    fun failedInitialProfileLoadCannotCreateReplacement() =
        runTest(dispatcher) {
            val controls = FakeControls()
            controls.set("getApplicationProfile", FakeMode.Error())
            val repo = FakeRepositories(controls, coroutineScope = backgroundScope)
            var writes = 0
            val account =
                object : AccountRepository by repo.account {
                    override suspend fun saveApplicationProfile(
                        body: SaveApplicationProfileRequest,
                        options: me.rxresu.core.network.RequestOptions,
                    ): ApplicationProfile {
                        writes++
                        return repo.account.saveApplicationProfile(body, options)
                    }
                }
            val vm = own(ProfileViewModel(account))
            advanceUntilIdle()
            vm.edit { it.copy(givenName = "No overwrite") }
            vm.save()
            advanceUntilIdle()
            assertTrue(vm.state.value.loadFailed)
            assertEquals(0, writes)
            repo.close()
        }

    @Test
    fun newProviderRequiresExplicitTestStepBeforeFinish() =
        runTest(dispatcher) {
            val repo = FakeRepositories(coroutineScope = backgroundScope)
            var creations = 0
            val ai =
                object : AiRepository by repo.ai {
                    override suspend fun createAiProvider(
                        body: CreateAiProviderRequest,
                        options: me.rxresu.core.network.RequestOptions,
                    ): TestAiProviderResponse {
                        creations++
                        return repo.ai.createAiProvider(body, options)
                    }
                }
            val vm = own(ProviderViewModel(ai, null))
            vm.edit { it.copy(label = "New", key = "test-key") }
            vm.save()
            advanceUntilIdle()
            assertEquals(0, creations)
            assertFalse(vm.state.value.finished)
            repo.close()
        }

    @Test
    fun newProviderCanFinishOnlyAfterCurrentSettingsPassTest() =
        runTest(dispatcher) {
            val repo = FakeRepositories(coroutineScope = backgroundScope)
            val ai =
                object : AiRepository by repo.ai {
                    override suspend fun testAiProvider(
                        id: String,
                        options: me.rxresu.core.network.RequestOptions,
                    ) =
                        repo.ai
                            .testAiProvider(id, options)
                            .copy(testStatus = "success", enabled = true)
                }
            val vm = own(ProviderViewModel(ai, null))
            vm.edit { it.copy(label = "New", key = "test-key") }
            vm.test()
            advanceUntilIdle()
            assertEquals("success", vm.state.value.testStatus)
            assertEquals(1, vm.state.value.testCount)
            assertEquals("", vm.state.value.key)
            vm.edit { it.copy(model = "different-model") }
            vm.save()
            advanceUntilIdle()
            assertFalse(vm.state.value.finished)
            vm.test()
            advanceUntilIdle()
            vm.save()
            advanceUntilIdle()
            assertTrue(vm.state.value.finished)
            repo.close()
        }

    @Test
    fun newestKeySummaryUsesGrantsAndCreationTime() =
        runTest(dispatcher) {
            val repo = FakeRepositories(coroutineScope = backgroundScope)
            val key = repo.account.listApiKeys().apiKeys.first()
            val old =
                key.copy(
                    createdAt = "2026-01-01T00:00:00Z",
                    permissions = mapOf("api" to listOf("read", "write")),
                )
            val recent =
                key.copy(
                    createdAt = "2026-02-01T00:00:00Z",
                    permissions = mapOf("api" to listOf("read")),
                )
            assertTrue(newestKeyReadOnly(listOf(recent, old)))
            assertFalse(newestKeyReadOnly(listOf(recent.copy(permissions = null), old)))
            assertFalse(newestKeyReadOnly(emptyList()))
            repo.close()
        }
}
