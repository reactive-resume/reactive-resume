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

/** A rich-text field as lines of inner HTML ("Led the <strong>redesign</strong>…") plus their list kind. */
internal data class RichDoc(val kind: ListKind, val lines: List<String>) {
    val plain: List<String> get() = lines.map(::innerText)

    fun toHtml(): String = when (kind) {
        ListKind.Paragraphs -> lines.joinToString("") { "<p>$it</p>" }
        ListKind.Bullets -> "<ul>" + lines.joinToString("") { "<li>$it</li>" } + "</ul>"
        ListKind.Numbers -> "<ol>" + lines.joinToString("") { "<li>$it</li>" } + "</ol>"
    }.let { if (lines.all { l -> l.isBlank() }) "" else it }

    /** New plain text from the editor: unchanged lines keep their markup, changed lines become plain text. */
    fun withText(text: String): RichDoc {
        val byPlain = lines.groupBy(::innerText)
        return copy(lines = text.split('\n').map { line -> byPlain[line]?.first() ?: escapeHtml(line) })
    }

    /** Bold or italic on a whole line, toggled. */
    fun toggle(index: Int, tag: String): RichDoc {
        val line = lines.getOrNull(index) ?: return this
        val open = "<$tag>"; val close = "</$tag>"
        val next = if (line.startsWith(open) && line.endsWith(close)) line.removePrefix(open).removeSuffix(close) else "$open$line$close"
        return copy(lines = lines.toMutableList().also { it[index] = next })
    }

    fun link(index: Int, url: String): RichDoc {
        val line = lines.getOrNull(index) ?: return this
        val inner = Regex("^<a [^>]*>(.*)</a>$").find(line)?.groupValues?.get(1) ?: line
        val next = if (url.isBlank()) inner else "<a href=\"${escapeHtml(url).replace("\"", "&quot;")}\">$inner</a>"
        return copy(lines = lines.toMutableList().also { it[index] = next })
    }

    /** Replace swaps only the line whose text is [original]; null when that line changed meanwhile. */
    fun replace(original: String, replacement: String): RichDoc? {
        val index = plain.indexOf(original).takeIf { it >= 0 } ?: return null
        return copy(lines = lines.toMutableList().also { it[index] = escapeHtml(replacement) })
    }

    companion object {
        fun parse(html: String): RichDoc {
            val kind = when {
                Regex("(?i)<ol[ >]").containsMatchIn(html) -> ListKind.Numbers
                Regex("(?i)<ul[ >]").containsMatchIn(html) -> ListKind.Bullets
                else -> ListKind.Paragraphs
            }
            val lines = Regex("(?is)<(li|p)[^>]*>(.*?)</\\1>").findAll(html).map { it.groupValues[2].trim() }.toList()
            return RichDoc(kind, lines.ifEmpty { if (html.isBlank()) listOf("") else htmlText(html).map(::escapeHtml) })
        }

        fun innerText(inner: String) = inner.replace(Regex("<[^>]+>"), "")
            .replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ").replace("&amp;", "&")
    }
}

/** Draws each line's bold, italic and link spans and its bullet or number, without changing the edited text. */
internal class RichTransformation(private val doc: RichDoc, private val hanging: androidx.compose.ui.unit.TextUnit, private val linkColor: androidx.compose.ui.graphics.Color) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val lines = text.text.split('\n')
        val prefixes = lines.indices.map { i -> when (doc.kind) { ListKind.Bullets -> "•  "; ListKind.Numbers -> "${i + 1}.  "; ListKind.Paragraphs -> "" } }
        val out = buildAnnotatedString {
            lines.forEachIndexed { i, line ->
                append(prefixes[i])
                val inner = doc.lines.getOrNull(i)?.takeIf { RichDoc.innerText(it) == line }
                if (inner == null) append(line) else appendInner(inner)
                if (i < lines.lastIndex) append('\n')
            }
            // One paragraph style over the whole text: each line is its own paragraph and wraps under its text.
            if (doc.kind != ListKind.Paragraphs) addStyle(ParagraphStyle(textIndent = TextIndent(firstLine = 0.sp, restLine = hanging)), 0, length)
        }
        val starts = lines.runningFold(0) { acc, l -> acc + l.length + 1 }
        val offsets = prefixes.runningFold(0) { acc, p -> acc + p.length }
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

    private fun AnnotatedString.Builder.appendInner(inner: String) {
        var bold = 0; var italic = 0; var link = 0
        Regex("<(/?)(strong|b|em|i|a)[^>]*>|([^<]+)").findAll(inner).forEach { m ->
            val text = m.groupValues[3]
            if (text.isNotEmpty()) {
                val style = SpanStyle(
                    fontWeight = if (bold > 0) FontWeight.Bold else null,
                    fontStyle = if (italic > 0) FontStyle.Italic else null,
                    textDecoration = if (link > 0) TextDecoration.Underline else null,
                    color = if (link > 0) linkColor else androidx.compose.ui.graphics.Color.Unspecified,
                )
                val start = length; append(RichDoc.innerText(text)); addStyle(style, start, length)
            } else {
                val delta = if (m.groupValues[1] == "/") -1 else 1
                when (m.groupValues[2]) { "strong", "b" -> bold += delta; "em", "i" -> italic += delta; "a" -> link += delta }
            }
        }
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
) {
    val doc = state.doc ?: return
    val ref = doc.section(section) ?: return
    val path = doc.itemPath(ref, itemId)?.plus(field) ?: return
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val reduced = LocalReducedMotion.current
    val stored = doc.json.at(path).str()
    var rich by remember { mutableStateOf(RichDoc.parse(stored)) }
    var value by remember { mutableStateOf(TextFieldValue(rich.plain.joinToString("\n"), initialCaretLine?.let { line -> TextRange(rich.plain.take(line).sumOf { it.length + 1 }) } ?: TextRange.Zero)) }
    var pending by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var ask by remember { mutableStateOf<ImproveAction?>(null) }
    var linking by remember { mutableStateOf(false) }
    val caretLine = value.text.take(value.selection.start).count { it == '\n' }
    val currentLine = rich.plain.getOrNull(caretLine).orEmpty()
    val title = ref.kind.itemTitle(doc.items(ref).firstOrNull { it["id"].str() == itemId } ?: JsonObject(emptyMap()))
    val write = { next: RichDoc -> actions.edit { it.set(path, JsonPrimitive(next.toHtml())) as JsonObject } }
    // Keep the newest stored text unless the person is mid-edit; write after a short pause and when leaving.
    LaunchedEffect(stored) { if (!pending) { rich = RichDoc.parse(stored); if (rich.plain.joinToString("\n") != value.text) value = value.copy(text = rich.plain.joinToString("\n")) } }
    LaunchedEffect(value.text, pending) { if (pending) { delay(400); write(rich); pending = false } }
    DisposableEffect(Unit) { onDispose { if (pending) write(rich); actions.clearImprovement(); actions.setEditing(false) } }
    fun change(next: RichDoc) { rich = next; write(next) }
    val improve = state.improve
    val where = stringResource(fieldLabel(field))
    val done = { if (pending) { write(rich); pending = false }; onBack() }

    Column(Modifier.fillMaxSize().background(c.bg)) {
        RrTopBar(
            stringResource(fieldLabel(field)),
            onBack = done,
            status = if (title.isNotBlank() && ref.kind != SectionKind.Summary) ({ RrText(title) }) else null,
        ) { RrButton(stringResource(S.string.done), done, Modifier.padding(end = 10.dp), RrButtonVariant.Secondary) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            BasicTextField(
                value = value,
                onValueChange = { next -> if (next.text != value.text) { rich = rich.withText(next.text); pending = true }; value = next },
                modifier = Modifier.fillMaxWidth().padding(16.dp).onFocusChanged { actions.setEditing(it.isFocused) },
                readOnly = state.locked,
                textStyle = RrType.input.copy(fontSize = 17.sp, lineHeight = 24.sp, color = c.ink),
                cursorBrush = SolidColor(c.accent),
                visualTransformation = RichTransformation(rich, 22.sp, c.accentText),
            )
            AnimatedVisibility(improve !is ImproveState.Idle && improve !is ImproveState.NoProvider, enter = expandVertically(tween(if (reduced) 0 else RrMotion.D2, easing = RrMotion.ease)) + fadeIn(), exit = shrinkVertically(tween(if (reduced) 0 else RrMotion.exit(RrMotion.D2))) + fadeOut()) {
                ImproveCard(
                    improve,
                    onClose = actions::clearImprovement,
                    onReplace = { ready ->
                        haptics(RrHaptic.Light)
                        val next = rich.replace(ready.asked.line, ready.text)
                        if (next == null) actions.toastError(S.string.the_line_changed_since_you_asked_so_it_wasn_t_replaced)
                        else { rich = next; value = value.copy(text = next.plain.joinToString("\n")); actions.replaceField(path, next.toHtml(), ready.operations) }
                    },
                    onTryAnother = { asked -> actions.improve(asked.line, rich.plain.joinToString("\n"), where, asked.action, asked.request) },
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
            RrIconButton(D.drawable.ic_ph_text_b, stringResource(S.string.bold), { change(rich.toggle(caretLine, "strong")) }, enabled = enabled)
            RrIconButton(D.drawable.ic_ph_text_italic, stringResource(S.string.italic), { change(rich.toggle(caretLine, "em")) }, enabled = enabled)
            RrIconButton(D.drawable.ic_ph_list_bullets, stringResource(S.string.bulleted_list), { change(rich.copy(kind = if (rich.kind == ListKind.Bullets) ListKind.Paragraphs else ListKind.Bullets)) }, enabled = enabled, selected = rich.kind == ListKind.Bullets)
            RrIconButton(D.drawable.ic_ph_list_numbers, stringResource(S.string.numbered_list), { change(rich.copy(kind = if (rich.kind == ListKind.Numbers) ListKind.Paragraphs else ListKind.Numbers)) }, enabled = enabled, selected = rich.kind == ListKind.Numbers)
            RrIconButton(D.drawable.ic_ph_link_simple, stringResource(S.string.link), { linking = true }, enabled = enabled && currentLine.isNotBlank())
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
                    else -> actions.improve(currentLine, rich.plain.joinToString("\n"), where, a.wire, null)
                }
            }, icon = D.drawable.ic_ph_sparkle)
        }
        state.aiProvider?.let { RrDisclosureLine(stringResource(S.string.sends_this_line_surrounding_field_text_and_your_instructions_to_0_1, it.label, it.model), Modifier.padding(16.dp)) }
    }
    ask?.let { a -> AskSheet(a, onDismiss = { ask = null }) { words -> ask = null; actions.improve(currentLine, rich.plain.joinToString("\n"), where, a.wire, words) } }
    if (linking) LinkSheet(onDismiss = { linking = false }) { url -> linking = false; change(rich.link(caretLine, url)) }
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
                RrText(stringResource(S.string.couldn_t_get_a_suggestion_nothing_changed), color = c.dangerText)
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
private fun LinkSheet(onDismiss: () -> Unit, onLink: (String) -> Unit) {
    var url by rememberSaveable { mutableStateOf("https://") }
    RrBottomSheet(onDismissRequest = onDismiss, fitContent = true, title = stringResource(S.string.link)) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            RrTextField(url, { url = it }, Modifier.fillMaxWidth(), label = stringResource(S.string.link_address), ltr = true)
            RrButton(stringResource(S.string.done), { onLink(url.takeIf { it != "https://" }.orEmpty()) })
        }
    }
}
