package me.rxresu.core.testing

import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.unit.toSize
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.semantics.getOrNull
import me.rxresu.core.designsystem.DesignTagKey
import me.rxresu.core.designsystem.Figtree
import me.rxresu.core.designsystem.GeistMono
import me.rxresu.core.designsystem.InstrumentSerif
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Read real Compose semantics and native TextView layouts; never read expected layout data. */
fun View.writeLayoutDump(out: File) {
    val elements = JSONArray()
    val density = resources.displayMetrics.density
    fun hasTextSlot(node: SemanticsNode): Boolean = node.config.getOrNull(DesignTagKey)?.textSlot == true || node.children.any(::hasTextSlot)
    fun textLayout(node: SemanticsNode): Pair<SemanticsNode, TextLayoutResult>? {
        val results = mutableListOf<TextLayoutResult>()
        node.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(results)
        results.firstOrNull()?.let { return node to it }
        return node.children.firstNotNullOfOrNull(::textLayout)
    }
    fun walk(node: SemanticsNode, parentHasText: Boolean = false) {
        val tag = node.config.getOrNull(DesignTagKey)
        val text = tag?.text ?: if (!parentHasText) {
            node.config.getOrNull(SemanticsProperties.Text)?.joinToString("") { it.text }
                ?: if (!hasTextSlot(node)) node.config.getOrNull(SemanticsProperties.EditableText)?.text else null
        } else null
        val box = Rect(node.positionInRoot, node.size.toSize())
        fun item() = JSONObject().put("x", box.left / density).put("y", box.top / density)
            .put("w", box.width / density).put("h", box.height / density)
        tag?.component?.let {
            val component = item().put("component", it)
            tag.radius?.let { radius ->
                // Compose clamps round corners to half the shortest side (the round token is 999 dp).
                component.put("radius", minOf(radius.value, box.width / density / 2, box.height / density / 2))
            }
            tag.bgName?.let { bg -> component.put("bg", bg) }
            tag.raster?.let { raster -> component.put("raster", JSONObject()
                .put("width", raster.width).put("height", raster.height).put("rgbaSha256", raster.rgbaSha256)) }
            elements.put(component)
        }
        if (text != null || tag?.icon != null) {
            val value = item()
            val measuredText = if (text != null) textLayout(node) else null
            if (tag?.textSlot != true) {
                measuredText?.let { (textNode, result) ->
                    if (result.lineCount > 0) {
                        val left = (0 until result.lineCount).minOf { result.getLineLeft(it) }
                        val right = (0 until result.lineCount).maxOf { result.getLineRight(it) }
                        value.put("x", (textNode.positionInRoot.x + left) / density)
                        value.put("w", (right - left) / density)
                    }
                }
            }
            text?.let { value.put("text", it) }
            tag?.icon?.let { value.put("icon", it) }
            tag?.iconWeight?.let { value.put("iconWeight", it) }
            val style = dumpStyle(tag?.style, tag?.colorName)
            if (style.length() > 0) value.put("style", style)
            elements.put(value)
            val runs = tag?.textRuns.orEmpty()
            if (runs.isNotEmpty() && measuredText != null) {
                val (textNode, result) = measuredText
                runs.forEach { run ->
                    val range = result.getPathForRange(run.start, run.end).getBounds()
                    val span = JSONObject()
                        .put("text", result.layoutInput.text.text.substring(run.start, run.end))
                        .put("x", (textNode.positionInRoot.x + range.left) / density)
                        .put("y", (textNode.positionInRoot.y + range.top) / density)
                        .put("w", range.width / density).put("h", range.height / density)
                        .put("style", dumpStyle(run.style, run.colorName))
                    elements.put(span)
                }
            }
        }
        node.children.forEach { walk(it, parentHasText || text != null) }
    }
    val rootPosition = IntArray(2).also(::getLocationOnScreen)
    fun visit(view: View) {
        if (view.visibility != View.VISIBLE) return
        if (view is RootForTest) walk(view.semanticsOwner.unmergedRootSemanticsNode)
        if (view is TextView && view.width > 0 && view.height > 0 && view.text.isNotEmpty()) {
            view.layout?.takeIf { it.lineCount > 0 }?.let { layout ->
                val position = IntArray(2).also(view::getLocationOnScreen)
                if (!isAttachedToWindow && this is ViewGroup && view !== this) {
                    // Unattached RemoteViews have no screen position; use their real laid-out hierarchy.
                    val bounds = android.graphics.Rect()
                    offsetDescendantRectToMyCoords(view, bounds)
                    position[0] = rootPosition[0] + bounds.left + view.scrollX
                    position[1] = rootPosition[1] + bounds.top + view.scrollY
                }
                val left = (0 until layout.lineCount).minOf(layout::getLineLeft)
                val right = (0 until layout.lineCount).maxOf(layout::getLineRight)
                elements.put(JSONObject()
                    .put("text", view.text.toString())
                    .put("x", (position[0] - rootPosition[0] + view.totalPaddingLeft + left - view.scrollX) / density)
                    .put("y", (position[1] - rootPosition[1] + view.totalPaddingTop - view.scrollY) / density)
                    .put("w", (right - left) / density)
                    .put("h", layout.height / density)
                    .put("nativeView", view.javaClass.name)
                    .put("nativeTypeface", view.typeface.toString())
                    .put("nativeColor", String.format("#%08x", view.currentTextColor))
                    .put("style", JSONObject()
                        .put("size", view.textSize / resources.displayMetrics.scaledDensity)
                        .put("lineHeight", view.lineHeight / resources.displayMetrics.scaledDensity)
                        .apply { if (android.os.Build.VERSION.SDK_INT >= 28) put("weight", view.typeface.weight) }))
            }
        }
        // AndroidView descendants sit below the Compose root in the real View hierarchy.
        if (view is ViewGroup) repeat(view.childCount) { visit(view.getChildAt(it)) }
    }
    visit(this)
    check(elements.length() > 0) { "No measured Compose or native text nodes in $out" }
    out.parentFile?.mkdirs()
    out.writeText(JSONObject().put("elements", elements).toString(2))
}

private fun dumpStyle(type: TextStyle?, colorName: String?): JSONObject = JSONObject().apply {
    type?.let {
        val family = when (type.fontFamily) {
            Figtree -> "Figtree"; InstrumentSerif -> "Instrument Serif"; GeistMono -> "Geist Mono"; else -> null
        }
        family?.let { put("family", it) }
        if (type.fontSize.isSp) put("size", type.fontSize.value)
        if (type.lineHeight.isSp) put("lineHeight", type.lineHeight.value)
        type.fontWeight?.let { put("weight", it.weight) }
        if (type.letterSpacing.isSp) put("letterSpacing", type.letterSpacing.value)
        if (type.letterSpacing.isEm && type.fontSize.isSp) put("letterSpacing", type.letterSpacing.value * type.fontSize.value)
    }
    colorName?.let { put("color", it) }
}
