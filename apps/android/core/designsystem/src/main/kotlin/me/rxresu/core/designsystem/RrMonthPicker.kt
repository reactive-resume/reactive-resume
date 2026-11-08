package me.rxresu.core.designsystem

import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import java.time.Month
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import androidx.compose.ui.unit.dp
import me.rxresu.core.strings.R as S

/**
 * Month and year picker for entry dates (B2 Start · End; the boards forbid native wheels): the year with previous and
 * next buttons, then the twelve months in a 3 × 4 grid of 44 dp cells. The selected month is accent-filled; this month
 * has a line-2 edge. With [onPresent], a "Present" button under the grid marks an ongoing entry (accent-filled while
 * [present]). Months outside [min]..[max] are dimmed and inert. Plays `selection` on a pick. Put it in a sheet.
 */
@Composable
fun RrMonthPicker(
    selected: YearMonth?,
    onSelect: (YearMonth) -> Unit,
    modifier: Modifier = Modifier,
    present: Boolean = false,
    onPresent: (() -> Unit)? = null,
    today: YearMonth = YearMonth.now(),
    min: YearMonth? = null,
    max: YearMonth? = null,
    locale: Locale = LocalConfiguration.current.locales[0],
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    var year by rememberSaveable { mutableIntStateOf((selected ?: today).year) }
    val full = remember(locale) { DateTimeFormatter.ofPattern("LLLL yyyy", locale) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            RrText("$year", style = RrType.label, color = c.ink, modifier = Modifier.weight(1f).padding(start = 4.dp).semantics { heading() })
            RrIconButton(R.drawable.ic_ph_caret_left, stringResource(R.string.ds_previous_year), { year-- }, mirrorInRtl = true, enabled = min == null || year > min.year)
            RrIconButton(R.drawable.ic_ph_caret_right, stringResource(R.string.ds_next_year), { year++ }, mirrorInRtl = true, enabled = max == null || year < max.year)
        }
        Month.entries.chunked(3).forEach { row ->
            Row(Modifier.fillMaxWidth().selectableGroup(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                row.forEach { m ->
                    val month = YearMonth.of(year, m)
                    val isSelected = !present && month == selected
                    val allowed = (min == null || month >= min) && (max == null || month <= max)
                    val label = month.format(full)
                    Box(
                        Modifier
                            .weight(1f)
                            .heightIn(min = 44.dp)
                            .clip(RrShape.md)
                            .background(if (isSelected) c.accent else Color.Transparent)
                            .then(if (month == today && !isSelected) Modifier.border(1.dp, c.line2, RrShape.md) else Modifier)
                            .selectable(isSelected, remember { MutableInteractionSource() }, LocalIndication.current, allowed, Role.Button) {
                                if (!isSelected) haptics(RrHaptic.Selection)
                                onSelect(month)
                            }
                            .semantics { contentDescription = label }
                            .rrEnabledAlpha(allowed, 0.35f),
                        contentAlignment = Alignment.Center,
                    ) {
                        RrText(
                            m.getDisplayName(TextStyle.SHORT_STANDALONE, locale).replaceFirstChar { it.titlecase(locale) },
                            style = RrType.ui.copy(fontWeight = FontWeight.SemiBold),
                            color = if (isSelected) c.onAccent else c.ink,
                            maxLines = 1,
                            modifier = Modifier.clearAndSetSemantics { },
                        )
                    }
                }
            }
        }
        if (onPresent != null) {
            RrButton(
                stringResource(S.string.present),
                { if (!present) haptics(RrHaptic.Selection); onPresent() },
                Modifier.fillMaxWidth().padding(top = 12.dp).semantics { this.selected = present },
                variant = if (present) RrButtonVariant.Primary else RrButtonVariant.Secondary,
                size = RrButtonSize.Large,
            )
        }
    }
}

@RrPreviews
@Composable
internal fun RrMonthPickerPreview() = RrPreviewSurface {
    RrMonthPicker(YearMonth.of(2022, 3), {}, onPresent = {}, today = YearMonth.of(2026, 11), locale = Locale.UK)
}
