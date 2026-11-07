package me.rxresu.feature.auth

import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.*
import me.rxresu.core.auth.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class AuthViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun fake() = FakeAuthService(ApplicationProvider.getApplicationContext())

    @Test
    fun checkedOriginSurvivesSignInAndTwoStep() =
        runTest(dispatcher) {
            val base = fake().apply { nextResult = AuthResult.TwoStepRequired }
            var seen = ""
            val auth =
                object : AuthService by base {
                    override suspend fun signInWithPassword(
                        server: String,
                        identifier: String,
                        password: String,
                    ): AuthResult {
                        seen = server
                        return base.signInWithPassword(server, identifier, password)
                    }
                }
            val vm = AuthViewModel(auth)
            vm.edit {
                it.copy(
                    server = "https://self.example.invalid",
                    email = "alex",
                    password = "secret",
                )
            }
            vm.checkServer(true)
            advanceUntilIdle()
            assertEquals(AuthEvent.SignIn, vm.events.first())
            vm.submit(false)
            advanceUntilIdle()
            assertEquals("https://self.example.invalid", seen)
            assertEquals(AuthEvent.TwoStep, vm.events.first())
            assertEquals("", vm.state.value.password)
        }

    @Test
    fun failedServerCannotContinue() =
        runTest(dispatcher) {
            val vm =
                AuthViewModel(
                    object : AuthService by fake() {
                        override suspend fun checkServer(input: String): ServerInfo =
                            throw java.io.IOException()
                    }
                )
            vm.checkServer(true)
            advanceUntilIdle()
            assertEquals(AuthViewModel.ERROR_SERVER, vm.state.value.error)
            assertFalse(vm.state.value.busy)
        }

    @Test
    fun wrongCodeClearsInputAndRetainsError() =
        runTest(dispatcher) {
            val vm =
                AuthViewModel(
                    fake().apply {
                        nextResult =
                            AuthResult.Error(
                                "INVALID_OTP",
                                "That code doesn't match. Check it and try again.",
                            )
                    }
                )
            vm.edit { it.copy(code = "123456") }
            vm.verify(false)
            advanceUntilIdle()
            assertEquals("", vm.state.value.code)
            assertNotNull(vm.state.value.error)
        }

    @Test
    fun incompleteCodeNeverVerifies() =
        runTest(dispatcher) {
            val auth = fake()
            val vm = AuthViewModel(auth)
            vm.edit { it.copy(code = "123") }
            vm.verify(false)
            advanceUntilIdle()
            assertEquals(SessionState.SignedOut, auth.state.value)
        }

    @Test
    fun resetRequiresFreshSignInAndClearsPassword() =
        runTest(dispatcher) {
            val auth = fake()
            val vm = AuthViewModel(auth)
            vm.edit { it.copy(password = "new-password") }
            vm.reset("test-token")
            advanceUntilIdle()
            assertEquals(AuthEvent.PasswordReset, vm.events.first())
            assertEquals(SessionState.SignedOut, auth.state.value)
            assertEquals("", vm.state.value.password)
        }

    @Test
    fun cancelPreventsLateServerNavigation() =
        runTest(dispatcher) {
            var completed = false
            val vm =
                AuthViewModel(
                    object : AuthService by fake() {
                        override suspend fun checkServer(input: String): ServerInfo {
                            delay(1000)
                            completed = true
                            return fake().checkServer(input)
                        }
                    }
                )
            vm.checkServer(true)
            runCurrent()
            vm.cancel()
            advanceUntilIdle()
            assertFalse(completed)
            assertFalse(vm.state.value.busy)
        }

    @Test
    fun forgotSuccessDoesNotSignIn() =
        runTest(dispatcher) {
            val auth = fake()
            val vm = AuthViewModel(auth)
            vm.edit { it.copy(email = "alex@example.invalid") }
            vm.forgot()
            advanceUntilIdle()
            assertTrue(vm.state.value.sent)
            assertEquals(SessionState.SignedOut, auth.state.value)
        }

    @Test
    fun expiredTwoStepReturnsToSignIn() =
        runTest(dispatcher) {
            val vm =
                AuthViewModel(
                    fake().apply {
                        nextResult =
                            AuthResult.Error(
                                "INVALID_TWO_FACTOR_COOKIE",
                                "This sign-in step expired. Sign in again.",
                            )
                    }
                )
            vm.edit { it.copy(code = "123456") }
            vm.verify(false)
            advanceUntilIdle()
            assertEquals(AuthEvent.SignInExpired, vm.events.first())
            assertEquals("", vm.state.value.code)
        }

    @Test
    fun cancelClearsAccountFieldsAsWellAsCredentials() =
        runTest(dispatcher) {
            val vm = AuthViewModel(fake())
            vm.edit {
                it.copy(
                    name = "Alex",
                    username = "alex",
                    email = "alex@example.invalid",
                    password = "secret",
                    code = "123456",
                )
            }
            vm.cancel()
            advanceUntilIdle()
            assertEquals("", vm.state.value.email)
            assertEquals("", vm.state.value.name)
            assertEquals("", vm.state.value.username)
            assertEquals("", vm.state.value.password)
        }

    @Test
    fun failedCancellationStillWipesCredentials() =
        runTest(dispatcher) {
            val vm =
                AuthViewModel(
                    object : AuthService by fake() {
                        override suspend fun cancelSignIn() {
                            throw java.io.IOException()
                        }
                    }
                )
            vm.edit {
                it.copy(email = "alex@example.invalid", password = "secret", code = "123456")
            }
            vm.cancel()
            advanceUntilIdle()
            assertEquals("", vm.state.value.password)
            assertEquals("", vm.state.value.email)
            assertEquals("", vm.state.value.code)
            assertNotNull(vm.state.value.error)
        }
}
