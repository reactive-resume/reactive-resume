package me.rxresu.feature.letters

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.DraftState
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.navigation.LetterMode
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * L1: a formatted body is edited in place (not stripped), and every page of a long letter can be read. Its own Robolectric
 * sandbox (legacy graphics; no pixels compared): sharing one with the screenshot captures left their sheets unopened.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w390dp-h844dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.LEGACY)
class LetterBodyAndPagesTest {
    @get:Rule val compose = createComposeRule()

    private val formatted = "<p>Dear <em>hiring team</em>,</p><ul><li>Led the redesign.</li><li>Ran interviews.</li></ul><p>Best, Alex</p>"

    @Test fun formattedBodyEditsKeepListAndEmphasis() {
        val repositories = FakeRepositories()
        try {
            val letter = runBlocking { repositories.letters.openDraft(StoryboardIds.lumenLetter).state.value.document!! }.copy(content = formatted, isLocked = false)
            var saved: String? = null
            compose.setContent {
                CompositionLocalProvider(LocalInspectionMode provides true) {
                    RrTheme(darkTheme = false) { LetterBodyEditor(LetterState(draft = DraftState(letter), loading = false), { saved = it }, {}) }
                }
            }
            compose.onNode(hasSetTextAction()).performTextReplacement("Dear hiring team,\nLed the redesign.\nRan 40 interviews.\nBest, Alex")
            compose.onNodeWithText("Save").performClick()
            compose.runOnIdle { assertEquals("<p>Dear <em>hiring team</em>,</p><ul><li>Led the redesign.</li><li>Ran 40 interviews.</li></ul><p>Best, Alex</p>", saved) }
        } finally { repositories.close() }
    }

    @Test fun keptAiDraftIsEditable() {
        val html = letterDraftHtml("First paragraph.\n\nSecond paragraph.")
        assertEquals(true, me.rxresu.core.designsystem.RrRichDoc.editable(html))
    }

    @Test fun detailsKeepDraftEditorAndPreviewReachableWithoutRootButtons() {
        val repositories = FakeRepositories()
        try {
            val letter = runBlocking { repositories.letters.openDraft(StoryboardIds.lumenLetter).state.value.document!! }.copy(content = "<p>Letter body.</p>", isLocked = false)
            var selected = ""
            compose.setContent {
                CompositionLocalProvider(LocalInspectionMode provides true) {
                    RrTheme(darkTheme = false) { LetterScreen(LetterState(draft = DraftState(letter), loading = false), LetterMode.Write, false, { selected = it }, {}, {}, {}) }
                }
            }
            compose.onNodeWithText("Draft from the posting").assertDoesNotExist()
            compose.onNodeWithText("Letter content").assertDoesNotExist()
            compose.onNodeWithText("Preview").assertDoesNotExist()
            listOf("Draft from the posting" to "draft", "Letter content" to "body", "Preview" to "preview").forEach { (label, action) ->
                compose.onNodeWithText("Details").performClick()
                compose.onNodeWithText(label).performClick()
                compose.runOnIdle { assertEquals(action, selected) }
            }
        } finally { repositories.close() }
    }

    @Test fun longLetterKeepsAllBodyParagraphs() {
        val repositories = FakeRepositories()
        try {
            val letter = runBlocking { repositories.letters.openDraft(StoryboardIds.lumenLetter).state.value.document!! }
            val content = (1..30).joinToString("") { "<p>Paragraph $it remains editable.</p>" }
            compose.setContent {
                CompositionLocalProvider(LocalInspectionMode provides true) {
                    RrTheme(darkTheme = false) { LetterScreen(LetterState(draft = DraftState(letter.copy(content = content)), loading = false, pageCount = 2), LetterMode.Write, false, {}, {}, {}, {}) }
                }
            }
            compose.onNodeWithText("Paragraph 30 remains editable.", useUnmergedTree = true).assertExists()
        } finally { repositories.close() }
    }

    @Test fun snapshotHasNoWriteDesignHistoryOrExportActions() {
        val repositories = FakeRepositories()
        try {
            val version = runBlocking { repositories.letters.getCoverLetterVersion(StoryboardIds.lumenLetter, "letter-version-lumen") }
            val actions = mutableListOf<String>()
            compose.setContent {
                CompositionLocalProvider(LocalInspectionMode provides true) {
                    RrTheme(darkTheme = false) {
                        LetterScreen(LetterState(snapshotVersionId = version.id, snapshotLabel = "Sent to Lumen", draft = DraftState(version.readOnlyLetter()), loading = false), LetterMode.Write, false, { actions += it }, { error("No live design writes") }, { error("No live page writes") }, {}, { error("No live content writes") })
                    }
                }
            }
            compose.onNodeWithContentDescription("Assistant").assertDoesNotExist()
            compose.onNodeWithContentDescription("More").assertDoesNotExist()
            listOf("Write", "Design", "Export", "Restore this version").forEach { compose.onNodeWithText(it).assertDoesNotExist() }
            compose.onAllNodes(hasSetTextAction()).assertCountEquals(0)
            compose.onNodeWithText("Details").assertIsNotEnabled()
            compose.onNodeWithText("Open current").performClick()
            compose.runOnIdle { assertEquals(listOf("current"), actions) }
        } finally { repositories.close() }
    }
}
