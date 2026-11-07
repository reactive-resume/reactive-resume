package me.rxresu.core.designsystem

import androidx.compose.animation.animateColorAsState
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
import androidx.compose.runtime.getValue
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

/**
 * 8 dp stage dot. Decorative: always pair it with the stage name ([RrStageLabel]) or a title that names the stage.
 *
 * @param color a custom lane's colour; the stage's own colour by default.
 */
@Composable
fun RrStageDot(stage: RrStage, modifier: Modifier = Modifier, color: Color = stage.color) {
    Box(modifier.size(8.dp).clip(RrShape.sm).background(color))
}

/** Stage dot plus its name ("Interview"). [name] comes from the caller's strings; [color] as on [RrStageDot]. */
@Composable
fun RrStageLabel(stage: RrStage, name: String, modifier: Modifier = Modifier, style: TextStyle = RrType.small, color: Color = stage.color) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        RrStageDot(stage, color = color)
        RrText(name, style = style)
    }
}

/**
 * Stepper bar: one 4 dp segment per stage up to [current], the rest `line`. TalkBack reads the name and position
 * ("Interview, 4/5"). Segments fill at d2 when the stage changes (instant under reduced motion).
 *
 * - Stacked (default): the stage name above a full-width bar, every reached segment in the current stage's colour.
 * - [inline] (J6 header): dot, name in [labelStyle], then the bar filling the rest of the row, each reached segment in
 *   its own stage's colour (saved grey, applied blue, …).
 */
@Composable
fun RrStageStepper(
    current: RrStage,
    name: String,
    modifier: Modifier = Modifier,
    stages: List<RrStage> = RrStage.entries,
    positionDescription: String = "${stages.indexOf(current) + 1}/${stages.size}",
    inline: Boolean = false,
    labelStyle: TextStyle = RrType.small,
) {
    val c = RrTheme.colors
    val reduced = LocalReducedMotion.current
    val index = stages.indexOf(current)
    val bar = @Composable { barModifier: Modifier ->
        Row(barModifier, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            stages.forEachIndexed { i, stage ->
                val target = when {
                    i > index -> c.line
                    inline -> stage.color
                    else -> current.color
                }
                val color by animateColorAsState(target, RrMotion.spec(RrMotion.D2, reduced), label = "segment")
                Box(Modifier.weight(1f).height(4.dp).clip(RrShape.sm).background(color))
            }
        }
    }
    val described = modifier.semantics(mergeDescendants = true) { stateDescription = positionDescription }
    if (inline) {
        Row(described, horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            RrStageLabel(current, name, style = labelStyle)
            bar(Modifier.weight(1f))
        }
    } else {
        Column(described, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            RrStageLabel(current, name, style = labelStyle)
            bar(Modifier.fillMaxWidth())
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
    RrStageStepper(RrStage.Interview, "Interview", stages = RrStage.entries.dropLast(1), inline = true, labelStyle = RrType.label)
    RrStageLabel(RrStage.Applied, "Phone screen", color = RrStage.Screening.color)
}
