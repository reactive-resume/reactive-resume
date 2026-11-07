package me.rxresu.core.testing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO

class StoryboardDiffTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun image(w: Int, h: Int, rgb: Int) = BufferedImage(w, h, BufferedImage.TYPE_INT_RGB).apply {
        for (y in 0 until h) for (x in 0 until w) setRGB(x, y, rgb)
    }

    @Test fun countsPixelsBeyondTheToleranceOverTheSharedArea() {
        val ref = image(4, 4, 0xFFFFFF)
        val cap = image(4, 4, 0xFFFFFF).apply {
            setRGB(0, 0, 0x000000) // different
            setRGB(1, 0, 0xF0F0F0) // anti-aliasing noise, within tolerance
        }
        val (result, sideBySide) = StoryboardDiff.compare(ref, cap, "X")
        assertEquals(1L, result.differentPixels)
        assertEquals(6.25, result.percent, 0.001)
        assertNull(result.sizeNote)
        assertEquals(12, sideBySide.width)
    }

    @Test fun findsTheHandoffOfAWorktreesMainCheckout() {
        val main = tmp.newFolder("repo")
        File(main, ".agents/handoff/android-app/screens").mkdirs()
        File(main, ".git/worktrees/wt").mkdirs()
        val worktree = tmp.newFolder("wt")
        File(worktree, ".git").writeText("gitdir: ${main.absolutePath}/.git/worktrees/wt\n")
        val module = File(worktree, "apps/android/core/designsystem").apply { mkdirs() }
        assertEquals(File(main, ".agents/handoff/android-app").canonicalFile, StoryboardDiff.handoffDir(module)?.canonicalFile)
    }

    @Test fun reportsNothingWithoutTheHandoff() {
        val capture = tmp.newFile("cap.png").also { ImageIO.write(image(2, 2, 0), "png", it) }
        assertNull(StoryboardDiff.report(capture, "screens/T1-Today-light.png", "T1-Today-light", tmp.newFolder("out"), handoff = null))
    }
}
