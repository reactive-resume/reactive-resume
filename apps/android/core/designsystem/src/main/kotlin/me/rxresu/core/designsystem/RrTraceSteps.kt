package me.rxresu.core.designsystem

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** One AI step: finished steps get a check, the running one a spinner. */
data class RrTraceStep(val label: String, val done: Boolean)

/**
 * Trace steps under an AI request ("Read the posting · Matched your facts · Measured page fit"): 13 sp ink-3, a 14 dp
 * accent check for each finished step and a spinner for the running one. Steps flow onto new lines; lines appear as
 * steps finish.
 */
@Composable
fun RrTraceSteps(steps: List<RrTraceStep>, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        steps.forEach { step ->
            val description = stringResource(if (step.done) R.string.ds_step_done else R.string.ds_step_running, step.label)
            Row(
                Modifier.semantics(mergeDescendants = true) { contentDescription = description },
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (step.done) RrIcon(R.drawable.ic_ph_check, null, size = 14.dp, tint = c.accentText) else RrSpinner(tint = c.ink3)
                RrText(step.label, style = RrType.small, color = c.ink3)
            }
        }
    }
}

@RrPreviews
@Composable
internal fun RrTraceStepsPreview() = RrPreviewSurface {
    RrTraceSteps(listOf(RrTraceStep("Read the posting", true), RrTraceStep("Matched your facts", true), RrTraceStep("Measured page fit", false)))
}
