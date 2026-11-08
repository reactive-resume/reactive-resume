package me.rxresu.core.designsystem

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp

/** Opt-in measurement metadata. Release accessibility semantics stay clean. */
val LocalRrDesignTags = staticCompositionLocalOf { false }

data class DesignTag(
    val style: TextStyle? = null,
    val color: Color? = null,
    val colorName: String? = null,
    val icon: String? = null,
    val iconWeight: String? = null,
    val component: String? = null,
    val radius: Dp? = null,
    val bgName: String? = null,
    val text: String? = null,
)

val DesignTagKey = SemanticsPropertyKey<DesignTag>("RrDesignTag")
var SemanticsPropertyReceiver.designTag by DesignTagKey

@Composable
fun Modifier.rrDesignTag(tag: DesignTag): Modifier =
    if (LocalRrDesignTags.current || LocalInspectionMode.current) semantics { designTag = tag } else this

/** Keep decorative children measurable in tests while production exposes one accessible control. */
@Composable
fun Modifier.rrClearAndSetSemantics(block: SemanticsPropertyReceiver.() -> Unit): Modifier =
    if (LocalRrDesignTags.current || LocalInspectionMode.current) semantics(properties = block) else clearAndSetSemantics(block)

fun RrColors.tokenName(color: Color): String = when (color) {
    bg -> "bg"; surface -> "surface"; raised -> "raised"; sunken -> "sunken"
    line -> "line"; line2 -> "line-2"; controlBorder -> "control-border"
    ink -> "ink"; ink2 -> "ink-2"; ink3 -> "ink-3"
    accent -> "accent"; accentHover -> "accent-hover"; onAccent -> "on-accent"
    accentSoft -> "accent-soft"; accentText -> "accent-text"
    danger -> "danger"; dangerSoft -> "danger-soft"; dangerText -> "danger-text"
    warn -> "warn"; warnSoft -> "warn-soft"; warnText -> "warn-text"; warnInk -> "warn-ink"
    infoSoft -> "info-soft"; infoText -> "info-text"
    hover -> "hover"; press -> "press"; scrim -> "scrim"; scrimSheet -> "scrim-sheet"
    RrFixedColors.paper -> "paper"
    RrFixedColors.stageSaved -> "st-saved"; RrFixedColors.stageApplied -> "st-applied"
    RrFixedColors.stageScreening -> "st-screening"; RrFixedColors.stageInterview -> "st-interview"
    RrFixedColors.stageOffer -> "st-offer"; RrFixedColors.stageClosed -> "st-closed"
    else -> "#%06X".format(color.toArgb() and 0xFFFFFF)
}
