package me.rxresu.feature.auth

import androidx.compose.runtime.CompositionLocalProvider
import kotlinx.coroutines.runBlocking
import me.rxresu.core.auth.*
import me.rxresu.core.data.*
import me.rxresu.core.testing.*
import org.junit.Test
import org.robolectric.RuntimeEnvironment

class AuthScreenshotTest : RrScreenshotTest() {
    private fun sample() =
        AuthUiState(
            info =
                runBlocking {
                    FakeAuthService(RuntimeEnvironment.getApplication())
                        .checkServer("https://rxresu.me")
                        .copy(
                            providers =
                                linkedMapOf(
                                    "google" to "Google",
                                    "github" to "GitHub",
                                    "apple" to "Apple",
                                )
                        )
                },
            email = "alex@morgan.design",
            password = "0123456789",
        )

    private fun capture(
        id: String,
        dark: Boolean,
        content: @androidx.compose.runtime.Composable () -> Unit,
    ) {
        val repositories = FakeRepositories()
        try {
            captureScreen(
                id,
                dark,
                wrap = {
                    CompositionLocalProvider(LocalRepositories provides repositories) { it() }
                },
                content = content,
            )
        } finally {
            repositories.close()
        }
    }

    @Test fun welcomeLight() = capture("A1-Welcome", false) { WelcomeScreen(AuthUiState()) }

    @Test fun welcomeDark() = capture("A1-Welcome", true) { WelcomeScreen(AuthUiState()) }

    @Test fun signInLight() = capture("A2-SignIn", false) { SignInScreen(sample()) }

    @Test fun signInDark() = capture("A2-SignIn", true) { SignInScreen(sample()) }

    @Test
    fun twoStepLight() = capture("A3-TwoStep", false) { TwoStepScreen(AuthUiState(code = "481")) }

    @Test
    fun twoStepDark() = capture("A3-TwoStep", true) { TwoStepScreen(AuthUiState(code = "481")) }

    private val request =
        ConsentRequest(
            "https://rxresu.me",
            "",
            "rr_cli_7f3a9c21",
            "Claude",
            listOf("api:read", "api:write", "api:delete"),
            "https://claude.ai/callback",
            true,
        )

    @Test
    fun consentLight() =
        capture("A4-Allow", false) {
            ConsentScreen(AuthUiState(consent = request, consentUsername = "alex"))
        }

    @Test
    fun consentDark() =
        capture("A4-Allow", true) {
            ConsentScreen(AuthUiState(consent = request, consentUsername = "alex"))
        }

    @Test
    fun browserConsent() =
        capture("A4-Browser", false) {
            ConsentScreen(AuthUiState(consent = request.copy(canGrantNatively = false)))
        }

    @Test
    fun credentialsError() =
        capture("A2-Error", false) {
            SignInScreen(
                sample()
                    .copy(
                        error =
                            "That email, username or password doesn't match. Check them, or reset your password."
                    )
            )
        }

    @Test
    fun register() =
        capture("A2-Register", false) {
            SignInScreen(sample().copy(name = "Alex Morgan", username = "alex"), register = true)
        }

    @Test
    fun backupCode() =
        capture("A3-Backup", true) { TwoStepScreen(AuthUiState(code = "ABCD-EFGH"), backup = true) }

    @Test fun forgot() = capture("A2-Forgot", false) { ForgotScreen(sample()) }

    @Test fun reset() = capture("A2-Reset", true) { ResetScreen(AuthUiState()) }

    @Test
    fun font200() = captureScreen("A2-SignIn", false, fontScale = 2f) { SignInScreen(sample()) }

    @Test
    fun rtlSignIn() =
        capture("A2-SignIn-RTL", false) {
            CompositionLocalProvider(
                androidx.compose.ui.platform.LocalLayoutDirection provides
                    androidx.compose.ui.unit.LayoutDirection.Rtl
            ) {
                SignInScreen(sample())
            }
        }
}
