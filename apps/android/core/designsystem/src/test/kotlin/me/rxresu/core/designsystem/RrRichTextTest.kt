package me.rxresu.core.designsystem

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

    @Test fun onlyLosslessBodiesAreEditable() {
        assertTrue(RrRichDoc.editable(letter))
        assertTrue(RrRichDoc.editable("<h2>Why Lumen</h2><p>Because.</p>"))
        assertTrue(RrRichDoc.editable("Plain words"))
        assertFalse(RrRichDoc.editable("<p>One</p><blockquote>Quoted</blockquote>"))
        assertFalse(RrRichDoc.editable("<ul><li>One<ul><li>Nested</li></ul></li></ul>"))
    }
}
