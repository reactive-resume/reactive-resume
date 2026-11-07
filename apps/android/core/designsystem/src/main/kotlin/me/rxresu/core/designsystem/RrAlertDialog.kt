package me.rxresu.core.designsystem

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** How the dialog confirms. */
enum class RrDialogConfirm {
    /** Accent button: the action is safe or reversible. */
    Primary,

    /** Danger button. */
    Danger,

    /** [RrHoldToDeleteButton]: the action cannot be undone. */
    HoldToDelete,
}

/**
 * Alert dialog, only for irreversible or blocking decisions. The title names what is destroyed ("Delete “Tidewater ·
 * UX lead” forever?"), the text says what happens, and [dismissLabel] says what Cancel keeps ("Keep in Trash").
 *
 * Opens over a `scrim` with a d2 fade and settles from 0.98 scale; exits in 70% of that. Under reduced motion it keeps a
 * d1 fade only. Back and tapping the scrim dismiss it.
 */
@Composable
fun RrAlertDialog(
    title: String,
    text: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismissRequest: () -> Unit,
    dismissLabel: String = stringResource(R.string.ds_cancel),
    confirm: RrDialogConfirm = RrDialogConfirm.Danger,
) {
    Dialog(
        onDismissRequest = onDismissRequest,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        RrAlertDialogLayer(title, text, confirmLabel, onConfirm, onDismissRequest, dismissLabel, confirm)
    }
}

/**
 * The dialog drawn in place: scrim plus card, filling its parent. [RrAlertDialog] hosts it in a window; use this
 * directly only where a window is not wanted (inside an existing full-window dialog destination, or previews).
 */
@Composable
fun RrAlertDialogLayer(
    title: String,
    text: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismissRequest: () -> Unit,
    dismissLabel: String = stringResource(R.string.ds_cancel),
    confirm: RrDialogConfirm = RrDialogConfirm.Danger,
) {
    val c = RrTheme.colors
    val reduced = LocalReducedMotion.current
    val still = LocalInspectionMode.current
    val shown = remember { Animatable(if (still) 1f else 0f) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        withContext(RrMotion.Unscaled) { shown.animateTo(1f, RrMotion.fade(RrMotion.D2, reduced)) }
    }
    fun close(then: () -> Unit) {
        scope.launch {
            withContext(RrMotion.Unscaled) { shown.animateTo(0f, RrMotion.fade(RrMotion.exit(RrMotion.D2), reduced)) }
            then()
        }
    }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = shown.value }
                .background(c.scrim)
                .clickable(remember { MutableInteractionSource() }, null) { close(onDismissRequest) },
        )
        Column(
            Modifier
                .safeDrawingPadding()
                .padding(horizontal = 20.dp)
                .widthIn(max = 480.dp)
                .graphicsLayer {
                    alpha = shown.value
                    val s = if (reduced) 1f else RrMotion.POPUP_START_SCALE + (1f - RrMotion.POPUP_START_SCALE) * shown.value
                    scaleX = s
                    scaleY = s
                }
                .rrShadow(RrElevation.Level3, RrShape.lg)
                .clip(RrShape.lg)
                .background(c.raised)
                .semantics { paneTitle = title }
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            RrText(title, style = RrType.sheetTitle, color = c.ink)
            RrText(text, style = RrType.ui, color = c.ink2)
            when (confirm) {
                RrDialogConfirm.HoldToDelete -> RrHoldToDeleteButton(onDelete = onConfirm, text = confirmLabel)
                RrDialogConfirm.Danger, RrDialogConfirm.Primary -> RrButton(
                    confirmLabel,
                    onConfirm,
                    Modifier.fillMaxWidth(),
                    variant = if (confirm == RrDialogConfirm.Danger) RrButtonVariant.Danger else RrButtonVariant.Primary,
                    size = RrButtonSize.Large,
                )
            }
            RrButton(dismissLabel, { close(onDismissRequest) }, Modifier.fillMaxWidth(), variant = RrButtonVariant.Secondary, size = RrButtonSize.Large)
        }
    }
}

@RrPreviews
@Composable
internal fun RrAlertDialogPreview() = RrPreviewSurface {
    Box(Modifier.fillMaxWidth().padding(0.dp)) {
        RrAlertDialogLayer(
            title = "Delete “Tidewater · UX lead” forever?",
            text = "The selected document will be deleted for good and can't be restored.",
            confirmLabel = stringResource(R.string.ds_hold_to_delete),
            onConfirm = {},
            onDismissRequest = {},
            dismissLabel = "Keep in Trash",
            confirm = RrDialogConfirm.HoldToDelete,
        )
    }
}
