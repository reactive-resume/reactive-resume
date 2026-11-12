package me.rxresu.feature.career

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class CareerMoreTest : RrScreenshotTest() {
    @get:Rule val rule = createComposeRule()

    @Test fun moreKeepsAuxiliaryActionsReachableWithoutRootSearch() {
        val repositories = FakeRepositories()
        val calls = mutableListOf<String>()
        rule.setContent {
            RrTheme(reducedMotion = true) {
                CompositionLocalProvider(LocalRepositories provides repositories) {
                    CareerScreen(CareerState(loading = false), refresh = {}, search = { calls += "search" }, settings = {},
                        coach = {}, thread = {}, knowledge = {}, offers = {}, schedules = { calls += "schedule" },
                        practice = { calls += "practice" }, setupAi = {}, all = { calls += "history" })
                }
            }
        }
        rule.onNodeWithText("Search").assertDoesNotExist()
        rule.onNodeWithText("Conversations").assertDoesNotExist()
        for (label in listOf("New schedule", "Conversations", "Practice without an application")) {
            rule.onNodeWithText("More").performScrollTo().performClick()
            rule.onNodeWithText(label).performClick()
        }
        rule.runOnIdle { assertEquals(listOf("schedule", "history", "practice"), calls) }
        repositories.close()
    }

    @Test fun morningCopyRequiresRealDailyEnabledRecurrence() {
        val repositories = FakeRepositories()
        val row = runBlocking { repositories.career.listCareerSchedules().first { it.kind == "discovery" } }
        val time = CareerTime(java.util.Locale.UK, repositories.time.timezone(), true, repositories.time.now())
        rule.setContent {
            RrTheme {
                CompositionLocalProvider(LocalRepositories provides repositories) {
                    Column {
                        me.rxresu.core.designsystem.RrText(discoveryRootSummary(row, time))
                        me.rxresu.core.designsystem.RrText(discoveryRootSummary(row.copy(intervalDays = 3), time))
                        me.rxresu.core.designsystem.RrText(discoveryRootSummary(row.copy(enabled = false), time))
                    }
                }
            }
        }
        rule.onNodeWithText("Finds new roles every morning at 07:00").assertExists()
        rule.onNodeWithText("Every 3 days at 07:00", substring = true).assertExists()
        rule.onNodeWithText("Paused", substring = true).assertExists()
        repositories.close()
    }
}
