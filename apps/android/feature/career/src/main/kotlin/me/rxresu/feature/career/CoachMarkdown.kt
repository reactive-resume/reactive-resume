package me.rxresu.feature.career

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.*

/** Blocks of a coach reply, as the web's `typeset-chat` Markdown (GFM subset) lays them out. */
internal sealed interface MdBlock {
    data class Paragraph(val text: String) : MdBlock
    data class Heading(val text: String) : MdBlock
    /** [marker] is "1." for ordered items, null for bullets. */
    data class Item(val depth: Int, val marker: String?, val text: String) : MdBlock
    data class Quote(val text: String) : MdBlock
    data class Code(val text: String) : MdBlock
    data class Table(val rows: List<List<String>>) : MdBlock
    data object Rule : MdBlock
}

private val heading = Regex("^#{1,6}\\s+(.*?)\\s*#*\\s*$")
private val bullet = Regex("^(\\s*)[-*+]\\s+(.*)$")
private val ordered = Regex("^(\\s*)(\\d{1,9})[.)]\\s+(.*)$")
private val rule = Regex("^\\s*([-*_])(\\s*\\1){2,}\\s*$")
private val tableSeparator = Regex("^\\s*\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)*\\|?\\s*$")

/**
 * Line-based Markdown blocks. Streaming-safe: a block only ever grows at the end, so text above never restyles. A soft
 * line break inside a paragraph or item reads as a space; an unclosed code fence runs to the end.
 */
internal fun markdownBlocks(source: String): List<MdBlock> {
    val blocks = mutableListOf<MdBlock>()
    val lines = source.replace("\r\n", "\n").split('\n')
    var i = 0
    fun appendTo(last: MdBlock?, line: String): Boolean = when (last) {
        is MdBlock.Paragraph -> { blocks[blocks.lastIndex] = last.copy(text = last.text + " " + line.trim()); true }
        is MdBlock.Item -> if (line.startsWith(" ") || line.startsWith("\t")) { blocks[blocks.lastIndex] = last.copy(text = last.text + " " + line.trim()); true } else false
        else -> false
    }
    var previousBlank = true
    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trim()
        when {
            trimmed.isEmpty() -> { previousBlank = true; i++; continue }
            trimmed.startsWith("```") || trimmed.startsWith("~~~") -> {
                val fence = trimmed.take(3); val code = mutableListOf<String>(); i++
                while (i < lines.size && !lines[i].trim().startsWith(fence)) code += lines[i++]
                i++; blocks += MdBlock.Code(code.joinToString("\n").trimEnd('\n'))
            }
            heading.matches(trimmed) -> { blocks += MdBlock.Heading(heading.find(trimmed)!!.groupValues[1]); i++ }
            rule.matches(line) -> { blocks += MdBlock.Rule; i++ }
            trimmed.startsWith("|") && i + 1 < lines.size && tableSeparator.matches(lines[i + 1]) -> {
                val rows = mutableListOf(cells(trimmed)); i += 2
                while (i < lines.size && lines[i].trim().startsWith("|")) rows += cells(lines[i++].trim())
                blocks += MdBlock.Table(rows)
            }
            ordered.matches(line) -> { val m = ordered.find(line)!!; blocks += MdBlock.Item(m.groupValues[1].length / 2, m.groupValues[2] + ".", m.groupValues[3]); i++ }
            bullet.matches(line) -> { val m = bullet.find(line)!!; blocks += MdBlock.Item(m.groupValues[1].length / 2, null, m.groupValues[2]); i++ }
            trimmed.startsWith(">") -> {
                val text = trimmed.removePrefix(">").trim(); val last = blocks.lastOrNull()
                if (!previousBlank && last is MdBlock.Quote) blocks[blocks.lastIndex] = last.copy(text = last.text + " " + text) else blocks += MdBlock.Quote(text)
                i++
            }
            else -> { if (previousBlank || !appendTo(blocks.lastOrNull(), line)) blocks += MdBlock.Paragraph(trimmed); i++ }
        }
        previousBlank = false
    }
    return blocks
}

private fun cells(row: String): List<String> = row.trim().removePrefix("|").removeSuffix("|").split('|').map { it.trim() }

private val inline = Regex(
    "(\\*\\*|__)(.+?)\\1" + // 1-2 strong
        "|~~(.+?)~~" + // 3 strike
        "|`([^`]+)`" + // 4 code
        "|!\\[([^\\]]*)]\\([^)]*\\)" + // 5 image: its alt text only, never loaded
        "|\\[([^\\]]+)]\\(\\s*(https?://[^)\\s]+|mailto:[^)\\s]+)[^)]*\\)" + // 6-7 link
        "|(?<![\\w*])\\*(?![\\s*])(.+?)(?<![\\s*])\\*(?!\\*)" + // 8 emphasis
        "|(?<![\\w_])_(?![\\s_])(.+?)(?<![\\s_])_(?![\\w_])", // 9 emphasis
)

/** Inline Markdown as styled runs. Links open in the browser; images become their alt text (web parity). */
internal fun markdownInline(text: String, code: SpanStyle, link: TextLinkStyles): AnnotatedString = buildAnnotatedString { appendInline(text, code, link) }

private fun AnnotatedString.Builder.appendInline(text: String, code: SpanStyle, link: TextLinkStyles) {
    var at = 0
    for (m in inline.findAll(text)) {
        append(text.substring(at, m.range.first)); at = m.range.last + 1
        val g = m.groupValues
        when {
            g[2].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { appendInline(g[2], code, link) }
            g[3].isNotEmpty() -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { appendInline(g[3], code, link) }
            g[4].isNotEmpty() -> withStyle(code) { append(g[4]) }
            m.value.startsWith("![") -> append(g[5])
            g[6].isNotEmpty() -> withLink(LinkAnnotation.Url(g[7], link)) { appendInline(g[6], code, link) }
            g[8].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { appendInline(g[8], code, link) }
            g[9].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { appendInline(g[9], code, link) }
        }
    }
    append(text.substring(at))
}

// TODO(lead): move to designsystem as the native `typeset-chat` (Assistant replies need the same).
/** A coach reply as rich text: paragraphs, headings, lists, quotes, code, tables and links in design-system type. */
@Composable
internal fun CoachMarkdown(text: String, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    val blocks = remember(text) { markdownBlocks(text) }
    val code = SpanStyle(fontFamily = RrType.mono.fontFamily, background = c.sunken)
    val link = TextLinkStyles(SpanStyle(color = c.accentText, textDecoration = TextDecoration.Underline))
    @Composable fun runs(value: String) = remember(value, c) { markdownInline(value, code, link) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        blocks.forEach { block ->
            when (block) {
                is MdBlock.Paragraph -> RrText(runs(block.text), style = RrType.body)
                is MdBlock.Heading -> RrText(runs(block.text), style = RrType.label)
                is MdBlock.Item -> Row(Modifier.padding(start = (block.depth * 20).dp)) {
                    RrText(block.marker ?: "•", Modifier.width(24.dp), style = RrType.body, color = if (block.marker == null) c.ink3 else c.ink)
                    RrText(runs(block.text), Modifier.weight(1f), style = RrType.body)
                }
                is MdBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
                    Box(Modifier.width(2.dp).fillMaxHeight().background(c.line2))
                    RrText(runs(block.text), Modifier.padding(start = 12.dp), style = RrType.body, color = c.ink2)
                }
                is MdBlock.Code -> Box(Modifier.fillMaxWidth().background(c.sunken, RrShape.md).horizontalScroll(rememberScrollState()).padding(12.dp)) {
                    RrText(block.text, style = RrType.mono, color = c.ink)
                }
                is MdBlock.Table -> Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                    block.rows.forEachIndexed { index, row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.padding(vertical = 4.dp)) {
                            row.forEach { cell -> RrText(runs(cell), Modifier.widthIn(min = 64.dp, max = 220.dp), style = if (index == 0) RrType.label else RrType.ui) }
                        }
                        if (index == 0) Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
                    }
                }
                MdBlock.Rule -> Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
            }
        }
    }
}
