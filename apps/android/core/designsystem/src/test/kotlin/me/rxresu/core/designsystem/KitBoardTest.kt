package me.rxresu.core.designsystem

import me.rxresu.core.testing.RrScreenshotTest
import me.rxresu.core.testing.captureBoard
import org.junit.Test
import org.robolectric.annotation.Config

/** The Kit board at its own pixel size, diffed against `boards/Kit.png` when the handoff is on this machine. */
@Config(qualifiers = "w2240dp-h1400dp-mdpi")
class KitBoardTest : RrScreenshotTest() {
    @Test fun kit() = captureBoard("Kit", "boards/Kit.png") { KitBoard() }
}
