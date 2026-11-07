package me.rxresu.core.designsystem

import android.text.format.DateFormat
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Time-list arithmetic, kept pure for tests. */
object RrTimeMath {
    /** Times of day from 00:00 every [stepMinutes] minutes, plus [selected] if it falls between steps. */
    fun slots(stepMinutes: Int, selected: LocalTime?): List<LocalTime> {
        require(stepMinutes in 1..720) { "stepMinutes must be 1–720" }
        val base = (0 until 24 * 60 step stepMinutes).map { LocalTime.of(it / 60, it % 60) }
        return if (selected != null && selected !in base) (base + selected.withSecond(0).withNano(0)).sorted() else base
    }
}

/**
 * Time list (no native wheels): 44 dp rows every [stepMinutes] minutes in Geist Mono, 24- or 12-hour by the device
 * setting. The selected time is accent-soft with a check and starts in view. Plays `selection` when a time is picked.
 */
@Composable
fun RrTimePicker(
    selected: LocalTime?,
    onSelect: (LocalTime) -> Unit,
    modifier: Modifier = Modifier,
    stepMinutes: Int = 15,
    use24Hour: Boolean = DateFormat.is24HourFormat(LocalContext.current),
    locale: Locale = LocalConfiguration.current.locales[0],
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val slots = remember(stepMinutes, selected) { RrTimeMath.slots(stepMinutes, selected) }
    val format = remember(use24Hour, locale) { DateTimeFormatter.ofPattern(if (use24Hour) "HH:mm" else "h:mm a", locale) }
    val start = slots.indexOf(selected ?: LocalTime.of(9, 0)).coerceAtLeast(0)
    val list = rememberLazyListState(initialFirstVisibleItemIndex = (start - 2).coerceAtLeast(0))
    LazyColumn(modifier.selectableGroup(), state = list, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        items(slots, key = { it.toSecondOfDay() }) { time ->
            val isSelected = time == selected
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 44.dp)
                    .clip(RrShape.md)
                    .background(if (isSelected) c.accentSoft else Color.Transparent)
                    .selectable(isSelected, remember { MutableInteractionSource() }, LocalIndication.current, role = Role.RadioButton) {
                        if (!isSelected) haptics(RrHaptic.Selection)
                        onSelect(time)
                    }
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RrText(
                    time.format(format),
                    style = RrType.mono.copy(fontSize = 16.sp, lineHeight = 22.sp, textDirection = TextDirection.Ltr),
                    color = if (isSelected) c.accentText else c.ink,
                    modifier = Modifier.weight(1f),
                )
                if (isSelected) RrIcon(R.drawable.ic_ph_check, null, size = 20.dp, tint = c.accentText)
            }
        }
    }
}

@RrPreviews
@Composable
internal fun RrTimePickerPreview() = RrPreviewSurface {
    RrTimePicker(LocalTime.of(10, 0), {}, modifier = Modifier.heightIn(max = 240.dp), use24Hour = true)
}
