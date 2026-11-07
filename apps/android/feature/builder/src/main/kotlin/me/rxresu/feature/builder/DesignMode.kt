package me.rxresu.feature.builder

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.core.graphics.toColorInt
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrElevation
import me.rxresu.core.designsystem.RrFilterChip
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrIconButtonSize
import me.rxresu.core.designsystem.RrMenu
import me.rxresu.core.designsystem.RrMenuItem
import me.rxresu.core.designsystem.RrMenuLabel
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrPaperPage
import me.rxresu.core.designsystem.RrPickerField
import me.rxresu.core.designsystem.RrRadius
import me.rxresu.core.designsystem.RrSearchField
import me.rxresu.core.designsystem.RrSegment
import me.rxresu.core.designsystem.RrSegmentedControl
import me.rxresu.core.designsystem.RrShape
import me.rxresu.core.designsystem.RrSlider
import me.rxresu.core.designsystem.RrSpinner
import me.rxresu.core.designsystem.RrSwitchRow
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.designsystem.rrDashedBorder
import me.rxresu.core.designsystem.rrShadow
import me.rxresu.core.navigation.DesignGroup
import me.rxresu.core.strings.R as S
import me.rxresu.core.designsystem.R as D

/** The design sheet's groups. Template and Type and Layout are the route's; the rest live inside the sheet. */
internal enum class DesignPanel(val title: Int) {
    Template(S.string.template), Type(S.string.type), Color(S.string.color), Page(S.string.page), Layout(S.string.layout), Advanced(S.string.advanced);

    /** Template opens lowered so the page stays big; the denser groups open raised. */
    val raised get() = this != Template

    companion object { fun of(group: DesignGroup) = when (group) { DesignGroup.Template -> Template; DesignGroup.Type -> Type; DesignGroup.Layout -> Layout } }
}

/** Accent presets (web design/presets.ts), written as rgba to metadata.design.colors.primary. */
internal enum class Accent(val label: Int, val hex: String) {
    Moss(S.string.moss, "#3E6B4F"), InkBlue(S.string.ink_blue, "#2F5A8A"), Teal(S.string.teal, "#1F6E73"), Plum(S.string.plum, "#6B3E6E"),
    Rust(S.string.rust, "#A0442A"), Burgundy(S.string.burgundy, "#8A2C3F"), Ochre(S.string.ochre, "#7A5A12"), Graphite(S.string.graphite, "#3B3F45"),
}

/** Font pairings (web design/presets.ts): heading family, body family, heading weight. Body weights are 400 and 700. */
internal enum class Pairing(val label: Int, val heading: String, val body: String, val weight: String, val serif: Boolean) {
    Classic(S.string.classic, "EB Garamond", "EB Garamond", "600", true),
    Traditional(S.string.traditional, "Tinos", "Tinos", "700", true),
    Balanced(S.string.balanced, "Source Serif 4", "Source Sans 3", "600", false),
    Professional(S.string.professional, "Carlito", "Carlito", "700", false),
    Clean(S.string.clean, "Lato", "Lato", "700", false),
    ;

    fun apply(json: JsonObject): JsonObject {
        val t = listOf("data", "metadata", "typography")
        fun weights(vararg w: String) = kotlinx.serialization.json.JsonArray(w.map(::JsonPrimitive))
        return json.set(t + listOf("heading", "fontFamily"), JsonPrimitive(heading)).set(t + listOf("heading", "fontWeights"), weights(weight))
            .set(t + listOf("body", "fontFamily"), JsonPrimitive(body)).set(t + listOf("body", "fontWeights"), weights("400", "700")) as JsonObject
    }

    companion object {
        fun of(json: JsonObject): Pairing? {
            val t = json.at(listOf("data", "metadata", "typography")).obj()
            return entries.firstOrNull { it.heading == t["heading"].obj()["fontFamily"].str() && it.body == t["body"].obj()["fontFamily"].str() }
        }
    }
}

/** Resume languages (packages/utils/src/locale.ts, without the pseudo-locale). */
internal val resumeLocales = "af-ZA,am-ET,ar-SA,az-AZ,bg-BG,bn-BD,ca-ES,cs-CZ,da-DK,de-DE,el-GR,en-US,en-GB,es-ES,fa-IR,fi-FI,fr-FR,he-IL,hi-IN,hu-HU,id-ID,it-IT,ja-JP,km-KH,kn-IN,ko-KR,lt-LT,lv-LV,ml-IN,mr-IN,ms-MY,ne-NP,nl-NL,no-NO,or-IN,pl-PL,pt-BR,pt-PT,ro-RO,ru-RU,sk-SK,sl-SI,sq-AL,sr-SP,sv-SE,ta-IN,te-IN,th-TH,tr-TR,uk-UA,uz-UZ,vi-VN,zh-CN,zh-TW".split(',')

/** A locale's name in its own language ("English (United Kingdom)", "Deutsch (Deutschland)"). */
internal fun localeName(tag: String): String = Locale.forLanguageTag(tag).let { it.getDisplayName(it).replaceFirstChar { c -> c.titlecase(it) } }

/** "#3E6B4F" ↔ "rgba(62, 107, 79, 1)". */
internal object Rgba {
    fun fromHex(hex: String): String? {
        val h = hex.trim().removePrefix("#").let { if (it.length == 3) it.map { c -> "$c$c" }.joinToString("") else it }
        if (!Regex("^[0-9a-fA-F]{6}$").matches(h)) return null
        val v = h.toInt(16)
        return "rgba(${v shr 16 and 255}, ${v shr 8 and 255}, ${v and 255}, 1)"
    }

    fun toHex(rgba: String): String? {
        val n = Regex("\\d+(\\.\\d+)?").findAll(rgba).map { it.value.toDouble() }.toList()
        if (n.size < 3) return null
        return "#%02X%02X%02X".format(n[0].toInt(), n[1].toInt(), n[2].toInt())
    }

    private fun channel(c: Int): Double = (c / 255.0).let { if (it <= 0.03928) it / 12.92 else Math.pow((it + 0.055) / 1.055, 2.4) }

    /** WCAG contrast of the colour against white paper. */
    fun contrastOnWhite(hex: String): Double {
        val v = hex.removePrefix("#").toInt(16)
        val l = 0.2126 * channel(v shr 16 and 255) + 0.7152 * channel(v shr 8 and 255) + 0.0722 * channel(v and 255)
        return 1.05 / (l + 0.05)
    }

    /** The web's "Use a darker shade": 0.93 per step until contrast reaches 4.6 (40 steps), else #333333. */
    fun darker(hex: String): String {
        var v = hex.removePrefix("#").toInt(16)
        repeat(40) {
            v = (((v shr 16 and 255) * 0.93).toInt() shl 16) or (((v shr 8 and 255) * 0.93).toInt() shl 8) or ((v and 255) * 0.93).toInt()
            val next = "#%06X".format(v)
            if (contrastOnWhite(next) >= 4.6) return next
        }
        return "#333333"
    }
}

private fun Accent.color() = Color(hex.toColorInt())

/** B6–B8: the live page in the top part and the docked design sheet with its groups. */
@Composable
internal fun DesignMode(
    state: BuilderUiState,
    group: DesignGroup,
    onGroup: (DesignGroup) -> Unit,
    actions: BuilderActions,
    modifier: Modifier = Modifier,
) {
    val doc = state.doc ?: return
    val haptics = rememberRrHaptics()
    val reduced = LocalReducedMotion.current
    val scope = rememberCoroutineScope()
    var panel by rememberSaveable { mutableStateOf(DesignPanel.of(group)) }
    BoxWithConstraints(modifier.fillMaxSize().background(RrTheme.colors.sunken)) {
        val total = maxHeight
        val lowered = total * 0.55f
        val raised = total * 0.76f
        val height = remember { Animatable((if (panel.raised) raised else lowered).value) }
        fun snap(up: Boolean) = scope.launch {
            haptics(RrHaptic.Selection)
            height.animateTo((if (up) raised else lowered).value, tween(if (reduced) 0 else RrMotion.D3, easing = RrMotion.easeDrawer))
        }
        val sheetHeight = height.value.dp
        val pageArea = total - sheetHeight
        // The page shrinks with the sheet and stays live; tap it to lower the sheet.
        val pageHeight = (pageArea + 8.dp).coerceAtLeast(80.dp)
        Box(Modifier.fillMaxWidth().padding(top = 12.dp).clickable(enabled = height.value > lowered.value + 1, onClickLabel = stringResource(S.string.lower_the_design_sheet)) { snap(false) }, contentAlignment = Alignment.TopCenter) {
            RrPaperPage(state.pages.firstOrNull(), stringResource(S.string.page_0_of_1, "1", "${state.pages.size.coerceAtLeast(1)}"), Modifier.height(pageHeight).aspectRatio(me.rxresu.core.designsystem.RrLayout.PAGE_ASPECT))
        }
        DockedSheet(
            height = sheetHeight,
            raised = height.value > (lowered.value + raised.value) / 2,
            onDrag = { delta -> scope.launch { height.snapTo((height.value - delta).coerceIn(lowered.value, raised.value)) } },
            onSettle = { velocityUp -> snap(velocityUp ?: (height.value > (lowered.value + raised.value) / 2)) },
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DesignPanel.entries.forEach { p ->
                    RrFilterChip(stringResource(p.title), selected = p == panel, onSelectedChange = {
                        if (p != panel) {
                            haptics(RrHaptic.Selection); panel = p
                            when (p) { DesignPanel.Template -> onGroup(DesignGroup.Template); DesignPanel.Type -> onGroup(DesignGroup.Type); DesignPanel.Layout -> onGroup(DesignGroup.Layout); else -> Unit }
                            if (p.raised != (height.value > (lowered.value + raised.value) / 2)) snap(p.raised)
                        }
                    })
                }
            }
            AnimatedContent(panel, transitionSpec = { fadeIn(tween(if (reduced) RrMotion.D1 else RrMotion.D2)) togetherWith fadeOut(tween(RrMotion.exit(RrMotion.D2))) }, label = "design-group") { shown ->
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
                    val enabled = !state.locked
                    when (shown) {
                        DesignPanel.Template -> { TemplatePicker(doc, actions, enabled); AccentRow(doc, actions, enabled) }
                        DesignPanel.Type -> { TypeGroup(doc, actions, enabled); Divider(); PageGroup(doc, actions, enabled) }
                        DesignPanel.Color -> { AccentRow(doc, actions, enabled); CustomColor(doc, actions, enabled) }
                        DesignPanel.Page -> PageGroup(doc, actions, enabled)
                        DesignPanel.Layout -> LayoutGroup(state, doc, actions, enabled)
                        DesignPanel.Advanced -> AdvancedGroup(doc, actions, enabled)
                    }
                }
            }
        }
    }
}

/**
 * A sheet docked above the mode bar: no scrim, never dismissed, two heights. Drag the grabber area between them;
 * screen readers get Raise / Lower actions.
 */
// TODO(lead): move to designsystem as a docked mode of RrBottomSheet (no scrim, not dismissable, two detents).
@Composable
private fun DockedSheet(height: Dp, raised: Boolean, onDrag: (Float) -> Unit, onSettle: (Boolean?) -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val c = RrTheme.colors
    val density = LocalDensity.current
    val raise = stringResource(S.string.raise_the_design_sheet)
    val lower = stringResource(S.string.lower_the_design_sheet)
    Column(
        modifier.fillMaxWidth().height(height)
            .rrShadow(RrElevation.Level3, RrShape.sheetTop).clip(RrShape.sheetTop).background(c.raised)
            .semantics { customActions = listOf(if (raised) CustomAccessibilityAction(lower) { onSettle(false); true } else CustomAccessibilityAction(raise) { onSettle(true); true }) },
    ) {
        Box(
            Modifier.fillMaxWidth().height(20.dp).draggable(
                rememberDraggableState { onDrag(with(density) { it.toDp().value }) },
                Orientation.Vertical,
                onDragStopped = { velocity -> onSettle(if (kotlin.math.abs(velocity) > 600f) velocity < 0 else null) },
            ),
            contentAlignment = Alignment.TopCenter,
        ) { Box(Modifier.padding(top = 8.dp).size(36.dp, 4.dp).clip(RrShape.sm).background(c.line2)) }
        content()
    }
}

@Composable
private fun Eyebrow(text: String, modifier: Modifier = Modifier, trailing: String? = null) {
    Row(modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        RrText(text, style = RrType.eyebrow.copy(fontSize = RrType.ui.fontSize, lineHeight = RrType.ui.lineHeight), color = RrTheme.colors.ink3, modifier = Modifier.weight(1f))
        if (trailing != null) RrText(trailing, color = RrTheme.colors.ink3)
    }
}

@Composable
private fun Divider() = Box(Modifier.padding(horizontal = 16.dp, vertical = 12.dp).fillMaxWidth().height(1.dp).background(RrTheme.colors.line))

private enum class TemplateFilter(val label: Int) { All(S.string.all), One(S.string.one_column), Two(S.string.two_columns), Ats(S.string.ats_safe) }

@Composable
private fun TemplatePicker(doc: ResumeDoc, actions: BuilderActions, enabled: Boolean) {
    var filter by rememberSaveable { mutableStateOf(TemplateFilter.All) }
    var grid by remember { mutableStateOf(false) }
    val haptics = rememberRrHaptics()
    val shown = TemplateInfo.entries.filter { t -> when (filter) { TemplateFilter.All -> true; TemplateFilter.One -> t.columns == 1; TemplateFilter.Two -> t.columns == 2; TemplateFilter.Ats -> t.atsSafe } }
    Eyebrow(stringResource(S.string.template), trailing = stringResource(S.string.message_0_of_1_shown, "${shown.size}", "${TemplateInfo.entries.size}"))
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TemplateFilter.entries.forEach { f -> RrFilterChip(stringResource(f.label), f == filter, { haptics(RrHaptic.Selection); filter = f }) }
    }
    val pick = { t: TemplateInfo ->
        if (t.id != doc.template) {
            haptics(RrHaptic.Selection)
            actions.edit(BuilderToast(S.string.template_changed_to_0, listOf(t.label), undo = true)) { it.set(listOf("data", "metadata", "template"), JsonPrimitive(t.id)) as JsonObject }
        }
    }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        shown.sortedByDescending { it.id == doc.template }.forEach { t -> TemplateCard(t, t.id == doc.template, enabled) { pick(t) } }
    }
    RrButton(stringResource(R.string.builder_show_templates), { grid = true }, Modifier.padding(horizontal = 8.dp), RrButtonVariant.Ghost)
    if (grid) RrBottomSheet(onDismissRequest = { grid = false }, title = stringResource(S.string.template)) {
        @OptIn(ExperimentalLayoutApi::class)
        FlowRow(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            shown.forEach { t -> TemplateCard(t, t.id == doc.template, enabled) { pick(t); grid = false } }
        }
    }
}

@Composable
private fun TemplateCard(t: TemplateInfo, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val c = RrTheme.colors
    val reduced = LocalReducedMotion.current
    val ring = remember { Animatable(if (selected) 1f else 0f) }
    LaunchedEffect(selected) { ring.animateTo(if (selected) 1f else 0f, tween(if (reduced) 0 else RrMotion.D1)) }
    Column(
        Modifier.width(84.dp).clickable(enabled = enabled, role = Role.RadioButton, onClick = onClick).semantics { this.selected = selected },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(me.rxresu.core.designsystem.RrLayout.PAGE_ASPECT)
                .graphicsLayer { alpha = 1f }
                .border(2.dp, c.accent.copy(alpha = ring.value), RrShape.xs).padding(2.dp)
                .rrShadow(RrElevation.Level1, RrShape.xs).clip(RrShape.xs),
        ) {
            Image(androidx.compose.ui.graphics.ImageBitmap.imageResource(t.preview), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        }
        RrText(t.label, style = RrType.caption, color = if (selected) c.ink else c.ink2)
    }
}

@Composable
private fun AccentRow(doc: ResumeDoc, actions: BuilderActions, enabled: Boolean) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val current = Rgba.toHex(doc.metadata["design"].obj()["colors"].obj()["primary"].str())
    Eyebrow(stringResource(S.string.accent_color))
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Accent.entries.forEach { a ->
            val label = stringResource(a.label)
            val selected = current.equals(a.hex, ignoreCase = true)
            Box(
                Modifier.size(44.dp, 44.dp)
                    .then(if (selected) Modifier.border(2.dp, c.accent, RrShape.sm).padding(4.dp) else Modifier.padding(4.dp))
                    .clip(RrShape.sm).background(a.color())
                    .clickable(enabled = enabled, role = Role.RadioButton, onClickLabel = null) {
                        haptics(RrHaptic.Selection); actions.set(listOf("data", "metadata", "design", "colors", "primary"), JsonPrimitive(Rgba.fromHex(a.hex)!!))
                    }
                    .semantics { this.selected = selected; contentDescription = label },
                contentAlignment = Alignment.Center,
            ) { if (selected) RrIcon(D.drawable.ic_ph_check, null, size = 20.dp, tint = me.rxresu.core.designsystem.RrFixedColors.paper) }
        }
    }
}

@Composable
private fun CustomColor(doc: ResumeDoc, actions: BuilderActions, enabled: Boolean) {
    val current = Rgba.toHex(doc.metadata["design"].obj()["colors"].obj()["primary"].str()).orEmpty()
    var text by rememberSaveable(current) { mutableStateOf(current) }
    val valid = Rgba.fromHex(text) != null
    val hex = if (valid) "#" + text.trim().removePrefix("#").uppercase().let { if (it.length == 3) it.map { c -> "$c$c" }.joinToString("") else it } else null
    val ratio = hex?.let { Rgba.contrastOnWhite(it) }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RrTextField(
            text,
            { text = it; Rgba.fromHex(it)?.let { rgba -> actions.set(listOf("data", "metadata", "design", "colors", "primary"), JsonPrimitive(rgba)) } },
            Modifier.fillMaxWidth(),
            label = stringResource(S.string.custom_color_hex),
            error = if (!valid && text.isNotBlank()) stringResource(S.string.use_a_hex_color_such_as_2f5a8a) else null,
            helper = ratio?.let { "%.1f:1".format(it) },
            ltr = true, mono = true, enabled = enabled,
            trailing = { if (hex != null) Box(Modifier.size(20.dp).clip(RrShape.xs).background(Color(hex.toColorInt()))) },
        )
        if (ratio != null && ratio < 4.5) {
            RrCallout(
                stringResource(S.string.too_light_for_headings_on_white_it_may_be_hard_to_read_and_print_faintly), tone = RrTone.Warn,
                actionLabel = stringResource(S.string.use_a_darker_shade),
                onAction = { val d = Rgba.darker(hex); text = d; actions.set(listOf("data", "metadata", "design", "colors", "primary"), JsonPrimitive(Rgba.fromHex(d)!!)) },
            )
        }
        RrText(stringResource(S.string.accent_is_used_for_headings_icons_and_the_header_band_body_text_stays_near_black_for_print_and_ats), style = RrType.small, color = RrTheme.colors.ink3)
    }
}

/** A labelled control row: label (and hint) at the start, control at the end. */
@Composable
private fun ControlRow(label: String, hint: String? = null, controlWidth: Dp = 220.dp, control: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            RrText(label, style = RrType.body)
            if (hint != null) RrText(hint, color = RrTheme.colors.ink3)
        }
        Box(Modifier.width(controlWidth)) { control() }
    }
}

@Composable
private fun TypeGroup(doc: ResumeDoc, actions: BuilderActions, enabled: Boolean) {
    val haptics = rememberRrHaptics()
    val c = RrTheme.colors
    val pairing = Pairing.of(doc.json)
    Eyebrow(stringResource(S.string.font_pairing))
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Pairing.entries.forEach { p ->
            val selected = p == pairing
            // TODO(lead): a selectable "choice card" component (B7 font pairings) would replace this token-built card.
            Column(
                Modifier.width(114.dp).heightIn(min = 56.dp).clip(RrShape.md)
                    .background(if (selected) c.accentSoft else c.raised)
                    .border(1.dp, if (selected) c.accent else c.line2, RrShape.md)
                    .clickable(enabled = enabled, role = Role.RadioButton) { haptics(RrHaptic.Selection); actions.edit { p.apply(it) } }
                    .semantics { this.selected = selected }
                    .padding(vertical = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                RrText("Aa", style = RrType.title.copy(fontFamily = if (p.serif) FontFamily.Serif else FontFamily.SansSerif, fontWeight = if (p.weight == "700") FontWeight.Bold else FontWeight.Normal, fontSize = RrType.sheetTitle.fontSize), color = if (selected) c.accentText else c.ink)
                RrText(stringResource(p.label), style = RrType.body, color = if (selected) c.accentText else c.ink2)
            }
        }
        Column(Modifier.width(114.dp).clip(RrShape.md).border(1.dp, c.line2, RrShape.md).padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            RrText(stringResource(S.string.custom), style = RrType.body)
            RrText(stringResource(S.string.any_font_in_advanced), style = RrType.small, color = c.ink3)
        }
    }
    val size = doc.metadata["typography"].obj()["body"].obj()["fontSize"].num() ?: 10.0
    Spacer(Modifier.height(12.dp))
    ControlRow(stringResource(S.string.text_size), stringResource(S.string.message_1011_recommended), controlWidth = 144.dp) {
        // Held steps read the newest size and join one undo step per press.
        fun step(delta: Double, press: String) = actions.edit(undoStep = press) { json ->
            val current = json.at(listOf("data", "metadata", "typography", "body", "fontSize")).num() ?: size
            TextSize.apply(json, (current + delta).coerceIn(TextSize.MIN, TextSize.MAX))
        }
        HoldStepper(
            stringResource(S.string.textsize_pt, size.toString().removeSuffix(".0")),
            onDecrease = { press -> step(-0.5, press) },
            onIncrease = { press -> step(0.5, press) },
            label = stringResource(S.string.text_size),
            canDecrease = enabled && size > TextSize.MIN, canIncrease = enabled && size < TextSize.MAX,
        )
    }
    if (size < 9) RrText(stringResource(S.string.body_text_is_very_small), color = c.warnText, modifier = Modifier.padding(horizontal = 16.dp))
    val density = Density.of(doc.json) ?: Density.Normal
    ControlRow(stringResource(S.string.density)) {
        RrSegmentedControl(
            Density.entries.map { RrSegment(stringResource(when (it) { Density.Compact -> S.string.compact; Density.Normal -> S.string.normal; Density.Roomy -> S.string.roomy })) },
            density.ordinal, { if (enabled) { haptics(RrHaptic.Selection); actions.edit { j -> Density.entries[it].apply(j) } } },
        )
    }
}

@Composable
private fun PageGroup(doc: ResumeDoc, actions: BuilderActions, enabled: Boolean) {
    val haptics = rememberRrHaptics()
    var languages by remember { mutableStateOf(false) }
    val page = doc.metadata["page"].obj()
    Eyebrow(stringResource(S.string.page))
    val formats = listOf("a4" to R.string.builder_a4, "letter" to S.string.letter, "free-form" to S.string.free_form)
    ControlRow(stringResource(S.string.paper)) {
        RrSegmentedControl(formats.map { RrSegment(stringResource(it.second)) }, formats.indexOfFirst { it.first == page["format"].str() }.coerceAtLeast(0), {
            if (enabled) { haptics(RrHaptic.Selection); actions.set(listOf("data", "metadata", "page", "format"), JsonPrimitive(formats[it].first)) }
        })
    }
    val margins = Margins.of(doc.json) ?: Margins.Normal
    ControlRow(stringResource(S.string.margins)) {
        RrSegmentedControl(Margins.entries.map { RrSegment(stringResource(when (it) { Margins.Narrow -> S.string.narrow; Margins.Normal -> S.string.normal; Margins.Wide -> S.string.wide })) }, margins.ordinal, {
            if (enabled) { haptics(RrHaptic.Selection); actions.edit { j -> Margins.entries[it].apply(j) } }
        })
    }
    ControlRow(stringResource(S.string.language), stringResource(S.string.sets_section_titles_date_words_and_text_direction_your_content_isn_t_translated), controlWidth = 180.dp) {
        RrPickerField(localeName(doc.locale), { languages = true }, enabled = enabled)
    }
    if (languages) {
        var query by remember { mutableStateOf("") }
        RrBottomSheet(onDismissRequest = { languages = false }, title = stringResource(S.string.language)) {
            RrSearchField(query, { query = it }, stringResource(S.string.language), Modifier.padding(horizontal = 16.dp))
            Column(Modifier.verticalScroll(rememberScrollState())) {
                resumeLocales.map { it to localeName(it) }.filter { query.isBlank() || it.second.contains(query, true) || it.first.contains(query, true) }.forEach { (tag, name) ->
                    me.rxresu.core.designsystem.RrChoiceRow(name, tag == doc.locale, { haptics(RrHaptic.Selection); actions.set(listOf("data", "metadata", "page", "locale"), JsonPrimitive(tag)); languages = false })
                }
            }
        }
    }
}

@Composable
private fun AdvancedGroup(doc: ResumeDoc, actions: BuilderActions, enabled: Boolean) {
    val page = doc.metadata["page"].obj()
    Spacer(Modifier.height(8.dp))
    RrSwitchRow(stringResource(S.string.underline_links), !page["hideLinkUnderline"].bool(), { actions.set(listOf("data", "metadata", "page", "hideLinkUnderline"), JsonPrimitive(!it)) }, Modifier.padding(horizontal = 16.dp), enabled = enabled)
    RrSwitchRow(stringResource(S.string.icons_in_contact_line), !page["hideIcons"].bool(), { actions.set(listOf("data", "metadata", "page", "hideIcons"), JsonPrimitive(!it)) }, Modifier.padding(horizontal = 16.dp), enabled = enabled)
    RrButton(stringResource(S.string.reset_design_defaults), { actions.edit(BuilderToast(S.string.design_reset_to_defaults, undo = true)) { DesignDefaults.reset(it) } }, Modifier.padding(16.dp), RrButtonVariant.Secondary, enabled = enabled)
}

/** Web design-panel.tsx "Reset design defaults": typography, design, sidebar width and page spacing back to defaults. */
internal object DesignDefaults {
    private val typography = me.rxresu.core.network.ApiJson.parseToJsonElement(
        """{"body":{"fontFamily":"IBM Plex Serif","fontWeights":["400","500"],"fontSize":10,"lineHeight":1.5},"heading":{"fontFamily":"IBM Plex Serif","fontWeights":["600"],"fontSize":14,"lineHeight":1.5}}""",
    )
    private val design = me.rxresu.core.network.ApiJson.parseToJsonElement(
        """{"colors":{"primary":"rgba(220, 38, 38, 1)","text":"rgba(0, 0, 0, 1)","background":"rgba(255, 255, 255, 1)"},"level":{"icon":"star","type":"circle"},"entry":{"layout":"stacked","lead":"organization","accent":"none"}}""",
    )
    private val page = mapOf("gapX" to 4, "gapY" to 6, "marginX" to 14, "marginY" to 12, "hideLinkUnderline" to false, "hideIcons" to false, "hideSectionIcons" to true)

    /** Keeps paper, language, date format, placement and custom CSS (packages/schema default.ts values). */
    fun reset(json: JsonObject): JsonObject {
        val m = listOf("data", "metadata")
        var next = json.set(m + "typography", typography).set(m + "design", design).set(m + listOf("layout", "sidebarWidth"), JsonPrimitive(35))
        page.forEach { (key, value) -> next = next.set(m + listOf("page", key), if (value is Boolean) JsonPrimitive(value) else JsonPrimitive(value as Int)) }
        return next as JsonObject
    }
}

/** B8: columns, sidebar, and each page's Main and Sidebar zones with section chips. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LayoutGroup(state: BuilderUiState, doc: ResumeDoc, actions: BuilderActions, enabled: Boolean) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val twoColumns = templateColumns(doc.template) == 2
    val layout = doc.metadata["layout"].obj()
    val pages = doc.pages
    var chipMenu by remember { mutableStateOf<String?>(null) }
    val zones = remember { mutableStateMapOf<Pair<Int, Boolean>, Rect>() }
    var dragging by remember { mutableStateOf<String?>(null) }
    var dragAt by remember { mutableStateOf(Offset.Zero) }
    val hoverZone = if (dragging == null) null else zones.entries.firstOrNull { it.value.contains(dragAt) }?.key
    Spacer(Modifier.height(8.dp))
    if (twoColumns) {
        val oneColumn = pages.all { it.fullWidth }
        ControlRow(stringResource(S.string.columns)) {
            RrSegmentedControl(listOf(RrSegment(stringResource(S.string.one_column)), RrSegment(stringResource(S.string.two_columns))), if (oneColumn) 0 else 1, {
                if (enabled) { haptics(RrHaptic.Selection); actions.setLayout { p -> if (it == 0) oneColumn(p) else p.map { page -> page.copy(fullWidth = false) } } }
            })
        }
        if (!oneColumn) {
            val left = layout["sidebarSide"].str().ifBlank { "left" } == "left"
            ControlRow(stringResource(S.string.sidebar_side)) {
                RrSegmentedControl(listOf(RrSegment(stringResource(S.string.left)), RrSegment(stringResource(S.string.right))), if (left) 0 else 1, {
                    if (enabled) { haptics(RrHaptic.Selection); actions.set(listOf("data", "metadata", "layout", "sidebarSide"), JsonPrimitive(if (it == 0) "left" else "right")) }
                })
            }
            val width = (layout["sidebarWidth"].num() ?: 35.0).toFloat()
            ControlRow(stringResource(S.string.sidebar_width)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RrSlider(width, { actions.set(listOf("data", "metadata", "layout", "sidebarWidth"), JsonPrimitive(it.roundToInt())) }, Modifier.weight(1f), 10f..50f, steps = 39, enabled = enabled, valueDescription = "${width.roundToInt()}%")
                    RrText("${width.roundToInt()}%", style = RrType.small, color = c.ink2)
                }
            }
        }
    }
    pages.forEachIndexed { index, page ->
        var pageMenu by remember { mutableStateOf(false) }
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            RrText(stringResource(S.string.page_0, "${index + 1}"), style = RrType.eyebrow.copy(fontSize = RrType.ui.fontSize, lineHeight = RrType.ui.lineHeight), color = c.ink3, modifier = Modifier.weight(1f))
            if (index == 0) {
                if (state.fitting) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) { RrSpinner(); RrText(stringResource(S.string.measuring_page_fit), color = c.ink2) }
                else RrButton(stringResource(R.string.builder_fit_to_one_page), actions::fitToOnePage, variant = RrButtonVariant.Ghost, icon = D.drawable.ic_ph_arrows_in_simple, enabled = enabled)
            }
            if (pages.size > 1) Box {
                RrIconButton(D.drawable.ic_ph_dots_three, stringResource(S.string.options_for_0, stringResource(S.string.page_0, "${index + 1}")), { pageMenu = true }, size = RrIconButtonSize.Small)
                RrMenu(pageMenu, { pageMenu = false }) {
                    RrMenuItem(stringResource(S.string.delete_page), {
                        pageMenu = false
                        actions.setLayout { p ->
                            val into = if (index == 0) 1 else index - 1
                            p.mapIndexed { i, it -> if (i == into) it.copy(main = it.main + p[index].main, sidebar = it.sidebar + p[index].sidebar) else it }.filterIndexed { i, _ -> i != index }
                        }
                    }, icon = D.drawable.ic_ph_trash, danger = true)
                }
            }
        }
        val columns = if (twoColumns && !page.fullWidth) listOf(false, true) else listOf(false)
        columns.forEach { sidebar ->
            val keys = if (sidebar) page.sidebar else if (page.fullWidth) page.main + page.sidebar else page.main
            val zoneKey = index to sidebar
            val hovering = hoverZone == zoneKey
            RrText(stringResource(if (sidebar) S.string.sidebar else S.string.main), color = c.ink3, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 6.dp))
            FlowRow(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 56.dp)
                    .onGloballyPositioned { zones[zoneKey] = it.boundsInRoot() }
                    .then(if (hovering || keys.isEmpty()) Modifier.rrDashedBorder(if (hovering) c.accent else c.line2, RrRadius.lg) else Modifier)
                    .clip(RrShape.lg).background(if (hovering) c.accentSoft else c.sunken).padding(8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (keys.isEmpty()) RrText(stringResource(S.string.drag_and_drop_sections_here_to_move_them_between_columns), color = c.ink3, modifier = Modifier.padding(8.dp))
                keys.forEach { key ->
                    val ref = doc.section(key) ?: return@forEach
                    SectionChip(
                        title = doc.displayTitle(ref),
                        lifted = dragging == key,
                        enabled = enabled,
                        onClick = { chipMenu = key },
                        onLift = { at -> dragging = key; dragAt = at; haptics(RrHaptic.Medium) },
                        onMove = { at -> val before = hoverZone; dragAt = at; val after = zones.entries.firstOrNull { it.value.contains(at) }?.key; if (after != null && after != before) haptics(RrHaptic.Selection) },
                        onDrop = {
                            val target = zones.entries.firstOrNull { it.value.contains(dragAt) }?.key
                            dragging = null
                            haptics(RrHaptic.Rigid)
                            if (target != null && target != zoneKey) actions.placeSection(key, target.first, target.second)
                        },
                    )
                }
            }
        }
    }
    RrButton(stringResource(S.string.add_page_0, "${pages.size + 1}"), { actions.setLayout { it + PageLayout(emptyList(), emptyList(), fullWidth = false) } }, Modifier.padding(16.dp), RrButtonVariant.Secondary, icon = D.drawable.ic_ph_plus, enabled = enabled)
    chipMenu?.let { key ->
        val ref = doc.section(key)
        RrBottomSheet(onDismissRequest = { chipMenu = null }, fitContent = true, title = ref?.let { doc.displayTitle(it) }) {
            val at = doc.pageOf(key) ?: 0
            RrMenuItem(stringResource(R.string.builder_move_to_main), { actions.placeSection(key, at, false); chipMenu = null })
            if (twoColumns && !pages.getOrNull(at)!!.fullWidth) RrMenuItem(stringResource(R.string.builder_move_to_sidebar), { actions.placeSection(key, at, true); chipMenu = null })
            RrMenuLabel(stringResource(S.string.move_to))
            pages.indices.filter { it != at }.forEach { i -> RrMenuItem(stringResource(S.string.page_0, "${i + 1}"), { actions.placeSection(key, i, false); chipMenu = null }) }
            RrMenuItem(stringResource(S.string.new_page), { actions.placeSection(key, pages.size, false); chipMenu = null }, icon = D.drawable.ic_ph_file_plus)
        }
    }
}

/** A section chip: tap for its menu, long-press to lift (tilts 2° with shadow-2) and drop into another zone. */
@Composable
private fun SectionChip(title: String, lifted: Boolean, enabled: Boolean, onClick: () -> Unit, onLift: (Offset) -> Unit, onMove: (Offset) -> Unit, onDrop: () -> Unit) {
    val c = RrTheme.colors
    var origin by remember { mutableStateOf(Offset.Zero) }
    var start by remember { mutableStateOf(Offset.Zero) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    Row(
        Modifier
            .zIndex(if (lifted) 1f else 0f)
            .onGloballyPositioned { if (!lifted) origin = it.boundsInRoot().topLeft }
            .offset { androidx.compose.ui.unit.IntOffset(offset.x.roundToInt(), offset.y.roundToInt()) }
            .then(if (lifted) Modifier.rotate(-2f).rrShadow(RrElevation.Level2, RrShape.md) else Modifier)
            .heightIn(min = 44.dp).clip(RrShape.md).background(c.raised).border(1.dp, if (lifted) c.accent else c.line2, RrShape.md)
            .clickable(enabled = enabled, onClick = onClick)
            .then(if (!enabled) Modifier else Modifier.pointerInput(title) {
                detectDragGesturesAfterLongPress(
                    onDragStart = { at -> offset = Offset.Zero; start = origin + at; onLift(start) },
                    onDrag = { change, amount -> change.consume(); offset += amount; onMove(start + offset) },
                    onDragEnd = { offset = Offset.Zero; onDrop() },
                    onDragCancel = { offset = Offset.Zero; onDrop() },
                )
            })
            .padding(start = 10.dp, end = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        RrIcon(D.drawable.ic_ph_dots_six_vertical, null, size = 16.dp, tint = c.ink3)
        RrText(title, style = RrType.body)
    }
}

/**
 * [RrStepper] with press-and-hold repeat (B7): a step on press, then every 120 ms after 400 ms, `selection` per step.
 * Each callback gets the press's key, so a held press can be one undo step.
 */
// TODO(lead): move to designsystem as RrStepper's hold-to-repeat.
@Composable
private fun HoldStepper(
    value: String,
    onDecrease: (press: String) -> Unit,
    onIncrease: (press: String) -> Unit,
    label: String,
    canDecrease: Boolean,
    canIncrease: Boolean,
) {
    val c = RrTheme.colors
    Row(
        Modifier.height(36.dp).clip(RrShape.md).background(c.raised).border(1.dp, c.controlBorder, RrShape.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HoldStepButton(D.drawable.ic_ph_minus, "${stringResource(D.string.ds_decrease)} $label", canDecrease, onDecrease)
        RrText(
            value,
            style = RrType.mono.copy(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium),
            color = c.ink,
            textAlign = TextAlign.Center,
            modifier = Modifier.defaultMinSize(minWidth = 64.dp).semantics {
                contentDescription = "$label, $value"
                liveRegion = LiveRegionMode.Polite
            },
        )
        HoldStepButton(D.drawable.ic_ph_plus, "${stringResource(D.string.ds_increase)} $label", canIncrease, onIncrease)
    }
}

@Composable
private fun HoldStepButton(icon: Int, description: String, enabled: Boolean, onStep: (press: String) -> Unit) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val canStep by rememberUpdatedState(enabled)
    val step by rememberUpdatedState(onStep)
    Box(
        Modifier
            .size(40.dp, 36.dp)
            .pointerInput(Unit) {
                coroutineScope {
                    awaitEachGesture {
                        awaitFirstDown()
                        if (!canStep) return@awaitEachGesture
                        val press = "stepper:${System.nanoTime()}"
                        val repeat = launch {
                            var wait = HoldRepeat.FIRST_MS
                            while (canStep) { haptics(RrHaptic.Selection); step(press); delay(wait); wait = HoldRepeat.NEXT_MS }
                        }
                        waitForUpOrCancellation()
                        repeat.cancel()
                    }
                }
            }
            .semantics {
                role = Role.Button
                contentDescription = description
                if (!enabled) disabled()
                onClick { if (enabled) { step("stepper:${System.nanoTime()}"); true } else false }
            }
            .alpha(if (enabled) 1f else 0.4f),
        contentAlignment = Alignment.Center,
    ) { RrIcon(icon, null, size = 20.dp, tint = c.ink2) }
}

/** Press-and-hold timing (B7 Haptics: repeated steps tick at most every 120 ms). */
internal object HoldRepeat {
    const val FIRST_MS = 400L
    const val NEXT_MS = 120L
}
