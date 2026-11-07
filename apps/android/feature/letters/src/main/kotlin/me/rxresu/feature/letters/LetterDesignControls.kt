package me.rxresu.feature.letters

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlin.math.pow
import me.rxresu.core.designsystem.*
import me.rxresu.core.network.generated.*
import me.rxresu.core.strings.R as CoreR

// TODO(lead): move to designsystem; share web design presets and token-only editors with builder.
internal data class LetterPairing(val label: Int, val heading: String, val body: String, val weight: CreateCoverLetterResponseStyleMetadataTypographyBodyFontWeightsItem)
internal val letterPairings = listOf(
    LetterPairing(CoreR.string.classic, "EB Garamond", "EB Garamond", CreateCoverLetterResponseStyleMetadataTypographyBodyFontWeightsItem.Value600),
    LetterPairing(CoreR.string.traditional, "Tinos", "Tinos", CreateCoverLetterResponseStyleMetadataTypographyBodyFontWeightsItem.Value700),
    LetterPairing(CoreR.string.balanced, "Source Serif 4", "Source Sans 3", CreateCoverLetterResponseStyleMetadataTypographyBodyFontWeightsItem.Value600),
    LetterPairing(CoreR.string.professional, "Carlito", "Carlito", CreateCoverLetterResponseStyleMetadataTypographyBodyFontWeightsItem.Value700),
    LetterPairing(CoreR.string.clean, "Lato", "Lato", CreateCoverLetterResponseStyleMetadataTypographyBodyFontWeightsItem.Value700),
)
internal val letterAccents = listOf(CoreR.string.moss to "#3E6B4F", CoreR.string.ink_blue to "#2F5A8A", CoreR.string.teal to "#1F6E73", CoreR.string.plum to "#6B3E6E", CoreR.string.rust to "#A0442A", CoreR.string.burgundy to "#8A2C3F", CoreR.string.ochre to "#7A5A12", CoreR.string.graphite to "#3B3F45")
internal fun letterHex(value: String): String? {
    val hex = value.trim().removePrefix("#")
    if (Regex("[0-9a-fA-F]{6}").matches(hex)) return "#" + hex.uppercase()
    if (Regex("[0-9a-fA-F]{3}").matches(hex)) return "#" + hex.flatMap { listOf(it, it) }.joinToString("").uppercase()
    val match = Regex("rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)(?:\\s*,\\s*(?:1|1\\.0+))?\\s*\\)", RegexOption.IGNORE_CASE).matchEntire(value.trim()) ?: return null
    val channels = match.groupValues.drop(1).map { it.toIntOrNull() ?: return null }
    if (channels.any { it !in 0..255 }) return null
    return "#" + channels.joinToString("") { it.toString(16).padStart(2, '0') }.uppercase()
}
internal fun letterContrast(hex: String): Double {
    val normalized = letterHex(hex) ?: return 0.0
    val channels = listOf(1, 3, 5).map { normalized.substring(it, it + 2).toInt(16) / 255.0 }.map { if (it <= 0.04045) it / 12.92 else ((it + 0.055) / 1.055).pow(2.4) }
    return 1.05 / (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2] + 0.05)
}
internal fun darkerLetterColor(hex: String): String {
    var channels = listOf(1, 3, 5).map { requireNotNull(letterHex(hex)).substring(it, it + 2).toInt(16).toDouble() }
    repeat(40) {
        val candidate = "#" + channels.joinToString("") { kotlin.math.round(it).toInt().toString(16).padStart(2, '0') }
        if (letterContrast(candidate) >= 4.6) return candidate.uppercase()
        channels = channels.map { it * 0.93 }
    }
    return "#333333"
}
@Composable internal fun LetterTypeSheet(state: LetterState, design: ((CreateCoverLetterResponseStyleMetadata) -> CreateCoverLetterResponseStyleMetadata) -> Unit, size: (Double) -> Unit, dismiss: () -> Unit) {
    val m = state.letter?.style?.metadata ?: return
    RrBottomSheet(dismiss, title = stringResource(CoreR.string.type), initialDetent = 1) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            letterPairings.forEach { pairing -> RrListRow(stringResource(pairing.label), subtitle = if (pairing.heading == pairing.body) pairing.body else pairing.heading + " + " + pairing.body, selected = m.typography.heading.fontFamily == pairing.heading && m.typography.body.fontFamily == pairing.body, enabled = state.editable, onClick = { design { metadata -> metadata.copy(typography = metadata.typography.copy(heading = metadata.typography.heading.copy(fontFamily = pairing.heading, fontWeights = listOf(pairing.weight)), body = metadata.typography.body.copy(fontFamily = pairing.body, fontWeights = listOf(CreateCoverLetterResponseStyleMetadataTypographyBodyFontWeightsItem.Value400, CreateCoverLetterResponseStyleMetadataTypographyBodyFontWeightsItem.Value700)))) } }) }
            RrText(stringResource(CoreR.string.font_size), style = RrType.label)
            RrStepper(m.typography.body.fontSize.toString(), { size((m.typography.body.fontSize - 0.5).coerceAtLeast(9.0)) }, { size((m.typography.body.fontSize + 0.5).coerceAtMost(12.5)) }, stringResource(CoreR.string.font_size))
            RrText(stringResource(CoreR.string.density), style = RrType.label)
            listOf(Triple(CoreR.string.compact, 1.35, 4.0), Triple(CoreR.string.normal, 1.5, 6.0), Triple(CoreR.string.roomy, 1.65, 8.0)).forEach { (label, height, gap) -> RrListRow(stringResource(label), selected = m.typography.body.lineHeight == height && m.page.gapY == gap, onClick = { design { metadata -> metadata.copy(typography = metadata.typography.copy(body = metadata.typography.body.copy(lineHeight = height)), page = metadata.page.copy(gapY = gap)) } }) }
            listOf(true, false).forEach { heading ->
                val font = if (heading) m.typography.heading else m.typography.body
                var family by remember(font.fontFamily) { mutableStateOf(font.fontFamily) }
                RrText(stringResource(if (heading) R.string.p4_headings else R.string.p4_body), style = RrType.label)
                RrTextField(family, { family = it }, label = stringResource(CoreR.string.font_family))
                RrButton(stringResource(CoreR.string.save), { design { metadata -> val type = metadata.typography; metadata.copy(typography = if (heading) type.copy(heading = type.heading.copy(fontFamily = family.trim())) else type.copy(body = type.body.copy(fontFamily = family.trim()))) } }, enabled = family.isNotBlank() && state.editable)
                RrStepper(font.lineHeight.toString(), { design { metadata -> val type = metadata.typography; metadata.copy(typography = if (heading) type.copy(heading = type.heading.copy(lineHeight = (font.lineHeight - 0.05).coerceAtLeast(1.0))) else type.copy(body = type.body.copy(lineHeight = (font.lineHeight - 0.05).coerceAtLeast(1.0)))) } }, { design { metadata -> val type = metadata.typography; metadata.copy(typography = if (heading) type.copy(heading = type.heading.copy(lineHeight = (font.lineHeight + 0.05).coerceAtMost(3.0))) else type.copy(body = type.body.copy(lineHeight = (font.lineHeight + 0.05).coerceAtMost(3.0)))) } }, stringResource(CoreR.string.line_height))
                RrText(stringResource(CoreR.string.font_weight), style = RrType.caption)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { CreateCoverLetterResponseStyleMetadataTypographyBodyFontWeightsItem.entries.filter { it != CreateCoverLetterResponseStyleMetadataTypographyBodyFontWeightsItem.Unknown }.forEach { weight -> RrContextChip(weight.wireValue, leftOut = weight !in font.fontWeights, onClick = { design { metadata -> val type = metadata.typography; val old = if (heading) type.heading else type.body; val weights = (if (weight in old.fontWeights && old.fontWeights.size > 1) old.fontWeights - weight else (old.fontWeights + weight).distinct()); metadata.copy(typography = if (heading) type.copy(heading = old.copy(fontWeights = weights)) else type.copy(body = old.copy(fontWeights = weights))) } }) } }
            }
        }
    }
}
@Composable internal fun LetterPageSheet(state: LetterState, design: ((CreateCoverLetterResponseStyleMetadata) -> CreateCoverLetterResponseStyleMetadata) -> Unit, dismiss: () -> Unit) {
    val m = state.letter?.style?.metadata ?: return
    RrBottomSheet(dismiss, title = stringResource(CoreR.string.page), initialDetent = 1) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            CreateCoverLetterResponseStyleMetadataPageFormat.entries.filter { it != CreateCoverLetterResponseStyleMetadataPageFormat.Unknown }.forEach { format -> RrListRow(format.wireValue, selected = m.page.format == format, onClick = { design { it.copy(page = it.page.copy(format = format)) } }) }
            RrText(stringResource(CoreR.string.margins), style = RrType.label)
            listOf(Triple(CoreR.string.narrow, 10.0, 8.0), Triple(CoreR.string.normal, 14.0, 12.0), Triple(CoreR.string.wide, 19.0, 16.0)).forEach { (label, x, y) -> RrListRow(stringResource(label), selected = m.page.marginX == x && m.page.marginY == y, onClick = { design { it.copy(page = it.page.copy(marginX = x, marginY = y)) } }) }
            RrSwitchRow(stringResource(CoreR.string.icons_in_contact_line), !m.page.hideIcons, { checked -> design { it.copy(page = it.page.copy(hideIcons = !checked)) } })
            RrSwitchRow(stringResource(CoreR.string.underline_links), !m.page.hideLinkUnderline, { checked -> design { it.copy(page = it.page.copy(hideLinkUnderline = !checked)) } })
        }
    }
}
@Composable internal fun LetterColorSheet(state: LetterState, color: (String) -> Unit, dismiss: () -> Unit) {
    val current = state.letter?.style?.metadata?.design?.colors?.primary.orEmpty()
    var text by remember(current) { mutableStateOf(letterHex(current) ?: current) }
    val normalized = letterHex(text)
    RrBottomSheet(dismiss, title = stringResource(CoreR.string.color), initialDetent = 1) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            letterAccents.forEach { (label, hex) -> RrListRow(stringResource(label), subtitle = hex, selected = letterHex(current) == hex, onClick = { color(hex) }) }
            RrTextField(text, { text = it }, label = stringResource(R.string.p4_custom_color))
            if (normalized == null) RrCallout(stringResource(R.string.p4_hex_color), tone = RrTone.Warn)
            else {
                RrText(stringResource(R.string.p4_contrast, letterContrast(normalized)), style = RrType.mono)
                if (letterContrast(normalized) < 4.5) RrCallout(stringResource(R.string.p4_light_color), tone = RrTone.Warn, actionLabel = stringResource(R.string.p4_darker), onAction = { color(darkerLetterColor(normalized)) })
                RrButton(stringResource(CoreR.string.save), { color(normalized) }, enabled = state.editable)
            }
        }
    }
}
