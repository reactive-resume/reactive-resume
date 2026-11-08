package me.rxresu.core.designsystem

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Shared dock for the resume builder (Edit · Design · Check · Share) and letters (Write · Design · Export). The selected mode uses its filled icon. Plays `selection` on change.
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
    val haptics = rememberRrHaptics()
    RrTabBar(
        tabs = modes.map { mode -> RrTab(mode.label, mode.icon ?: R.drawable.ic_ph_file_text, mode.selectedIcon ?: mode.icon ?: R.drawable.ic_ph_file_text, mode.count, mode.contentDescription, mode.warn) },
        selectedIndex = selectedIndex,
        onSelect = { haptics(RrHaptic.Selection); onSelect(it) },
        onReselect = onSelect,
        modifier = modifier,
    )
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
