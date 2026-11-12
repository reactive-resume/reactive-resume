package me.rxresu.core.testing

import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ActivityScenario
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.robolectric.Shadows.shadowOf
import java.time.Duration

class StoryboardScrollTest : RrScreenshotTest() {
    @Test fun plainScrollReachesTheLastRowAndReportsItsActualOffset() {
        lateinit var state: ScrollState
        withContent({
            state = rememberScrollState()
            Column(Modifier.width(300.dp).height(240.dp).verticalScroll(state)) {
                repeat(10) { RowContent(it, 10) }
            }
        }) { view ->
            assertEquals(0, state.value)
            val result = view.scrollStoryboardToEnd(::settle)
            settle()
            assertTrue(result.scrollable)
            assertTrue(result.semanticOffset > 0f)
            assertEquals(state.value.toFloat(), result.semanticOffset, 0f)
            assertEquals(state.maxValue.toFloat(), result.semanticMax, 0f)
            assertEquals(state.maxValue, state.value)
            assertLastRowVisible(view)
        }
    }

    @Test fun lazyScrollKeepsGoingPastTheInitialEstimatedMaximum() {
        lateinit var state: LazyListState
        withContent({
            state = rememberLazyListState()
            LazyColumn(Modifier.width(300.dp).height(240.dp), state = state) {
                items(96) { RowContent(it, 96) }
            }
        }) { view ->
            assertEquals(0, state.firstVisibleItemIndex)
            val result = view.scrollStoryboardToEnd(::settle)
            settle()
            assertTrue(result.scrollable)
            assertTrue(result.semanticOffset > 0f)
            assertEquals(result.semanticMax, result.semanticOffset, 0f)
            assertFalse(state.canScrollForward)
            assertEquals(95, state.layoutInfo.visibleItemsInfo.last().index)
            assertLastRowVisible(view)
        }
    }

    @Test fun horizontalControlsDoNotCountAsVerticalContent() {
        lateinit var state: ScrollState
        withContent({
            state = rememberScrollState()
            Row(Modifier.width(300.dp).horizontalScroll(state)) {
                repeat(20) { Box(Modifier.width(100.dp)) { RrText("Template $it") } }
            }
        }) { view ->
            assertTrue(state.maxValue > 0)
            val result = view.scrollStoryboardToEnd(::settle)
            assertFalse(result.scrollable)
            assertEquals(0f, result.semanticOffset, 0f)
            assertEquals(0f, result.semanticMax, 0f)
            assertEquals(0, state.value)
        }
    }

    @Test fun fittingVerticalContentNeedsNoEndCapture() {
        withContent({
            Column(Modifier.width(300.dp).height(240.dp).verticalScroll(rememberScrollState())) {
                repeat(2) { RowContent(it, 2) }
            }
        }) { view ->
            val result = view.scrollStoryboardToEnd(::settle)
            assertFalse(result.scrollable)
            assertEquals(0f, result.semanticOffset, 0f)
            assertLastRowVisible(view)
        }
    }

    @Composable
    private fun RowContent(index: Int, count: Int) {
        Box(Modifier.height(64.dp)) { RrText(if (index == count - 1) "Last row" else "Row $index") }
    }

    private fun withContent(content: @Composable () -> Unit, assertion: (View) -> Unit) {
        ActivityScenario.launch(ComponentActivity::class.java).use { scenario ->
            scenario.onActivity { activity -> activity.setContent { RrTheme { content() } } }
            settle()
            scenario.onActivity { activity -> assertion(activity.findViewById<ViewGroup>(android.R.id.content)) }
        }
    }

    private fun assertLastRowVisible(view: View) {
        // Refresh scroll-layer transforms before reading bounds, as captureScreen draws before its layout dump.
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bitmap))
        bitmap.recycle()
        fun find(node: SemanticsNode): SemanticsNode? {
            if (node.config.getOrNull(SemanticsProperties.Text)?.any { it.text == "Last row" } == true) return node
            return node.children.firstNotNullOfOrNull(::find)
        }
        fun findInView(view: View): SemanticsNode? = when (view) {
            is RootForTest -> find(view.semanticsOwner.unmergedRootSemanticsNode)
            is ViewGroup -> (0 until view.childCount).firstNotNullOfOrNull { findInView(view.getChildAt(it)) }
            else -> null
        }
        val last = requireNotNull(findInView(view)) { "Last row was not composed" }
        assertTrue("Last row is clipped or offscreen: ${last.boundsInRoot}, position=${last.positionInRoot}, size=${last.size}", last.boundsInRoot.height > 0f)
    }

    private fun settle() = repeat(3) { shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100)) }
}
