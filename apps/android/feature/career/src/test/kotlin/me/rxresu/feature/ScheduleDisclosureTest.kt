package me.rxresu.feature.career

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.network.generated.SaveCareerScheduleRequest
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ScheduleDisclosureTest : RrScreenshotTest() {
    @get:Rule val rule = createComposeRule()

    @Test fun discoveryShowsSearchDisclosureBeforeSavingEnabledSchedule() {
        val repositories = FakeRepositories()
        val state = runBlocking {
            ScheduleState(loading = false, available = true, profile = repositories.career.getCareerProfile(),
                web = repositories.ai.getWebAccessStatus().copy(search = true))
        }
        val today = repositories.time.today()
        val zone = repositories.time.timezone()
        val saved = mutableListOf<SaveCareerScheduleRequest>()
        rule.setContent {
            RrTheme(reducedMotion = true) {
                CompositionLocalProvider(LocalRepositories provides repositories) {
                    Box(Modifier.fillMaxSize()) { ScheduleScreen(state, today, zone, {}, {}, { saved += it }, {}) }
                }
            }
        }
        rule.onNodeWithText("Save").performClick()
        rule.runOnIdle { assertTrue(saved.isEmpty()) }
        rule.onNodeWithText("The search service may charge.", substring = true).assertExists()
        rule.onNodeWithText("Cancel").performClick()
        rule.runOnIdle { assertTrue(saved.isEmpty()) }
        rule.onNodeWithText("Save").performClick()
        rule.onAllNodesWithText("Save").onLast().performClick()
        rule.runOnIdle { assertEquals(1, saved.size); assertEquals(true, saved.single().enabled) }
        repositories.close()
    }
}
