package me.rxresu.feature.documents

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.*
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class LibraryMotionTest : RrScreenshotTest() {
    @get:Rule val compose = createComposeRule()

    @Test fun reducedGridRemovalClosesTheGapAtOnce() {
        val repos = FakeRepositories()
        val docs = runBlocking { repos.documents.listDocuments() }.take(2)
        val state = mutableStateOf(LibraryUiState(loading = false, all = docs, documents = docs))
        compose.setContent { RrTheme(reducedMotion = true) {
            CompositionLocalProvider(LocalRepositories provides repos) { LibraryScreen(state.value, repos.time.now(), LibraryActions()) }
        } }
        val initial = compose.onNodeWithText(docs.first().name).fetchSemanticsNode().boundsInRoot.topLeft
        compose.mainClock.autoAdvance = false
        compose.runOnIdle { state.value = state.value.copy(all = docs.takeLast(1), documents = docs.takeLast(1)) }
        compose.waitForIdle()
        compose.mainClock.advanceTimeByFrame()
        compose.mainClock.advanceTimeByFrame()
        compose.onNodeWithText(docs.first().name).assertDoesNotExist()
        val moved = compose.onNodeWithText(docs.last().name).fetchSemanticsNode().boundsInRoot.topLeft
        assertEquals(initial, moved)
    }
}
