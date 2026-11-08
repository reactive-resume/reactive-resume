package me.rxresu.feature.builder

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.ParagraphStyle
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextIndent
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrDisclosureLine
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrMenuItem
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrShape
import me.rxresu.core.designsystem.RrSpinner
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTopBar
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.BuilderRichText
import me.rxresu.core.navigation.SettingsAi
import me.rxresu.core.network.generated.CreateImprovementRequestAction
import me.rxresu.core.strings.R as S
import me.rxresu.core.designsystem.R as D

/** How the field's lines print: bullets, numbers, or paragraphs. */
internal enum class ListKind { Bullets, Numbers, Paragraphs }

/** Inline marks on one character: tags from [RichDoc.TAGS] and a link target. */
internal data class Marks(val tags: Set<String> = emptySet(), val href: String? = null)

/**
 * A rich-text field as its plain text (lines split by `\n`) with each character's inline marks, plus the list kind.
 * Bold, italic and links apply to a selection range; lines nobody touched keep the exact HTML they came with, so
 * markup the editor doesn't draw (highlights, colours) survives.
 */
internal class RichDoc private constructor(val kind: ListKind, val text: String, private val marks: List<Marks>, private val originals: Map<String, String>) {
    val plain: List<String> get() = text.split('\n')

    /** Each line's inner HTML. */
    val lines: List<String> get() = lineRanges().map { r -> serialize(r).let { originals[it] ?: it } }

    fun copy(kind: ListKind = this.kind) = RichDoc(kind, text, marks, originals)

    fun toHtml(): String = when (kind) {
        ListKind.Paragraphs -> lines.joinToString("") { "<p>$it</p>" }
        ListKind.Bullets -> "<ul>" + lines.joinToString("") { "<li>$it</li>" } + "</ul>"
        ListKind.Numbers -> "<ol>" + lines.joinToString("") { "<li>$it</li>" } + "</ol>"
    }.let { if (plain.all { l -> l.isBlank() }) "" else it }

    fun marksAt(index: Int): Marks = marks.getOrElse(index) { Marks() }

    /**
     * New text from the editor. Characters kept around the edit keep their marks; typed ones take the marks of the
     * character before (the one after at a line start), never extending a link past its end.
     */
    fun withText(next: String): RichDoc {
        if (next == text) return this
        var prefix = 0
        while (prefix < text.length && prefix < next.length && text[prefix] == next[prefix]) prefix++
        var suffix = 0
        while (suffix < text.length - prefix && suffix < next.length - prefix && text[text.length - 1 - suffix] == next[next.length - 1 - suffix]) suffix++
        val before = marks.getOrNull(prefix - 1)?.takeIf { text[prefix - 1] != '\n' }
        val after = marks.getOrNull(text.length - suffix)?.takeIf { text[text.length - suffix] != '\n' }
        val typed = (before ?: after ?: Marks()).let { m -> m.copy(href = m.href?.takeIf { before?.href == it && after?.href == it }) }
        val inserted = next.substring(prefix, next.length - suffix).map { if (it == '\n') Marks() else typed }
        return RichDoc(kind, next, marks.take(prefix) + inserted + marks.takeLast(suffix), originals)
    }

    /** The range a toolbar action applies to: the selection, or the caret's whole line when nothing is selected. */
    fun target(selection: TextRange): IntRange {
        if (!selection.collapsed) return selection.min until selection.max
        val line = text.take(selection.start).count { it == '\n' }
        return lineRanges()[line]
    }

    /** Whether every character of [range] (newlines aside) carries [tag]. */
    fun has(range: IntRange, tag: String) = range.filter { text[it] != '\n' }.let { chars -> chars.isNotEmpty() && chars.all { tag in marks[it].tags } }

    /** Bold ("strong") or italic ("em") on [range]: removed when all of it has the mark, added otherwise. */
    fun toggle(range: IntRange, tag: String): RichDoc {
        val on = !has(range, tag)
        return RichDoc(kind, text, marks.mapIndexed { i, m -> if (i in range && text[i] != '\n') m.copy(tags = if (on) m.tags + tag else m.tags - tag) else m }, originals)
    }

    /** Links [range] to [url]; a blank url removes the link. */
    fun link(range: IntRange, url: String): RichDoc =
        RichDoc(kind, text, marks.mapIndexed { i, m -> if (i in range && text[i] != '\n') m.copy(href = url.trim().ifBlank { null }) else m }, originals)

    /** Replace swaps only the line whose text is [original]; null when that line changed meanwhile. */
    fun replace(original: String, replacement: String): RichDoc? {
        val index = plain.indexOf(original).takeIf { it >= 0 } ?: return null
        val range = lineRanges()[index]
        val text = this.text.replaceRange(range.first, range.last + 1, replacement)
        return RichDoc(kind, text, marks.take(range.first) + List(replacement.length) { Marks() } + marks.drop(range.last + 1), originals)
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

        fun parse(html: String): RichDoc {
            val kind = when {
                Regex("(?i)<ol[ >]").containsMatchIn(html) -> ListKind.Numbers
                Regex("(?i)<ul[ >]").containsMatchIn(html) -> ListKind.Bullets
                else -> ListKind.Paragraphs
            }
            val inners = Regex("(?is)<(li|p)[^>]*>(.*?)</\\1>").findAll(html).map { it.groupValues[2].trim() }.toList()
                .ifEmpty { if (html.isBlank()) listOf("") else htmlText(html).map(::escapeHtml) }
            val text = StringBuilder(); val marks = ArrayList<Marks>(); val originals = HashMap<String, String>()
            inners.forEachIndexed { index, inner ->
                if (index > 0) { text.append('\n'); marks += Marks() }
                val start = text.length
                readInner(inner, text, marks)
                val parsed = RichDoc(kind, text.toString(), marks.toList(), emptyMap())
                originals[parsed.serialize(start until text.length)] = inner
            }
            return RichDoc(kind, text.toString(), marks, originals)
        }

        private fun readInner(inner: String, text: StringBuilder, marks: MutableList<Marks>) {
            val stack = ArrayList<Pair<String, String?>>() // tag, href
            Regex("<(/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)").findAll(inner).forEach { m ->
                val chunk = m.groupValues[4]
                if (chunk.isNotEmpty()) {
                    val decoded = innerText(chunk)
                    val current = Marks(stack.mapNotNull { (t, _) -> t.takeIf { it in TAGS } }.toSet(), stack.lastOrNull { it.first == "a" }?.second)
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
    }
}

/**
 * Draws each line's bold, italic and link marks and its bullet or number, without changing the edited text, and
 * tints [highlight] (the line Improve is asking about) as the board does.
 */
internal class RichTransformation(
    private val doc: RichDoc,
    private val hanging: androidx.compose.ui.unit.TextUnit,
    private val linkColor: androidx.compose.ui.graphics.Color,
    private val highlight: IntRange? = null,
    private val highlightColor: androidx.compose.ui.graphics.Color = androidx.compose.ui.graphics.Color.Unspecified,
) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val lines = text.text.split('\n')
        val prefixes = lines.indices.map { i -> when (doc.kind) { ListKind.Bullets -> "•  "; ListKind.Numbers -> "${i + 1}.  "; ListKind.Paragraphs -> "" } }
        val styled = text.text == doc.text
        val starts = lines.runningFold(0) { acc, l -> acc + l.length + 1 }
        val offsets = prefixes.runningFold(0) { acc, p -> acc + p.length }
        val out = buildAnnotatedString {
            lines.forEachIndexed { i, line ->
                append(prefixes[i])
                val base = length
                append(line)
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
                            color = if (m.href != null) linkColor else androidx.compose.ui.graphics.Color.Unspecified,
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
            // One paragraph style over the whole text: each line is its own paragraph and wraps under its text.
            if (doc.kind != ListKind.Paragraphs) addStyle(ParagraphStyle(textIndent = TextIndent(firstLine = 0.sp, restLine = hanging)), 0, length)
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

/** Improve's line actions (web improve.tsx): Stronger verb, Add a result, Make it shorter, Ask for something else…. */
internal enum class ImproveAction(val label: Int, val wire: CreateImprovementRequestAction) {
    Verb(S.string.stronger_verb, CreateImprovementRequestAction.Verb),
    Result(S.string.add_a_result, CreateImprovementRequestAction.Result),
    Shorter(S.string.make_it_shorter, CreateImprovementRequestAction.Shorter),
    Custom(S.string.ask_for_something_else, CreateImprovementRequestAction.Custom),
    ;

    companion object { fun of(wire: CreateImprovementRequestAction) = entries.firstOrNull { it.wire == wire } ?: Verb }
}

@Composable
internal fun RichTextRoute(route: BuilderRichText, vm: BuilderViewModel, nav: NavController) {
    val state by vm.state.collectAsStateWithLifecycle()
    RichTextScreen(state, route.section, route.itemId, route.field, vm, onBack = { nav.popBackStack() }, onSetUpAi = { nav.navigate(SettingsAi) })
}

/**
 * B4: the full-screen rich text editor. The toolbar rides on the keyboard: bold, italic, lists, link and Improve.
 * Improve asks about the line under the caret and shows the suggestion under the text; nothing changes until Replace.
 */
@Composable
internal fun RichTextScreen(
    state: BuilderUiState,
    section: String,
    itemId: String,
    field: String,
    actions: BuilderActions,
    onBack: () -> Unit,
    onSetUpAi: () -> Unit,
    initialCaretLine: Int? = null,
    initialSelection: TextRange? = null,
) {
    val doc = state.doc ?: return
    val ref = doc.section(section) ?: return
    val path = doc.itemPath(ref, itemId)?.plus(field) ?: return
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val reduced = LocalReducedMotion.current
    val stored = doc.json.at(path).str()
    var rich by remember { mutableStateOf(RichDoc.parse(stored)) }
    var value by remember { mutableStateOf(TextFieldValue(rich.text, initialSelection ?: initialCaretLine?.let { line -> TextRange(rich.plain.take(line).sumOf { it.length + 1 }) } ?: TextRange.Zero)) }
    var pending by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var ask by remember { mutableStateOf<ImproveAction?>(null) }
    var linking by remember { mutableStateOf<IntRange?>(null) }
    val caretLine = value.text.take(value.selection.start).count { it == '\n' }
    val currentLine = rich.plain.getOrNull(caretLine).orEmpty()
    val title = ref.kind.itemTitle(doc.items(ref).firstOrNull { it["id"].str() == itemId } ?: JsonObject(emptyMap()))
    val write = { next: RichDoc -> actions.edit { it.set(path, JsonPrimitive(next.toHtml())) as JsonObject } }
    // Keep the newest stored text unless the person is mid-edit; write after a short pause and when leaving.
    LaunchedEffect(stored) { if (!pending) { rich = RichDoc.parse(stored); if (rich.text != value.text) value = value.copy(text = rich.text) } }
    LaunchedEffect(value.text, pending) { if (pending) { delay(400); write(rich); pending = false } }
    DisposableEffect(Unit) { onDispose { if (pending) write(rich); actions.clearImprovement(); actions.setEditing(false) } }
    fun change(next: RichDoc) { rich = next; write(next) }
    val improve = state.improve
    // The line Improve is asking about is tinted while its card is open (B4 board).
    val askedLine = when (improve) { is ImproveState.Working -> improve.asked.line; is ImproveState.Ready -> improve.asked.line; is ImproveState.Failed -> improve.asked.line; else -> null }
    val askedRange = askedLine?.let { line -> rich.plain.indexOf(line).takeIf { it >= 0 }?.let { rich.lineRanges()[it] } }
    val target = rich.target(value.selection)
    val where = stringResource(fieldLabel(field))
    val done = { if (pending) { write(rich); pending = false }; onBack() }

    Column(Modifier.fillMaxSize().background(c.bg)) {
        RrTopBar(
            stringResource(fieldLabel(field)),
            onBack = done,
            status = if (title.isNotBlank() && ref.kind != SectionKind.Summary) ({ RrText(title) }) else null,
        ) { RrButton(stringResource(S.string.done), done, Modifier.padding(end = 10.dp), RrButtonVariant.Secondary) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            // Selection draws in the accent's soft fill with accent handles.
            CompositionLocalProvider(LocalTextSelectionColors provides TextSelectionColors(handleColor = c.accent, backgroundColor = c.accentSoft)) {
            BasicTextField(
                value = value,
                onValueChange = { next -> if (next.text != value.text) { rich = rich.withText(next.text); pending = true }; value = next },
                modifier = Modifier.fillMaxWidth().padding(16.dp).onFocusChanged { actions.setEditing(it.isFocused) },
                readOnly = state.locked,
                textStyle = RrType.input.copy(fontSize = 17.sp, lineHeight = 24.sp, color = c.ink),
                cursorBrush = SolidColor(c.accent),
                visualTransformation = RichTransformation(rich, 22.sp, c.accentText, highlight = askedRange, highlightColor = c.sunken),
            )
            }
            AnimatedVisibility(improve !is ImproveState.Idle && improve !is ImproveState.NoProvider, enter = expandVertically(tween(if (reduced) 0 else RrMotion.D2, easing = RrMotion.ease)) + fadeIn(), exit = shrinkVertically(tween(if (reduced) 0 else RrMotion.exit(RrMotion.D2))) + fadeOut()) {
                ImproveCard(
                    improve,
                    onClose = actions::clearImprovement,
                    onReplace = { ready ->
                        haptics(RrHaptic.Light)
                        val next = rich.replace(ready.asked.line, ready.text)
                        if (next == null) actions.toastError(S.string.the_line_changed_since_you_asked_so_it_wasn_t_replaced)
                        else { rich = next; value = value.copy(text = next.text); actions.replaceField(path, next.toHtml(), ready.operations) }
                    },
                    onTryAnother = { asked -> actions.improve(asked.line, rich.text, where, asked.action, asked.request) },
                )
            }
        }
        LaunchedEffect(improve) { if (improve is ImproveState.Failed) haptics(RrHaptic.Error) }
        // The formatting toolbar rides on top of the keyboard.
        Row(
            Modifier.fillMaxWidth().background(c.surface).imePadding().navigationBarsPadding().padding(horizontal = 6.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val enabled = !state.locked
            // Bold, italic and link act on the selection, or on the caret's line when nothing is selected.
            RrIconButton(D.drawable.ic_ph_text_b, stringResource(S.string.bold), { change(rich.toggle(target, "strong")) }, enabled = enabled, selected = rich.has(target, "strong"))
            RrIconButton(D.drawable.ic_ph_text_italic, stringResource(S.string.italic), { change(rich.toggle(target, "em")) }, enabled = enabled, selected = rich.has(target, "em"))
            RrIconButton(D.drawable.ic_ph_list_bullets, stringResource(S.string.bulleted_list), { change(rich.copy(kind = if (rich.kind == ListKind.Bullets) ListKind.Paragraphs else ListKind.Bullets)) }, enabled = enabled, selected = rich.kind == ListKind.Bullets)
            RrIconButton(D.drawable.ic_ph_list_numbers, stringResource(S.string.numbered_list), { change(rich.copy(kind = if (rich.kind == ListKind.Numbers) ListKind.Paragraphs else ListKind.Numbers)) }, enabled = enabled, selected = rich.kind == ListKind.Numbers)
            RrIconButton(D.drawable.ic_ph_link_simple, stringResource(S.string.link), { linking = target }, enabled = enabled && !target.isEmpty(), selected = !target.isEmpty() && rich.marksAt(target.first).href != null)
            Spacer(Modifier.weight(1f))
            RrButton(
                stringResource(S.string.improve),
                { if (improve is ImproveState.NoProvider) onSetUpAi() else menu = true },
                variant = RrButtonVariant.Soft,
                icon = D.drawable.ic_ph_sparkle,
                enabled = enabled && currentLine.isNotBlank(),
            )
        }
    }
    if (menu) RrBottomSheet(onDismissRequest = { menu = false }, fitContent = true, title = stringResource(S.string.improve_selected_line)) {
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            RrText(stringResource(S.string.original), style = RrType.small, color = c.ink3)
            RrText(currentLine, style = RrType.body, color = c.ink2)
        }
        ImproveAction.entries.forEach { a ->
            RrMenuItem(stringResource(a.label), {
                menu = false
                when (a) {
                    ImproveAction.Result, ImproveAction.Custom -> ask = a
                    else -> actions.improve(currentLine, rich.text, where, a.wire, null)
                }
            }, icon = D.drawable.ic_ph_sparkle)
        }
        state.aiProvider?.let { RrDisclosureLine(stringResource(S.string.sends_this_line_surrounding_field_text_and_your_instructions_to_0_1, it.label, it.model), Modifier.padding(16.dp)) }
    }
    ask?.let { a -> AskSheet(a, onDismiss = { ask = null }) { words -> ask = null; actions.improve(currentLine, rich.text, where, a.wire, words) } }
    linking?.let { range -> LinkSheet(rich.marksAt(range.first).href, onDismiss = { linking = null }) { url -> linking = null; change(rich.link(range, url)) } }
    LaunchedEffect(Unit) { actions.loadAiProvider() }
    if (improve is ImproveState.NoProvider) LaunchedEffect(improve) { onSetUpAi(); actions.clearImprovement() }
}

@Composable
private fun ImproveCard(state: ImproveState, onClose: () -> Unit, onReplace: (ImproveState.Ready) -> Unit, onTryAnother: (ImproveRequest) -> Unit) {
    val c = RrTheme.colors
    val asked = when (state) { is ImproveState.Working -> state.asked; is ImproveState.Ready -> state.asked; is ImproveState.Failed -> state.asked; else -> return }
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(RrShape.lg).background(c.raised).padding(1.dp)
            .background(c.surface).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RrIcon(D.drawable.ic_ph_sparkle, null, size = 20.dp, tint = c.accentText)
            RrText(stringResource(ImproveAction.of(asked.action).label), color = c.ink2, modifier = Modifier.weight(1f))
            RrIconButton(D.drawable.ic_ph_x, stringResource(S.string.close), onClose)
        }
        Column(Modifier.fillMaxWidth().clip(RrShape.md).background(c.sunken).padding(12.dp)) {
            RrText(stringResource(S.string.original), style = RrType.small, color = c.ink3)
            RrText(asked.line, style = RrType.ui)
        }
        when (state) {
            is ImproveState.Working -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { RrSpinner(); RrText(stringResource(S.string.improving), color = c.ink2) }
            is ImproveState.Failed -> {
                RrText(stringResource(if (state.destinationChanged) D.string.ds_ai_destination_changed else S.string.couldn_t_get_a_suggestion_nothing_changed), color = c.dangerText)
                // The renewed destination is disclosed before Try again sends anything to it.
                if (state.destinationChanged) RrDisclosureLine(stringResource(S.string.sends_this_line_surrounding_field_text_and_your_instructions_to_0_1, asked.provider, asked.model))
                RrButton(stringResource(S.string.try_again), { onTryAnother(asked) }, variant = RrButtonVariant.Secondary)
            }
            is ImproveState.Ready -> {
                Column(Modifier.fillMaxWidth().clip(RrShape.md).background(c.accentSoft).padding(12.dp)) {
                    RrText(stringResource(R.string.builder_suggestion), style = RrType.small, color = c.ink2)
                    RrText(state.text, style = RrType.ui)
                }
                val note = listOfNotNull(state.why.ifBlank { null }, if (state.addsFacts) stringResource(S.string.check_it_s_accurate) else null).joinToString(" ")
                if (note.isNotEmpty()) RrText(note, color = c.ink2)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RrButton(stringResource(S.string.replace), { onReplace(state) })
                    RrButton(stringResource(S.string.keep_mine), onClose, variant = RrButtonVariant.Secondary)
                    RrButton(stringResource(S.string.try_another), { onTryAnother(asked) }, variant = RrButtonVariant.Ghost)
                }
                RrDisclosureLine(stringResource(S.string.sends_this_line_surrounding_field_text_and_your_instructions_to_0_1, asked.provider, asked.model))
            }
        }
    }
}

/** "Add a result" asks first; "Ask for something else…" takes the request. */
@Composable
private fun AskSheet(action: ImproveAction, onDismiss: () -> Unit, onAsk: (String?) -> Unit) {
    var words by rememberSaveable { mutableStateOf("") }
    RrBottomSheet(onDismissRequest = onDismiss, fitContent = true, title = stringResource(action.label)) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val prompt = stringResource(if (action == ImproveAction.Result) S.string.what_changed_because_of_this_a_number_a_time_saved_who_used_it else S.string.what_should_change)
            RrTextField(words, { if (it.length <= 500) words = it }, Modifier.fillMaxWidth(), label = prompt, placeholder = if (action == ImproveAction.Custom) prompt else null, singleLine = false)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                RrButton(stringResource(if (action == ImproveAction.Result) S.string.add else S.string.ask), { onAsk(words) }, enabled = words.isNotBlank())
                if (action == ImproveAction.Result) RrButton(stringResource(S.string.i_don_t_have_one_yet), { onAsk(null) }, variant = RrButtonVariant.Ghost)
            }
        }
    }
}

@Composable
private fun LinkSheet(current: String?, onDismiss: () -> Unit, onLink: (String) -> Unit) {
    var url by rememberSaveable { mutableStateOf(current ?: "https://") }
    RrBottomSheet(onDismissRequest = onDismiss, fitContent = true, title = stringResource(S.string.link)) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            RrTextField(url, { url = it }, Modifier.fillMaxWidth(), label = stringResource(S.string.link_address), ltr = true)
            RrButton(stringResource(S.string.done), { onLink(url.takeIf { it != "https://" }.orEmpty()) })
        }
    }
}
