package me.rxresu.feature.settings

import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import me.rxresu.core.designsystem.RrTheme
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w390dp-h844dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SettingsInteractionTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun headerSwipeDismissesModal() {
        var closed = false
        compose.setContent {
            RrTheme {
                SettingsScreen(
                    SettingsState(loading = false),
                    "https://rxresu.me",
                    "1.0 (1)",
                    close = { closed = true },
                )
            }
        }
        compose.onNodeWithContentDescription("Close settings").performTouchInput {
            swipe(center, center + Offset(0f, 300f), 300)
        }
        compose.runOnIdle { assertTrue(closed) }
    }

    @Test
    fun closeButtonProvidesAlternativeToSwipe() {
        var closed = false
        compose.setContent {
            RrTheme {
                SettingsScreen(
                    SettingsState(loading = false),
                    "https://rxresu.me",
                    "1.0 (1)",
                    close = { closed = true },
                )
            }
        }
        compose.onNodeWithContentDescription("Close settings").performClick()
        compose.runOnIdle { assertTrue(closed) }
    }

    @Test
    fun timezonePickerSearchesAndReturnsChosenZone() {
        var timezone: String? = null
        compose.setContent {
            RrTheme(reducedMotion = true) {
                PreferencesScreen(
                    SettingsState(loading = false),
                    update = { timezone = it.timezone },
                )
            }
        }
        compose.onNodeWithText("Language").performClick()
        compose.onNodeWithText("Timezone").performClick()
        compose.onNode(hasSetTextAction()).performTextReplacement("Lisbon")
        compose.onNodeWithText("Europe/Lisbon").performClick()
        compose.runOnIdle { assertEquals("Europe/Lisbon", timezone) }
    }

    @Test
    fun emptySalaryPeriodRequiresExplicitChoice() {
        var data = ProfileData(requestedSalary = Salary())
        compose.setContent {
            RrTheme(reducedMotion = true) {
                ProfileScreen(
                    ProfileState(draft = data, loading = false),
                    edit = { change -> data = change(data) },
                )
            }
        }
        compose.onNodeWithContentDescription("Full name, ").performClick()
        compose.onNodeWithText("Requested salary").performScrollTo().performClick()
        compose.onNodeWithContentDescription("Pay period, ").performClick()
        compose.onNodeWithText("Hour").performClick()
        compose.runOnIdle {
            assertEquals(
                me.rxresu.core.network.generated.CreateCareerOfferRequestPeriod.Hour,
                data.requestedSalary?.period,
            )
        }
    }

    @Test
    fun invalidSalaryOpensAndFocusesAmountAt200PercentWithReducedMotion() {
        org.robolectric.RuntimeEnvironment.setFontScale(2f)
        try {
            compose.setContent {
                RrTheme(reducedMotion = true) {
                    ProfileScreen(
                        ProfileState(
                            draft = ProfileData(requestedSalary = Salary(amount = -1.0)),
                            loading = false,
                            invalid = true,
                        )
                    )
                }
            }
            compose
                .onNode(hasSetTextAction() and hasContentDescription("Amount"))
                .assertIsDisplayed()
                .assertIsFocused()
            compose
                .onAllNodes(
                    SemanticsMatcher.keyIsDefined(
                        androidx.compose.ui.semantics.SemanticsProperties.Error
                    )
                )
                .assertCountEquals(1)
        } finally {
            org.robolectric.RuntimeEnvironment.setFontScale(1f)
        }
    }

    @Test
    fun invalidReferenceOpensExactRowInsteadOfContactFields() {
        compose.setContent {
            RrTheme(reducedMotion = true) {
                ProfileScreen(
                    ProfileState(
                        draft =
                            ProfileData(
                                references =
                                    listOf(
                                        ProfileReference(
                                            "Company",
                                            kotlinx.serialization.json.JsonPrimitive("bad email"),
                                            "A mentor",
                                            "Lee",
                                            "",
                                        )
                                    )
                            ),
                        loading = false,
                        invalid = true,
                    )
                )
            }
        }
        compose
            .onNode(hasSetTextAction() and hasContentDescription("Email"))
            .assertIsDisplayed()
            .assertIsFocused()
    }

    @Test
    fun addressCountryPickerReturnsChosenCountry() {
        var data = ProfileData()
        compose.setContent {
            RrTheme(reducedMotion = true) {
                ProfileScreen(
                    ProfileState(draft = data, loading = false),
                    edit = { change -> data = change(data) },
                )
            }
        }
        compose.onNodeWithContentDescription("Full name, ").performClick()
        compose.onNodeWithText("Address").performScrollTo().performClick()
        compose.onNodeWithContentDescription("Country, ").performScrollTo().performClick()
        compose.onNode(hasSetTextAction() and hasText("Country")).performTextReplacement("Germany")
        compose.onNode(hasText("Germany") and !hasSetTextAction()).performClick()
        compose.runOnIdle { assertEquals("DE", data.address?.countryCode) }
    }

    @Test
    fun profileAutosaveDebouncesEditsAndKeepsFailureVisible() {
        val record =
            me.rxresu.core.network.generated.ApplicationProfile(
                ProfileData(
                    email = kotlinx.serialization.json.JsonPrimitive("old@example.invalid")
                ),
                "2026-11-07T09:00:00Z",
                "reviewed-revision",
            )
        var state by
            androidx.compose.runtime.mutableStateOf(
                ProfileState(record = record, draft = record.data, loading = false)
            )
        var saves = 0
        compose.mainClock.autoAdvance = false
        compose.setContent {
            RrTheme(reducedMotion = true) {
                ProfileScreen(
                    state,
                    edit = { change -> state = state.copy(draft = change(state.draft)) },
                    save = {
                        saves++
                        state = state.copy(error = true)
                    },
                )
            }
        }
        compose
            .onNode(hasSetTextAction() and hasContentDescription("Email"))
            .performTextReplacement("new@example.invalid")
        compose.mainClock.advanceTimeBy(400)
        compose.runOnIdle { assertEquals(0, saves) }
        compose.mainClock.advanceTimeBy(200)
        compose.runOnIdle {
            assertEquals(1, saves)
            assertEquals("new@example.invalid", emailText(state.draft.email))
        }
        compose.mainClock.advanceTimeBy(2000)
        compose.runOnIdle { assertEquals(1, saves) }
    }

    @Test
    fun pendingDraftsRequireSignOutConfirmation() {
        var signOuts = 0
        compose.setContent {
            RrTheme(reducedMotion = true) {
                SettingsScreen(
                    SettingsState(loading = false, pendingEdits = true),
                    "https://rxresu.me",
                    "6.1.0",
                    signOut = { signOuts++ },
                )
            }
        }
        compose.onNodeWithText("Sign out").performScrollTo().performClick()
        compose.onNodeWithText("Sign out of rxresu.me?").assertIsDisplayed()
        compose.runOnIdle { assertEquals(0, signOuts) }
        compose.onAllNodesWithText("Sign out").onLast().performClick()
        compose.runOnIdle { assertEquals(1, signOuts) }
    }
}
