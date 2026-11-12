package me.rxresu.feature.letters

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.DraftState
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class LetterDesignControlsTest : RrScreenshotTest() {
    @get:Rule val compose = createComposeRule()

    @Test fun pairingSetsHeadingAndBodyWithoutChangingPage() {
        val repositories = FakeRepositories()
        try {
            val letter = runBlocking { repositories.letters.openDraft(StoryboardIds.lumenLetter).state.value.document!! }
            var metadata = letter.style.metadata
            compose.setContent {
                CompositionLocalProvider(LocalInspectionMode provides true) {
                    RrTheme { LetterTypeSheet(LetterState(draft = DraftState(letter), loading = false), { metadata = it(metadata) }, {}, {}) }
                }
            }
            compose.onNodeWithText("Balanced").performScrollTo().performClick()
            compose.runOnIdle {
                assertEquals("Source Serif 4", metadata.typography.heading.fontFamily)
                assertEquals("Source Sans 3", metadata.typography.body.fontFamily)
                assertEquals(letter.style.metadata.page, metadata.page)
            }
        } finally { repositories.close() }
    }
}
