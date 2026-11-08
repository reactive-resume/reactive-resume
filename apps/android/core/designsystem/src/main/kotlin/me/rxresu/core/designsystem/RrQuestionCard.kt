package me.rxresu.core.designsystem

import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

/**
 * A question from the assistant or coach (B16 "Did you lead the onboarding redesign?"): info-soft card, the question
 * in semibold ink, then 48 dp answer buttons, 10 dp apart, and an optional free-text input.
 * Each answer is its own TalkBack button.
 */
@Composable
fun RrQuestionCard(
    question: String,
    answers: List<String>,
    onAnswer: (String) -> Unit,
    modifier: Modifier = Modifier,
    ownWordsLabel: String? = null,
    onOwnWords: (() -> Unit)? = null,
    enabled: Boolean = true,
    ownWordsInput: (@Composable () -> Unit)? = null,
) {
    val c = RrTheme.colors
    Column(
        modifier.fillMaxWidth().rrDesignTag(DesignTag(component = "Card", radius = RrRadius.xl, bgName = "info-soft")).clip(RrShape.xl).background(c.infoSoft).padding(21.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        RrText(question, style = RrType.label.copy(fontSize = RrType.rowTitle.fontSize, lineHeight = RrType.rowTitle.lineHeight), color = c.ink)
        answers.forEach { answer ->
            Box(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .rrDesignTag(DesignTag(component = "ChoiceButton", radius = RrRadius.md, bgName = "raised"))
                    .clip(RrShape.md)
                    .background(c.raised)
                    .border(1.dp, c.line2, RrShape.md)
                    .clickable(remember { MutableInteractionSource() }, LocalIndication.current, enabled = enabled, role = Role.Button) { onAnswer(answer) }
                    .padding(horizontal = 14.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                RrText(answer, style = RrType.ui.copy(fontSize = RrType.body.fontSize), color = c.ink)
            }
        }
        if (ownWordsInput != null) {
            ownWordsInput()
        } else if (ownWordsLabel != null && onOwnWords != null) {
            RrButton(ownWordsLabel, onOwnWords, variant = RrButtonVariant.Secondary, enabled = enabled)
        }
    }
}

@RrPreviews
@Composable
internal fun RrQuestionCardPreview() = RrPreviewSurface {
    RrQuestionCard(
        "Did you lead the onboarding redesign, or take part in it?",
        listOf("Yes, I led it", "I took part in it", "No"),
        onAnswer = {},
        ownWordsInput = {
            RrTextField("", {}, placeholder = "Or in your own words…", trailing = {
                RrIcon(R.drawable.ic_ph_arrow_up, null, size = 20.dp, tint = RrTheme.colors.ink3)
            })
        },
    )
}
