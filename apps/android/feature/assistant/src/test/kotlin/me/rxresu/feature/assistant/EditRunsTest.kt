package me.rxresu.feature.assistant

import me.rxresu.core.designsystem.RrEditRun
import org.junit.Assert.assertEquals
import org.junit.Test

class EditRunsTest {
    @Test fun sharedWordEndingNeverSplitsRemovedAndAddedWords() {
        val runs = editRuns("Built the design system now used by six teams.", "Built and scaled a design system adopted by six teams.")
        assertEquals("the design system now used ", (runs[1] as RrEditRun.Removed).text)
        assertEquals("and scaled a design system adopted ", (runs[2] as RrEditRun.Added).text)
        assertEquals("by six teams.", (runs[3] as RrEditRun.Same).text)
    }
    @Test fun appendedSentenceKeepsWholeOriginalSentence() {
        val runs = editRuns("Business software.", "Business software. I lead audits.")
        assertEquals("Business software. ", runs[0].text)
        assertEquals("", runs[1].text)
        assertEquals("I lead audits.", runs[2].text)
    }
    @Test fun deletingLastWordKeepsReadableWordBoundary() {
        val runs = editRuns("A word", "A")
        assertEquals("A ", runs[0].text)
        assertEquals("word", runs[1].text)
        assertEquals("", runs[2].text)
    }
}
