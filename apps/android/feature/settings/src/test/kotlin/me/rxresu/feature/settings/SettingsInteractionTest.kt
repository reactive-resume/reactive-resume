package me.rxresu.feature.settings

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
        compose.onNodeWithText("Requested salary").performClick()
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
        compose.onNodeWithText("Address").performScrollTo().performClick()
        compose.onNodeWithContentDescription("Country, ").performScrollTo().performClick()
        compose.onNode(hasSetTextAction() and hasText("Country")).performTextReplacement("Germany")
        compose.onNode(hasText("Germany") and !hasSetTextAction()).performClick()
        compose.runOnIdle { assertEquals("DE", data.address?.countryCode) }
    }
}
