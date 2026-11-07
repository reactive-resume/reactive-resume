package me.rxresu.core.designsystem

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Fit evidence for one requirement. */
enum class RrEvidence { Supported, Partial, Missing }

/**
 * Evidence pill on Fit (W1): Supported (accent, check-circle), Partly supported (info, circle-half), No evidence yet
 * (warn, question). [label] comes from the caller's strings ("Supported", "Partly supported", "No evidence yet").
 */
@Composable
fun RrEvidencePill(evidence: RrEvidence, label: String, modifier: Modifier = Modifier) {
    when (evidence) {
        RrEvidence.Supported -> RrBadge(label, modifier, RrBadgeTone.Accent, R.drawable.ic_ph_check_circle)
        RrEvidence.Partial -> RrBadge(label, modifier, RrBadgeTone.Info, R.drawable.ic_ph_circle_half)
        RrEvidence.Missing -> RrBadge(label, modifier, RrBadgeTone.Warn, R.drawable.ic_ph_question)
    }
}

@RrPreviews
@Composable
internal fun RrEvidencePillPreview() = RrPreviewSurface {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RrEvidencePill(RrEvidence.Supported, "Supported")
        RrEvidencePill(RrEvidence.Partial, "Partly supported")
        RrEvidencePill(RrEvidence.Missing, "No evidence yet")
    }
}
