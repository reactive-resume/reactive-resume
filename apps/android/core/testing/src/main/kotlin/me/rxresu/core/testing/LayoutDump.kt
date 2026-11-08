package me.rxresu.core.testing

import android.view.View
import android.view.ViewGroup
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

/** Read measured, unmerged Compose semantics; never read expected layout data. */
fun View.writeLayoutDump(out: File) {
    val elements = JSONArray()
    val density = resources.displayMetrics.density
    fun walk(node: SemanticsNode, parentHasText: Boolean = false) {
        val tag = node.config.getOrNull(DesignTagKey)
        val text = tag?.text ?: if (!parentHasText) {
            node.config.getOrNull(SemanticsProperties.Text)?.joinToString("") { it.text }
                ?: node.config.getOrNull(SemanticsProperties.EditableText)?.text
        } else null
        val box = node.boundsInRoot
        fun item() = JSONObject().put("x", box.left / density).put("y", box.top / density)
            .put("w", box.width / density).put("h", box.height / density)
        tag?.component?.let {
            val component = item().put("component", it)
            tag.radius?.let { radius ->
                // Compose clamps round corners to half the shortest side (the round token is 999 dp).
                component.put("radius", minOf(radius.value, box.width / density / 2, box.height / density / 2))
            }
            tag.bgName?.let { bg -> component.put("bg", bg) }
            elements.put(component)
        }
        if (text != null || tag?.icon != null) {
            val value = item()
            if (text != null) {
                fun textLayout(n: SemanticsNode): Pair<SemanticsNode, TextLayoutResult>? {
                    val results = mutableListOf<TextLayoutResult>()
                    n.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(results)
                    results.firstOrNull()?.let { return n to it }
                    return n.children.firstNotNullOfOrNull { textLayout(it) }
                }
                textLayout(node)?.let { (textNode, result) ->
                    if (result.lineCount > 0) {
                        val left = (0 until result.lineCount).minOf { result.getLineLeft(it) }
                        val right = (0 until result.lineCount).maxOf { result.getLineRight(it) }
                        value.put("x", (textNode.boundsInRoot.left + left) / density)
                        value.put("w", (right - left) / density)
                    }
                }
            }
            text?.let { value.put("text", it) }
            tag?.icon?.let { value.put("icon", it) }
            tag?.iconWeight?.let { value.put("iconWeight", it) }
            val style = JSONObject()
            tag?.style?.let { type ->
                val family = when (type.fontFamily) {
                    Figtree -> "Figtree"; InstrumentSerif -> "Instrument Serif"; GeistMono -> "Geist Mono"; else -> null
                }
                family?.let { style.put("family", it) }
                if (type.fontSize.isSp) style.put("size", type.fontSize.value)
                if (type.lineHeight.isSp) style.put("lineHeight", type.lineHeight.value)
                type.fontWeight?.let { style.put("weight", it.weight) }
                if (type.letterSpacing.isSp) style.put("letterSpacing", type.letterSpacing.value)
                if (type.letterSpacing.isEm && type.fontSize.isSp) style.put("letterSpacing", type.letterSpacing.value * type.fontSize.value)
            }
            tag?.colorName?.let { style.put("color", it) }
            if (style.length() > 0) value.put("style", style)
            elements.put(value)
        }
        node.children.forEach { walk(it, parentHasText || text != null) }
    }
    fun visit(view: View) {
        if (view is RootForTest) walk(view.semanticsOwner.unmergedRootSemanticsNode)
        else if (view is ViewGroup) repeat(view.childCount) { visit(view.getChildAt(it)) }
    }
    visit(this)
    check(elements.length() > 0) { "No measured Compose nodes in $out" }
    out.parentFile?.mkdirs()
    out.writeText(JSONObject().put("elements", elements).toString(2))
}
