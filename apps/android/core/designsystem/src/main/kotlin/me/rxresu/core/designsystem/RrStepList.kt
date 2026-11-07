package me.rxresu.core.designsystem

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp

/** Where a step of [RrStepList] stands. */
enum class RrStepState { Pending, Running, Done }

/** One line of [RrStepList]. */
data class RrStep(val label: String, val state: RrStepState)

/**
 * Vertical progress steps for long work (D4 import: Reading the file · Finding sections · Filling in entries): 14 sp
 * ink-2 lines 8 dp apart, each led by an 18 dp mark: an accent check-circle once done, a spinner while running, a line-2
 * ring while pending. Steps change when the work does; no progress bar. TalkBack reads "Done: …", "In progress: …" or
 * the label. For the one-line trace under an AI request use [RrTraceSteps].
 */
@Composable
fun RrStepList(steps: List<RrStep>, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        steps.forEach { step ->
            val description = when (step.state) {
                RrStepState.Done -> stringResource(R.string.ds_step_done, step.label)
                RrStepState.Running -> stringResource(R.string.ds_step_running, step.label)
                RrStepState.Pending -> step.label
            }
            Row(
                Modifier.clearAndSetSemantics { contentDescription = description },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                when (step.state) {
                    RrStepState.Done -> RrIcon(R.drawable.ic_ph_check_circle, null, size = 18.dp, tint = c.accentText)
                    RrStepState.Running -> RrSpinner(size = 18.dp, tint = c.ink3)
                    RrStepState.Pending -> RrIcon(R.drawable.ic_ph_circle_notch, null, size = 18.dp, tint = c.line2)
                }
                RrText(step.label, style = RrType.ui, color = c.ink2)
            }
        }
    }
}

@RrPreviews
@Composable
internal fun RrStepListPreview() = RrPreviewSurface {
    RrStepList(
        listOf(
            RrStep("Reading the file", RrStepState.Done),
            RrStep("Finding sections", RrStepState.Running),
            RrStep("Filling in entries", RrStepState.Pending),
        ),
    )
}
