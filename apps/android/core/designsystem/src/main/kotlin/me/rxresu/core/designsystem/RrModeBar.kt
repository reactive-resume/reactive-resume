package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Builder mode bar that replaces the tab bar in the resume builder (Write · Design · Check · Share) and letters
 * (Write · Design · Export). A segmented control of 36 dp stacked items on `surface`, with a line on top and the
 * navigation bar inset below. The selected mode uses its filled icon. Plays `selection` on change.
 *
 * Give Check `warn = true` and a content description with the count ("Check, 3 issues") while issues are open.
 */
@Composable
fun RrModeBar(
    modes: List<RrSegment>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = RrTheme.colors
    Column(modifier.fillMaxWidth().background(c.surface)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
        SegmentTrack(
            segments = modes,
            selectedIndex = selectedIndex,
            onSelect = onSelect,
            modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 8.dp),
            itemHeight = 36.dp,
            stacked = true,
            fillWidth = true,
        )
        Box(Modifier.windowInsetsPadding(WindowInsets.navigationBars))
    }
}

/** The builder's four modes with their regular and filled icons. Labels come from the caller's strings. */
fun rrBuilderModes(write: String, design: String, check: String, share: String, checkWarn: Boolean = false, checkDescription: String? = null) = listOf(
    RrSegment(write, R.drawable.ic_ph_pencil_simple, R.drawable.ic_ph_pencil_simple_fill),
    RrSegment(design, R.drawable.ic_ph_palette, R.drawable.ic_ph_palette_fill),
    RrSegment(check, R.drawable.ic_ph_seal_check, R.drawable.ic_ph_seal_check_fill, warn = checkWarn, contentDescription = checkDescription),
    RrSegment(share, R.drawable.ic_ph_share_network, R.drawable.ic_ph_share_network_fill),
)

@RrPreviews
@Composable
internal fun RrModeBarPreview() = RrPreviewSurface {
    RrModeBar(rrBuilderModes("Write", "Design", "Check", "Share", checkWarn = true, checkDescription = "Check, 3 issues"), 0, {})
    RrModeBar(
        listOf(
            RrSegment("Write", R.drawable.ic_ph_pencil_simple, R.drawable.ic_ph_pencil_simple_fill),
            RrSegment("Design", R.drawable.ic_ph_palette, R.drawable.ic_ph_palette_fill),
            RrSegment("Export", R.drawable.ic_ph_export),
        ),
        1,
        {},
    )
}
