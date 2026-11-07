package me.rxresu.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp

/**
 * Grouped list: `surface` panel, line edge, 4 dp corners, a 1 dp line between children. Children are usually
 * [RrListRow], [RrSwitchRow] or [RrSwipeRow]; any composable works (its background shows through as `surface`).
 */
@Composable
fun RrListGroup(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val c = RrTheme.colors
    val dividers = remember { IntArray(64) }
    val count = remember { IntArray(1) }
    Layout(
        content = content,
        modifier = modifier
            .fillMaxWidth()
            .clip(RrShape.lg)
            .background(c.surface)
            .border(1.dp, c.line, RrShape.lg)
            .padding(1.dp)
            .drawWithContent {
                drawContent()
                val h = 1.dp.toPx()
                // dividers[] holds the inner y after each 1 dp gap; the 1 dp padding shifts it back onto the gap.
                for (i in 0 until count[0]) {
                    val y = dividers[i] + h / 2
                    drawLine(c.line, Offset(0f, y), Offset(size.width, y), h)
                }
            },
    ) { measurables, constraints ->
        val gap = 1.dp.roundToPx()
        val loose = Constraints(minWidth = constraints.maxWidth, maxWidth = constraints.maxWidth)
        val placeables = measurables.map { it.measure(loose) }
        val height = placeables.sumOf { it.height } + gap * (placeables.size - 1).coerceAtLeast(0)
        layout(constraints.maxWidth, height) {
            var y = 0
            count[0] = 0
            placeables.forEachIndexed { i, p ->
                if (i > 0) {
                    y += gap
                    if (count[0] < dividers.size) dividers[count[0]++] = y
                }
                p.placeRelative(0, y)
                y += p.height
            }
        }
    }
}

/** Group eyebrow ("Needs you") with an optional trailing count (mono) or action link ("Calendar"). */
@Composable
fun RrSectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    count: String? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val c = RrTheme.colors
    Row(
        modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RrText(title, style = RrType.eyebrow, color = c.ink3, modifier = Modifier.weight(1f, fill = false))
        when {
            actionLabel != null && onAction != null -> RrText(
                actionLabel,
                style = RrType.ui,
                color = c.accentText,
                modifier = Modifier.clip(RrShape.md).combinedClickable(role = Role.Button, onClick = onAction).padding(vertical = 2.dp),
            )
            count != null -> RrText(count, style = RrType.mono, color = c.ink3)
        }
    }
}

private val RowTitle = RrType.label.copy(fontWeight = FontWeight.Medium, lineHeight = RrType.ui.lineHeight)

/**
 * List row (52 dp min): leading icon, title and optional second line, trailing slot. Text wraps rather than clips.
 *
 * @param trailing value, caret or badge; see [RrRowValue] and [RrRowCaret]. Switch rows use [RrSwitchRow].
 * @param onLongClick opens the row's actions sheet; plays `light`.
 * @param selected accent-soft fill.
 * @param danger danger text and icon ("Sign out", "Delete").
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun RrListRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    @DrawableRes icon: Int? = null,
    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
    onLongClickLabel: String? = null,
    selected: Boolean = false,
    danger: Boolean = false,
    enabled: Boolean = true,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val interaction = remember { MutableInteractionSource() }
    RowFrame(
        modifier
            .background(if (selected) c.accentSoft else c.surface)
            .then(
                if (onClick != null || onLongClick != null) Modifier.combinedClickable(
                    interactionSource = interaction,
                    indication = LocalIndication.current,
                    enabled = enabled,
                    role = Role.Button,
                    onLongClickLabel = onLongClickLabel,
                    onLongClick = onLongClick?.let { { haptics(RrHaptic.Light); it() } },
                    onClick = onClick ?: {},
                ) else Modifier,
            ),
    ) {
        val fg = if (danger) c.dangerText else c.ink
        when {
            leading != null -> leading()
            icon != null -> RrIcon(icon, null, tint = if (danger) c.dangerText else c.ink2)
        }
        Column(Modifier.weight(1f)) {
            RrText(title, style = RowTitle, color = fg)
            if (subtitle != null) RrText(subtitle, style = RrType.small, color = c.ink3)
        }
        if (trailing != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically, content = trailing)
        }
    }
}

@Composable
private fun RowFrame(modifier: Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp).padding(start = 14.dp, end = 12.dp, top = 10.dp, bottom = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** Trailing value in ink-3 ("Match system"), optionally with a caret. */
@Composable
fun RrRowValue(text: String, caret: Boolean = true) {
    RrText(text, style = RrType.small, color = RrTheme.colors.ink3)
    if (caret) RrRowCaret()
}

/** Trailing caret (18 dp), mirrored in RTL. */
@Composable
fun RrRowCaret() {
    RrIcon(R.drawable.ic_ph_caret_right, null, size = 18.dp, tint = RrTheme.colors.ink3, mirrorInRtl = true)
}

/**
 * A row whose whole area toggles a switch (one TalkBack control: "Notifications, switch, on"). Plays `toggle`.
 */
@Composable
fun RrSwitchRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    @DrawableRes icon: Int? = null,
    enabled: Boolean = true,
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    RowFrame(
        modifier.background(c.surface).toggleable(checked, remember { MutableInteractionSource() }, LocalIndication.current, enabled, Role.Switch) {
            haptics(if (it) RrHaptic.ToggleOn else RrHaptic.ToggleOff)
            onCheckedChange(it)
        },
    ) {
        if (icon != null) RrIcon(icon, null, tint = c.ink2)
        Column(Modifier.weight(1f)) {
            RrText(title, style = RowTitle, color = c.ink)
            if (subtitle != null) RrText(subtitle, style = RrType.small, color = c.ink3)
        }
        RrSwitch(checked, null, enabled = enabled)
    }
}

/** Two-line key/value cell ("Created" over "28 Oct 2026") used in details sheets. */
@Composable
fun RrKeyValue(key: String, value: String, modifier: Modifier = Modifier, mono: Boolean = false) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        RrText(key, style = RrType.caption, color = RrTheme.colors.ink3)
        RrText(value, style = if (mono) RrType.mono else RrType.ui, color = RrTheme.colors.ink)
    }
}

@RrPreviews
@Composable
internal fun RrListPreview() = RrPreviewSurface {
    RrSectionHeader("Needs you", count = "3", modifier = Modifier.padding(0.dp))
    RrListGroup {
        RrListRow("Account", subtitle = "alex@morgan.design", icon = R.drawable.ic_ph_user, onClick = {}, trailing = { RrRowCaret() })
        RrListRow("Theme", icon = R.drawable.ic_ph_moon, onClick = {}, trailing = { RrRowValue("Match system") })
        RrSwitchRow("Notifications", checked = true, onCheckedChange = {}, icon = R.drawable.ic_ph_bell_simple)
        RrListRow("Sign out", icon = R.drawable.ic_ph_sign_out, onClick = {}, danger = true)
    }
    RrKeyValue("Created", "28 Oct 2026")
}
