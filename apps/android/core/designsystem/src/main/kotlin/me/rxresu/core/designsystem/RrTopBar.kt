package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

private val BarTitle = RrType.label.copy(fontWeight = FontWeight.SemiBold, lineHeight = RrType.ui.lineHeight)

/**
 * Top bar for pushed screens and the builder (56 dp under the status bar): back caret, title with an optional status
 * line ("Saved", "Saving…" with a spinner), trailing icon buttons. A line under it unless [flat].
 *
 * @param onBack shows the back caret ("Back"); null hides it.
 * @param status the second line; put a spinner or icon beside its words there.
 * @param applyStatusBarInset pad for the status bar (false when a parent already did).
 */
@Composable
fun RrTopBar(
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    backLabel: String = stringResource(R.string.ds_back),
    status: (@Composable RowScope.() -> Unit)? = null,
    flat: Boolean = false,
    applyStatusBarInset: Boolean = true,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val c = RrTheme.colors
    Column(modifier.fillMaxWidth().background(c.bg).then(if (applyStatusBarInset) Modifier.windowInsetsPadding(WindowInsets.statusBars) else Modifier)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = RrLayout.topBar).padding(horizontal = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) RrIconButton(R.drawable.ic_ph_caret_left, backLabel, onBack, mirrorInRtl = true)
            Column(Modifier.weight(1f).padding(horizontal = 4.dp)) {
                RrText(title, style = BarTitle, color = c.ink, maxLines = 1, modifier = Modifier.semantics { heading() })
                if (status != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        ProvideRrContent(c.ink3, RrType.caption.copy(fontWeight = FontWeight.Normal)) { status() }
                    }
                }
            }
            actions()
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
}
