package me.rxresu.core.designsystem

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * One tab of [RrUnderlineTabs].
 *
 * @param trailing a mono count ("3") or short badge text after the label; [warn] draws it as a warn badge.
 */
data class RrUnderlineTab(val label: String, val trailing: String? = null, val warn: Boolean = false, val contentDescription: String? = null)

private val TabText = RrType.ui.copy(fontWeight = FontWeight.Medium)

/**
 * Scrollable underline tabs (the job workspace: Overview · Fit · Apply · Interview prep …). 44 dp tabs 20 dp apart, a
 * line under the strip, and a 2 dp accent indicator that slides with ease-in-out-strong d2 (instant under reduced
 * motion). The selected tab scrolls into view. Plays `selection` on change.
 */
@Composable
fun RrUnderlineTabs(
    tabs: List<RrUnderlineTab>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(horizontal = 16.dp),
) {
    val c = RrTheme.colors
    val reduced = LocalReducedMotion.current
    val haptics = rememberRrHaptics()
    val scroll = rememberScrollState()
    // Tab bounds (start, width) in the scrolling row, in px.
    val bounds = remember(tabs.size) { mutableStateListOf<Pair<Float, Float>>().apply { repeat(tabs.size) { add(0f to 0f) } } }
    val rowWidth = remember { floatArrayOf(0f) }
    val rtl = androidx.compose.ui.platform.LocalLayoutDirection.current == androidx.compose.ui.unit.LayoutDirection.Rtl
    val x = remember { Animatable(0f) }
    val w = remember { Animatable(0f) }
    LaunchedEffect(selectedIndex, bounds.getOrNull(selectedIndex), reduced) {
        val (start, width) = bounds.getOrNull(selectedIndex) ?: return@LaunchedEffect
        val first = w.value == 0f
        val spec = RrMotion.spec<Float>(RrMotion.D2, reduced || first, RrMotion.easeInOutStrong)
        launch { x.animateTo(start, spec) }
        launch { w.animateTo(width, spec) }
        // Scroll offsets count from the start edge; convert the physical bound in RTL.
        val logical = if (rtl) rowWidth[0] - start - width else start
        val viewStart = scroll.value
        val viewEnd = viewStart + scroll.viewportSize
        if (logical < viewStart || logical + width > viewEnd) scroll.animateScrollTo((logical - 16f).toInt().coerceAtLeast(0))
    }
    Box(modifier.fillMaxWidth()) {
        Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(1.dp).background(c.line))
        Row(
            Modifier
                .horizontalScroll(scroll)
                .selectableGroup()
                .padding(contentPadding)
                .onPlaced { rowWidth[0] = it.size.width.toFloat() }
                .drawBehind {
                    // Bounds are physical (left-based) in both directions.
                    val h = 2.dp.toPx()
                    drawRect(c.accent, Offset(x.value, size.height - h), Size(w.value, h))
                },
            horizontalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            tabs.forEachIndexed { i, tab ->
                val selected = i == selectedIndex
                Row(
                    Modifier
                        .heightIn(min = 44.dp)
                        .onPlaced { coords ->
                            val parentX = coords.parentCoordinates?.let { p -> p.localPositionOf(coords, Offset.Zero).x } ?: 0f
                            bounds[i] = parentX to coords.size.width.toFloat()
                        }
                        .selectable(selected, role = Role.Tab) {
                            if (!selected) haptics(RrHaptic.Selection)
                            onSelect(i)
                        }
                        .then(if (tab.contentDescription != null) Modifier.semantics(mergeDescendants = true) { contentDescription = tab.contentDescription } else Modifier),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RrText(tab.label, style = TabText, color = if (selected) c.ink else c.ink2, maxLines = 1)
                    if (tab.trailing != null) {
                        if (tab.warn) RrBadge(tab.trailing, tone = RrBadgeTone.Warn) else RrText(tab.trailing, style = RrType.mono, color = c.ink3)
                    }
                }
            }
        }
    }
}

@RrPreviews
@Composable
internal fun RrUnderlineTabsPreview() = RrPreviewSurface {
    RrUnderlineTabs(
        listOf(RrUnderlineTab("Overview"), RrUnderlineTab("Fit"), RrUnderlineTab("Apply", "2"), RrUnderlineTab("Interview prep"), RrUnderlineTab("Practice"), RrUnderlineTab("Debrief")),
        selectedIndex = 0,
        onSelect = {},
        contentPadding = PaddingValues(0.dp),
    )
}
