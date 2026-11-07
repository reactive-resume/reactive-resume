package me.rxresu.feature.settings

import androidx.compose.runtime.CompositionLocalProvider
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.*
import me.rxresu.core.network.generated.*
import me.rxresu.core.testing.*
import org.junit.Test

class SettingsScreenshotTest : RrScreenshotTest() {
    private fun capture(
        id: String,
        dark: Boolean,
        content: @androidx.compose.runtime.Composable (SettingsState, ProfileState) -> Unit,
    ) {
        val repositories = FakeRepositories()
        try {
            val s = runBlocking {
                SettingsState(
                    account = repositories.account.getProfile(),
                    providers =
                        repositories.ai.listAiProviders().map {
                            it.copy(testStatus = if (it.isDefault) "success" else "failure")
                        },
                    preferences =
                        AppPreferences(
                            notifications =
                                setOf(
                                    NotificationCategory.InterviewsAndBriefings,
                                    NotificationCategory.FollowUpsAndOfferDeadlines,
                                    NotificationCategory.FeedbackComments,
                                )
                        ),
                    loading = false,
                    providersLoading = false,
                    security = repositories.account.securityInfo(),
                    serverVersion = "6.1.0",
                )
            }
            val profile = runBlocking { repositories.account.getApplicationProfile() }
            captureScreen(
                id,
                dark,
                wrap = {
                    CompositionLocalProvider(LocalRepositories provides repositories) { it() }
                },
            ) {
                content(
                    s,
                    ProfileState(
                        record = profile,
                        draft = profile?.data ?: ProfileData(),
                        loading = false,
                    ),
                )
            }
        } finally {
            repositories.close()
        }
    }

    @Test
    fun rootLight() =
        capture("S1-Settings", false) { s, _ -> SettingsScreen(s, "https://rxresu.me", "1.0 (1)") }

    @Test
    fun rootDark() =
        capture("S1-Settings", true) { s, _ -> SettingsScreen(s, "https://rxresu.me", "1.0 (1)") }

    @Test
    fun accountLight() =
        capture("S2-Account", false) { s, _ -> AccountScreen(s, "https://rxresu.me") }

    @Test
    fun accountDark() =
        capture("S2-Account", true) { s, _ -> AccountScreen(s, "https://rxresu.me") }

    @Test fun preferencesLight() = capture("S3-Preferences", false) { s, _ -> PreferencesScreen(s) }

    @Test fun preferencesDark() = capture("S3-Preferences", true) { s, _ -> PreferencesScreen(s) }

    @Test fun profileLight() = capture("S4-Profile", false) { _, s -> ProfileScreen(s) }

    @Test fun profileDark() = capture("S4-Profile", true) { _, s -> ProfileScreen(s) }

    @Test fun aiLight() = capture("S5-AI", false) { s, _ -> AiScreen(s) }

    @Test fun aiDark() = capture("S5-AI", true) { s, _ -> AiScreen(s) }

    private fun provider() =
        ProviderState(
            provider = CreateAiProviderRequestProvider.Anthropic,
            label = "Personal Claude",
            key = "test-key-not-a-secret",
            model = "claude-haiku-5-5",
            baseURL = "https://api.anthropic.com/v1",
        )

    @Test fun providerLight() = capture("S6-Provider", false) { _, _ -> ProviderScreen(provider()) }

    @Test fun providerDark() = capture("S6-Provider", true) { _, _ -> ProviderScreen(provider()) }

    @Test fun loading() = capture("S5-Loading", false) { _, _ -> AiScreen(SettingsState()) }

    @Test
    fun offline() =
        capture("S1-Offline", true) { s, _ ->
            SettingsScreen(s.copy(offline = true, error = true), "https://rxresu.me", "1.0 (1)")
        }

    @Test
    fun providerError() =
        capture("S6-Error", false) { _, _ ->
            ProviderScreen(provider().copy(testStatus = "failure", testErrorKind = "auth"))
        }

    @Test
    fun font200() =
        captureScreen("S3-Preferences", false, fontScale = 2f) {
            PreferencesScreen(SettingsState(loading = false))
        }
}
