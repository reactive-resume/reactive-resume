package me.rxresu.core.designsystem

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Collapse state of [RrLargeTitleHeader]. Drive it with [nestedScrollConnection] on the screen's scrolling content
 * (`Modifier.nestedScroll(state.nestedScrollConnection)`), or call [onScrolled] with the list's scroll position.
 */
@Stable
class RrLargeTitleState(private val thresholdPx: Float) {
    /** Content scrolled past the top, in px. */
    var scrolledPx by mutableFloatStateOf(0f)
        private set

    /** 0 = expanded, 1 = collapsed. Collapsed once the content has scrolled [RrLargeTitleHeader]'s 40 dp. */
    val fraction: Float get() = collapseFraction(scrolledPx, thresholdPx)

    val collapsed: Boolean get() = fraction >= 1f

    /** Sets the scroll position directly (e.g. `if (index > 0) Float.MAX_VALUE else offset` from a lazy list). */
    fun onScrolled(px: Float) {
        scrolledPx = px.coerceAtLeast(0f)
    }

    val nestedScrollConnection: NestedScrollConnection = object : NestedScrollConnection {
        override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
            scrolledPx = (scrolledPx - consumed.y).coerceAtLeast(0f)
            // Pulled past the top: the content is at its start.
            if (available.y > 0f) scrolledPx = 0f
            return Offset.Zero
        }
    }

    companion object {
        /** Pure collapse progress, for tests and custom headers. */
        fun collapseFraction(scrolledPx: Float, thresholdPx: Float): Float =
            if (thresholdPx <= 0f) 1f else (scrolledPx / thresholdPx).coerceIn(0f, 1f)
    }
}

/** Collapse after this much scroll. */
val RrLargeTitleCollapseDistance: Dp = 40.dp

@Composable
fun rememberRrLargeTitleState(): RrLargeTitleState {
    val px = with(LocalDensity.current) { RrLargeTitleCollapseDistance.toPx() }
    return remember(px) { RrLargeTitleState(px) }
}

/** Shorthand for `nestedScroll(state.nestedScrollConnection)` on the scrolling content. */
fun Modifier.rrLargeTitleScroll(state: RrLargeTitleState): Modifier = nestedScroll(state.nestedScrollConnection)

private val CollapsedTitle = RrType.topBarTitle

/**
 * Root-tab header: Instrument Serif title with an optional ink-3 subtitle ("Saturday, 7 November"), trailing
 * actions (search, the tab's one primary action, the avatar), and an optional [bottom] row (filter chips). After 40 dp
 * of scroll it becomes a 56 dp bar with a top-bar title and a line under it (crossfade d2; instant under reduced motion).
 */
@Composable
fun RrLargeTitleHeader(
    title: String,
    state: RrLargeTitleState,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    applyStatusBarInset: Boolean = true,
    bottom: (@Composable () -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val c = RrTheme.colors
    val reduced = LocalReducedMotion.current
    val collapsed by animateFloatAsState(
        if (state.collapsed) 1f else 0f,
        RrMotion.spec(RrMotion.D2, reduced),
        label = "collapse",
    )
    Column(modifier.fillMaxWidth().rrDesignTag(DesignTag(component = "RootHeader", bgName = "bg")).background(c.bg).then(if (applyStatusBarInset) Modifier.rrStatusBarsPadding() else Modifier)) {
        if (collapsed < 1f) {
            Column(Modifier.graphicsLayer { alpha = 1f - collapsed }) {
                RootTitleAndActions(
                    title = title,
                    actions = actions,
                )
                if (subtitle != null) RrText(subtitle, style = RrType.ui, color = c.ink3, modifier = Modifier.padding(horizontal = 24.dp))
                bottom?.invoke()
            }
        }

        if (collapsed > 0f) {
            Column(Modifier.graphicsLayer { alpha = collapsed }) {
                Box(Modifier.fillMaxWidth().heightIn(min = RrLayout.topBar).padding(horizontal = 12.dp)) {
                    RrText(title, style = CollapsedTitle, color = c.ink, maxLines = 1, modifier = Modifier.align(Alignment.Center).padding(horizontal = 96.dp).semantics { heading() })
                    Row(Modifier.align(Alignment.CenterEnd), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically, content = actions)
                }
                if (bottom != null) Box(Modifier.padding(bottom = 8.dp)) { bottom() }
                Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
            }
        }
    }
}

/** Long translations and large fonts keep whole words by moving actions above the title. */
@Composable
private fun RootTitleAndActions(title: String, actions: @Composable RowScope.() -> Unit) {
    Layout(
        contents = listOf(
            { RrText(title, style = RrType.rootTitle, modifier = Modifier.semantics { heading() }) },
            { Row(Modifier.padding(bottom = 2.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically, content = actions) },
        ),
        modifier = Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 8.dp),
    ) { (titleM, actionsM), constraints ->
        val width = constraints.maxWidth
        val actionsP = actionsM.first().measure(Constraints(maxWidth = width))
        val beside = (width - actionsP.width).coerceAtLeast(0)
        val stacked = titleM.first().maxIntrinsicWidth(Constraints.Infinity) > beside
        val titleP = titleM.first().measure(Constraints(maxWidth = if (stacked) width else beside))
        val rowHeight = if (actionsP.width == 0) titleP.height else maxOf(44.dp.roundToPx(), actionsP.height)
        val height = if (stacked) rowHeight + titleP.height else maxOf(rowHeight, titleP.height)
        layout(width, height) {
            actionsP.placeRelative(width - actionsP.width, (rowHeight - actionsP.height) / 2)
            titleP.placeRelative(0, if (stacked) rowHeight else (height - titleP.height) / 2)
        }
    }
}

@RrPreviews
@Composable
internal fun RrLargeTitleHeaderPreview() = RrPreviewSurface {
    val expanded = rememberRrLargeTitleState()
    RrLargeTitleHeader("Today", expanded, subtitle = "Saturday, 7 November", applyStatusBarInset = false) {
        RrIconButton(R.drawable.ic_ph_magnifying_glass, "Search", {})
        RrAvatar("AM", onClick = {}, contentDescription = "Settings")
    }
    val collapsed = rememberRrLargeTitleState().apply { onScrolled(Float.MAX_VALUE) }
    RrLargeTitleHeader("Documents", collapsed, applyStatusBarInset = false) {
        RrIconButton(R.drawable.ic_ph_magnifying_glass, "Search", {})
        RrButton("New", {}, size = RrButtonSize.Small, icon = R.drawable.ic_ph_plus)
        RrAvatar("AM", onClick = {}, contentDescription = "Settings")
    }
}
