package me.rxresu.core.designsystem

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.ParagraphStyle
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextIndent
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import me.rxresu.core.strings.R as S

/** How a line prints: a bullet, a number, or a paragraph (headings keep their own tag). */
enum class RrListKind { Bullets, Numbers, Paragraphs }

/** Inline marks on one character: tags from [RrRichDoc.TAGS] and a link target. */
data class RrMarks(val tags: Set<String> = emptySet(), val href: String? = null)

/**
 * Rich text (the HTML the web's editor stores) as its plain text, lines split by `\n`, with each character's inline
 * marks and each line's block: `p`, `h1`–`h6`, or an item of a `ul` or `ol`. Bold, italic and links apply to a
 * selection range; lines nobody touched keep the exact HTML they came with, so markup the editor doesn't draw
 * (highlights, colours) survives.
 */
class RrRichDoc private constructor(
    val text: String,
    private val marks: List<RrMarks>,
    /** One per line: "p", "h1"–"h6", "ul" or "ol". */
    private val blocks: List<String>,
    private val originals: Map<String, String>,
) {
    val plain: List<String> get() = text.split('\n')

    /** The whole field's list kind: bullets or numbers when every line is that list, paragraphs otherwise. */
    val kind: RrListKind get() = when {
        blocks.all { it == "ul" } -> RrListKind.Bullets
        blocks.all { it == "ol" } -> RrListKind.Numbers
        else -> RrListKind.Paragraphs
    }

    /** The list kind of line [line]. */
    fun kindAt(line: Int): RrListKind = when (blocks.getOrNull(line)) { "ul" -> RrListKind.Bullets; "ol" -> RrListKind.Numbers; else -> RrListKind.Paragraphs }

    /** Whether line [line] is a heading. */
    fun headingAt(line: Int) = blocks.getOrNull(line)?.startsWith("h") == true

    /** Each line's inner HTML. */
    val lines: List<String> get() = lineRanges().map { r -> serialize(r).let { originals[it] ?: it } }

    /** Every line as [kind] (the builder's fields are one list or paragraphs throughout). */
    fun copy(kind: RrListKind = this.kind) = RrRichDoc(text, marks, List(blocks.size) { kind.tag }, originals)

    /** Lines [lines] as [kind]; the others keep theirs (letters mix paragraphs and lists). */
    fun withKind(lines: IntRange, kind: RrListKind) = RrRichDoc(text, marks, blocks.mapIndexed { i, b -> if (i in lines) kind.tag else b }, originals)

    fun toHtml(): String {
        if (plain.all { it.isBlank() }) return ""
        val out = StringBuilder()
        var list: String? = null
        lines.forEachIndexed { i, inner ->
            val block = blocks[i]
            val item = block == "ul" || block == "ol"
            if (list != null && list != block) { out.append("</").append(list).append('>'); list = null }
            if (item && list == null) { out.append('<').append(block).append('>'); list = block }
            val tag = if (item) "li" else block
            out.append('<').append(tag).append('>').append(inner).append("</").append(tag).append('>')
        }
        if (list != null) out.append("</").append(list).append('>')
        return out.toString()
    }

    fun marksAt(index: Int): RrMarks = marks.getOrElse(index) { RrMarks() }

    /**
     * New text from the editor. Characters kept around the edit keep their marks; typed ones take the marks of the
     * character before (the one after at a line start), never extending a link past its end. New lines take the block
     * of the line they were typed in.
     */
    fun withText(next: String): RrRichDoc {
        if (next == text) return this
        var prefix = 0
        while (prefix < text.length && prefix < next.length && text[prefix] == next[prefix]) prefix++
        var suffix = 0
        while (suffix < text.length - prefix && suffix < next.length - prefix && text[text.length - 1 - suffix] == next[next.length - 1 - suffix]) suffix++
        val before = marks.getOrNull(prefix - 1)?.takeIf { text[prefix - 1] != '\n' }
        val after = marks.getOrNull(text.length - suffix)?.takeIf { text[text.length - suffix] != '\n' }
        val typed = (before ?: after ?: RrMarks()).let { m -> m.copy(href = m.href?.takeIf { before?.href == it && after?.href == it }) }
        val inserted = next.substring(prefix, next.length - suffix).map { if (it == '\n') RrMarks() else typed }
        val startLine = text.take(prefix).count { it == '\n' }
        val oldEnd = text.take(text.length - suffix).count { it == '\n' }
        val newEnd = next.take(next.length - suffix).count { it == '\n' }
        val nextBlocks = blocks.take(startLine) + List(newEnd - startLine + 1) { blocks[startLine] } + blocks.drop(oldEnd + 1)
        return RrRichDoc(next, marks.take(prefix) + inserted + marks.takeLast(suffix), nextBlocks, originals)
    }

    /** The range a toolbar action applies to: the selection, or the caret's whole line when nothing is selected. */
    fun target(selection: TextRange): IntRange {
        if (!selection.collapsed) return selection.min until selection.max
        val line = text.take(selection.start).count { it == '\n' }
        return lineRanges()[line]
    }

    /** The lines [selection] touches. */
    fun linesOf(selection: TextRange): IntRange = text.take(selection.min).count { it == '\n' }..text.take(selection.max).count { it == '\n' }

    /** Whether every character of [range] (newlines aside) carries [tag]. */
    fun has(range: IntRange, tag: String) = range.filter { text[it] != '\n' }.let { chars -> chars.isNotEmpty() && chars.all { tag in marks[it].tags } }

    /** Bold ("strong") or italic ("em") on [range]: removed when all of it has the mark, added otherwise. */
    fun toggle(range: IntRange, tag: String): RrRichDoc {
        val on = !has(range, tag)
        return RrRichDoc(text, marks.mapIndexed { i, m -> if (i in range && text[i] != '\n') m.copy(tags = if (on) m.tags + tag else m.tags - tag) else m }, blocks, originals)
    }

    /** Links [range] to [url]; a blank url removes the link. */
    fun link(range: IntRange, url: String): RrRichDoc =
        RrRichDoc(text, marks.mapIndexed { i, m -> if (i in range && text[i] != '\n') m.copy(href = url.trim().ifBlank { null }) else m }, blocks, originals)

    /** Replace swaps only the line whose text is [original]; null when that line changed meanwhile. */
    fun replace(original: String, replacement: String): RrRichDoc? {
        val index = plain.indexOf(original).takeIf { it >= 0 } ?: return null
        val range = lineRanges()[index]
        val text = this.text.replaceRange(range.first, range.last + 1, replacement)
        return RrRichDoc(text, marks.take(range.first) + List(replacement.length) { RrMarks() } + marks.drop(range.last + 1), blocks, originals)
    }

    fun lineRanges(): List<IntRange> {
        var start = 0
        return plain.map { line -> (start until start + line.length).also { start += line.length + 1 } }
    }

    /**
     * Inner HTML for [range]: tags nest so marks spanning several runs stay open (`<em>Led the <strong>redesign
     * </strong>.</em>`); a link is closed and reopened when its target changes.
     */
    private fun serialize(range: IntRange): String {
        val out = StringBuilder()
        val open = ArrayList<String>() // "a" or a tag, outermost first
        var openHref: String? = null
        fun closeTo(size: Int) { while (open.size > size) out.append("</").append(open.removeAt(open.lastIndex)).append('>') }
        var i = range.first
        while (i <= range.last) {
            val m = marks[i]
            var j = i
            while (j + 1 <= range.last && marks[j + 1] == m) j++
            val wanted = m.tags + listOfNotNull(m.href?.let { "a" })
            var keep = 0
            while (keep < open.size && open[keep] in wanted && (open[keep] != "a" || openHref == m.href)) keep++
            closeTo(keep)
            if ("a" !in open) openHref = null
            for (tag in listOf("a") + TAGS) if (tag in wanted && tag !in open) {
                if (tag == "a") { out.append("<a href=\"").append(escapeHtml(m.href!!).replace("\"", "&quot;")).append("\">"); openHref = m.href }
                else out.append('<').append(tag).append('>')
                open += tag
            }
            out.append(escapeHtml(text.substring(i, j + 1)))
            i = j + 1
        }
        closeTo(0)
        return out.toString()
    }

    companion object {
        /** Inline tags the editor keeps as marks, in nesting order; `b`, `i` and `strike` read as their equivalents. */
        val TAGS = listOf("strong", "em", "u", "s", "code")
        private val aliases = mapOf("b" to "strong", "i" to "em", "strike" to "s")
        private val BLOCK = Regex("(?is)<(ul|ol)(?:\\s[^>]*)?>|</(ul|ol)>|<(li|p|h[1-6])(?:\\s[^>]*)?>(.*?)</\\3>")
        private val RrListKind.tag get() = when (this) { RrListKind.Bullets -> "ul"; RrListKind.Numbers -> "ol"; RrListKind.Paragraphs -> "p" }

        fun parse(html: String): RrRichDoc {
            val blocks = ArrayList<String>(); val inners = ArrayList<String>()
            val lists = ArrayList<String>()
            BLOCK.findAll(html).forEach { m ->
                when {
                    m.groupValues[1].isNotEmpty() -> lists += m.groupValues[1].lowercase()
                    m.groupValues[2].isNotEmpty() -> if (lists.isNotEmpty()) lists.removeAt(lists.lastIndex)
                    else -> {
                        val tag = m.groupValues[3].lowercase()
                        blocks += if (tag == "li") lists.lastOrNull() ?: "ul" else tag
                        inners += m.groupValues[4].trim()
                    }
                }
            }
            if (inners.isEmpty()) { (if (html.isBlank()) listOf("") else htmlText(html).map(::escapeHtml).ifEmpty { listOf("") }).forEach { inners += it; blocks += "p" } }
            val text = StringBuilder(); val marks = ArrayList<RrMarks>(); val originals = HashMap<String, String>()
            inners.forEachIndexed { index, inner ->
                if (index > 0) { text.append('\n'); marks += RrMarks() }
                val start = text.length
                readInner(inner, text, marks)
                val parsed = RrRichDoc(text.toString(), marks.toList(), blocks.take(index + 1), emptyMap())
                originals[parsed.serialize(start until text.length)] = inner
            }
            return RrRichDoc(text.toString(), marks, blocks, originals)
        }

        /**
         * Whether [html] round-trips through this editor without losing anything outside its lines: only paragraphs,
         * headings and (unnested) lists, with nothing between them. Anything else (quotes, tables, rules) stays read-only.
         */
        fun editable(html: String): Boolean {
            if (!html.contains('<')) return true
            if (Regex("(?is)<(ul|ol)(?:\\s[^>]*)?>(?:(?!</(?:ul|ol)>).)*<(ul|ol)[\\s>]").containsMatchIn(html)) return false
            val rest = html.replace(BLOCK, "")
            return rest.isBlank() && BLOCK.containsMatchIn(html)
        }

        private fun readInner(inner: String, text: StringBuilder, marks: MutableList<RrMarks>) {
            val stack = ArrayList<Pair<String, String?>>() // tag, href
            Regex("<(/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)").findAll(inner).forEach { m ->
                val chunk = m.groupValues[4]
                if (chunk.isNotEmpty()) {
                    val decoded = innerText(chunk)
                    val current = RrMarks(stack.mapNotNull { (t, _) -> t.takeIf { it in TAGS } }.toSet(), stack.lastOrNull { it.first == "a" }?.second)
                    text.append(decoded); repeat(decoded.length) { marks += current }
                    return@forEach
                }
                val tag = m.groupValues[2].lowercase().let { aliases[it] ?: it }
                if (m.groupValues[1] == "/") { stack.indexOfLast { it.first == tag }.takeIf { it >= 0 }?.let { stack.removeAt(it) } }
                else if (tag != "br") stack += tag to Regex("href=\"([^\"]*)\"").find(m.groupValues[3])?.groupValues?.get(1)?.let(::innerText)
            }
        }

        fun innerText(inner: String) = inner.replace(Regex("<[^>]+>"), "")
            .replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ").replace("&amp;", "&")

        private fun escapeHtml(text: String) = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

        /** Plain lines from HTML without paragraph or list blocks. */
        private fun htmlText(html: String): List<String> =
            html.replace(Regex("(?i)</(li|p|div|h[1-6])>|<br\\s*/?>"), "\n")
                .replace(Regex("<[^>]+>"), "")
                .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ")
                .lines().map { it.trim() }.filter { it.isNotEmpty() }
    }
}

/**
 * Draws each line's bold, italic and link marks, its bullet or number and its heading weight, without changing the
 * edited text, and tints [highlight] (e.g. the line Improve is asking about).
 */
class RrRichTransformation(
    private val doc: RrRichDoc,
    private val hanging: TextUnit,
    private val linkColor: Color,
    private val highlight: IntRange? = null,
    private val highlightColor: Color = Color.Unspecified,
) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val lines = text.text.split('\n')
        var number = 0
        val prefixes = lines.indices.map { i ->
            val kind = doc.kindAt(i)
            number = if (kind == RrListKind.Numbers) number + 1 else 0
            when (kind) { RrListKind.Bullets -> "•  "; RrListKind.Numbers -> "$number.  "; RrListKind.Paragraphs -> "" }
        }
        val styled = text.text == doc.text
        val starts = lines.runningFold(0) { acc, l -> acc + l.length + 1 }
        val offsets = prefixes.runningFold(0) { acc, p -> acc + p.length }
        val out = buildAnnotatedString {
            val lineStarts = IntArray(lines.size)
            lines.forEachIndexed { i, line ->
                lineStarts[i] = length
                append(prefixes[i])
                val base = length
                append(line)
                if (styled && doc.headingAt(i)) addStyle(SpanStyle(fontWeight = FontWeight.SemiBold), base, base + line.length)
                if (styled) line.indices.forEach { k ->
                    val m = doc.marksAt(starts[i] + k)
                    if (m.tags.isEmpty() && m.href == null) return@forEach
                    addStyle(
                        SpanStyle(
                            fontWeight = if ("strong" in m.tags) FontWeight.Bold else null,
                            fontStyle = if ("em" in m.tags) FontStyle.Italic else null,
                            textDecoration = when {
                                m.href != null || "u" in m.tags -> TextDecoration.Underline
                                "s" in m.tags -> TextDecoration.LineThrough
                                else -> null
                            },
                            color = if (m.href != null) linkColor else Color.Unspecified,
                        ),
                        base + k, base + k + 1,
                    )
                }
                if (i < lines.lastIndex) append('\n')
            }
            if (highlight != null && styled && !highlight.isEmpty()) {
                val line = starts.indexOfLast { it <= highlight.first }.coerceIn(0, lines.lastIndex)
                addStyle(SpanStyle(background = highlightColor), highlight.first + offsets[line + 1], highlight.last + 1 + offsets[line + 1])
            }
            // List lines wrap under their text: one paragraph style over a field that is one list, else per list line.
            val indent = ParagraphStyle(textIndent = TextIndent(firstLine = 0.sp, restLine = hanging))
            if (doc.kind != RrListKind.Paragraphs) addStyle(indent, 0, length)
            else if (styled) lines.indices.filter { doc.kindAt(it) != RrListKind.Paragraphs }.forEach { i ->
                addStyle(indent, lineStarts[i], if (i < lines.lastIndex) lineStarts[i + 1] else length)
            }
        }
        val mapping = object : OffsetMapping {
            override fun originalToTransformed(offset: Int): Int {
                val line = starts.indexOfLast { it <= offset }.coerceIn(0, lines.lastIndex)
                return offset + offsets[line + 1]
            }
            override fun transformedToOriginal(offset: Int): Int {
                var line = 0
                while (line < lines.lastIndex && starts[line + 1] + offsets[line + 1] <= offset) line++
                return (offset - offsets[line + 1]).coerceIn(starts[line], starts[line] + lines[line].length)
            }
        }
        return TransformedText(out, mapping)
    }
}

/**
 * The rich-text field (B4, L1 body): the text with its marks, bullets and numbers drawn, accent caret and accent-soft
 * selection. [onValueChange] gets the field value and the document with the edit applied.
 */
@Composable
fun RrRichTextField(
    value: TextFieldValue,
    doc: RrRichDoc,
    onValueChange: (TextFieldValue, RrRichDoc) -> Unit,
    modifier: Modifier = Modifier,
    readOnly: Boolean = false,
    textStyle: TextStyle = RrType.input.copy(fontSize = 17.sp, lineHeight = 24.sp),
    highlight: IntRange? = null,
    placeholder: String? = null,
) {
    val c = RrTheme.colors
    CompositionLocalProvider(LocalTextSelectionColors provides TextSelectionColors(handleColor = c.accent, backgroundColor = c.accentSoft)) {
        BasicTextField(
            value = value,
            onValueChange = { next -> onValueChange(next, if (next.text != value.text) doc.withText(next.text) else doc) },
            modifier = modifier,
            readOnly = readOnly,
            textStyle = textStyle.copy(color = c.ink),
            cursorBrush = SolidColor(c.accent),
            visualTransformation = RrRichTransformation(doc, 22.sp, c.accentText, highlight = highlight, highlightColor = c.sunken),
            decorationBox = { field ->
                // An empty editor otherwise shows nothing at all, not even where to type.
                if (placeholder != null && value.text.isEmpty()) RrText(placeholder, style = textStyle, color = c.ink3)
                field()
            },
        )
    }
}

/**
 * The formatting toolbar for [RrRichTextField], riding on the keyboard: bold, italic, bullets, numbers and link act on
 * the selection (or the caret's line). Lists apply to the whole field when [wholeField] (the builder's fields are one
 * list), else to the selected lines. [trailing] holds screen actions such as Improve.
 */
@Composable
fun RrRichTextToolbar(
    doc: RrRichDoc,
    selection: TextRange,
    onChange: (RrRichDoc) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    wholeField: Boolean = false,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    val target = doc.target(selection)
    val lines = doc.linesOf(selection)
    var linking by remember { mutableStateOf<IntRange?>(null) }
    fun list(kind: RrListKind) {
        val on = if (wholeField) doc.kind == kind else lines.all { doc.kindAt(it) == kind }
        val next = if (on) RrListKind.Paragraphs else kind
        onChange(if (wholeField) doc.copy(kind = next) else doc.withKind(lines, next))
    }
    val listed = { kind: RrListKind -> if (wholeField) doc.kind == kind else doc.kindAt(lines.first) == kind }
    Row(modifier, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        RrIconButton(R.drawable.ic_ph_text_b, stringResource(S.string.bold), { onChange(doc.toggle(target, "strong")) }, enabled = enabled, selected = doc.has(target, "strong"))
        RrIconButton(R.drawable.ic_ph_text_italic, stringResource(S.string.italic), { onChange(doc.toggle(target, "em")) }, enabled = enabled, selected = doc.has(target, "em"))
        RrIconButton(R.drawable.ic_ph_list_bullets, stringResource(S.string.bulleted_list), { list(RrListKind.Bullets) }, enabled = enabled, selected = listed(RrListKind.Bullets))
        RrIconButton(R.drawable.ic_ph_list_numbers, stringResource(S.string.numbered_list), { list(RrListKind.Numbers) }, enabled = enabled, selected = listed(RrListKind.Numbers))
        RrIconButton(R.drawable.ic_ph_link_simple, stringResource(S.string.link), { linking = target }, enabled = enabled && !target.isEmpty(), selected = !target.isEmpty() && doc.marksAt(target.first).href != null)
        trailing()
    }
    linking?.let { range -> RrLinkSheet(doc.marksAt(range.first).href, onDismiss = { linking = null }) { url -> linking = null; onChange(doc.link(range, url)) } }
}

@Composable
private fun RrLinkSheet(current: String?, onDismiss: () -> Unit, onLink: (String) -> Unit) {
    var url by rememberSaveable { mutableStateOf(current ?: "https://") }
    RrBottomSheet(onDismissRequest = onDismiss, fitContent = true, title = stringResource(S.string.link)) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            RrTextField(url, { url = it }, Modifier.fillMaxWidth(), label = stringResource(S.string.link_address), ltr = true)
            RrButton(stringResource(S.string.done), { onLink(url.takeIf { it != "https://" }.orEmpty()) })
        }
    }
}
