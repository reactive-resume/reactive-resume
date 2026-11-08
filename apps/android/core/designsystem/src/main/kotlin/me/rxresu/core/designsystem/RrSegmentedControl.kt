package me.rxresu.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

/**
 * One segment of [RrSegmentedControl] or [RrModeBar].
 *
 * @param selectedIcon the filled icon shown while selected (mode bar only; segments keep the regular weight).
 * @param count a mono count after the label ("Issues 2").
 * @param warn a 6 dp warn mark beside the icon (Check with open issues); say the count in [contentDescription].
 * @param contentDescription replaces the label for TalkBack when the segment carries more than its words.
 */
data class RrSegment(
    val label: String,
    @DrawableRes val icon: Int? = null,
    @DrawableRes val selectedIcon: Int? = icon,
    val count: String? = null,
    val warn: Boolean = false,
    val contentDescription: String? = null,
)

/**
 * Segmented control: sunken track, the selected segment raised with shadow-1. The selection slides with
 * ease-in-out-strong d2 (instant under reduced motion) and plays `selection`.
 *
 * Plays `selection` once when a different segment is picked; callers add no haptic of their own. Segments that don't
 * fit side by side (long translations, 200% text) keep their full labels and wrap onto further rows, so every segment
 * stays visible and reachable.
 *
 * @param fillWidth segments share the available width equally; false sizes every segment to the widest label.
 * @param containerColor the track: `sunken` by default; `bg` where the control sits on the sunken page canvas (B1
 *   Page · Outline).
 * @param enabled false ignores taps (no selection, no haptic), e.g. while the document is locked.
 */
@Composable
fun RrSegmentedControl(
    segments: List<RrSegment>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    fillWidth: Boolean = true,
    containerColor: Color = RrTheme.colors.sunken,
    enabled: Boolean = true,
) {
    SegmentTrack(segments, selectedIndex, onSelect, modifier, itemHeight = 32.dp, stacked = false, fillWidth = fillWidth, containerColor = containerColor, enabled = enabled)
}

private val SegmentText = RrType.small.copy(fontWeight = FontWeight.Medium)
private val ModeText = RrType.small.copy(fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 14.sp)

@Composable
internal fun SegmentTrack(
    segments: List<RrSegment>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier,
    itemHeight: Dp,
    stacked: Boolean,
    fillWidth: Boolean,
    containerColor: Color = RrTheme.colors.sunken,
    enabled: Boolean = true,
) {
    val c = RrTheme.colors
    val reduced = LocalReducedMotion.current
    val haptics = rememberRrHaptics()
    val position = remember { Animatable(selectedIndex.toFloat()) }
    LaunchedEffect(selectedIndex, reduced) {
        position.animateTo(selectedIndex.toFloat(), RrMotion.spec(RrMotion.D2, reduced, RrMotion.easeInOutStrong))
    }
    Layout(
        modifier = modifier.clip(RrShape.lg).background(containerColor).padding(2.dp).selectableGroup(),
        content = {
            Box(Modifier.rrShadow(RrElevation.Level1, RrShape.md).clip(RrShape.md).background(c.raised))
            segments.forEachIndexed { i, s ->
                val selected = i == selectedIndex
                val fg = if (selected) c.ink else c.ink2
                val content: @Composable () -> Unit = {
                    val iconId = if (selected) s.selectedIcon else s.icon
                    if (iconId != null) {
                        val iconSize = if (stacked) 20.dp else 18.dp
                        Box {
                            RrIcon(iconId, null, size = iconSize, tint = fg)
                            // Beside the icon, outside its bounds, so the label stays centred.
                            if (s.warn) Box(Modifier.offset(x = iconSize + 3.dp, y = iconSize / 2 - 5.dp).size(6.dp).clip(RrShape.xs).background(c.warn))
                        }
                    }
                    RrText(s.label, style = if (stacked) ModeText else SegmentText, color = fg, maxLines = 1)
                    if (s.count != null) RrText(s.count, style = RrType.mono, color = c.ink3)
                }
                val itemModifier = Modifier
                    .clip(RrShape.md)
                    .selectable(selected, enabled = enabled, role = Role.Tab) {
                        if (!selected) haptics(RrHaptic.Selection)
                        onSelect(i)
                    }
                    .then(if (s.contentDescription != null) Modifier.semantics(mergeDescendants = true) { contentDescription = s.contentDescription } else Modifier)
                    .padding(horizontal = 2.dp)
                if (stacked) {
                    Column(itemModifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) { content() }
                } else {
                    Row(itemModifier, horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) { content() }
                }
            }
        },
    ) { measurables, constraints ->
        val gap = 2.dp.roundToPx()
        val minH = itemHeight.roundToPx()
        val items = measurables.drop(1)
        val natural = items.map { it.maxIntrinsicWidth(minH) }.let { n ->
            if (fillWidth && constraints.hasBoundedWidth) n else (n.maxOrNull() ?: 0).let { widest -> n.map { widest } }
        }
        val available = if (constraints.hasBoundedWidth) constraints.maxWidth else Int.MAX_VALUE
        // Rows of segments that fit side by side; one row unless the labels are too wide (200% text, translations).
        val rows = segmentRows(natural, available, gap)
        val widths = IntArray(items.size)
        rows.forEach { row ->
            val rowNatural = row.map { natural[it] }
            val rowWidths = if (fillWidth && constraints.hasBoundedWidth) segmentWidths(rowNatural, available - gap * (row.size - 1)) else rowNatural
            row.forEachIndexed { k, i -> widths[i] = rowWidths[k].coerceAtMost(available) }
        }
        val h = maxOf(minH, items.indices.maxOfOrNull { items[it].minIntrinsicHeight(widths[it]) } ?: 0)
        val xs = IntArray(items.size)
        val ys = IntArray(items.size)
        rows.forEachIndexed { r, row ->
            var x = 0
            row.forEach { i -> xs[i] = x; ys[i] = r * (h + gap); x += widths[i] + gap }
        }
        val placeables = items.mapIndexed { i, m -> m.measure(Constraints.fixed(widths[i], h)) }
        // The indicator follows the animated index between neighbouring segments' bounds (across rows when wrapped).
        val pos = position.value.coerceIn(0f, (widths.size - 1).coerceAtLeast(0).toFloat())
        val lo = pos.toInt()
        val hi = minOf(lo + 1, widths.lastIndex.coerceAtLeast(0))
        val t = pos - lo
        fun lerp(a: IntArray, i: Int, j: Int) = a.getOrElse(i) { 0 } + (a.getOrElse(j) { 0 } - a.getOrElse(i) { 0 }) * t
        val indicator = measurables.first().measure(Constraints.fixed(lerp(widths, lo, hi).roundToInt().coerceAtLeast(0), h))
        val width = rows.maxOfOrNull { row -> row.sumOf { widths[it] } + gap * (row.size - 1) } ?: 0
        layout(width, rows.size * h + gap * (rows.size - 1).coerceAtLeast(0)) {
            indicator.placeRelative(lerp(xs, lo, hi).roundToInt(), lerp(ys, lo, hi).roundToInt())
            placeables.forEachIndexed { i, p -> p.placeRelative(xs[i], ys[i]) }
        }
    }
}

/** Indices of [natural] widths grouped into rows no wider than [available] with [gap] between neighbours, in order. */
internal fun segmentRows(natural: List<Int>, available: Int, gap: Int): List<List<Int>> {
    val rows = mutableListOf<MutableList<Int>>()
    var x = 0
    natural.forEachIndexed { i, w ->
        val row = rows.lastOrNull()
        if (row == null || x + gap + w > available) { rows += mutableListOf(i); x = w } else { row += i; x += gap + w }
    }
    return rows
}

/**
 * Widths for segments that share [available] like CSS `flex: 1` with `min-width: auto`: equal shares, except that a
 * segment never gets less than its content; the others split what remains.
 */
internal fun segmentWidths(natural: List<Int>, available: Int): List<Int> {
    val widths = IntArray(natural.size)
    val fixed = BooleanArray(natural.size)
    var remaining = available
    var open = natural.size
    while (open > 0) {
        val share = remaining / open
        val grown = natural.indices.filter { !fixed[it] && natural[it] > share }
        if (grown.isEmpty()) {
            natural.indices.filter { !fixed[it] }.forEach { widths[it] = share.coerceAtLeast(0) }
            break
        }
        grown.forEach { fixed[it] = true; widths[it] = natural[it]; remaining -= natural[it]; open-- }
    }
    return widths.toList()
}

@RrPreviews
@Composable
internal fun RrSegmentedControlPreview() = RrPreviewSurface {
    RrSegmentedControl(
        listOf(
            RrSegment("List", R.drawable.ic_ph_list),
            RrSegment("Board", R.drawable.ic_ph_kanban),
            RrSegment("Calendar", R.drawable.ic_ph_calendar_blank),
            RrSegment("Insights", R.drawable.ic_ph_chart_bar),
        ),
        selectedIndex = 0,
        onSelect = {},
    )
    RrSegmentedControl(
        listOf(RrSegment("Issues", count = "2"), RrSegment("Job match"), RrSegment("Writing")),
        selectedIndex = 0,
        onSelect = {},
    )
    RrSegmentedControl(
        listOf(RrSegment("Page", R.drawable.ic_ph_file_text), RrSegment("Outline", R.drawable.ic_ph_list_bullets)),
        selectedIndex = 0,
        onSelect = {},
        fillWidth = false,
    )
    Box(Modifier.background(RrTheme.colors.sunken).padding(8.dp)) {
        RrSegmentedControl(
            listOf(RrSegment("Page", R.drawable.ic_ph_file_text), RrSegment("Outline", R.drawable.ic_ph_list_bullets)),
            selectedIndex = 1,
            onSelect = {},
            fillWidth = false,
            containerColor = RrTheme.colors.bg,
        )
    }
}
