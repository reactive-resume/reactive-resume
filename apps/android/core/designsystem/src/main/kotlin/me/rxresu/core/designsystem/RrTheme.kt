package me.rxresu.core.designsystem

import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.Animatable
import android.animation.ValueAnimator
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.foundation.IndicationNodeFactory
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.interaction.FocusInteraction
import androidx.compose.foundation.interaction.HoverInteraction
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.node.DelegatableNode
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.invalidateDraw
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch

/** Colours of the current theme. Read through [RrTheme.colors]. */
val LocalRrColors = staticCompositionLocalOf { LightRrColors }

/**
 * The in-app Haptics switch (Settings › Preferences › Haptics). The system setting is honoured separately by
 * `View.performHapticFeedback`, so a haptic plays only when both allow it.
 */
val LocalRrHapticsEnabled = staticCompositionLocalOf { true }

/**
 * True when the system asks for reduced motion ("Remove animations", or animator duration scale 0). Movement and
 * stagger go; sheets, dialogs, menus and toasts keep a d1 fade; spinners keep turning; Hold to delete still fills.
 */
val LocalReducedMotion = staticCompositionLocalOf { false }

/** Default content colour for [RrText] and [RrIcon]; components set it for their children. */
val LocalRrContentColor = staticCompositionLocalOf { LightRrColors.ink }

/** Default text style for [RrText]; components set it for their children. */
val LocalRrTextStyle = staticCompositionLocalOf { RrType.ui }

/**
 * Reactive Resume theme. Provides the colours, haptics switch, reduced-motion flag, the press-wash indication (never a
 * Material ripple), text selection colours (accent-soft) and the default content colour and text style.
 *
 * @param darkTheme dark palette when true; pass the app's theme preference (Light, Dark or Match system).
 * @param hapticsEnabled the in-app Haptics switch.
 * @param reducedMotion defaults to the system setting; tests can force it.
 */
@Composable
fun RrTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    hapticsEnabled: Boolean = true,
    reducedMotion: Boolean = rememberSystemReducedMotion(),
    content: @Composable () -> Unit,
) {
    // Theme switches cross-fade the palette over d2 (instant under reduced motion and in previews).
    val still = LocalInspectionMode.current
    val dark = remember { Animatable(if (darkTheme) 1f else 0f) }
    LaunchedEffect(darkTheme, reducedMotion) {
        val target = if (darkTheme) 1f else 0f
        if (reducedMotion || still) dark.snapTo(target) else dark.animateTo(target, tween(RrMotion.D2, easing = RrMotion.ease))
    }
    val colors = when (dark.value) {
        0f -> LightRrColors
        1f -> DarkRrColors
        else -> lerpColors(LightRrColors, DarkRrColors, dark.value)
    }
    val selection = remember(colors) { TextSelectionColors(handleColor = colors.accent, backgroundColor = colors.accentSoft) }
    val indication = remember(colors) { RrPressIndication(colors.press, colors.hover, colors.accent) }
    CompositionLocalProvider(
        LocalRrColors provides colors,
        LocalRrHapticsEnabled provides hapticsEnabled,
        LocalReducedMotion provides reducedMotion,
        LocalIndication provides indication,
        LocalTextSelectionColors provides selection,
        LocalRrContentColor provides colors.ink,
        LocalRrTextStyle provides RrType.ui,
        content = { if (LocalRrDesignTags.current || still) content() else ProvideSystemInsets(content) },
    )
}

/** Accessors for the current theme, mirroring the composition locals. */
object RrTheme {
    val colors: RrColors
        @Composable @ReadOnlyComposable get() = LocalRrColors.current

    /** Type scale. Constant across themes, exposed here so call sites read `RrTheme.type.label`. */
    val type: RrType get() = RrType

    val reducedMotion: Boolean
        @Composable @ReadOnlyComposable get() = LocalReducedMotion.current

    val hapticsEnabled: Boolean
        @Composable @ReadOnlyComposable get() = LocalRrHapticsEnabled.current
}

/** Sets the content colour (and optionally the text style) for [RrText] and [RrIcon] inside [content]. */
@Composable
fun ProvideRrContent(color: Color, style: TextStyle? = null, content: @Composable () -> Unit) {
    if (style == null) {
        CompositionLocalProvider(LocalRrContentColor provides color, content = content)
    } else {
        CompositionLocalProvider(LocalRrContentColor provides color, LocalRrTextStyle provides style, content = content)
    }
}

/** System reduced-motion flag: animator duration scale 0 ("Remove animations"). Updates while the app runs. */
@Composable
fun rememberSystemReducedMotion(): Boolean {
    val context = LocalContext.current
    var reduced by remember { mutableStateOf(!ValueAnimator.areAnimatorsEnabled()) }
    DisposableEffect(context) {
        val resolver = context.contentResolver
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                reduced = Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
            }
        }
        resolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        onDispose { resolver.unregisterContentObserver(observer) }
    }
    return reduced
}

/**
 * Press and hover wash from the `press` and `hover` tokens, plus a 2 dp accent ring for keyboard focus. The wash fills
 * the bounds of the clickable, so clip the element to its shape before `clickable`.
 */
private class RrPressIndication(val press: Color, val hover: Color, val focus: Color) : IndicationNodeFactory {
    override fun create(interactionSource: InteractionSource): DelegatableNode = Node(interactionSource)

    override fun equals(other: Any?) = other is RrPressIndication && other.press == press && other.hover == hover && other.focus == focus
    override fun hashCode() = (press.hashCode() * 31 + hover.hashCode()) * 31 + focus.hashCode()

    private inner class Node(val source: InteractionSource) : Modifier.Node(), DrawModifierNode {
        private var pressed = 0
        private var hovered = 0
        private var focused = 0

        override fun onAttach() {
            coroutineScope.launch {
                source.interactions.collect {
                    when (it) {
                        is PressInteraction.Press -> pressed++
                        is PressInteraction.Release, is PressInteraction.Cancel -> pressed = (pressed - 1).coerceAtLeast(0)
                        is HoverInteraction.Enter -> hovered++
                        is HoverInteraction.Exit -> hovered = (hovered - 1).coerceAtLeast(0)
                        is FocusInteraction.Focus -> focused++
                        is FocusInteraction.Unfocus -> focused = (focused - 1).coerceAtLeast(0)
                    }
                    invalidateDraw()
                }
            }
        }

        override fun ContentDrawScope.draw() {
            drawContent()
            when {
                pressed > 0 -> drawRect(press)
                hovered > 0 -> drawRect(hover)
            }
            if (focused > 0) {
                val w = 2.dp.toPx()
                drawRect(focus, topLeft = androidx.compose.ui.geometry.Offset(w / 2, w / 2),
                    size = androidx.compose.ui.geometry.Size(size.width - w, size.height - w), style = Stroke(w))
            }
        }
    }
}

/** The palette part-way between two themes (theme cross-fade). */
internal fun lerpColors(a: RrColors, b: RrColors, t: Float) = RrColors(
    bg = androidx.compose.ui.graphics.lerp(a.bg, b.bg, t),
    surface = androidx.compose.ui.graphics.lerp(a.surface, b.surface, t),
    raised = androidx.compose.ui.graphics.lerp(a.raised, b.raised, t),
    sunken = androidx.compose.ui.graphics.lerp(a.sunken, b.sunken, t),
    line = androidx.compose.ui.graphics.lerp(a.line, b.line, t),
    line2 = androidx.compose.ui.graphics.lerp(a.line2, b.line2, t),
    controlBorder = androidx.compose.ui.graphics.lerp(a.controlBorder, b.controlBorder, t),
    ink = androidx.compose.ui.graphics.lerp(a.ink, b.ink, t),
    ink2 = androidx.compose.ui.graphics.lerp(a.ink2, b.ink2, t),
    ink3 = androidx.compose.ui.graphics.lerp(a.ink3, b.ink3, t),
    accent = androidx.compose.ui.graphics.lerp(a.accent, b.accent, t),
    accentHover = androidx.compose.ui.graphics.lerp(a.accentHover, b.accentHover, t),
    onAccent = androidx.compose.ui.graphics.lerp(a.onAccent, b.onAccent, t),
    accentSoft = androidx.compose.ui.graphics.lerp(a.accentSoft, b.accentSoft, t),
    accentText = androidx.compose.ui.graphics.lerp(a.accentText, b.accentText, t),
    danger = androidx.compose.ui.graphics.lerp(a.danger, b.danger, t),
    dangerSoft = androidx.compose.ui.graphics.lerp(a.dangerSoft, b.dangerSoft, t),
    dangerText = androidx.compose.ui.graphics.lerp(a.dangerText, b.dangerText, t),
    warn = androidx.compose.ui.graphics.lerp(a.warn, b.warn, t),
    warnSoft = androidx.compose.ui.graphics.lerp(a.warnSoft, b.warnSoft, t),
    warnText = androidx.compose.ui.graphics.lerp(a.warnText, b.warnText, t),
    warnInk = androidx.compose.ui.graphics.lerp(a.warnInk, b.warnInk, t),
    infoSoft = androidx.compose.ui.graphics.lerp(a.infoSoft, b.infoSoft, t),
    infoText = androidx.compose.ui.graphics.lerp(a.infoText, b.infoText, t),
    hover = androidx.compose.ui.graphics.lerp(a.hover, b.hover, t),
    press = androidx.compose.ui.graphics.lerp(a.press, b.press, t),
    scrim = androidx.compose.ui.graphics.lerp(a.scrim, b.scrim, t),
    scrimSheet = androidx.compose.ui.graphics.lerp(a.scrimSheet, b.scrimSheet, t),
    isDark = t >= 0.5f,
)
