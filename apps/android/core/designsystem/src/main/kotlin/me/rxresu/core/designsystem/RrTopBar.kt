package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

private val BarTitle = RrType.topBarTitle

/**
 * Top bar for pushed screens and the builder (56 dp under the status bar): back caret, title with an optional status
 * line ("Saved", "Saving…" with a spinner), trailing icon buttons. A line under it unless [flat].
 *
 * @param onBack shows the back caret ("Back"); null hides it.
 * @param onClose shows a close (×) button in the back caret's place, for screens presented as modals (D4 Import,
 *   full-screen editors); [onBack] is then ignored.
 * @param status the second line; put a spinner or icon beside its words there.
 * @param applyStatusBarInset pad for the status bar (false when a parent already did).
 */
@Composable
fun RrTopBar(
    title: String = "",
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    backLabel: String = stringResource(R.string.ds_back),
    status: (@Composable RowScope.() -> Unit)? = null,
    flat: Boolean = true,
    applyStatusBarInset: Boolean = true,
    onClose: (() -> Unit)? = null,
    closeLabel: String = stringResource(R.string.ds_close),
    center: (@Composable () -> Unit)? = null,
    centerBetweenActions: Boolean = false,
    containerColor: androidx.compose.ui.graphics.Color = RrTheme.colors.bg,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val c = RrTheme.colors
    Column(modifier.fillMaxWidth().rrDesignTag(DesignTag(component = "TopBar", bgName = c.tokenName(containerColor))).background(containerColor).then(if (applyStatusBarInset) Modifier.rrStatusBarsPadding() else Modifier)) {
        androidx.compose.ui.layout.Layout(
            contents = listOf(
                {
                    Row(Modifier.defaultMinSize(minWidth = 44.dp), verticalAlignment = Alignment.CenterVertically) {
                        when {
                            onClose != null -> RrIconButton(R.drawable.ic_ph_x, closeLabel, onClose)
                            onBack != null -> RrIconButton(R.drawable.ic_ph_caret_left, backLabel, onBack, mirrorInRtl = true)
                        }
                    }
                },
                {
                    if (center != null) center() else Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        if (title.isNotEmpty()) RrText(title, style = BarTitle, color = c.ink, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
                        if (status != null) Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                            ProvideRrContent(c.ink3, RrType.ui) { status() }
                        }
                    }
                },
                { Row(Modifier.defaultMinSize(minWidth = 44.dp), horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically, content = actions) },
            ),
            modifier = Modifier.fillMaxWidth().heightIn(min = RrLayout.topBar).padding(horizontal = 12.dp),
        ) { (startM, centerM, endM), constraints ->
            val width = constraints.maxWidth
            val loose = androidx.compose.ui.unit.Constraints(maxWidth = width)
            val start = startM.first().measure(loose)
            val end = endM.first().measure(loose)
            val middle = centerM.firstOrNull()?.measure(androidx.compose.ui.unit.Constraints(maxWidth = (width - (if (centerBetweenActions) start.width + end.width else 2 * maxOf(start.width, end.width)) - 8.dp.roundToPx()).coerceAtLeast(0)))
            val height = maxOf(constraints.minHeight, start.height, end.height, middle?.height ?: 0)
            layout(width, height) {
                start.placeRelative(0, (height - start.height) / 2)
                middle?.placeRelative((width - middle.width + if (centerBetweenActions) start.width - end.width else 0) / 2, (height - middle.height) / 2)
                end.placeRelative(width - end.width, (height - end.height) / 2)
            }
        }
        if (!flat) Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
    }
}

@RrPreviews
@Composable
internal fun RrTopBarPreview() = RrPreviewSurface {
    RrTopBar(
        "Product designer",
        onBack = {},
        applyStatusBarInset = false,
        status = { RrSpinner(); RrText("Saving…") },
    ) {
        RrIconButton(R.drawable.ic_ph_arrow_counter_clockwise, "Undo", {})
        RrIconButton(R.drawable.ic_ph_arrow_clockwise, "Redo", {}, enabled = false)
        RrIconButton(R.drawable.ic_ph_sparkle, "Assistant", {}, tint = RrTheme.colors.accentText)
        RrIconButton(R.drawable.ic_ph_dots_three, "More", {})
    }
    RrTopBar("Trash", onBack = {}, applyStatusBarInset = false, status = { RrIcon(R.drawable.ic_ph_cloud_check, null, size = 14.dp); RrText("Saved") })
    RrTopBar("Import a resume", onClose = {}, applyStatusBarInset = false)
}
