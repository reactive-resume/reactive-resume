package me.rxresu.feature.builder

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import me.rxresu.core.designsystem.*
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
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
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrChoiceCard
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrElevation
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrMenuItem
import me.rxresu.core.designsystem.RrPaperPage
import me.rxresu.core.designsystem.RrPickerField
import me.rxresu.core.designsystem.RrRadius
import me.rxresu.core.designsystem.RrSearchField
import me.rxresu.core.designsystem.RrSegment
import me.rxresu.core.designsystem.RrSegmentedControl
import me.rxresu.core.designsystem.RrShape
import me.rxresu.core.designsystem.RrSlider
import me.rxresu.core.designsystem.RrSpinner
import me.rxresu.core.designsystem.RrStepper
import me.rxresu.core.designsystem.RrSwitchRow
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.designsystem.rrShadow
import me.rxresu.core.navigation.DesignGroup
import me.rxresu.core.strings.R as S
import me.rxresu.core.designsystem.R as D

/** Accent presets (web design/presets.ts), written as rgba to metadata.design.colors.primary. */
internal enum class Accent(val label: Int, val hex: String) {
    Moss(S.string.moss, "#3F7A4E"), InkBlue(S.string.ink_blue, "#2F5A8A"), Teal(S.string.teal, "#1F7A78"), Plum(S.string.plum, "#6B3F7A"),
    Rust(S.string.rust, "#A4512E"), Burgundy(S.string.burgundy, "#7D2A39"), Ochre(S.string.ochre, "#9A6B16"), Graphite(S.string.graphite, "#4A4A4A"),
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

/** "#3F7A4E" ↔ "rgba(62, 107, 79, 1)". */
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

/** B6: live page and focused, pushed design choices. */
@Composable
internal fun DesignOverview(state: BuilderUiState, actions: BuilderActions, onPicker: (me.rxresu.core.navigation.DesignPicker) -> Unit, onPreview: () -> Unit) {
    val doc = state.doc ?: return
    val m = doc.metadata
    val size = m["typography"].obj()["body"].obj()["fontSize"].num() ?: 10.0
    val color = Rgba.toHex(m["design"].obj()["colors"].obj()["primary"].str())
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        RrPageTitle(stringResource(S.string.design), subtitle = stringResource(R.string.builder_design_subtitle), subtitleColor = RrTheme.colors.ink3)
        RrPageBand(onClick = onPreview) { RrPaperPage(state.pages.firstOrNull(), stringResource(R.string.builder_preview_page), Modifier.padding(vertical = 1.dp).width(150.dp)) }
        Spacer(Modifier.height(8.dp))
        val choices = listOf(
            me.rxresu.core.navigation.DesignPicker.Template to stringResource(S.string.template),
            me.rxresu.core.navigation.DesignPicker.Colour to stringResource(R.string.builder_colour),
            me.rxresu.core.navigation.DesignPicker.Typography to stringResource(R.string.builder_typography),
            me.rxresu.core.navigation.DesignPicker.Page to stringResource(S.string.page),
            me.rxresu.core.navigation.DesignPicker.Layout to stringResource(S.string.layout),
            me.rxresu.core.navigation.DesignPicker.Photo to stringResource(S.string.photo),
            me.rxresu.core.navigation.DesignPicker.Entries to stringResource(S.string.entries),
            me.rxresu.core.navigation.DesignPicker.Advanced to stringResource(S.string.advanced),
        )
        choices.forEachIndexed { index, (picker, label) ->
            val value = when (picker) {
                me.rxresu.core.navigation.DesignPicker.Template -> TemplateInfo.of(doc.template)?.label.orEmpty()
                me.rxresu.core.navigation.DesignPicker.Colour -> Accent.entries.firstOrNull { it.hex.equals(color, true) }?.let { stringResource(it.label) }.orEmpty()
                me.rxresu.core.navigation.DesignPicker.Typography -> "${Pairing.of(doc.json)?.let { stringResource(it.label) }.orEmpty()} · ${size.toString().removeSuffix(".0")} pt"
                me.rxresu.core.navigation.DesignPicker.Page -> stringResource(R.string.builder_normal_margins, m["page"].obj()["format"].str().uppercase())
                me.rxresu.core.navigation.DesignPicker.Layout -> stringResource(if (templateColumns(doc.template) == 1 || doc.pages.all { it.fullWidth }) S.string.one_column else S.string.two_columns)
                else -> ""
            }
            RrListRow(label, onClick = if (state.locked) null else ({ onPicker(picker) }), divider = index < choices.lastIndex, trailing = {
                if (picker == me.rxresu.core.navigation.DesignPicker.Colour && color != null) Box(Modifier.size(16.dp).clip(RrShape.xs).background(Color(color.toColorInt())))
                RrText(value, style = RrType.ui, color = RrTheme.colors.ink3)
                RrIcon(D.drawable.ic_ph_caret_right, null, size = 18.dp, tint = RrTheme.colors.ink3, mirrorInRtl = true)
            })
        }
        RrButton(stringResource(S.string.reset_design_defaults), { actions.edit(BuilderToast(S.string.design_reset_to_defaults, undo = true)) { DesignDefaults.reset(it) } }, Modifier.padding(horizontal = 24.dp), variant = RrButtonVariant.GhostAccent, enabled = !state.locked)
    }
}

private enum class TemplateFilter(val label: Int) { All(S.string.all), One(S.string.one_column), Two(S.string.two_columns), Ats(S.string.ats_safe) }

@Composable
internal fun TemplatePicker(doc: ResumeDoc, actions: BuilderActions, enabled: Boolean, page: androidx.compose.ui.graphics.ImageBitmap?) {
    var filter by rememberSaveable { mutableStateOf(TemplateFilter.All) }
    val haptics = rememberRrHaptics()
    val shown = TemplateInfo.entries.filter { t -> when (filter) { TemplateFilter.All -> true; TemplateFilter.One -> t.columns == 1; TemplateFilter.Two -> t.columns == 2; TemplateFilter.Ats -> t.atsSafe } }
    RrSegmentedControl(TemplateFilter.entries.take(3).map { RrSegment(stringResource(it.label)) }, filter.ordinal.coerceAtMost(2), { filter = TemplateFilter.entries[it] }, Modifier.padding(start = 24.dp, end = 24.dp, top = 16.dp))
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 24.dp, end = 24.dp, top = 20.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        shown.sortedByDescending { it.id == doc.template }.forEach { t ->
            val selected = t.id == doc.template
            Column(Modifier.width(180.dp).clickable(enabled = enabled, role = Role.RadioButton) {
                if (!selected) {
                    haptics(RrHaptic.Selection)
                    actions.edit(BuilderToast(S.string.template_changed_to_0, listOf(t.label), undo = true)) { it.set(listOf("data", "metadata", "template"), JsonPrimitive(t.id)) as JsonObject }
                }
            }.semantics { this.selected = selected }, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                RrPageThumbnail(page, Modifier.fillMaxWidth().then(if (selected) Modifier.border(2.dp, RrTheme.colors.accent, androidx.compose.foundation.shape.RoundedCornerShape(RrRadius.paper)) else Modifier))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    RrText(t.label, style = RrType.buttonLg)
                    if (selected) RrIcon(D.drawable.ic_ph_check_circle, null, size = 16.dp, tint = RrTheme.colors.accentText)
                }
                RrText(stringResource(if (t.columns == 1) S.string.one_column else S.string.two_columns) + if (t.atsSafe) " · " + stringResource(S.string.ats_safe) else "", style = RrType.ui, color = RrTheme.colors.ink3)
            }
        }
        RrSwitchRow(stringResource(R.string.builder_ats_only), filter == TemplateFilter.Ats, { filter = if (it) TemplateFilter.Ats else TemplateFilter.All }, Modifier.width(240.dp), enabled = enabled)
    }
}

@Composable
internal fun AccentRow(doc: ResumeDoc, actions: BuilderActions, enabled: Boolean) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val current = Rgba.toHex(doc.metadata["design"].obj()["colors"].obj()["primary"].str())
    var custom by remember { mutableStateOf(false) }
    RrSectionHeading(stringResource(R.string.builder_colour))
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 18.dp, end = 18.dp, top = 12.dp)) {
        Accent.entries.forEach { a ->
            val label = stringResource(a.label)
            val selected = current.equals(a.hex, ignoreCase = true)
            Box(Modifier.size(42.dp, 32.dp).clickable(enabled = enabled, role = Role.RadioButton) {
                if (!selected) haptics(RrHaptic.Selection)
                actions.set(listOf("data", "metadata", "design", "colors", "primary"), JsonPrimitive(Rgba.fromHex(a.hex)!!))
            }.semantics { this.selected = selected; contentDescription = label }, contentAlignment = Alignment.Center) {
                Box(Modifier.size(32.dp).then(if (selected) Modifier.drawBehind {
                    drawRoundRect(c.accent, Offset(-4.dp.toPx(), -4.dp.toPx()), androidx.compose.ui.geometry.Size(size.width + 8.dp.toPx(), size.height + 8.dp.toPx()), androidx.compose.ui.geometry.CornerRadius(12.dp.toPx()), style = androidx.compose.ui.graphics.drawscope.Stroke(2.dp.toPx()))
                } else Modifier).clip(RrShape.sm).background(a.color()), contentAlignment = Alignment.Center) {
                    if (selected) RrIcon(D.drawable.ic_ph_check, null, size = 16.dp, tint = me.rxresu.core.designsystem.RrFixedColors.paper)
                }
            }
        }
    }
    Row(Modifier.padding(horizontal = 24.dp).heightIn(min = 44.dp).clickable(enabled = true, role = androidx.compose.ui.semantics.Role.Button, onClick = { custom = true }), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {

            RrText(stringResource(R.string.builder_custom_colour), style = RrType.textLink, color = RrTheme.colors.accentText)
        }
    if (custom) RrBottomSheet(onDismissRequest = { custom = false }, title = stringResource(R.string.builder_custom_colour), fitContent = true) { CustomColor(doc, actions, enabled) }
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

/** Full-width controls keep labels and translated hints readable at every font scale. */
@Composable
private fun ControlRow(label: String, hint: String? = null, controlWidth: Dp? = null, control: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RrText(label, style = RrType.formLabel, color = RrTheme.colors.ink2)
        if (controlWidth != null) Box(Modifier.width(controlWidth)) { control() } else control()
        if (hint != null) RrText(hint, style = RrType.ui, color = RrTheme.colors.ink3)
    }
}

@Composable
internal fun TypeGroup(doc: ResumeDoc, actions: BuilderActions, enabled: Boolean, onCustom: () -> Unit) {
    val haptics = rememberRrHaptics()
    val c = RrTheme.colors
    val pairing = Pairing.of(doc.json)
    RrSectionHeading(stringResource(S.string.font_pairing))
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Pairing.entries.forEach { p ->
            val selected = p == pairing
            RrChoiceCard(selected, { actions.edit { p.apply(it) } }, Modifier.width(114.dp), enabled = enabled) {
                RrText("Aa", style = RrType.title.copy(fontFamily = if (p.serif) FontFamily.Serif else FontFamily.SansSerif, fontWeight = if (p.weight == "700") FontWeight.Bold else FontWeight.Normal, fontSize = RrType.sheetTitle.fontSize), color = if (selected) c.accentText else c.ink)
                RrText(stringResource(p.label), style = RrType.body, color = if (selected) c.accentText else c.ink2)
            }
        }
        // Fonts outside the pairings: tap to pick any font in Advanced.
        RrChoiceCard(pairing == null, onCustom, Modifier.width(114.dp), enabled = enabled) {
            RrText(stringResource(S.string.custom), style = RrType.body, color = if (pairing == null) c.accentText else c.ink)
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
        var press by remember { mutableStateOf("") }
        RrStepper(
            stringResource(S.string.textsize_pt, size.toString().removeSuffix(".0")),
            onDecrease = { step(-0.5, press) },
            onIncrease = { step(0.5, press) },
            label = stringResource(S.string.text_size),
            canDecrease = enabled && size > TextSize.MIN, canIncrease = enabled && size < TextSize.MAX,
            repeatOnHold = true,
            onPressStart = { press = "stepper:${System.nanoTime()}" },
        )
    }
    if (size < 9) RrText(stringResource(S.string.body_text_is_very_small), color = c.warnText, modifier = Modifier.padding(horizontal = 16.dp))
    val density = Density.of(doc.json) ?: Density.Normal
    ControlRow(stringResource(S.string.density)) {
        RrSegmentedControl(
            Density.entries.map { RrSegment(stringResource(when (it) { Density.Compact -> S.string.compact; Density.Normal -> S.string.normal; Density.Roomy -> S.string.roomy })) },
            density.ordinal, { actions.edit { j -> Density.entries[it].apply(j) } }, enabled = enabled,
        )
    }
}

@Composable
internal fun PageGroup(doc: ResumeDoc, actions: BuilderActions, enabled: Boolean) {
    val haptics = rememberRrHaptics()
    var languages by remember { mutableStateOf(false) }
    val page = doc.metadata["page"].obj()
    Spacer(Modifier.height(12.dp))
    val formats = listOf("a4" to R.string.builder_a4, "letter" to S.string.letter, "free-form" to S.string.free_form)
    ControlRow(stringResource(S.string.paper)) {
        RrSegmentedControl(formats.map { RrSegment(stringResource(it.second)) }, formats.indexOfFirst { it.first == page["format"].str() }.coerceAtLeast(0), {
            actions.set(listOf("data", "metadata", "page", "format"), JsonPrimitive(formats[it].first))
        }, enabled = enabled)
    }
    val margins = Margins.of(doc.json) ?: Margins.Normal
    ControlRow(stringResource(S.string.margins)) {
        RrSegmentedControl(Margins.entries.map { RrSegment(stringResource(when (it) { Margins.Narrow -> S.string.narrow; Margins.Normal -> S.string.normal; Margins.Wide -> S.string.wide })) }, margins.ordinal, {
            actions.edit { j -> Margins.entries[it].apply(j) }
        }, enabled = enabled)
    }
    ControlRow(stringResource(S.string.language), stringResource(S.string.sets_section_titles_date_words_and_text_direction_your_content_isn_t_translated)) {
        RrPickerField(localeName(doc.locale), { languages = true }, enabled = enabled)
    }
    if (languages) {
        var query by remember { mutableStateOf("") }
        RrBottomSheet(onDismissRequest = { languages = false }, title = stringResource(S.string.language)) {
            RrSearchField(query, { query = it }, stringResource(S.string.language), Modifier.padding(horizontal = 16.dp))
            Column(Modifier.verticalScroll(rememberScrollState())) {
                resumeLocales.map { it to localeName(it) }.filter { query.isBlank() || it.second.contains(query, true) || it.first.contains(query, true) }.forEach { (tag, name) ->
                    me.rxresu.core.designsystem.RrChoiceRow(name, tag == doc.locale, { actions.set(listOf("data", "metadata", "page", "locale"), JsonPrimitive(tag)); languages = false })
                }
            }
        }
    }
}

@Composable
internal fun AdvancedGroup(doc: ResumeDoc, actions: BuilderActions, enabled: Boolean) {
    val page = doc.metadata["page"].obj()
    listOf("body" to R.string.builder_body_font, "heading" to R.string.builder_heading_font).forEach { (key, label) ->
        val typography = doc.metadata["typography"].obj()[key].obj()
        Column(Modifier.padding(24.dp)) {
            TextField(stringResource(label), typography["fontFamily"].str(), !enabled, actions = actions) { actions.set(listOf("data", "metadata", "typography", key, "fontFamily"), JsonPrimitive(it)) }
        }
    }
    RrSwitchRow(stringResource(R.string.builder_hyphenation), doc.metadata["typography"].obj()["hyphenation"].bool(), { actions.set(listOf("data", "metadata", "typography", "hyphenation"), JsonPrimitive(it)) }, enabled = enabled)
    RrSwitchRow(stringResource(S.string.underline_links), !page["hideLinkUnderline"].bool(), { actions.set(listOf("data", "metadata", "page", "hideLinkUnderline"), JsonPrimitive(!it)) }, enabled = enabled)
    RrSwitchRow(stringResource(S.string.icons_in_contact_line), !page["hideIcons"].bool(), { actions.set(listOf("data", "metadata", "page", "hideIcons"), JsonPrimitive(!it)) }, enabled = enabled)
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

/** B8 keeps page placement and drag cancellation at the draft boundary. */
@Composable
internal fun LayoutGroup(state: BuilderUiState, doc: ResumeDoc, actions: BuilderActions, enabled: Boolean, autoScroll: ReorderAutoScroll? = null) {
    val c = RrTheme.colors
    val twoColumns = templateColumns(doc.template) == 2
    val pages = doc.pages
    val haptics = rememberRrHaptics()
    val reduced = LocalReducedMotion.current
    val zones = remember { mutableStateMapOf<Pair<Int, Boolean>, Rect>() }
    var dragged by remember { mutableStateOf<String?>(null) }
    var dragAt by remember { mutableStateOf(Offset.Zero) }
    var dragScrollOffset by remember { mutableFloatStateOf(0f) }
    val maxStep = with(LocalDensity.current) { 12.dp.toPx() }
    if (autoScroll != null && dragged != null) LaunchedEffect(dragged) {
        while (true) {
            androidx.compose.runtime.withFrameNanos { }
            val viewport = autoScroll.viewport
            val step = ReorderMath.autoScrollStep(dragAt.y, viewport.top, viewport.bottom, maxStep)
            if (step != 0f) dragScrollOffset += autoScroll.state.scrollBy(step)
        }
    }
    var menu by remember { mutableStateOf<String?>(null) }
    Column(Modifier.padding(start = 24.dp, end = 24.dp, top = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RrText(stringResource(S.string.columns), style = RrType.formLabel, color = c.ink2)
        RrSegmentedControl(listOf(RrSegment(stringResource(S.string.one_column)), RrSegment(stringResource(S.string.two_columns))), if (twoColumns && pages.any { !it.fullWidth }) 1 else 0, { index ->
            if (index == 0) actions.setLayout(::oneColumn) else actions.edit { json ->
                val next = if (twoColumns) json else json.set(listOf("data", "metadata", "template"), JsonPrimitive("azurill")) as JsonObject
                next.set(listOf("data", "metadata", "layout", "pages"), JsonArray(pages.map { page -> kotlinx.serialization.json.buildJsonObject { put("main", JsonArray(page.main.map(::JsonPrimitive))); put("sidebar", JsonArray(page.sidebar.map(::JsonPrimitive))); put("fullWidth", JsonPrimitive(false)) } })) as JsonObject
            }
        }, enabled = enabled)
    }
    if (twoColumns && pages.any { !it.fullWidth }) {
        val layout = doc.metadata["layout"].obj()
        ControlRow(stringResource(S.string.sidebar_side)) {
            RrSegmentedControl(listOf(RrSegment(stringResource(S.string.left)), RrSegment(stringResource(S.string.right))), if (layout["sidebarSide"].str() == "right") 1 else 0, { actions.set(listOf("data", "metadata", "layout", "sidebarSide"), JsonPrimitive(if (it == 0) "left" else "right")) }, enabled = enabled)
        }
        val width = (layout["sidebarWidth"].num() ?: 35.0).toFloat()
        ControlRow(stringResource(S.string.sidebar_width)) { RrSlider(width, { actions.set(listOf("data", "metadata", "layout", "sidebarWidth"), JsonPrimitive(it.roundToInt())) }, valueRange = 10f..50f, enabled = enabled, valueDescription = "${width.roundToInt()}%") }
    }
    pages.forEachIndexed { index, page ->
        var pageMenu by remember { mutableStateOf(false) }
        RrSectionHeading(stringResource(S.string.page_0, "${index + 1}"), actionLabel = if (index == 0) stringResource(R.string.builder_fit_to_one_page) else stringResource(S.string.more), onAction = if (!enabled || state.fitting) null else ({ if (index == 0) actions.fitToOnePage() else pageMenu = true }))
        if (state.fitting && index == 0) Row(Modifier.padding(horizontal = 24.dp)) { RrSpinner(); RrText(stringResource(S.string.measuring_page_fit)) }
        Spacer(Modifier.height(8.dp))
        val columns = if (twoColumns && !page.fullWidth) listOf(false, true) else listOf(false)
        columns.forEach { sidebar ->
            val keys = if (sidebar) page.sidebar else if (page.fullWidth || !twoColumns) page.main + page.sidebar else page.main
            if (columns.size == 2) RrText(stringResource(if (sidebar) S.string.sidebar else S.string.main), style = RrType.formLabel, color = c.ink3, modifier = Modifier.padding(start = 24.dp, top = 16.dp))
            Column(Modifier.fillMaxWidth().heightIn(min = 44.dp).onGloballyPositioned { zones[index to sidebar] = it.boundsInRoot() }) {
                keys.forEachIndexed { rowIndex, key ->
                    val ref = doc.section(key) ?: return@forEachIndexed
                    var origin by remember(key) { mutableStateOf(Offset.Zero) }
                    var offset by remember(key) { mutableStateOf(Offset.Zero) }
                    var moved by remember(key) { mutableStateOf(false) }
                    val lifted = dragged == key
                    Box(Modifier.zIndex(if (lifted) 1f else 0f)
                        .onGloballyPositioned { if (!lifted) origin = it.boundsInRoot().topLeft }
                        .offset { androidx.compose.ui.unit.IntOffset(offset.x.roundToInt(), (offset.y + if (lifted) dragScrollOffset else 0f).roundToInt()) }
                        .then(if (lifted) Modifier.rrShadow(RrElevation.Level2) else Modifier)
                        .then(if (!enabled) Modifier else Modifier.pointerInput(key, keys) {
                            detectDragGesturesAfterLongPress(
                                onDragStart = { at -> dragged = key; offset = Offset.Zero; dragScrollOffset = 0f; dragAt = origin + at; moved = false; haptics(RrHaptic.Medium) },
                                onDrag = { change, amount ->
                                    change.consume(); val before = zones.entries.firstOrNull { it.value.contains(dragAt) }?.key
                                    offset += amount; dragAt += amount; moved = true
                                    if (zones.entries.firstOrNull { it.value.contains(dragAt) }?.key != before) haptics(RrHaptic.Selection)
                                },
                                onDragEnd = {
                                    val target = zones.entries.firstOrNull { it.value.contains(dragAt) }
                                    dragged = null; offset = Offset.Zero; dragScrollOffset = 0f
                                    if (!moved) menu = key else {
                                        haptics(RrHaptic.Rigid)
                                        if (target != null && target.key != (index to sidebar)) actions.placeSection(key, target.key.first, target.key.second)
                                        else if (target != null) {
                                            val to = (((dragAt.y - target.value.top) / target.value.height) * keys.size).toInt().coerceIn(0, keys.lastIndex)
                                            if (to != rowIndex) actions.setLayout { list -> list.mapIndexed { i, p -> if (i != index) p else if (sidebar) p.copy(sidebar = keys.moved(rowIndex, to)) else p.copy(main = keys.moved(rowIndex, to), sidebar = if (page.fullWidth || !twoColumns) emptyList() else p.sidebar) } }
                                        }
                                    }
                                },
                                onDragCancel = { dragged = null; offset = Offset.Zero; dragScrollOffset = 0f },
                            )
                        })) {
                        RrListRow(doc.displayTitle(ref), leading = { RrIcon(D.drawable.ic_ph_dots_six_vertical, null, tint = c.ink3) }, divider = rowIndex < keys.lastIndex,
                            onClick = if (enabled) ({ menu = key }) else null)
                    }
                }
            }
        }
        if (pageMenu) RrBottomSheet(onDismissRequest = { pageMenu = false }, title = stringResource(S.string.page_0, "${index + 1}"), fitContent = true) {
            RrMenuItem(stringResource(S.string.delete_page), {
                actions.setLayout { p -> val into = if (index == 0) 1 else index - 1; p.mapIndexed { i, it -> if (i == into) it.copy(main = it.main + p[index].main, sidebar = it.sidebar + p[index].sidebar) else it }.filterIndexed { i, _ -> i != index } }; pageMenu = false
            }, danger = true)
        }
    }
    Row(Modifier.padding(horizontal = 24.dp).heightIn(min = 44.dp).clickable(enabled = enabled, role = androidx.compose.ui.semantics.Role.Button, onClick = { actions.setLayout { it + PageLayout(emptyList(), emptyList(), false) } }), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RrIcon(D.drawable.ic_ph_plus, null, size = 20.dp, tint = RrTheme.colors.accentText)
            RrText(stringResource(R.string.builder_add_page), style = RrType.textLink, color = RrTheme.colors.accentText)
        }
    menu?.let { key -> doc.section(key)?.let { SectionMenu(doc, it, actions) { menu = null } } }
}

@Composable
internal fun PhotoDesign(doc: ResumeDoc, actions: BuilderActions, enabled: Boolean) {
    val picture = doc.data["picture"].obj()
    RrSwitchRow(stringResource(S.string.show_photo), !picture["hidden"].bool(), { actions.set(listOf("data", "picture", "hidden"), JsonPrimitive(!it)) }, enabled = enabled)
    ControlRow(stringResource(S.string.size)) { RrSlider((picture["size"].num() ?: 64.0).toFloat(), { actions.set(listOf("data", "picture", "size"), JsonPrimitive(it.toInt())) }, valueRange = 32f..512f, enabled = enabled) }
    ControlRow(stringResource(S.string.border_radius)) { RrSlider((picture["borderRadius"].num() ?: 0.0).toFloat(), { actions.set(listOf("data", "picture", "borderRadius"), JsonPrimitive(it.toInt())) }, valueRange = 0f..100f, enabled = enabled) }
}

@Composable
internal fun EntryDesign(doc: ResumeDoc, actions: BuilderActions, enabled: Boolean) {
    val entry = doc.metadata["design"].obj()["entry"].obj()
    val groups = listOf(
        Triple("layout", S.string.layout, listOf("stacked" to R.string.builder_stacked, "inline" to S.string.inline)),
        Triple("lead", R.string.builder_lead, listOf("organization" to S.string.organization, "position" to S.string.position)),
        Triple("accent", S.string.accent, listOf("none" to S.string.none, "text" to S.string.text, "background" to S.string.background_color)),
    )
    groups.forEach { (key, label, values) ->
        ControlRow(stringResource(label)) {
            RrSegmentedControl(values.map { RrSegment(stringResource(it.second)) }, values.indexOfFirst { it.first == entry[key].str() }.coerceAtLeast(0), {
                actions.set(listOf("data", "metadata", "design", "entry", key), JsonPrimitive(values[it].first))
            }, enabled = enabled)
        }
    }
}
