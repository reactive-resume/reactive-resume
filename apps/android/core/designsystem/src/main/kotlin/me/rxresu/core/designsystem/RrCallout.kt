package me.rxresu.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
) {
    val t = tone.colors()
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
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (title != null) RrText(title, style = RrType.small.copy(fontWeight = FontWeight.SemiBold), color = t.content)
            RrText(text, style = RrType.small, color = t.content)
            if (actionLabel != null && onAction != null) {
                RrButton(actionLabel, onAction, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small)
            }
        }
    }
}

/**
 * Full-width strip under a top bar (`.strip`): locked resume, "updated by an AI agent" with Undo, offline. 13 sp text,
 * 18 dp icon, the tone's soft fill, an optional trailing action.
 */
@Composable
fun RrStrip(
    text: String,
    modifier: Modifier = Modifier,
    tone: RrTone = RrTone.Info,
    @DrawableRes icon: Int? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val t = tone.colors()
    Row(
        modifier.fillMaxWidth().background(t.container).semantics { liveRegion = LiveRegionMode.Polite }.padding(horizontal = 16.dp, vertical = 8.dp),
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
    RrStrip("This resume is locked. Unlock it from its menu to edit.", icon = R.drawable.ic_ph_lock_simple)
    RrOfflineStrip()
}
