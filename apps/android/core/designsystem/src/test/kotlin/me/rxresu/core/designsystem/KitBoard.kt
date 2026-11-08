package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.FocusInteraction
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The storyboard's grey canvas around the two theme panels (board chrome, not an app colour). */
private val BoardCanvas = Color(0xFFE9E7E1)

/**
 * Reproduction of `boards/Kit.png` (design/source/Kit.dc.html): a 2240×1400 canvas with the light and dark panels,
 * three columns each, in the board's grouping and order. Built only from design-system components.
 */
@Composable
fun KitBoard() {
    Row(
        Modifier.size(2240.dp, 1400.dp).background(BoardCanvas).padding(40.dp),
        horizontalArrangement = Arrangement.spacedBy(40.dp),
    ) {
        RrTheme(darkTheme = false, reducedMotion = true) { KitPanel(dark = false) }
        RrTheme(darkTheme = true, reducedMotion = true) { KitPanel(dark = true) }
    }
}

@Composable
private fun KitPanel(dark: Boolean) {
    val c = RrTheme.colors
    Row(
        Modifier
            .size(1060.dp, 1320.dp)
            .background(c.bg, androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
            .border(1.dp, Color.Black.copy(alpha = 0.12f), androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
            .padding(28.dp),
        horizontalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        KitColumn { TypeAndTokens(dark) }
        KitColumn { ButtonsAndControls() }
        KitColumn { ListsAndOverlays() }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.KitColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.weight(1f).fillMaxSize().wrapContentHeight(Alignment.Top, unbounded = true), verticalArrangement = Arrangement.spacedBy(14.dp), content = content)
}

/** `.kt`: group title with its component name in mono. */
@Composable
private fun KitTitle(title: String, code: String? = null) {
    val c = RrTheme.colors
    androidx.compose.ui.layout.Layout(
        contents = listOf(
            { RrText(title, style = RrType.eyebrow.copy(textMotion = androidx.compose.ui.text.style.TextMotion.Animated), color = c.ink3) },
            { if (code != null) RrText(code, style = RrType.mono.copy(fontSize = 11.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium, textMotion = androidx.compose.ui.text.style.TextMotion.Animated), color = c.ink3) },
        ), modifier = Modifier.fillMaxWidth(),
    ) { (titleM, codeM), constraints ->
        val width = constraints.maxWidth
        val titleNatural = titleM.first().maxIntrinsicWidth(androidx.compose.ui.unit.Constraints.Infinity)
        val codeNatural = codeM.firstOrNull()?.maxIntrinsicWidth(androidx.compose.ui.unit.Constraints.Infinity) ?: 0
        val gap = if (codeNatural > 0) 8.dp.roundToPx() else 0
        val total = titleNatural + codeNatural
        val available = width - gap
        val fits = total <= available
        val titleWidth = if (fits || total == 0) titleNatural else (available.toFloat() * titleNatural / total).toInt()
        val codeWidth = if (fits) codeNatural else available - titleWidth
        val titleP = titleM.first().measure(androidx.compose.ui.unit.Constraints(maxWidth = titleWidth))
        val codeP = codeM.firstOrNull()?.measure(androidx.compose.ui.unit.Constraints(maxWidth = codeWidth))
        layout(width, maxOf(titleP.height, codeP?.height ?: 0)) {
            titleP.placeRelative(0, 0)
            codeP?.placeRelative(width - codeWidth, 0)
        }
    }
}

@Composable
private fun TypeAndTokens(dark: Boolean) {
    val c = RrTheme.colors
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        RrIcon(if (dark) R.drawable.ic_ph_moon else R.drawable.ic_ph_sun, null)
        RrText(if (dark) "Dark theme" else "Light theme", style = RrType.sheetTitle)
    }
    KitTitle("Type", "Text variant")
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        RrText("Root title 34 · Documents", style = RrType.rootTitle.copy(letterSpacing = 0.sp))
        RrText("Big number 40 · 86", style = RrType.bigNumber)
        RrText("Page title 28 · Application profile", style = RrType.pageTitle)
        RrText("Sheet title 22 · Share resume", style = RrType.sheetTitle)
        RrText("Heading 20 · Experience", style = RrType.heading)
        RrText("Section 17 · Work history", style = RrType.sectionHeading)
        RrText("Label 15 · Senior product designer", style = RrType.label)
        RrText("Body 15/24 · Edits save as you type.", style = RrType.body)
        RrText("UI 14/20 · Duplicate · Rename", style = RrType.ui)
        RrText("Small 13 · Updated 2 minutes ago", style = RrType.small, color = c.ink2)
        RrText("Caption 12 · Draft", style = RrType.caption, color = c.ink2)
        RrText("Eyebrow 12 · Recent", style = RrType.eyebrow, color = c.ink3)
        RrText("rxresu.me/alex/fieldnote", style = RrType.mono, color = c.ink2)
    }
    KitTitle("Surfaces and ink", "tokens.color")
    val swatches = listOf(
        Triple("bg", c.bg, c.ink), Triple("surface", c.surface, c.ink), Triple("raised", c.raised, c.ink), Triple("sunken", c.sunken, c.ink),
        Triple("line", c.line, c.ink), Triple("line-2", c.line2, c.ink), Triple("control", c.controlBorder, c.bg), Triple("paper", RrFixedColors.paper, RrFixedColors.paperInk),
        Triple("ink", c.ink, c.bg), Triple("ink-2", c.ink2, c.bg), Triple("ink-3", c.ink3, c.bg), Triple("accent", c.accent, c.onAccent),
        Triple("acc-soft", c.accentSoft, c.accentText), Triple("info", c.infoSoft, c.infoText), Triple("warn", c.warnSoft, c.warnText), Triple("danger", c.dangerSoft, c.dangerText),
    )
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        swatches.chunked(4).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { (name, bg, fg) ->
                    Box(
                        Modifier.weight(1f).height(40.dp).clip(RrShape.sm).background(bg).border(1.dp, c.line, RrShape.sm).padding(horizontal = 4.dp, vertical = 3.dp),
                        contentAlignment = Alignment.BottomStart,
                    ) { RrText(name, style = RrType.mono.copy(fontSize = 9.5.sp, lineHeight = 11.sp), color = fg) }
                }
            }
        }
    }
    KitTitle("Stages: dot plus name, always")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RrStage.entries.forEach { RrStageLabel(it, it.name) }
    }
    KitTitle("Badges", "Badge tone")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RrBadge("Public", tone = RrBadgeTone.Accent, icon = R.drawable.ic_ph_globe_simple)
        RrBadge("Locked", tone = RrBadgeTone.Neutral, icon = R.drawable.ic_ph_lock_simple)
        RrBadge("3 issues", tone = RrBadgeTone.Warn)
        RrBadge("New", tone = RrBadgeTone.Info)
        RrBadge("Failed", tone = RrBadgeTone.Danger)
        RrBadge("Design", tone = RrBadgeTone.Outline)
    }
    KitTitle("Icons: Phosphor regular 24, filled only when selected")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(
            R.drawable.ic_ph_magnifying_glass, R.drawable.ic_ph_plus, R.drawable.ic_ph_dots_three, R.drawable.ic_ph_caret_left,
            R.drawable.ic_ph_x, R.drawable.ic_ph_sparkle, R.drawable.ic_ph_lock_simple, R.drawable.ic_ph_arrow_counter_clockwise,
            R.drawable.ic_ph_arrow_clockwise, R.drawable.ic_ph_share_network, R.drawable.ic_ph_dots_six_vertical, R.drawable.ic_ph_house_simple_fill,
        ).forEach { id ->
            val accent = id == R.drawable.ic_ph_sparkle || id == R.drawable.ic_ph_house_simple_fill
            RrIcon(id, null, tint = if (accent) c.accentText else c.ink2)
        }
    }
}

@Composable
private fun ButtonsAndControls() {
    val c = RrTheme.colors
    KitTitle("Buttons", "Button 28 · 36 · 44")
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RrButton("Share PDF", {}, size = RrButtonSize.Large, icon = R.drawable.ic_ph_share_network)
        RrButton("Other formats", {}, variant = RrButtonVariant.Secondary, size = RrButtonSize.Large)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RrButton("Save job", {})
        RrButton("Cancel", {}, variant = RrButtonVariant.Secondary)
        RrButton("Skip", {}, variant = RrButtonVariant.Ghost)
        RrButton("Delete", {}, variant = RrButtonVariant.Danger)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RrButton("New", {}, size = RrButtonSize.Small, icon = R.drawable.ic_ph_plus)
        RrButton("Improve", {}, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small, icon = R.drawable.ic_ph_sparkle, iconTint = c.accentText)
        RrButton("Undo", {}, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small)
        RrButton("Accept", {}, variant = RrButtonVariant.Soft, size = RrButtonSize.Small)
    }
    HoldToDeleteSurface(progress = 0.38f, text = "Hold to delete", enabled = true)
    KitTitle("Disabled", "whole control at 45%")
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        RrButton("Save job", {}, enabled = false)
        RrButton("Cancel", {}, variant = RrButtonVariant.Secondary, enabled = false)
        RrIconButton(R.drawable.ic_ph_arrow_clockwise, "Redo", {}, enabled = false)
        RrSwitch(true, null, enabled = false)
    }
    RrText("Buttons, icon buttons, tiles, toggles and choice cards fade as a whole: fill, border and label together. Enabled primary buttons always keep the accent fill.", style = RrType.small, color = c.ink2)
    KitTitle("Icon buttons", "IconButton 44 hit, label required")
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RrIconButton(R.drawable.ic_ph_caret_left, "Back", {})
        RrIconButton(R.drawable.ic_ph_arrow_counter_clockwise, "Undo", {})
        RrIconButton(R.drawable.ic_ph_sparkle, "Assistant", {}, selected = true)
        RrIconButton(R.drawable.ic_ph_dots_three, "More", {})
        RrIconButton(R.drawable.ic_ph_seal_check, "Check, 3 issues", {}, dot = true)
    }
    KitTitle("Segmented", "Segmented 40 · up to 3 options")
    RrSegmentedControl(listOf(RrSegment("List"), RrSegment("Board"), RrSegment("Calendar")), 0, {})
    KitTitle("Controls", "Switch · Checkbox · Radio")
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
        RrSwitch(true, null)
        RrSwitch(false, null)
        RrCheckbox(true, null)
        RrCheckbox(false, null)
        RrRadio(true, null)
        RrRadio(false, null)
    }
    RrText("Radio and checkbox rows inside sheets keep the 24 px row padding, clear of the sheet edges.", style = RrType.small, color = c.ink2)
    KitTitle("Fields", "Field: 13 label above, 44 input, 16 text")
    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
    RrTextField("Lumen", {}, label = "Company")
    val focus = remember { MutableInteractionSource() }
    // Draw the focused state without real focus: emit once the field's collector is listening (next frame).
    LaunchedEffect(Unit) {
        withFrameNanos { }
        focus.emit(FocusInteraction.Focus())
    }
    val roleWidth = androidx.compose.ui.text.rememberTextMeasurer().measure("Senior product designer", style = RrType.input).size.width
    RrTextField("Senior product designer", {}, label = "Role", interactionSource = focus, modifier = Modifier.drawWithContent {
        drawContent()
        val x = 20.dp.toPx() + roleWidth
        drawLine(c.accent, androidx.compose.ui.geometry.Offset(x, 38.dp.toPx()), androidx.compose.ui.geometry.Offset(x, 58.dp.toPx()), 1.dp.toPx())
    })
    RrTextField("alex@morgan", {}, label = "Email", error = "Add the domain ending, like morgan.com", ltr = true)
    }
    KitTitle("Chips", "Chip 32 · tags and suggestions only")
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RrFilterChip("Leadership", false, {})
        RrFilterChip("Research", false, {})
        RrAddChip("Tag", {})
    }
    KitTitle("AI composer", "line only when sending is blocked")
    Row(Modifier.fillMaxWidth().clip(RrShape.xl).background(c.raised).border(1.dp, c.controlBorder, RrShape.xl).padding(start = 14.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        RrText("Ask about this resume…", style = RrType.body, color = c.ink3, modifier = Modifier.weight(1f))
        RrIconButton(R.drawable.ic_ph_arrow_up, "Send", {}, size = RrIconButtonSize.Small, containerColor = c.accent, tint = c.onAccent)
    }
    RrDisclosureLine("Knowledge couldn't load. Try again or switch Knowledge off before sending.", icon = R.drawable.ic_ph_warning_circle)

}

@Composable
private fun KitFrame(modifier: Modifier = Modifier, bottomPadding: androidx.compose.ui.unit.Dp = 0.dp, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().clip(RrShape.lg).background(RrTheme.colors.bg).border(1.dp, RrTheme.colors.line, RrShape.lg).padding(1.dp).padding(bottom = bottomPadding), content = content)
}

@Composable
private fun ListsAndOverlays() {
    val c = RrTheme.colors
    CompositionLocalProvider(LocalRrInsets provides RrInsets(0.dp, 0.dp)) {
        KitTitle("Root header", "RootHeader · serif 34")
        KitFrame {
            RrLargeTitleHeader("Documents", rememberRrLargeTitleState(), subtitle = "Saturday, 7 November", applyStatusBarInset = false) {
                RrIconButton(R.drawable.ic_ph_magnifying_glass, "Search", {})
                RrIconButton(R.drawable.ic_ph_plus, "New", {})
            }
        }
        KitTitle("Pushed screen", "TopBar 56 · PageTitle 28 · one line")
        KitFrame {
            RrTopBar(onBack = {}, applyStatusBarInset = false, modifier = Modifier.wrapContentWidth(Alignment.Start, unbounded = true).width(333.dp).offset(x = (-8).dp)) { RrIconButton(R.drawable.ic_ph_dots_three, "More", {}) }
            RrPageTitle("Application profile", subtitle = "Used to fill job forms.", subtitleColor = c.ink3)
        }
        KitTitle("Section and rows", "SectionHeading 22 · ListRow 64 · 24 margins")
        KitFrame(bottomPadding = 4.dp) {
            RrSectionHeading("Sections", actionLabel = "Add", onAction = {}, first = true)
            RrListGroup {
                RrListRow("Experience", subtitle = "Northwind Labs, Harbour Studio", divider = true, trailing = { RrRowCaret() })
                RrListRow("Template", divider = true, trailing = { RrRowValue("Onyx") })
                RrSwitchRow("Public link", checked = true, onCheckedChange = {}, subtitle = "Anyone with the link")
            }
        }
        KitTitle("Hero", "HeroCard · the one next step")
        KitFrame(bottomPadding = 20.dp) {
            RrHeroCard(topMargin = 0.dp) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).clip(RrShape.full).background(RrFixedColors.stageInterview))
                    RrText("Tue 10 Nov · 10:00", style = RrType.keyLine, color = c.ink3)
                }
                RrText("Technical interview at Lumen", style = RrType.heading)
                RrButton("Open briefing", {}, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), size = RrButtonSize.Large)
            }
        }
        KitTitle("Footer bar", "FooterBar · actions in thumb reach")
        KitFrame {
            RrFooterBar(applyBottomInset = false) {
                RrButton("Test", {}, Modifier.weight(1f), variant = RrButtonVariant.Secondary, size = RrButtonSize.Large)
                RrButton("Save", {}, Modifier.weight(1f), size = RrButtonSize.Large)
            }
        }
        KitTitle("Dock", "NavDock 64 · tabs, builder, letter")
        KitFrame { RrTabBar(rrAppTabs("Today", "Documents", "Applications", "Career"), 0, {}) }
        KitFrame { RrModeBar(rrBuilderModes("Edit", "Design", "Check", "Share", checkWarn = true), 0, {}) }
        KitTitle("Toast", "Toast · Undo and fuse")
        RrToast("Moved to trash", actionLabel = "Undo", fuse = 0.6f)
    }
}
