package me.rxresu.core.testing

import me.rxresu.core.designsystem.RrText
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class CaptureFreshnessTest : RrScreenshotTest() {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun fittingCaptureRemovesOldScrolledEvidenceAndKeepsOtherScreens() {
        val previous = System.getProperty("rr.fidelity.dir")
        val output = temporary.newFolder()
        System.setProperty("rr.fidelity.dir", output.absolutePath)
        try {
            val oldEnd = output.resolve("X99-Fresh-light-end.png").apply { writeText("stale") }
            val oldDump = output.resolve("X99-Fresh-light-end.json").apply { writeText("stale") }
            val sibling = output.resolve("X98-Other-light.png").apply { writeText("other") }
            captureScreen("X99-Fresh", dark = false) { RrText("Fits") }
            assertTrue(output.resolve("X99-Fresh-light.png").isFile)
            assertTrue(output.resolve("X99-Fresh-light.json").readText().contains("Fits"))
            assertFalse(oldEnd.exists())
            assertFalse(oldDump.exists())
            assertTrue(sibling.isFile)
        } finally {
            if (previous == null) System.clearProperty("rr.fidelity.dir") else System.setProperty("rr.fidelity.dir", previous)
        }
    }
}
