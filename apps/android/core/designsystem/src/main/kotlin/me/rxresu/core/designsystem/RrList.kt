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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.takeOrElse
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size

/**
 * Plain list with an optional top divider. Rows own their bottom dividers. Children are usually
 * [RrListRow], [RrSwitchRow] or [RrSwipeRow].
 */
@Composable
fun RrListGroup(modifier: Modifier = Modifier, content: @Composable () -> Unit) = RrListGroup(modifier, false, content)

@Composable
fun RrListGroup(modifier: Modifier = Modifier, topDivider: Boolean, content: @Composable () -> Unit) {
    val c = RrTheme.colors
    Column(modifier.fillMaxWidth().drawWithContent {
        drawContent()
        if (topDivider) {
            val h = 1.dp.toPx()
            val inset = RrLayout.screenMargin.toPx()
            drawLine(c.line, Offset(inset, h / 2), Offset(size.width - inset, h / 2), h)
        }
    }, content = { content() })
}

/**
 * Serif section heading with an inline count or trailing action.
 *
 * @param topPadding space above the eyebrow: 20 dp between groups; 4 dp for the first group under a header (T1),
 *   0 dp right under a sheet or step title.
 */
@Composable
fun RrSectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    count: String? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    topPadding: Dp = 32.dp,
) {
    RrSectionHeading(title, modifier, count, actionLabel, onAction, topPadding = topPadding)
}

private val RowTitle = RrType.rowTitle

/**
 * List row (64 dp min): leading icon, title and optional second line, trailing slot. Text wraps at larger font scales.
 *
 * @param trailing value, caret or badge; see [RrRowValue] and [RrRowCaret]. Switch rows use [RrSwitchRow].
 * @param onLongClick opens the row's actions sheet; plays `light`.
 * @param selected accent-soft fill.
 * @param danger danger text and icon ("Sign out", "Delete").
 * @param overline a caption line above the title in ink-3 ("Experience" over "Northwind Labs").
 * @param titleColor overrides the title colour (ink, or danger text with [danger]); e.g. ink-3 for a hidden entry.
 * @param tile the D3 layout: this icon on a 40 dp sunken tile, everything top-aligned, 14 dp padding and gaps, a
 *   semibold title over a two-line description. Replaces [icon] and [leading].
 */
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
    overline: String? = null,
    titleColor: Color = Color.Unspecified,
    @DrawableRes tile: Int? = null,
    divider: Boolean = false,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) = RrListRow(
    AnnotatedString(title), modifier, subtitle, icon, onClick, onLongClick, onLongClickLabel, selected, danger, enabled, leading,
    overline, titleColor, tile, divider, trailing,
)

/**
 * [RrListRow] with a styled title, e.g. search matches in semibold (`SpanStyle(fontWeight = FontWeight.SemiBold)`).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun RrListRow(
    title: AnnotatedString,
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
    overline: String? = null,
    titleColor: Color = Color.Unspecified,
    @DrawableRes tile: Int? = null,
    divider: Boolean = false,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val interaction = remember { MutableInteractionSource() }
    RowFrame(
        divider = divider,
        modifier = modifier
            .rrEnabledAlpha(enabled, 0.45f)
            .background(if (selected) c.accentSoft else Color.Transparent)
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
        val fg = titleColor.takeOrElse { if (danger) c.dangerText else c.ink }
        when {
            tile != null -> RrIconTile(tile, danger = danger)
            leading != null -> leading()
            icon != null -> RrIcon(icon, null, tint = if (danger) c.dangerText else c.ink2)
        }
        RowText(
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    if (overline != null) RrText(overline, style = RrType.caption, color = c.ink3)
                    RrText(title, style = RowTitle, color = fg, maxLines = if (androidx.compose.ui.platform.LocalDensity.current.fontScale > 1f) Int.MAX_VALUE else 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    if (subtitle != null) RrText(subtitle, style = RrType.ui, color = c.ink3, maxLines = if (androidx.compose.ui.platform.LocalDensity.current.fontScale > 1f) Int.MAX_VALUE else 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                }
            },
            trailing = trailing?.let { { Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically, content = it) } },
            gap = 16.dp,
            top = false,
            modifier = Modifier.weight(1f),
        )
    }
}

/**
 * A row's words and its trailing slot. Side by side normally; at large font scales a trailing value (a date, a status)
 * that would make the words wrap moves under them instead of squeezing them into narrow fragments, and it always does
 * once the longest word no longer fits beside it. Words that fit on their lines keep their trailing value beside.
 */
@Composable
private fun RowText(text: @Composable () -> Unit, trailing: (@Composable () -> Unit)?, gap: Dp, top: Boolean, modifier: Modifier) {
    Layout(contents = listOf(text, trailing ?: {}), modifier = modifier) { (textM, trailingM), constraints ->
        val width = constraints.maxWidth
        val trailingP = trailingM.firstOrNull()?.measure(Constraints(maxWidth = width))
        val text = textM.first()
        if (trailingP == null || trailingP.width == 0) {
            val p = text.measure(Constraints(minWidth = width, maxWidth = width, maxHeight = constraints.maxHeight))
            return@Layout layout(width, p.height) { p.placeRelative(0, 0) }
        }
        val gapPx = gap.roundToPx()
        val beside = (width - trailingP.width - gapPx).coerceAtLeast(0)
        val stacked = text.minIntrinsicWidth(Constraints.Infinity) > beside ||
            fontScale >= RrListRowStack.FONT_SCALE && text.maxIntrinsicHeight(beside) > text.maxIntrinsicHeight(width)
        if (stacked) {
            val p = text.measure(Constraints(minWidth = width, maxWidth = width))
            val below = 4.dp.roundToPx()
            layout(width, p.height + below + trailingP.height) {
                p.placeRelative(0, 0)
                trailingP.placeRelative(0, p.height + below)
            }
        } else {
            val p = text.measure(Constraints(minWidth = beside, maxWidth = beside))
            val h = maxOf(p.height, trailingP.height)
            layout(width, h) {
                p.placeRelative(0, if (top) 0 else (h - p.height) / 2)
                trailingP.placeRelative(beside + gapPx, if (top) 0 else (h - trailingP.height) / 2)
            }
        }
    }
}

/** From this font scale [RrListRow] stacks a trailing value under words that would wrap beside it but not alone. */
internal object RrListRowStack {
    const val FONT_SCALE = 1.5f
}

@Composable
private fun RowFrame(modifier: Modifier, divider: Boolean = false, content: @Composable RowScope.() -> Unit) {
    val c = RrTheme.colors
    Row(
        modifier.fillMaxWidth().padding(horizontal = RrLayout.screenMargin).rrDesignTag(DesignTag(component = "ListRow")).defaultMinSize(minHeight = RrLayout.listRowMin)
            .drawWithContent {
                drawContent()
                if (divider) { val h = 1.dp.toPx(); drawLine(c.line, Offset(0f, size.height - h / 2), Offset(size.width, size.height - h / 2), h) }
            }.padding(bottom = if (divider) 1.dp else 0.dp).padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** Trailing value in ink-3 ("Match system"), optionally with a caret. */
@Composable
fun RrRowValue(text: String, caret: Boolean = true) {
    RrText(text, style = RrType.ui, color = RrTheme.colors.ink3)
    if (caret) RrRowCaret()
}

/** Trailing caret (18 dp), mirrored in RTL. */
@Composable
fun RrRowCaret() {
    RrIcon(R.drawable.ic_ph_caret_right, null, size = 24.dp, tint = RrTheme.colors.ink2, mirrorInRtl = true)
}

/**
 * A row whose whole area toggles a switch (one TalkBack control: "Notifications, switch, on"). Plays `toggle`.
 *
 * @param containerColor the row's fill: `surface` inside an [RrListGroup]; `Color.Transparent` to show whatever is
 *   behind it (a sheet's `raised`, a card).
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
    containerColor: Color = Color.Transparent,
    divider: Boolean = false,
) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    RowFrame(
        modifier.rrEnabledAlpha(enabled, 0.45f).background(containerColor).toggleable(checked, remember { MutableInteractionSource() }, LocalIndication.current, enabled, Role.Switch) {
            haptics(if (it) RrHaptic.ToggleOn else RrHaptic.ToggleOff)
            onCheckedChange(it)
        },
        divider = divider,
    ) {
        if (icon != null) RrIcon(icon, null, tint = c.ink2)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            RrText(title, style = RowTitle, color = c.ink)
            if (subtitle != null) RrText(subtitle, style = RrType.ui, color = c.ink3, maxLines = if (androidx.compose.ui.platform.LocalDensity.current.fontScale > 1f) Int.MAX_VALUE else 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
        }
        RrSwitch(checked, null, enabled = enabled)
    }
}

/** Two-line key/value cell ("Created" over "28 Oct 2026") used in details sheets. */
@Composable
fun RrKeyValue(key: String, value: String, modifier: Modifier = Modifier, mono: Boolean = false) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        RrText(key, style = RrType.small, color = RrTheme.colors.ink3)
        RrText(value, style = if (mono) RrType.mono else RrType.buttonLg, color = RrTheme.colors.ink)
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
    RrListGroup {
        RrListRow(
            "Import a resume",
            subtitle = "PDF, Word, LinkedIn export (.zip), Reactive Resume or JSON Resume",
            tile = R.drawable.ic_ph_file_arrow_up,
            onClick = {},
        )
        RrListRow(
            androidx.compose.ui.text.buildAnnotatedString {
                append("Product ")
                pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.SemiBold)); append("designer"); pop()
            },
            subtitle = "Resume · Edited 2 days ago",
            icon = R.drawable.ic_ph_file_text,
            onClick = {},
        )
        RrListRow("Northwind Labs", overline = "Experience", titleColor = RrTheme.colors.ink3, icon = R.drawable.ic_ph_eye_slash)
    }
    RrKeyValue("Created", "28 Oct 2026")
}
