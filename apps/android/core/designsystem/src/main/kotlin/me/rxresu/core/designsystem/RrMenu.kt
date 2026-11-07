package me.rxresu.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import kotlinx.coroutines.withContext

/**
 * Popup menu anchored to its parent (put it in the same `Box` as the trigger). Opens below the trigger, aligned to its
 * end edge, or above when there is no room. Starts 4 dp back toward the trigger at 0.98 scale and settles outward with
 * a fade (d2); exits in 70%. Reduced motion: a d1 fade in place. Back and taps outside close it.
 */
@Composable
fun RrMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val reduced = LocalReducedMotion.current
    val still = LocalInspectionMode.current
    val shown = remember { Animatable(if (expanded && still) 1f else 0f) }
    LaunchedEffect(expanded) {
        withContext(RrMotion.Unscaled) {
            shown.animateTo(
                if (expanded) 1f else 0f,
                RrMotion.fade(if (expanded) RrMotion.D2 else RrMotion.exit(RrMotion.D2), reduced),
            )
        }
    }
    if (!expanded && shown.value == 0f) return
    val gap = with(LocalDensity.current) { 4.dp.roundToPx() }
    val provider = remember(gap) { MenuPosition(gap) }
    Popup(popupPositionProvider = provider, onDismissRequest = onDismissRequest, properties = PopupProperties(focusable = true)) {
        RrMenuSurface(
            modifier.graphicsLayer {
                alpha = shown.value
                if (!reduced) {
                    val s = RrMotion.POPUP_START_SCALE + (1f - RrMotion.POPUP_START_SCALE) * shown.value
                    scaleX = s
                    scaleY = s
                    translationY = -(1f - shown.value) * 4.dp.toPx() * if (provider.above) -1f else 1f
                    transformOrigin = TransformOrigin(if (provider.rtl) 0f else 1f, if (provider.above) 1f else 0f)
                }
            },
            content,
        )
    }
}

/** The menu panel: `raised`, line edge, 4 dp corners, shadow-2. [RrMenu] hosts it in a popup. */
@Composable
fun RrMenuSurface(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val c = RrTheme.colors
    Column(
        modifier
            .widthIn(min = 200.dp, max = 320.dp)
            .width(IntrinsicSize.Max)
            .rrShadow(RrElevation.Level2, RrShape.lg)
            .clip(RrShape.lg)
            .background(c.raised)
            .border(1.dp, c.line, RrShape.lg)
            .verticalScroll(rememberScrollState())
            .padding(vertical = 4.dp),
        content = content,
    )
}

/** Menu item (44 dp): optional 20 dp icon, words; [danger] for destructive items ("Move to Trash"). */
@Composable
fun RrMenuItem(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    @DrawableRes icon: Int? = null,
    danger: Boolean = false,
    enabled: Boolean = true,
    trailing: String? = null,
) {
    val c = RrTheme.colors
    val fg = if (danger) c.dangerText else c.ink
    Row(
        modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 44.dp)
            .clickable(remember { MutableInteractionSource() }, LocalIndication.current, enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) RrIcon(icon, null, size = 20.dp, tint = if (danger) c.dangerText else c.ink2)
        RrText(text, style = RrType.ui.copy(fontSize = RrType.body.fontSize), color = if (enabled) fg else c.ink3, modifier = Modifier.weight(1f))
        if (trailing != null) RrText(trailing, style = RrType.mono, color = c.ink3)
    }
}

/** Group label inside a menu (eyebrow, sentence case). */
@Composable
fun RrMenuLabel(text: String, modifier: Modifier = Modifier) {
    RrText(text, style = RrType.eyebrow, color = RrTheme.colors.ink3, modifier = modifier.padding(start = 14.dp, end = 14.dp, top = 8.dp, bottom = 4.dp).semantics { heading() })
}

/** Line between menu groups. */
@Composable
fun RrMenuDivider() {
    Box(Modifier.fillMaxWidth().padding(vertical = 4.dp).defaultMinSize(minHeight = 1.dp).background(RrTheme.colors.line))
}

private class MenuPosition(private val gap: Int) : PopupPositionProvider {
    var above = false
    var rtl = false

    override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
        rtl = layoutDirection == LayoutDirection.Rtl
        val x = if (rtl) anchorBounds.left else anchorBounds.right - popupContentSize.width
        val below = anchorBounds.bottom + gap
        above = below + popupContentSize.height > windowSize.height && anchorBounds.top - gap - popupContentSize.height >= 0
        val y = if (above) anchorBounds.top - gap - popupContentSize.height else below
        return IntOffset(x.coerceIn(0, (windowSize.width - popupContentSize.width).coerceAtLeast(0)), y.coerceAtLeast(0))
    }
}

@RrPreviews
@Composable
internal fun RrMenuPreview() = RrPreviewSurface {
    RrMenuSurface {
        RrMenuLabel("Product designer")
        RrMenuItem("Rename", {}, icon = R.drawable.ic_ph_note_pencil)
        RrMenuItem("Duplicate", {}, icon = R.drawable.ic_ph_copy)
        RrMenuItem("Print", {}, icon = R.drawable.ic_ph_printer)
        RrMenuDivider()
        RrMenuItem("Move to Trash", {}, icon = R.drawable.ic_ph_trash, danger = true)
    }
}
