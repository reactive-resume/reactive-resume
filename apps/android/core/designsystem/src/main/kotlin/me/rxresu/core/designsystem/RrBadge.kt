package me.rxresu.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** Badge tones. Colour never carries meaning alone: the badge always has words. */
enum class RrBadgeTone { Accent, Neutral, Outline, Info, Warn, Danger }

/**
 * A 20 dp label: status ("Public", "Locked"), counts ("3 issues"), recency ("New"), failure, tags in outline.
 * Evidence states use [RrEvidencePill]; the AI "Used" source chip is [RrUsedChip].
 */
@Composable
fun RrBadge(text: String, modifier: Modifier = Modifier, tone: RrBadgeTone = RrBadgeTone.Neutral, @DrawableRes icon: Int? = null, containerColor: Color? = null) {
    val c = RrTheme.colors
    val (bg, fg) = when (tone) {
        RrBadgeTone.Accent -> c.accentSoft to c.accentText
        RrBadgeTone.Neutral -> c.sunken to c.ink2
        RrBadgeTone.Outline -> Color.Transparent to c.ink2
        RrBadgeTone.Info -> c.infoSoft to c.infoText
        RrBadgeTone.Warn -> c.warnSoft to c.warnText
        RrBadgeTone.Danger -> c.dangerSoft to c.dangerText
    }
    Row(
        modifier
            .rrDesignTag(DesignTag(component = "Badge", radius = RrRadius.xs, bgName = c.tokenName(containerColor ?: bg)))
            .defaultMinSize(minHeight = 20.dp)
            .clip(RrShape.xs)
            .background(containerColor ?: bg)
            .then(if (tone == RrBadgeTone.Outline) Modifier.border(1.dp, c.line2, RrShape.xs) else Modifier)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) RrIcon(icon, null, size = 14.dp, tint = fg)
        RrText(text, style = RrType.caption, color = fg)
    }
}

@RrPreviews
@Composable
internal fun RrBadgePreview() = RrPreviewSurface {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RrBadge("Public", tone = RrBadgeTone.Accent, icon = R.drawable.ic_ph_globe_simple)
        RrBadge("Locked", tone = RrBadgeTone.Neutral, icon = R.drawable.ic_ph_lock_simple)
        RrBadge("3 issues", tone = RrBadgeTone.Warn)
        RrBadge("New", tone = RrBadgeTone.Info)
        RrBadge("Failed", tone = RrBadgeTone.Danger)
        RrBadge("Design", tone = RrBadgeTone.Outline)
    }
}
