package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp

/** Application stages. Colours are the same in both themes and always sit beside the stage name. */
enum class RrStage(val color: Color) {
    Saved(RrFixedColors.stageSaved),
    Applied(RrFixedColors.stageApplied),
    Screening(RrFixedColors.stageScreening),
    Interview(RrFixedColors.stageInterview),
    Offer(RrFixedColors.stageOffer),
    Closed(RrFixedColors.stageClosed),
}

/** 8 dp stage dot. Decorative: always pair it with the stage name ([RrStageLabel]) or a title that names the stage. */
@Composable
fun RrStageDot(stage: RrStage, modifier: Modifier = Modifier) {
    Box(modifier.size(8.dp).clip(RrShape.sm).background(stage.color))
}

/** Stage dot plus its name ("Interview"). [name] comes from the caller's strings. */
@Composable
fun RrStageLabel(stage: RrStage, name: String, modifier: Modifier = Modifier, style: TextStyle = RrType.small) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        RrStageDot(stage)
        RrText(name, style = style)
    }
}

/**
 * Stepper bar: one 4 dp segment per stage, filled up to [current] in the current stage's colour, with the stage name
 * above it. TalkBack reads the name and position ("Interview, stage 4 of 6").
 */
@Composable
fun RrStageStepper(
    current: RrStage,
    name: String,
    modifier: Modifier = Modifier,
    stages: List<RrStage> = RrStage.entries,
    positionDescription: String = "${stages.indexOf(current) + 1}/${stages.size}",
) {
    val c = RrTheme.colors
    val index = stages.indexOf(current)
    Column(modifier.semantics(mergeDescendants = true) { stateDescription = positionDescription }, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        RrStageLabel(current, name)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            stages.forEachIndexed { i, _ ->
                Box(
                    Modifier.weight(1f).height(4.dp).clip(RrShape.sm)
                        .background(if (i <= index) current.color else c.line),
                )
            }
        }
    }
}

@RrPreviews
@Composable
internal fun RrStagePreview() = RrPreviewSurface {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RrStage.entries.forEach { RrStageLabel(it, it.name) }
    }
    RrStageStepper(RrStage.Interview, "Interview")
}
