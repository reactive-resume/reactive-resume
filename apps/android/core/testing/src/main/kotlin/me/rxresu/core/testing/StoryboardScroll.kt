package me.rxresu.core.testing

import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull

/** Offsets use Compose semantics units: pixels for ScrollState, estimated item offsets for lazy lists. */
data class StoryboardScrollResult(val scrollable: Boolean, val semanticOffset: Float, val semanticMax: Float)

/**
 * Scroll the largest visible vertical viewport to its content end, never a horizontal carousel.
 * Call on the UI thread; [settle] must advance pending frames after each asynchronous ScrollBy action.
 */
fun View.scrollStoryboardToEnd(settle: () -> Unit): StoryboardScrollResult {
    val initial = verticalScrollNodes().maxByOrNull { it.boundsInRoot.width * it.boundsInRoot.height }
        ?: return StoryboardScrollResult(false, 0f, 0f)
    val id = initial.id
    var attempts = 0
    while (true) {
        val node = verticalScrollNodes().singleOrNull { it.id == id }
            ?: error("Vertical scroll viewport disappeared before its end capture")
        val range = requireNotNull(node.config.getOrNull(SemanticsProperties.VerticalScrollAxisRange))
        val offset = range.value()
        val maximum = range.maxValue()
        check(offset.isFinite() && !maximum.isNaN()) { "Invalid vertical scroll range: $offset/$maximum" }
        if (offset >= maximum) return StoryboardScrollResult(true, offset, maximum)
        check(attempts++ < 10_000) { "Vertical scroll did not reach its end after 10000 viewport actions: $offset/$maximum" }
        val action = node.config.getOrNull(SemanticsActions.ScrollBy)?.action
            ?: error("Vertical scroll viewport has no ScrollBy action")
        check(action(0f, node.boundsInRoot.height)) { "Vertical ScrollBy action was rejected" }
        settle()
        val updated = verticalScrollNodes().singleOrNull { it.id == id }
            ?: error("Vertical scroll viewport disappeared after scrolling")
        val current = requireNotNull(updated.config.getOrNull(SemanticsProperties.VerticalScrollAxisRange))
        check(current.value() > offset) {
            "Vertical ScrollBy did not advance from $offset/$maximum to ${current.value()}/${current.maxValue()}; viewport=$id ${updated.boundsInRoot}, reverse=${current.reverseScrolling}"
        }
    }
}

private fun View.verticalScrollNodes(): List<SemanticsNode> {
    val nodes = mutableListOf<SemanticsNode>()
    fun walk(node: SemanticsNode) {
        val range = node.config.getOrNull(SemanticsProperties.VerticalScrollAxisRange)
        if (range != null && range.maxValue() > 0f && node.boundsInRoot.height > 0f) nodes += node
        node.children.forEach(::walk)
    }
    fun visit(view: View) {
        if (view is RootForTest) walk(view.semanticsOwner.unmergedRootSemanticsNode)
        else if (view is ViewGroup) repeat(view.childCount) { visit(view.getChildAt(it)) }
    }
    visit(this)
    return nodes
}
