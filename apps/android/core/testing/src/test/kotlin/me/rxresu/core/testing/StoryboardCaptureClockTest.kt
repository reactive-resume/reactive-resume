package me.rxresu.core.testing

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Recomposer
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.RoborazziTaskType
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.io.path.createTempDirectory

class StoryboardCaptureClockTest : RrScreenshotTest() {
    @Test fun lightCaptureOwnsFramesThroughTheEndAndDisposesItsRecomposer() = assertCapture(false)
    @Test fun darkCaptureOwnsFramesThroughTheEndAndDisposesItsRecomposer() = assertCapture(true)

    @OptIn(ExperimentalRoborazziApi::class)
    private fun assertCapture(dark: Boolean) {
        val directory = createTempDirectory("storyboard-capture-clock").toFile()
        val top = directory.resolve("capture.png")
        val end = directory.resolve("capture-end.png")
        val before = Recomposer.runningRecomposers.value.toSet()
        lateinit var scroll: ScrollState
        var frameObserved = false
        try {
            capture(directory.resolve("unused.png"), dark, 1f, wrapHeight = false, safeArea = false,
                fidelityFile = top, captureEnd = true, options = RrRoborazziOptions.copy(taskType = RoborazziTaskType.Record)) {
                RrTheme(darkTheme = dark) {
                    LaunchedEffect(Unit) { withFrameNanos { frameObserved = true } }
                    scroll = rememberScrollState()
                    Column(Modifier.width(300.dp).height(240.dp).verticalScroll(scroll)) {
                        repeat(17) { index ->
                            Box(Modifier.height(64.dp).background(if (index == 16) RrTheme.colors.accentSoft else RrTheme.colors.bg)) {
                                RrText(if (index == 16) "Last row" else "Row $index")
                            }
                        }
                    }
                }
            }
            assertTrue("Composition frame never ran", frameObserved)
            assertTrue("Content must actually overflow", scroll.maxValue > 0)
            assertEquals("Actual scroll state reached its end", scroll.maxValue, scroll.value)
            assertTrue("Top PNG missing", top.isFile)
            assertTrue("End PNG missing", end.isFile)
            assertTrue("End layout missing", directory.resolve("capture-end.json").isFile)
            assertFalse("Native scroll paint did not change", top.readBytes().contentEquals(end.readBytes()))
            assertTrue("Capture leaked a recomposer", (Recomposer.runningRecomposers.value - before).isEmpty())
        } finally {
            directory.deleteRecursively()
        }
    }
}
