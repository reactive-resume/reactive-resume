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
                    account =
                        repositories.account
                            .getProfile()
                            .copy(
                                locale =
                                    ImportResumeFileLocale.entries.first { it.wireValue == "en-GB" }
                            ),
                    providers =
                        repositories.ai.listAiProviders().map {
                            it.copy(
                                testStatus = if (it.isDefault) "success" else "failure",
                                testErrorKind = if (it.isDefault) null else "auth",
                            )
                        },
                    preferences =
                        AppPreferences(
                            notifications =
                                setOf(
                                    NotificationCategory.InterviewsAndBriefings,
                                    NotificationCategory.FollowUpsAndOfferDeadlines,
                                    NotificationCategory.NewRoles,
                                )
                        ),
                    loading = false,
                    providersLoading = false,
                    security =
                        AccountSecurityInfo.Available(
                            true,
                            8,
                            listOf("this phone"),
                            listOf("GitHub"),
                            3,
                        ),
                    passwordChangedMonthsAgo = 3,
                    career =
                        repositories.career
                            .getCareerProfile()
                            .copy(
                                minBase =
                                    repositories.career
                                        .getCareerProfile()
                                        .minBase
                                        .copy(amount = 65000.0)
                            ),
                    web = repositories.ai.getWebAccessStatus().copy(configured = false),
                    memory = SaveCareerProfileRequestMemoryMode.Ask,
                    apiKeys =
                        repositories.account.listApiKeys().apiKeys.mapIndexed { i, key ->
                            key.copy(
                                permissions =
                                    mapOf(
                                        "api" to
                                            if (i == 0) listOf("read")
                                            else listOf("read", "write", "delete")
                                    )
                            )
                        },
                    connections =
                        repositories.account.listConnectedApplications().connections.let { apps ->
                            if (id == "S2-Account")
                                listOf(
                                    apps.first().copy(clientName = "Claude"),
                                    apps
                                        .first()
                                        .copy(
                                            id = "storyboard-second-client",
                                            clientName = "Other client",
                                        ),
                                )
                            else apps
                        },
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
                        draft =
                            (profile?.data ?: ProfileData()).copy(
                                address =
                                    (profile?.data?.address ?: Address()).copy(
                                        city = "Lisbon, Portugal"
                                    ),
                                links =
                                    listOf(
                                        ProfileLink(
                                            "LinkedIn",
                                            "https://linkedin.com/in/alexmorgan",
                                        )
                                    ),
                                requestedSalary =
                                    Salary(65000.0, "EUR", CreateCareerOfferRequestPeriod.Year),
                            ),
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

    @Test
    fun profileLight() =
        capture("S4-Profile", false) { state, s -> ProfileScreen(s, career = state.career) }

    @Test
    fun profileDark() =
        capture("S4-Profile", true) { state, s -> ProfileScreen(s, career = state.career) }

    @Test fun aiLight() = capture("S5-AI", false) { s, _ -> AiScreen(s) }

    @Test fun aiDark() = capture("S5-AI", true) { s, _ -> AiScreen(s) }

    private fun provider(): ProviderState {
        val repositories = FakeRepositories()
        return try {
            val original =
                runBlocking { repositories.ai.listAiProviders().first() }
                    .copy(apiKeyPreview = "sk-•••••••••••••4f2a", baseURL = "")
            ProviderState(
                isNew = true,
                original = original,
                provider = original.provider,
                label = original.label,
                model = original.model,
                baseURL = "",
                testStatus = "success",
            )
        } finally {
            repositories.close()
        }
    }

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

    @Test
    fun profileDetailsLight() =
        capture("S4-ProfileDetails", false) { _, state -> ProfileDetailsScreen(state) }

    @Test
    fun profileDetailsDark() =
        capture("S4-ProfileDetails", true) { _, state -> ProfileDetailsScreen(state) }

    @Test
    fun preferencesRtl() =
        capture("S3-Preferences-RTL", false) { state, _ ->
            CompositionLocalProvider(
                androidx.compose.ui.platform.LocalLayoutDirection provides
                    androidx.compose.ui.unit.LayoutDirection.Rtl
            ) {
                PreferencesScreen(state)
            }
        }
}
