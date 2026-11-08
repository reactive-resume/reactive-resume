package me.rxresu.core.designsystem

import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.isSpecified
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import kotlin.math.roundToInt

/**
 * Text in the design-system type. Style defaults to [LocalRrTextStyle] (UI 14/20) and colour to [LocalRrContentColor].
 * Text wraps by default so it survives 200% font scale; set [maxLines] only where a board truncates.
 */
@Composable
fun RrText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalRrTextStyle.current,
    color: Color = Color.Unspecified,
    textAlign: TextAlign? = null,
    textDecoration: TextDecoration? = null,
    maxLines: Int = Int.MAX_VALUE,
    overflow: TextOverflow = TextOverflow.Ellipsis,
    onTextLayout: ((TextLayoutResult) -> Unit)? = null,
    measureSlot: Boolean = false,
) {
    val resolved = resolve(style, color, textAlign, textDecoration)
    CssLineBox(resolved, modifier.rrDesignTag(DesignTag(text = text, style = resolved, colorName = RrTheme.colors.tokenName(resolved.color), textSlot = measureSlot))) { onLayout ->
        BasicText(
            text = text,
            style = resolved,
            maxLines = maxLines,
            overflow = overflow,
            onTextLayout = { onLayout(it); onTextLayout?.invoke(it) },
        )
    }
}

/** [RrText] for styled runs (struck and added text in proposals, inline icons). */
@Composable
fun RrText(
    text: AnnotatedString,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalRrTextStyle.current,
    color: Color = Color.Unspecified,
    textAlign: TextAlign? = null,
    maxLines: Int = Int.MAX_VALUE,
    overflow: TextOverflow = TextOverflow.Ellipsis,
    inlineContent: Map<String, InlineTextContent> = emptyMap(),
) {
    val resolved = resolve(style, color, textAlign, null)
    val colors = RrTheme.colors
    val runs = remember(text, resolved, colors) {
        if (text.spanStyles.isEmpty()) emptyList() else {
            val edges = (listOf(0, text.length) + text.spanStyles.flatMap { listOf(it.start, it.end) }).distinct().sorted()
            edges.zipWithNext { start, end ->
                val span = text.spanStyles.filter { it.start <= start && it.end >= end }
                    .fold(resolved.toSpanStyle()) { style, range -> style.merge(range.item) }
                val runStyle = resolved.copy(color = span.color, fontSize = span.fontSize, fontWeight = span.fontWeight, fontFamily = span.fontFamily, letterSpacing = span.letterSpacing)
                DesignTextRun(start, end, runStyle, colors.tokenName(runStyle.color))
            }.filter { run -> run.start < run.end && text.spanStyles.any { it.start <= run.start && it.end >= run.end } }
        }
    }
    CssLineBox(resolved, modifier.rrDesignTag(DesignTag(text = text.text, style = resolved, colorName = colors.tokenName(resolved.color), textRuns = runs))) { onLayout ->
        BasicText(
            text = text,
            style = resolved,
            maxLines = maxLines,
            overflow = overflow,
            inlineContent = inlineContent,
            onTextLayout = onLayout,
        )
    }
}

/**
 * Android's fallback line spacing never lets a line be shorter than the font's own extents, so Instrument Serif lines
 * come out taller than their line height (44 sp display text takes 58 px instead of 48). CSS lets the glyphs overflow
 * the line box instead. This reports `lines × lineHeight` and centres the text on it, matching the boards; text whose
 * lines already fit is untouched.
 */
@Composable
private fun CssLineBox(style: TextStyle, modifier: Modifier, text: @Composable ((TextLayoutResult) -> Unit) -> Unit) {
    val last = remember { arrayOfNulls<TextLayoutResult>(1) }
    Layout(content = { text { last[0] = it } }, modifier = modifier) { measurables, constraints ->
        val placeable = measurables.first().measure(constraints)
        val result = last[0]
        val target = if (result != null && style.lineHeight.isSp) (style.lineHeight.toPx() * result.lineCount).roundToInt() else placeable.height
        val height = if (target in 1 until placeable.height) target.coerceIn(constraints.minHeight, constraints.maxHeight) else placeable.height
        layout(placeable.width, height) { placeable.place(0, (height - placeable.height) / 2) }
    }
}

@Composable
private fun resolve(style: TextStyle, color: Color, align: TextAlign?, decoration: TextDecoration?): TextStyle {
    val c = when {
        color.isSpecified -> color
        style.color.isSpecified -> style.color
        else -> LocalRrContentColor.current
    }
    return RrTextDefaults.merge(style).merge(TextStyle(color = c, textAlign = align ?: TextAlign.Unspecified, textDecoration = decoration))
}
