package me.rxresu.feature.settings

import androidx.lifecycle.ViewModelStore
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import me.rxresu.core.auth.*
import me.rxresu.core.data.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class AccountSettingsViewModelTest {
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

    private suspend fun auth() =
        FakeAuthService(RuntimeEnvironment.getApplication()).also {
            it.signInWithPassword("https://rxresu.me", "alex", "test-password")
        }

    @Test
    fun preferencesSaveThroughRepositoryAndRefreshState() =
        runTest(dispatcher) {
            val auth = auth()
            val repo = FakeRepositories(authSession = auth, coroutineScope = backgroundScope)
            val vm = SettingsViewModel(repo, auth)
            store.put("vm", vm)
            advanceUntilIdle()
            vm.preference {
                setTheme(ThemePreference.Dark)
                setHaptics(false)
                setReducedMotion(true)
                setNotification(NotificationCategory.NewRoles, true)
            }
            advanceUntilIdle()
            assertEquals(ThemePreference.Dark, vm.state.value.preferences.theme)
            assertFalse(vm.state.value.preferences.haptics)
            assertEquals(true, vm.state.value.preferences.reducedMotion)
            assertTrue(NotificationCategory.NewRoles in vm.state.value.preferences.notifications)
            repo.close()
        }

    @Test
    fun photoUploadAndExplicitNullRemovalReachAccountProfile() =
        runTest(dispatcher) {
            val auth = auth()
            val repo = FakeRepositories(authSession = auth, coroutineScope = backgroundScope)
            val vm = SettingsViewModel(repo, auth)
            store.put("vm", vm)
            advanceUntilIdle()
            var saves = 0
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
                vm.accountSaved.collect { saves++ }
            }
            vm.uploadPhoto(byteArrayOf(1, 2, 3), "image/png")
            advanceUntilIdle()
            assertFalse(vm.state.value.error)
            assertNotNull(repo.account.getProfile().image)
            vm.removePhoto()
            advanceUntilIdle()
            assertNull(repo.account.getProfile().image)
            assertEquals(2, saves)
            repo.close()
        }

    @Test
    fun accountExportCannotFinishAfterSignOut() =
        runTest(dispatcher) {
            val auth = auth()
            val controls = FakeControls()
            val repo =
                FakeRepositories(controls, authSession = auth, coroutineScope = backgroundScope)
            val vm = SettingsViewModel(repo, auth)
            store.put("vm", vm)
            advanceUntilIdle()
            var delivered = false
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
                vm.exports.collect { delivered = true }
            }
            controls.set("exportAccountData", FakeMode.Loading)
            vm.exportAccount()
            runCurrent()
            auth.signOut()
            controls.set("exportAccountData", FakeMode.Ready)
            advanceUntilIdle()
            assertFalse(delivered)
            repo.close()
        }

    @Test
    fun cleanupFailureStillReportsAfterViewModelIsRemoved() =
        runTest(dispatcher) {
            val base = auth()
            val auth =
                object : AuthService by base {
                    override suspend fun signOut() {
                        delay(1000)
                        base.signOut()
                        throw java.io.IOException("cleanup")
                    }
                }
            val repo = FakeRepositories(authSession = auth, coroutineScope = backgroundScope)
            val vm = SettingsViewModel(repo, auth)
            store.put("vm", vm)
            advanceUntilIdle()
            var partial: Boolean? = null
            vm.signOut { partial = it }
            runCurrent()
            store.clear()
            advanceUntilIdle()
            assertEquals(SessionState.SignedOut, auth.state.value)
            assertEquals(true, partial)
            repo.close()
        }
}
