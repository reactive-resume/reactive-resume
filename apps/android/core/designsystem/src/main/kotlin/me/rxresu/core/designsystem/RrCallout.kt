package me.rxresu.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.layout.layout
import kotlin.math.roundToInt
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** Alert tones shared by [RrCallout] and [RrStrip]. */
enum class RrTone { Info, Warn, Danger, Accent }

internal data class ToneColors(val container: Color, val content: Color, @DrawableRes val icon: Int)

@Composable
internal fun RrTone.colors(): ToneColors {
    val c = RrTheme.colors
    return when (this) {
        RrTone.Info -> ToneColors(c.infoSoft, c.infoText, R.drawable.ic_ph_info)
        RrTone.Warn -> ToneColors(c.warnSoft, c.warnText, R.drawable.ic_ph_warning)
        RrTone.Danger -> ToneColors(c.dangerSoft, c.dangerText, R.drawable.ic_ph_warning_circle)
        RrTone.Accent -> ToneColors(c.accentSoft, c.accentText, R.drawable.ic_ph_check_circle)
    }
}

/**
 * Callout (alert): icon, text and an optional action, on the tone's soft fill. Billing and scheduled-work notes use
 * [RrTone.Warn] with the `key` icon. Danger callouts are announced as they appear.
 *
 * @param icon overrides the tone's default icon (info, warning, warning-circle, check-circle).
 * @param actionLink draws the action as a semibold text link in the tone's colour, 6 dp under the text (T2 "Create
 *   account"), instead of a small secondary button. Its touch target is 44 dp tall without adding that height.
 */
@Composable
fun RrCallout(
    text: String,
    modifier: Modifier = Modifier,
    tone: RrTone = RrTone.Info,
    @DrawableRes icon: Int? = null,
    title: String? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    actionLink: Boolean = false,
) {
    val t = tone.colors()
    val link = actionLink && actionLabel != null && onAction != null
    Row(
        modifier
            .fillMaxWidth()
            .clip(RrShape.lg)
            .background(t.container)
            .then(if (tone == RrTone.Danger) Modifier.semantics { liveRegion = LiveRegionMode.Polite } else Modifier)
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        RrIcon(icon ?: t.icon, null, size = 20.dp, tint = t.content)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(if (link) 6.dp else 8.dp)) {
            if (title != null) RrText(title, style = RrType.small.copy(fontWeight = FontWeight.SemiBold), color = t.content)
            RrText(text, style = RrType.small, color = t.content)
            if (actionLabel != null && onAction != null) {
                if (link) CalloutLink(actionLabel, t.content, onAction)
                else RrButton(actionLabel, onAction, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
            }
        }
    }
}

private val LinkText = RrType.small.copy(fontWeight = FontWeight.SemiBold)

/**
 * A text link whose tap area is 44 dp tall: the clickable box is centred on the text and reports only the text's height
 * to the layout, so the callout keeps the board's spacing.
 */
@Composable
private fun CalloutLink(label: String, color: Color, onClick: () -> Unit) {
    val target = 44.dp
    Box(
        Modifier
            .layout { measurable, constraints ->
                val p = measurable.measure(constraints.copy(minHeight = 0))
                val line = LinkText.lineHeight.toPx().roundToInt()
                val inset = if (p.height > target.roundToPx()) 0 else ((p.height - line) / 2).coerceAtLeast(0)
                layout(p.width, p.height - 2 * inset) { p.place(0, -inset) }
            }
            .clip(RrShape.md)
            .clickable(role = Role.Button, onClick = onClick)
            .heightIn(min = target),
        contentAlignment = Alignment.CenterStart,
    ) {
        RrText(label, style = LinkText, color = color)
    }
}

/**
 * Full-width strip under a top bar (`.strip`): locked resume, "updated by an AI agent" with Undo, offline. 13 sp text,
 * 18 dp icon, the tone's soft fill, an optional trailing action and an optional dismiss button ([onDismiss]).
 */
@Composable
fun RrStrip(
    text: String,
    modifier: Modifier = Modifier,
    tone: RrTone = RrTone.Info,
    @DrawableRes icon: Int? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    onDismiss: (() -> Unit)? = null,
) {
    val t = tone.colors()
    Row(
        modifier.fillMaxWidth().background(t.container).semantics { liveRegion = LiveRegionMode.Polite }
                        // The 36 dp dismiss button sets the row height (44 dp with the padding); the end inset lines its icon up.
            .then(if (onDismiss != null) Modifier.padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp) else Modifier.padding(horizontal = 16.dp, vertical = 8.dp)),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RrIcon(icon ?: t.icon, null, size = 18.dp, tint = t.content)
        RrText(text, style = RrType.small, color = t.content, modifier = Modifier.weight(1f))
        if (actionLabel != null && onAction != null) {
            RrText(
                actionLabel,
                style = RrType.small.copy(fontWeight = FontWeight.SemiBold),
                color = t.content,
                modifier = Modifier.clip(RrShape.md).clickable(role = Role.Button, onClick = onAction).padding(horizontal = 8.dp, vertical = 4.dp),
            )
        }
        if (onDismiss != null) {
            RrIconButton(R.drawable.ic_ph_x, androidx.compose.ui.res.stringResource(R.string.ds_dismiss), onDismiss, size = RrIconButtonSize.Small, tint = t.content)
        }
    }
}

/**
 * Offline strip: edits are kept on this device and sync on reconnect. Pass [text] for a screen-specific message
 * ("You're offline. History needs a connection.").
 */
@Composable
fun RrOfflineStrip(modifier: Modifier = Modifier, text: String = androidx.compose.ui.res.stringResource(R.string.ds_offline)) {
    RrStrip(text, modifier, tone = RrTone.Warn, icon = R.drawable.ic_ph_cloud_slash)
}

@RrPreviews
@Composable
internal fun RrCalloutPreview() = RrPreviewSurface {
    RrCallout("Paste the posting to see which of its terms your resume already has.")
    RrCallout("Your provider may charge your account for requests made with your API key.", tone = RrTone.Warn, icon = R.drawable.ic_ph_key)
    RrCallout("Couldn't send. Your message is kept.", tone = RrTone.Danger, actionLabel = "Try again", onAction = {})
    RrCallout("Template changed to Onyx.", tone = RrTone.Accent)
    RrCallout(
        "You're using a guest account. Create an account to keep your work on other devices.",
        actionLabel = "Create account",
        onAction = {},
        actionLink = true,
    )
    RrStrip("This resume is locked. Unlock it from its menu to edit.", icon = R.drawable.ic_ph_lock_simple)
    RrStrip("This resume was updated by an AI agent.", icon = R.drawable.ic_ph_sparkle, actionLabel = "Undo", onAction = {}, onDismiss = {})
    RrOfflineStrip()
}
