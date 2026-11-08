package me.rxresu.core.designsystem

import org.junit.Assert.assertEquals
import org.junit.Test

class RrProposalPhraseTest {
    @Test fun replacementConnectorsKeepBothPassagesAndReadablePhrases() {
        val runs = listOf(RrEditRun.Same("Built "), RrEditRun.Removed("the system used "),
            RrEditRun.Added("a system adopted "), RrEditRun.Same("by six teams."))
        val shown = proposalPhraseRuns(runs)
        assertEquals("the system used by ", shown[1].text)
        assertEquals("a system adopted by ", shown[2].text)
        assertEquals("six teams.", shown[3].text)
        assertEquals(runs.filterNot { it is RrEditRun.Added }.joinToString("") { it.text },
            shown.filterNot { it is RrEditRun.Added }.joinToString("") { it.text })
        assertEquals(runs.filterNot { it is RrEditRun.Removed }.joinToString("") { it.text },
            shown.filterNot { it is RrEditRun.Removed }.joinToString("") { it.text })
    }

    @Test fun nounSuffixAndPureAdditionsKeepOriginalRuns() {
        val noun = listOf(RrEditRun.Removed("old "), RrEditRun.Added("new "), RrEditRun.Same("teams."))
        val addition = listOf(RrEditRun.Removed(""), RrEditRun.Added("Led "), RrEditRun.Same("by example."))
        assertEquals(noun, proposalPhraseRuns(noun))
        assertEquals(addition, proposalPhraseRuns(addition))
    }
}
