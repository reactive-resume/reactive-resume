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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
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
import me.rxresu.core.designsystem.RrListKind
import me.rxresu.core.designsystem.RrMarks
import me.rxresu.core.designsystem.RrRichDoc
import me.rxresu.core.designsystem.RrRichTextField
import me.rxresu.core.designsystem.RrRichTextToolbar
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

/** The shared rich-text model and drawing ([RrRichDoc]); the builder's fields are one list or paragraphs throughout. */
internal typealias ListKind = RrListKind
internal typealias Marks = RrMarks
internal typealias RichDoc = RrRichDoc

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
    val where = stringResource(fieldLabel(field))
    val done = { if (pending) { write(rich); pending = false }; onBack() }

    Column(Modifier.fillMaxSize().background(c.bg)) {
        RrTopBar(
            stringResource(fieldLabel(field)),
            onBack = done,
            status = if (title.isNotBlank() && ref.kind != SectionKind.Summary) ({ RrText(title) }) else null,
        ) { RrButton(stringResource(S.string.done), done, Modifier.padding(end = 10.dp), RrButtonVariant.Secondary) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            RrRichTextField(
                value = value,
                doc = rich,
                onValueChange = { next, doc -> if (next.text != value.text) { rich = doc; pending = true }; value = next },
                modifier = Modifier.fillMaxWidth().padding(16.dp).onFocusChanged { actions.setEditing(it.isFocused) },
                readOnly = state.locked,
                highlight = askedRange,
                placeholder = if (ref.kind == SectionKind.Summary) null else stringResource(S.string.describe_the_role),
            )
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
        // The formatting toolbar rides on top of the keyboard. Bold, italic and link act on the selection, or on the
        // caret's line when nothing is selected; lists switch the whole field.
        RrRichTextToolbar(
            rich,
            value.selection,
            ::change,
            Modifier.fillMaxWidth().background(c.surface).imePadding().navigationBarsPadding().padding(horizontal = 6.dp, vertical = 6.dp),
            enabled = !state.locked,
            wholeField = true,
        ) {
            Spacer(Modifier.weight(1f))
            RrButton(
                stringResource(S.string.improve),
                { if (improve is ImproveState.NoProvider) onSetUpAi() else menu = true },
                variant = RrButtonVariant.Soft,
                icon = D.drawable.ic_ph_sparkle,
                enabled = !state.locked && currentLine.isNotBlank(),
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
    }
    ask?.let { a -> AskSheet(a, onDismiss = { ask = null }) { words -> ask = null; actions.improve(currentLine, rich.text, where, a.wire, words) } }
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
