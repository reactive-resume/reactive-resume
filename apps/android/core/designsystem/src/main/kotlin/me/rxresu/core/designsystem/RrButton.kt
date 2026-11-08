package me.rxresu.core.designsystem

import androidx.compose.ui.graphics.graphicsLayer
import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Button fills. One [Primary] (accent) per screen: the one primary action. */
enum class RrButtonVariant {
    /** Accent fill, on-accent text. */
    Primary,

    /** Surface fill with a line-2 edge. */
    Secondary,

    /** No fill, ink-2 text. */
    Ghost,

    /** No fill, accent text ("Add a person"). */
    GhostAccent,

    /** Danger fill, white text. */
    Danger,

    /** No fill, danger text (sheet footers: "Delete"). */
    DangerGhost,

    /** Accent-soft fill, accent text ("Accept"). */
    Soft,
}

/** Heights 28, 36 and 44 dp. Small buttons keep a 44 dp touch area through Compose's minimum touch target. */
enum class RrButtonSize(
    internal val height: Dp,
    internal val horizontalPadding: Dp,
    internal val iconSize: Dp,
    internal val textStyle: TextStyle,
    internal val shape: Shape,
) {
    Small(28.dp, 10.dp, 16.dp, RrType.small.copy(fontWeight = FontWeight.Medium), RrShape.md),
    Medium(36.dp, 14.dp, 20.dp, RrType.ui.copy(fontWeight = FontWeight.Medium), RrShape.md),
    Large(44.dp, 16.dp, 20.dp, RrType.ui.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium), RrShape.lg),
}

internal data class RrButtonColors(val container: Color, val content: Color, val border: Color?)

@Composable
internal fun RrButtonVariant.colors(): RrButtonColors {
    val c = RrTheme.colors
    return when (this) {
        RrButtonVariant.Primary -> RrButtonColors(c.accent, c.onAccent, null)
        RrButtonVariant.Secondary -> RrButtonColors(c.surface, c.ink, c.line2)
        RrButtonVariant.Ghost -> RrButtonColors(Color.Transparent, c.ink2, null)
        RrButtonVariant.GhostAccent -> RrButtonColors(Color.Transparent, c.accentText, null)
        RrButtonVariant.Danger -> RrButtonColors(c.danger, RrFixedColors.onDanger, null)
        RrButtonVariant.DangerGhost -> RrButtonColors(Color.Transparent, c.dangerText, null)
        RrButtonVariant.Soft -> RrButtonColors(c.accentSoft, c.accentText, null)
    }
}

/**
 * Text button with an optional leading icon.
 *
 * @param loading shows the spinner beside the words and ignores taps (the label stays, e.g. "Saving…" is the caller's
 *   choice of [text]).
 * @param iconTint overrides the icon colour (the Kit's "Improve" button draws its sparkle in accent).
 * @param fillWidth stretch to the available width (`btn.blk`).
 */
@Composable
fun RrButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: RrButtonVariant = RrButtonVariant.Primary,
    size: RrButtonSize = RrButtonSize.Medium,
    @DrawableRes icon: Int? = null,
    iconTint: Color? = null,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    val colors = variant.colors()
    val interaction = remember { MutableInteractionSource() }
    val busy = stringResource(R.string.ds_working)
    Row(
        modifier = modifier
            .rrPressScale(interaction)
            // Disabled fades the whole button, fill included. A layer whose alpha changes, never Modifier.alpha: that
            // removes its layer at 1f, and on devices the changed chain could drop the fill once a button was enabled.
            .graphicsLayer { alpha = if (enabled) 1f else 0.45f }
            .defaultMinSize(minHeight = size.height)
            .clip(size.shape)
            .background(colors.container)
            .then(if (colors.border != null) Modifier.border(1.dp, colors.border, size.shape) else Modifier)
            .clickable(interaction, androidx.compose.foundation.LocalIndication.current, enabled = enabled && !loading, role = Role.Button, onClick = onClick)
            .then(if (loading) Modifier.semantics { stateDescription = busy } else Modifier)
            .padding(horizontal = size.horizontalPadding, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ProvideRrContent(colors.content, size.textStyle) {
            when {
                loading -> RrSpinner(size = if (size == RrButtonSize.Small) 14.dp else 16.dp)
                icon != null -> RrIcon(icon, null, size = size.iconSize, tint = iconTint ?: colors.content)
            }
            RrText(text, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}

@RrPreviews
@Composable
internal fun RrButtonPreview() = RrPreviewSurface {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RrButton("Share PDF", {}, size = RrButtonSize.Large, icon = R.drawable.ic_ph_share_network)
        RrButton("Download formats", {}, variant = RrButtonVariant.Secondary, size = RrButtonSize.Large)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RrButton("Save job", {})
        RrButton("Cancel", {}, variant = RrButtonVariant.Secondary)
        RrButton("Skip", {}, variant = RrButtonVariant.Ghost)
        RrButton("Delete", {}, variant = RrButtonVariant.Danger)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RrButton("New", {}, size = RrButtonSize.Small, icon = R.drawable.ic_ph_plus)
        RrButton("Improve", {}, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small, icon = R.drawable.ic_ph_sparkle, iconTint = RrTheme.colors.accentText)
        RrButton("Undo", {}, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small)
        RrButton("Accept", {}, variant = RrButtonVariant.Soft, size = RrButtonSize.Small)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RrButton("Saving…", {}, loading = true)
        RrButton("Add a person", {}, variant = RrButtonVariant.GhostAccent, icon = R.drawable.ic_ph_plus)
        RrButton("Delete", {}, variant = RrButtonVariant.DangerGhost)
        RrButton("Off", {}, enabled = false, variant = RrButtonVariant.Secondary)
    }
}
