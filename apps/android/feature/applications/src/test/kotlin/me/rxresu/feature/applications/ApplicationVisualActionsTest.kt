package me.rxresu.feature.applications

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.navigation.ApplicationsView
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class ApplicationVisualActionsTest : RrScreenshotTest() {
    @get:Rule val compose = createComposeRule()

    @Test fun stagePreviewExpandsToEveryRealRowAndCollapsesWithoutChangingStoredData() {
        val repos = applicationStoryboard()
        val storedIds = runBlocking { repos.applications.listApplications().map { it.id } }
        compose.setContent {
            RrTheme(reducedMotion = true) {
                fakeWrap(repos).invoke { ApplicationsRoute(ApplicationsView.List, rememberNavController()) }
            }
        }
        compose.onNodeWithText("Northwind Labs").assertDoesNotExist()
        compose.onNodeWithText("Harbour Studio").assertDoesNotExist()
        assertEquals("Collapsed", compose.onNodeWithText("Applied").fetchSemanticsNode().config[SemanticsProperties.StateDescription])
        compose.onNodeWithText("Applied").performClick()
        compose.onNodeWithText("Northwind Labs").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Harbour Studio").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Applied").performScrollTo()
        assertEquals("Expanded", compose.onNodeWithText("Applied").fetchSemanticsNode().config[SemanticsProperties.StateDescription])
        compose.onNodeWithText("Applied").performClick()
        compose.onNodeWithText("Northwind Labs").assertDoesNotExist()
        compose.onNodeWithText("Harbour Studio").assertDoesNotExist()
        compose.onNodeWithText("Closed · 6").performScrollTo().assertIsDisplayed()
        compose.runOnIdle { assertEquals(storedIds, runBlocking { repos.applications.listApplications().map { it.id } }) }
        repos.close()
    }

    @Test fun closedRowOpensItsOwnList() {
        val repos = FakeRepositories()
        compose.setContent {
            RrTheme(reducedMotion = true) {
                fakeWrap(repos).invoke { ApplicationsRoute(ApplicationsView.List, rememberNavController()) }
            }
        }
        val closedCount = runBlocking { repos.applications.listApplications().count { it.status == ApplicationStage.Closed } }
        compose.onNodeWithText("Closed · $closedCount").performScrollTo().performClick()
        compose.onAllNodesWithText("Northwind Labs")[0].performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Interviewing").assertDoesNotExist()
        repos.close()
    }

    @Test fun closedBoardMarkShowsTheClosedLane() {
        val repos = FakeRepositories()
        compose.setContent {
            RrTheme(reducedMotion = true) {
                fakeWrap(repos).invoke { ApplicationsRoute(ApplicationsView.Board, rememberNavController()) }
            }
        }
        compose.onNodeWithContentDescription("Page 6 of 6").performClick()
        compose.onAllNodesWithText("Northwind Labs")[0].assertIsDisplayed()
        repos.close()
    }

    @Test fun closedDetailShowsReasonAndReopensStoredApplication() {
        val repos = FakeRepositories()
        val id = "application-closed-0"
        val previousStage = runBlocking { stageBeforeClosed(repos.applications.getApplication(id)) }
        compose.setContent {
            RrTheme(reducedMotion = true) {
                fakeWrap(repos).invoke { ApplicationRoute(id, rememberNavController()) }
            }
        }
        compose.onNode(hasText("Closed ·", substring = true) and hasText("Not selected", substring = true)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Reopen").performClick()
        compose.runOnIdle {
            assertEquals(previousStage, runBlocking { repos.applications.getApplication(id) }.status)
        }
        repos.close()
    }
}
