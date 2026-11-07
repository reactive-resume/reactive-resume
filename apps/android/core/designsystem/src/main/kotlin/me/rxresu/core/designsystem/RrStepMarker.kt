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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import me.rxresu.core.strings.R as S

/**
 * Numbered step marker (W2's Documents · Form answers · Submit, the Apply sheet): the number in Geist Mono 600 ink-2 on
 * a 24 dp sunken square, or a 14 dp tick in accent-text on accent-soft once [done]. Put the step's name beside it;
 * TalkBack reads the number, or "Done" for a ticked step.
 */
@Composable
fun RrStepMarker(number: Int, done: Boolean, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    Box(modifier.size(24.dp).clip(RrShape.sm).background(if (done) c.accentSoft else c.sunken), contentAlignment = Alignment.Center) {
        if (done) RrIcon(R.drawable.ic_ph_check, stringResource(S.string.done), size = 14.dp, tint = c.accentText)
        else RrText(number.toString(), style = RrType.mono.copy(fontWeight = FontWeight.SemiBold), color = c.ink2, maxLines = 1)
    }
}

@RrPreviews
@Composable
internal fun RrStepMarkerPreview() = RrPreviewSurface {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        RrStepMarker(1, done = true)
        RrText("Documents", style = RrType.eyebrow, color = RrTheme.colors.ink3)
        RrStepMarker(2, done = false)
        RrText("Form answers", style = RrType.eyebrow, color = RrTheme.colors.ink3)
    }
}
