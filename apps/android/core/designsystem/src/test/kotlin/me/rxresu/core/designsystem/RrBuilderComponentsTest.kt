package me.rxresu.core.designsystem

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextLayoutResult
import kotlin.math.ceil
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class RrBuilderComponentsTest : RrScreenshotTest() {
    @get:Rule val rule = createComposeRule()

    @Test fun compactToolbarKeepsBoldNumberingAndLinkActions() {
        var doc by mutableStateOf(RrRichDoc.parse("<p>First paragraph</p><p>Second paragraph</p>"))
        rule.setContent { RrTheme { RrRichTextToolbar(doc, TextRange(0, 5), { doc = it }, compact = true, wholeField = true) } }
        rule.onNodeWithContentDescription("Bold").performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(true, doc.has(0..4, "strong"))
        rule.onNodeWithContentDescription("Bulleted list").performSemanticsAction(SemanticsActions.OnLongClick)
        assertEquals(RrListKind.Numbers, doc.kind)
        rule.onNodeWithContentDescription("Link").performSemanticsAction(SemanticsActions.OnClick)
        rule.onNodeWithContentDescription("Link address").assertExists()
    }

    @Test fun readingLayoutEditsOneNativeDocumentWithoutChangingOtherMarkup() {
        var doc by mutableStateOf(RrRichDoc.parse("<p>First</p><p><em>Second</em></p>"))
        var value by mutableStateOf(TextFieldValue(doc.text))
        rule.setContent { RrTheme { RrRichTextField(value, doc, { next, rich -> value = next; doc = rich }, readingLayout = true) } }
        val layouts = mutableListOf<TextLayoutResult>()
        rule.onNode(hasSetTextAction()).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        val layout = layouts.single()
        assertEquals(3, layout.lineCount)
        assertEquals(with(rule.density) { 12.dp.toPx() }, layout.getLineTop(2) - layout.getLineBottom(0), 0.01f)
        rule.onNode(hasSetTextAction()).performTextReplacement("First!\nSecond")
        assertEquals("<p>First!</p><p><em>Second</em></p>", doc.toHtml())
    }

    @Test fun changedWordKeepsItsPaddingWhenItWrapsToTheNextLine() {
        rule.setContent { RrTheme {
            RrSuggestionText("Built the design system now used by six product teams; cut interface defects by a third.",
                "Created and scaled the design system adopted by six product teams, cutting interface defects by a third.", Modifier.width(292.dp))
        } }
        val layouts = mutableListOf<TextLayoutResult>()
        rule.onNode(SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult), useUnmergedTree = true)
            .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        val result = layouts.single()
        val start = result.layoutInput.text.text.indexOf("adopted")
        assertEquals(1, result.getLineForOffset(start))
        assertEquals(with(rule.density) { 2.dp.toPx() }, result.getBoundingBox(start).left, 0.01f)
    }

    @Test fun trackedNumberAllocatesMeasuredAdvanceBeforeAdjacentCopy() {
        var result: TextLayoutResult? = null
        rule.setContent { RrTheme { Row(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(16.dp)) {
            RrText("86", Modifier.testTag("number"), style = RrType.bigNumber, onTextLayout = { result = it })
            RrText("Mostly readable", Modifier.testTag("verdict"))
        } } }
        val number = rule.onNodeWithTag("number").getUnclippedBoundsInRoot()
        val verdict = rule.onNodeWithTag("verdict").getUnclippedBoundsInRoot()
        assertEquals(with(rule.density) { ceil(requireNotNull(result).getLineRight(0).toDouble()).toFloat().toDp() }, number.right - number.left)
        assertEquals(16.dp, verdict.left - number.right)
    }

    @Test fun swatchesExpandVerticallyAndChooseNearestAdjacentTarget() {
        var selected = ""
        rule.setContent { RrTheme { Row(Modifier.padding(20.dp)) {
            RrColourSwatch(RrFixedColors.paper, "First", false, { selected = "First" })
            RrColourSwatch(RrFixedColors.paper, "Second", false, { selected = "Second" })
        } } }
        // Five dp beyond the 32 dp visual/layout height remains inside its 44 dp native touch target.
        rule.onNodeWithContentDescription("First").performTouchInput { down(Offset(center.x, -5.dp.toPx())); up() }
        assertEquals("First", selected)
        rule.onNodeWithContentDescription("Second").performTouchInput { down(Offset(0.5.dp.toPx(), center.y)); up() }
        assertEquals("Second", selected)
    }
}
