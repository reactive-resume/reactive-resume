package me.rxresu.core.designsystem

import androidx.compose.foundation.layout.width
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class RrAssistantComponentsTest : RrScreenshotTest() {
    @get:Rule val compose = createComposeRule()

    @Test fun questionKeepsChoicesAndOwnWordsInsideTheBoardCard() {
        compose.setContent {
            RrTheme {
                RrQuestionCard("Did you lead the accessibility audit at Northwind Labs?", listOf("Yes, I led it", "I took part in it", "No"), {},
                    modifier = Modifier.width(342.dp).testTag("question"), ownWordsInput = {
                        RrTextField("", {}, modifier = Modifier.testTag("own-words"), placeholder = "Or in your own words…")
                    })
            }
        }
        val card = compose.onNodeWithTag("question").getUnclippedBoundsInRoot()
        assertEquals(318f, (card.bottom - card.top).value, 0.01f)
        val choices = listOf("Yes, I led it", "I took part in it", "No").map { text ->
            compose.onNode(hasText(text) and hasClickAction()).getUnclippedBoundsInRoot().also {
                assertEquals(300f, (it.right - it.left).value, 0.01f)
                assertEquals(48f, (it.bottom - it.top).value, 0.01f)
                assertEquals(21f, (it.left - card.left).value, 0.01f)
            }
        }
        choices.zipWithNext().forEach { (first, next) -> assertEquals(10f, (next.top - first.bottom).value, 0.01f) }
        val input = compose.onNodeWithTag("own-words").getUnclippedBoundsInRoot()
        assertEquals(44f, (input.bottom - input.top).value, 0.01f)
        assertEquals(10f, (input.top - choices.last().bottom).value, 0.01f)
    }

    @Test fun compactProposalKeepsTheSameHighlightedWordsAndFocusRevealsActions() {
        val showActions = mutableStateOf(false)
        compose.setContent {
            RrTheme {
                RrProposalCard(1, "Summary", listOf(RrEditRun.Same("Built "), RrEditRun.Added("a shared "), RrEditRun.Same("system.")), {}, {},
                    modifier = Modifier.width(342.dp), onEdit = {}, showActions = showActions.value)
            }
        }
        fun highlightedText() = compose.onNodeWithText("Built", substring = true).fetchSemanticsNode().config[SemanticsProperties.Text].single().also {
            assertEquals("Built a shared system.", it.text.replace("\u2060", ""))
            assertTrue(it.spanStyles.any { span -> it.text.substring(span.start, span.end) == "a shared" })
        }
        val compact = highlightedText()
        compose.onNodeWithText("Accept").assertDoesNotExist()
        compose.onNodeWithText("Edit").assertDoesNotExist()
        compose.onNodeWithText("Reject").assertDoesNotExist()
        compose.runOnIdle { showActions.value = true }
        assertEquals(compact, highlightedText())
        listOf("Accept", "Edit", "Reject").forEach { text ->
            val bounds = compose.onNode(hasText(text) and hasClickAction()).getUnclippedBoundsInRoot()
            assertEquals(36f, (bounds.bottom - bounds.top).value, 0.01f)
        }
    }

    @Test fun blankSendKeepsSolidAccentWithoutDispatchingAndBlockedSendStillDims() {
        val input = mutableStateOf("")
        val enabled = mutableStateOf(true)
        var sent = 0
        compose.setContent { RrTheme { RrAiComposer(input.value, { input.value = it }, { sent++ }, "Ask", enabled = enabled.value, dimEmptySend = false) } }
        val send = compose.onNodeWithContentDescription("Send")
        send.assertIsNotEnabled()
        assertEquals(LightRrColors.accent.toArgb(), send.captureToImage().toPixelMap()[10, 14].toArgb())
        send.performSemanticsAction(SemanticsActions.OnClick)
        compose.runOnIdle { assertEquals(0, sent); enabled.value = false }
        send.assertIsNotEnabled()
        assertTrue(LightRrColors.accent.toArgb() != send.captureToImage().toPixelMap()[10, 14].toArgb())
        compose.runOnIdle { enabled.value = true; input.value = "Ready" }
        send.assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(1, sent) }
    }

    @Test fun proposalKeepsRealSpacesOutsideStrikeAndHighlightPadding() {
        compose.setContent { RrTheme {
            RrProposalCard(1, "Summary", listOf(RrEditRun.Same("Built "), RrEditRun.Removed("old by "), RrEditRun.Added("new by "), RrEditRun.Same("six.")), {}, {}, modifier = Modifier.width(342.dp), showActions = false)
        } }
        val text = compose.onNodeWithText("Built", substring = true)
        val layouts = mutableListOf<TextLayoutResult>()
        text.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        val layout = layouts.single()
        val native = layout.layoutInput.text
        assertEquals("Built old by new by six.", native.text.replace("\u2060", ""))
        val removed = native.spanStyles.single { it.item.textDecoration == TextDecoration.LineThrough }
        val added = native.spanStyles.single { it.item.textDecoration != TextDecoration.LineThrough }
        assertEquals("old by", native.text.substring(removed.start, removed.end))
        assertEquals("new by", native.text.substring(added.start, added.end))
        val between = layout.getBoundingBox(added.start).left - layout.getBoundingBox(removed.end - 1).right
        val six = native.text.indexOf("six.")
        val after = layout.getBoundingBox(six).left - layout.getBoundingBox(added.end - 1).right
        assertTrue("Removed/added words visibly touch: $between px", between >= 10f)
        assertTrue("Added/unchanged words visibly touch: $after px", after >= 10f)
        val image = text.captureToImage().toPixelMap()
        val paintedRows = (0 until image.height).filter { y -> (0 until image.width).any { x -> image[x, y].toArgb() == LightRrColors.accentSoft.toArgb() } }
        assertEquals("Highlight starts 3 dp inside the line box", 6, paintedRows.first())
        assertEquals("Highlight ends at 21 dp, leaving separate line bands", 41, paintedRows.last())
    }

    @Test fun wrappedHighlightStaysInsideTheNativeParagraph() {
        compose.setContent { RrTheme {
            RrProposalCard(1, "Summary", listOf(RrEditRun.Added("New words that wrap onto another line in this narrow card.")), {}, {},
                modifier = Modifier.width(180.dp).testTag("proposal"), showActions = false)
        } }
        val card = compose.onNodeWithTag("proposal")
        val cardBounds = card.getUnclippedBoundsInRoot()
        val textBounds = compose.onNodeWithText("New words", substring = true).getUnclippedBoundsInRoot()
        val image = card.captureToImage().toPixelMap()
        val scale = image.width / (cardBounds.right - cardBounds.left).value
        val left = (textBounds.left - cardBounds.left).value * scale
        val right = (textBounds.right - cardBounds.left).value * scale
        val paintedColumns = (0 until image.width).filter { x -> (0 until image.height).any { y -> image[x, y].toArgb() == LightRrColors.accentSoft.toArgb() } }
        assertTrue("Wrapped highlight escapes paragraph start", paintedColumns.first() >= left)
        assertTrue("Wrapped highlight escapes paragraph end", paintedColumns.last() < right)
    }
}
