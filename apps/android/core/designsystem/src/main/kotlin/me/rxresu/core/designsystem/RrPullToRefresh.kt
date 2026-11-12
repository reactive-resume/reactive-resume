package me.rxresu.core.designsystem

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshState
import androidx.compose.material3.pulltorefresh.pullToRefresh
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * Pull to refresh (Today, Documents, Applications, Career) with the design-system indicator: the content follows the
 * finger, and words with an arrow (then a spinner) appear above it. Arming plays `soft` once per pull. Material's
 * `pullToRefresh` is used only as gesture plumbing; nothing of its look shows.
 *
 * Re-tap of the tab and the screen's own Refresh action stay the visible alternatives.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RrPullToRefresh(
    refreshing: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val state = rememberPullToRefreshState()
    val haptics = rememberRrHaptics()
    val armed by remember { derivedStateOf { state.distanceFraction >= 1f } }
    LaunchedEffect(armed) { if (armed && !refreshing) haptics(RrHaptic.Soft) }
    LaunchedEffect(refreshing) { if (refreshing) state.animateToThreshold() else state.animateToHidden() }
    val threshold = 72.dp
    Box(modifier.pullToRefresh(refreshing, state, threshold = threshold, onRefresh = onRefresh)) {
        Box(Modifier.graphicsLayer { translationY = state.distanceFraction.coerceIn(0f, 1.5f) * threshold.toPx() }) { content() }
        RefreshIndicator(state, refreshing, Modifier.align(Alignment.TopCenter))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RefreshIndicator(state: PullToRefreshState, refreshing: Boolean, modifier: Modifier) {
    val c = RrTheme.colors
    val fraction = state.distanceFraction
    if (fraction <= 0f && !refreshing) return
    Row(
        modifier
            .fillMaxWidth()
            .padding(top = 20.dp)
            .graphicsLayer { alpha = fraction.coerceIn(0f, 1f) }
            .semantics { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (refreshing) {
            RrSpinner(tint = c.ink3)
            RrText(stringResource(R.string.ds_refreshing), style = RrType.small, color = c.ink3)
        } else {
            RrIcon(
                R.drawable.ic_ph_arrow_clockwise,
                null,
                size = 14.dp,
                tint = c.ink3,
                modifier = Modifier.graphicsLayer { rotationZ = fraction.coerceIn(0f, 1f) * 270f },
            )
            if (fraction >= 1f) RrText(stringResource(R.string.ds_release_to_refresh), style = RrType.small, color = c.ink3)
        }
    }
}

@RrPreviews
@Composable
internal fun RrPullToRefreshPreview() = RrPreviewSurface {
    RrPullToRefresh(refreshing = true, onRefresh = {}, modifier = Modifier.fillMaxWidth()) {
        RrCard { RrText("Needs you", style = RrType.label) }
    }
}
