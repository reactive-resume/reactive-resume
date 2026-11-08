package me.rxresu.feature.documents

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class CopyForJobDraftTest : RrScreenshotTest() {
    @get:Rule val compose = createComposeRule()

    @Test fun dirtyStepBackKeepsWordsAndFailedCopyCanRetry() {
        val repos = FakeRepositories()
        val state = runBlocking { DocumentActionsUiState(library = repos.documents.listDocuments(), applications = listOf(repos.applications.getApplication(me.rxresu.core.data.StoryboardIds.lumen))) }
        var copies = 0
        compose.setContent { RrTheme {
            NewDocumentSheet(state, NewDocumentCallbacks(onCopyForJob = { _, _, _ -> copies++ }), initialStep = NewStep.CopyForJob)
        } }
        compose.onNodeWithText("Add a job").performScrollTo().performClick()
        compose.onAllNodes(hasSetTextAction())[0].performTextInput("New company")
        compose.onAllNodes(hasSetTextAction())[1].performTextInput("New role")
        compose.onAllNodes(hasSetTextAction())[2].performTextInput("My long posting stays here")
        compose.onNodeWithContentDescription("Back").performClick()
        compose.onNodeWithText("Discard changes?").assertExists()
        compose.onNodeWithText("Keep editing").performClick()
        compose.onNodeWithText("My long posting stays here").assertExists()
        compose.onNodeWithText("Save job, create and open").performScrollTo().performClick()
        compose.onNodeWithText("My long posting stays here").assertExists()
        compose.onNodeWithText("Save job, create and open").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(2, copies) }
    }
}
