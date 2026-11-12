package me.rxresu.core.designsystem

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.TextRange
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** The shared rich-text model on a cover letter's mixed HTML: paragraphs, a list and emphasis survive edits. */
@RunWith(RobolectricTestRunner::class)
class RrRichTextTest {
    private val letter = "<p>Dear <em>hiring team</em>,</p><ul><li>Led the <strong>redesign</strong>.</li><li>Ran interviews.</li></ul><p>Best, <mark data-color=\"yellow\">Alex</mark></p>"

    @Test fun mixedBlocksRoundTripUntouched() {
        val doc = RrRichDoc.parse(letter)
        assertEquals(listOf("Dear hiring team,", "Led the redesign.", "Ran interviews.", "Best, Alex"), doc.plain)
        assertEquals(letter, doc.toHtml())
        assertEquals(RrListKind.Paragraphs, doc.kindAt(0)); assertEquals(RrListKind.Bullets, doc.kindAt(1))
    }

    @Test fun editingOneLineKeepsTheListEmphasisAndOtherLinesMarkup() {
        val doc = RrRichDoc.parse(letter)
        val edited = doc.withText(doc.text.replace("Ran interviews.", "Ran 40 interviews.\nWrote the guide."))
        assertEquals("<p>Dear <em>hiring team</em>,</p><ul><li>Led the <strong>redesign</strong>.</li><li>Ran 40 interviews.</li><li>Wrote the guide.</li></ul><p>Best, <mark data-color=\"yellow\">Alex</mark></p>", edited.toHtml())
        // Lists apply to the selected lines only.
        val numbered = edited.withKind(edited.linesOf(TextRange(0)), RrListKind.Numbers)
        assertEquals("<ol><li>Dear <em>hiring team</em>,</li></ol><ul><li>Led the <strong>redesign</strong>.</li><li>Ran 40 interviews.</li><li>Wrote the guide.</li></ul><p>Best, <mark data-color=\"yellow\">Alex</mark></p>", numbered.toHtml())
    }

    @Test fun paragraphSpacingKeepsNativeOffsetsAndMarkup() {
        val doc = RrRichDoc.parse(letter)
        val transformed = RrRichTransformation(doc, 20.sp, Color.Blue, paragraphSpacing = 12.sp, showMarkers = false).filter(AnnotatedString(doc.text))
        assertEquals(doc.text.replace("\n", "\u200B"), transformed.text.text)
        for (offset in 0..doc.text.length) {
            val rendered = transformed.offsetMapping.originalToTransformed(offset)
            assertEquals(offset, transformed.offsetMapping.transformedToOriginal(rendered))
        }
        for (offset in 0..transformed.text.length) assertTrue(transformed.offsetMapping.transformedToOriginal(offset) in 0..doc.text.length)
        assertEquals(letter, doc.toHtml())
    }

    @Test fun suggestionMarksAdditionsWithoutChangingWordsOrMarkingInflections() {
        val original = "Built the design system now used by six product teams; cut interface defects by a third."
        val suggestion = "Created and scaled the design system adopted by six product teams, cutting interface defects by a third."
        assertEquals(listOf("Created and scaled", "adopted"), addedWordRanges(original, suggestion).map { suggestion.substring(it) })
        assertTrue(addedWordRanges(original, original).isEmpty())
        assertEquals(listOf(0..4), addedWordRanges("", "Added"))
        assertTrue(addedWordRanges("Deleted", "").isEmpty())
    }

    @Test fun onlyLosslessBodiesAreEditable() {
        assertTrue(RrRichDoc.editable(letter))
        assertTrue(RrRichDoc.editable("<h2>Why Lumen</h2><p>Because.</p>"))
        assertTrue(RrRichDoc.editable("Plain words"))
        assertFalse(RrRichDoc.editable("<p>One</p><blockquote>Quoted</blockquote>"))
        assertFalse(RrRichDoc.editable("<ul><li>One<ul><li>Nested</li></ul></li></ul>"))
    }
}
