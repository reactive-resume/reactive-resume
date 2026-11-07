package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Size of [RrCompanyTile]: 36 dp beside list rows (J1), 28 dp in board cards and compact rows. */
enum class RrCompanyTileSize(internal val size: Dp, internal val text: Dp) { Regular(36.dp, 14.dp), Small(28.dp, 12.dp) }

/**
 * A company's mark: its first letter in 600 ink-2 on a sunken tile with 2 dp corners ("L" for Lumen). Decorative and
 * hidden from TalkBack: the row beside it names the company. The letter keeps its size at every font scale.
 */
@Composable
fun RrCompanyTile(company: String, modifier: Modifier = Modifier, size: RrCompanyTileSize = RrCompanyTileSize.Regular) {
    val c = RrTheme.colors
    val trimmed = company.trim()
    val initial = if (trimmed.isEmpty()) "?" else String(Character.toChars(trimmed.codePointAt(0))).uppercase()
    Box(
        modifier.size(size.size).clip(RrShape.sm).background(c.sunken).clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        RrText(initial, style = fixedSizeText(RrType.ui.copy(fontWeight = FontWeight.SemiBold), size.text, 20.dp), color = c.ink2, maxLines = 1)
    }
}

@RrPreviews
@Composable
internal fun RrCompanyTilePreview() = RrPreviewSurface {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        RrCompanyTile("Lumen")
        RrCompanyTile("parcel & Co.")
        RrCompanyTile("Orbital Health", size = RrCompanyTileSize.Small)
    }
}
