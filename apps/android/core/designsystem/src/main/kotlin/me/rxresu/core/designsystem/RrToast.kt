package me.rxresu.core.designsystem

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalAccessibilityManager
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/** How a toast ended. */
enum class RrToastResult { Dismissed, ActionPerformed }

/** Neutral toasts use the ink fill; danger toasts ("Download failed. Try again.") use danger-soft. */
enum class RrToastTone { Neutral, Danger }

/** A toast being shown. [durationMs] is its full life; the fuse runs linearly across it. */
@Stable
class RrToastData internal constructor(
    val message: String,
    val actionLabel: String?,
    val tone: RrToastTone,
    val durationMs: Long,
    private val continuation: CancellableContinuation<RrToastResult>,
) {
    /** Runs the action (Undo) and closes the toast. */
    fun performAction() {
        if (continuation.isActive) continuation.resume(RrToastResult.ActionPerformed)
    }

    /** Closes the toast early. */
    fun dismiss() {
        if (continuation.isActive) continuation.resume(RrToastResult.Dismissed)
    }
}

/**
 * Toast queue. [show] suspends until the toast ends and returns whether its action ran. One toast at a time; later
 * ones wait their turn. Life: 5 s, or 8 s with an action (longer when the accessibility service asks for it).
 *
 * ```
 * scope.launch {
 *     if (toasts.show("“Lumen letter” moved to Trash", actionLabel = undo) == RrToastResult.ActionPerformed) restore()
 * }
 * ```
 */
@Stable
class RrToastHostState {
    private val mutex = Mutex()

    /** The toast on screen, or null. */
    var current: RrToastData? by mutableStateOf(null)
        private set

    /** Adjusts a duration for accessibility (set by [RrToastHost]); identity by default. */
    internal var timeout: (Long, Boolean) -> Long = { ms, _ -> ms }

    suspend fun show(message: String, actionLabel: String? = null, tone: RrToastTone = RrToastTone.Neutral): RrToastResult = mutex.withLock {
        try {
            val base = if (actionLabel != null) WITH_ACTION_MS else PLAIN_MS
            val life = timeout(base, actionLabel != null)
            withTimeoutOrNull(life) {
                suspendCancellableCoroutine { cont -> current = RrToastData(message, actionLabel, tone, life, cont) }
            } ?: RrToastResult.Dismissed
        } finally {
            current = null
            // Let the exit (d2) finish before the next toast rises.
            delay(RrMotion.D2.toLong())
        }
    }

    companion object {
        const val PLAIN_MS = 5_000L
        const val WITH_ACTION_MS = 8_000L
    }
}

/**
 * Shows [state]'s toasts. Place it at the bottom of the screen, above the tab bar or mode bar (the caller pads it by
 * that bar's height). 12 dp side margins; rises 8 dp with a fade (d3), exits d2; a 2 dp accent fuse burns linearly for
 * the toast's life. Announced politely to TalkBack.
 */
@Composable
fun RrToastHost(state: RrToastHostState, modifier: Modifier = Modifier) {
    val a11y = LocalAccessibilityManager.current
    LaunchedEffect(a11y) {
        state.timeout = { ms, action -> a11y?.calculateRecommendedTimeoutMillis(ms, containsIcons = false, containsText = true, containsControls = action) ?: ms }
    }
    var shown by remember { mutableStateOf<RrToastData?>(null) }
    val current = state.current
    if (current != null) shown = current
    val data = shown ?: return
    val reduced = LocalReducedMotion.current
    val still = LocalInspectionMode.current
    val enter = remember(data) { Animatable(if (still) 1f else 0f) }
    LaunchedEffect(data, current == null) {
        withContext(RrMotion.Unscaled) {
            if (current != null) {
                enter.animateTo(1f, RrMotion.fade(RrMotion.D3, reduced))
            } else {
                enter.animateTo(0f, RrMotion.fade(RrMotion.D2, reduced))
                shown = null
            }
        }
    }
    val fuse = remember(data) { Animatable(1f) }
    LaunchedEffect(data) {
        if (!still) withContext(RrMotion.Unscaled) { fuse.animateTo(0f, tween(data.durationMs.toInt(), easing = LinearEasing)) }
    }
    RrToast(
        data.message,
        actionLabel = data.actionLabel,
        onAction = data::performAction,
        tone = data.tone,
        fuse = fuse.value,
        modifier = modifier.padding(horizontal = 12.dp).graphicsLayer {
            alpha = enter.value
            translationY = if (reduced) 0f else (1f - enter.value) * 8.dp.toPx()
        },
    )
}

/**
 * The toast surface: message, optional action, fuse. [RrToastHost] drives it; use directly only for static layouts.
 *
 * @param fuse remaining share of the toast's life, 1 to 0.
 */
@Composable
fun RrToast(
    message: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: () -> Unit = {},
    tone: RrToastTone = RrToastTone.Neutral,
    fuse: Float = 1f,
) {
    val c = RrTheme.colors
    val (bg, fg) = if (tone == RrToastTone.Danger) c.dangerSoft to c.dangerText else c.ink to c.bg
    val fuseColor = if (tone == RrToastTone.Danger) c.danger else c.accent
    Row(
        modifier
            .fillMaxWidth()
            .rrShadow(RrElevation.Level3, RrShape.lg)
            .clip(RrShape.lg)
            .background(bg)
            .drawWithContent {
                drawContent()
                val h = 2.dp.toPx()
                val w = size.width * fuse.coerceIn(0f, 1f)
                val x = if (layoutDirection == androidx.compose.ui.unit.LayoutDirection.Rtl) size.width - w else 0f
                drawRect(fuseColor, Offset(x, size.height - h), Size(w, h))
            }
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }
            .defaultMinSize(minHeight = 44.dp)
            .padding(start = 14.dp, end = 8.dp, top = 12.dp, bottom = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (tone == RrToastTone.Danger) RrIcon(R.drawable.ic_ph_warning_circle, null, size = 20.dp, tint = fg)
        RrText(message, style = RrType.ui, color = fg, modifier = Modifier.weight(1f))
        if (actionLabel != null) {
            Box(
                Modifier.height(28.dp).clip(RrShape.md).clickable(role = Role.Button, onClick = onAction).padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                RrText(actionLabel, style = RrType.ui.copy(fontWeight = FontWeight.SemiBold), color = fg)
            }
        }
    }
}

@RrPreviews
@Composable
internal fun RrToastPreview() = RrPreviewSurface {
    RrToast("“Lumen letter” moved to Trash", actionLabel = "Undo", fuse = 0.62f)
    RrToast("Download failed. Try again.", actionLabel = "Try again", tone = RrToastTone.Danger, fuse = 0.4f)
}
