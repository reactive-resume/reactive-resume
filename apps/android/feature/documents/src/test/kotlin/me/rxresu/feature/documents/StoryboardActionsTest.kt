package me.rxresu.feature.documents

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import me.rxresu.core.designsystem.RrMotion
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class StoryboardActionsTest : RrScreenshotTest() {
    @get:Rule val compose = createComposeRule()

    @Test fun actionsOpenEditorAndFormatsThroughDistinctCallbacks() {
        val repos = FakeRepositories()
        val doc = runBlocking { repos.documents.listDocuments().first { it.id == StoryboardIds.resume } }
        var opened = 0
        var formats = 0
        var pdf = 0
        compose.setContent {
            RrTheme {
                DocumentActionsSheet(DocumentActionsUiState(document = doc), repos.time.now(), DocumentActionsCallbacks(onOpen = { opened++ }, onFormats = { formats++ }, onSharePdf = { pdf++ }))
            }
        }
        compose.onNodeWithText("Open").performClick()
        compose.onNodeWithText("Share PDF").performClick()
        compose.runOnIdle { assertEquals(1, opened); assertEquals(1, formats); assertEquals(0, pdf) }
    }

    @Test fun lockedDocumentStillOpensButCannotRenameOrTrash() {
        val repos = FakeRepositories()
        val doc = runBlocking { repos.documents.listDocuments().first { it.id == StoryboardIds.lockedResume } }
        var opened = 0
        var trashed = 0
        compose.setContent {
            RrTheme {
                DocumentActionsSheet(DocumentActionsUiState(document = doc), repos.time.now(), DocumentActionsCallbacks(onOpen = { opened++ }, onTrash = { trashed++ }))
            }
        }
        compose.onNodeWithText("Rename").assertIsNotEnabled()
        compose.onNodeWithText("Move to trash").assertIsNotEnabled()
        compose.onNodeWithText("Open").performClick()
        compose.runOnIdle { assertEquals(1, opened); assertEquals(0, trashed) }
    }

    @Test fun reducedMotionSheetStillOpensDocumentAfterItsFade() {
        val repos = FakeRepositories()
        val doc = runBlocking { repos.documents.listDocuments().first { it.id == StoryboardIds.resume } }
        var opened = 0
        compose.setContent {
            RrTheme(reducedMotion = true) {
                DocumentActionsSheet(DocumentActionsUiState(document = doc), repos.time.now(), DocumentActionsCallbacks(onOpen = { opened++ }))
            }
        }
        // Reduced motion retains the shared d1 opacity transition.
        compose.mainClock.advanceTimeBy(RrMotion.D1.toLong() + 32)
        compose.onNodeWithText("Open").performClick()
        compose.runOnIdle { assertEquals(1, opened) }
    }

    @Test fun newSheetKeepsLastActionReachableAtTwoHundredPercent() {
        var saved = 0
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = 2f)) {
                RrTheme { NewDocumentSheet(DocumentActionsUiState(), NewDocumentCallbacks(onSaveJob = { saved++ })) }
            }
        }
        compose.onNodeWithText("Save a job").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(1, saved) }
    }

    @Test fun singleApplicationLetterKeepsApplicationIdentity() {
        val repos = FakeRepositories()
        val app = runBlocking { repos.applications.listApplications().first { it.id == StoryboardIds.lumen } }
        var selected: String? = null
        compose.setContent {
            RrTheme {
                CompositionLocalProvider(LocalRepositories provides repos) {
                    NewDocumentSheet(DocumentActionsUiState(applications = listOf(app)), NewDocumentCallbacks(onApplicationLetter = { selected = it }))
                }
            }
        }
        compose.onNodeWithText("Cover letter").performClick()
        compose.runOnIdle { assertEquals(app.id, selected) }
    }
}
