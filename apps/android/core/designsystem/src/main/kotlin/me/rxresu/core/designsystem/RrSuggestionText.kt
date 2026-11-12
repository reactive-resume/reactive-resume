package me.rxresu.core.designsystem

import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.unit.sp

/** Suggested paragraph with added words marked; native text still wraps and exposes its full accessible text. */
@Composable
fun RrSuggestionText(original: String, suggestion: String, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val additions = remember(original, suggestion) { addedWordRanges(original, suggestion) }
    val text = remember(suggestion, additions, c.ink) { buildAnnotatedString {
        var offset = 0
        additions.forEach { range ->
            append(suggestion.substring(offset, range.first))
            appendInlineContent("padding", "\u00A0")
            // Keep inline padding attached to its word when Android breaks the line.
            append('\u2060')
            val start = length
            append(suggestion.substring(range))
            addStyle(SpanStyle(color = c.ink), start, length)
            append('\u2060')
            appendInlineContent("padding", "\u00A0")
            offset = range.last + 1
        }
        append(suggestion.substring(offset))
    } }
    RrText(text, modifier.rrAddedTextBackground(layout, text.spanStyles.map { it.start until it.end }, c.accentSoft), style = RrType.body, inlineContent = mapOf("padding" to InlineTextContent(Placeholder(2.sp, 18.sp, PlaceholderVerticalAlign.TextCenter)) {
        Box(Modifier.fillMaxSize())
    }), measureUnstyledText = true, onTextLayout = { layout = it })
}

internal fun Modifier.rrAddedTextBackground(layout: TextLayoutResult?, additions: List<IntRange>, color: Color): Modifier = drawBehind {
    layout?.let { result -> additions.forEach { run ->
        val first = result.getLineForOffset(run.first)
        val last = result.getLineForOffset(run.last)
        for (line in first..last) {
            val range = result.getPathForRange(maxOf(run.first, result.getLineStart(line)), minOf(run.last + 1, result.getLineEnd(line, visibleEnd = true))).getBounds()
            val height = 18.sp.toPx()
            val left = maxOf(0f, range.left - 2.sp.toPx())
            val right = minOf(result.size.width.toFloat(), range.right + 2.sp.toPx())
            drawRoundRect(color, Offset(left, range.top + (range.height - height) / 2),
                Size(right - left, height), CornerRadius(2.dp.toPx()))
        }
    } }
}

/** Keep unchanged words in order; inflections such as cut/cutting don't obscure the substantive additions. */
internal fun addedWordRanges(original: String, suggestion: String): List<IntRange> {
    val words = Regex("[\\p{L}\\p{N}]+(?:['’][\\p{L}]+)?")
    fun key(word: String): String = word.lowercase().let { value ->
        if (value.length > 5 && value.endsWith("ing")) value.dropLast(3).let { stem -> if (stem.length > 1 && stem.last() == stem[stem.lastIndex - 1]) stem.dropLast(1) else stem } else value
    }
    val old = words.findAll(original).map { key(it.value) }.toList()
    val next = words.findAll(suggestion).toList()
    val keys = next.map { key(it.value) }
    val lengths = Array(old.size + 1) { IntArray(next.size + 1) }
    for (i in old.indices.reversed()) for (j in next.indices.reversed()) lengths[i][j] =
        if (old[i] == keys[j]) lengths[i + 1][j + 1] + 1 else maxOf(lengths[i + 1][j], lengths[i][j + 1])
    val same = BooleanArray(next.size)
    var i = 0; var j = 0
    while (i < old.size && j < next.size) {
        when {
            old[i] == keys[j] -> { same[j] = true; i++; j++ }
            lengths[i + 1][j] >= lengths[i][j + 1] -> i++
            else -> j++
        }
    }
    val ranges = mutableListOf<IntRange>()
    next.indices.filter { !same[it] }.forEach { index ->
        val range = next[index].range
        val previous = ranges.lastOrNull()
        if (previous != null && suggestion.substring(previous.last + 1, range.first).all { it.isWhitespace() }) ranges[ranges.lastIndex] = previous.first..range.last
        else ranges += range
    }
    return ranges
}
