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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
            .clip(RrShape.lg)
            .background(c.bg)
            .border(1.dp, Color.Black.copy(alpha = 0.12f), RrShape.lg)
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
    Column(Modifier.weight(1f).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(14.dp), content = content)
}

/** `.kt`: group title with its component name in mono. */
@Composable
private fun KitTitle(title: String, code: String? = null) {
    val c = RrTheme.colors
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        RrText(title, style = RrType.eyebrow, color = c.ink3)
        if (code != null) RrText(code, style = RrType.mono.copy(fontSize = 11.sp), color = c.ink3)
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
        RrText("Display 44", style = RrType.display)
        RrText("Title 30 · Documents", style = RrType.title)
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
        RrButton("Improve", {}, variant = RrButtonVariant.Secondary, size = RrButtonSize.Small, icon = R.drawable.ic_ph_sparkle, iconTint = c.accentText)
        RrButton("Undo", {}, variant = RrButtonVariant.Ghost, size = RrButtonSize.Small)
        RrButton("Accept", {}, variant = RrButtonVariant.Soft, size = RrButtonSize.Small)
    }
    HoldToDeleteSurface(progress = 0.38f, text = "Hold to delete", enabled = true)
    KitTitle("Icon buttons", "IconButton 44 hit, label required")
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RrIconButton(R.drawable.ic_ph_caret_left, "Back", {})
        RrIconButton(R.drawable.ic_ph_arrow_counter_clockwise, "Undo", {})
        RrIconButton(R.drawable.ic_ph_sparkle, "Assistant", {}, selected = true)
        RrIconButton(R.drawable.ic_ph_dots_three, "More", {})
        RrIconButton(R.drawable.ic_ph_seal_check, "Check, 3 issues", {}, dot = true)
    }
    KitTitle("Segmented and tabs")
    RrSegmentedControl(
        listOf(
            RrSegment("List", R.drawable.ic_ph_list),
            RrSegment("Board", R.drawable.ic_ph_kanban),
            RrSegment("Calendar", R.drawable.ic_ph_calendar_blank),
            RrSegment("Insights", R.drawable.ic_ph_chart_bar),
        ),
        selectedIndex = 0,
        onSelect = {},
    )
    RrUnderlineTabs(
        listOf(RrUnderlineTab("Overview"), RrUnderlineTab("Fit"), RrUnderlineTab("Apply"), RrUnderlineTab("Interview prep")),
        selectedIndex = 0,
        onSelect = {},
        contentPadding = PaddingValues(0.dp),
        modifier = Modifier.offset(x = (-2).dp),
    )
    KitTitle("Chips", "Chip 32, context chip 26")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RrFilterChip("All", true, {})
        RrFilterChip("Resumes", false, {})
        RrFilterChip("Letters", false, {})
        RrFilterChip("Design", false, {}, icon = R.drawable.ic_ph_tag)
        RrAddChip("Tag", {})
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RrContextChip("Product designer", icon = R.drawable.ic_ph_file_text, onRemove = {})
        RrContextChip("Lumen posting", leftOut = true)
    }
    KitTitle("Controls", "Switch · Checkbox · Radio · Slider")
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
        RrSwitch(true, null)
        RrSwitch(false, null)
        RrCheckbox(true, null)
        RrCheckbox(false, null)
        RrRadio(true, null)
        RrRadio(false, null)
    }
    // The board's slider row is 20 dp (4 dp track, 8 dp padding); in apps it keeps a 44 dp touch row.
    RrSlider(0.45f, {}, modifier = Modifier.height(20.dp))
    KitTitle("Fields", "Input 44 on touch, 16 pt text")
    RrTextField("Lumen", {}, label = "Company")
    val focus = remember { MutableInteractionSource() }
    // Draw the focused state without real focus: emit once the field's collector is listening (next frame).
    LaunchedEffect(Unit) {
        withFrameNanos { }
        focus.emit(FocusInteraction.Focus())
    }
    RrTextField("Senior product designer", {}, label = "Role", interactionSource = focus)
    RrTextField("alex@morgan", {}, label = "Email", error = "Add the domain ending, like morgan.com", ltr = true)
}

@Composable
private fun ListsAndOverlays() {
    val c = RrTheme.colors
    KitTitle("List group", "Row 52 min")
    RrListGroup {
        RrListRow("Account", subtitle = "alex@morgan.design", icon = R.drawable.ic_ph_user, onClick = {}, trailing = { RrRowCaret() })
        RrListRow("Theme", icon = R.drawable.ic_ph_moon, onClick = {}, trailing = { RrRowValue("Match system") })
        RrSwitchRow("Notifications", checked = true, onCheckedChange = {}, icon = R.drawable.ic_ph_bell_simple)
        RrListRow("Sign out", icon = R.drawable.ic_ph_sign_out, onClick = {}, danger = true)
    }
    KitTitle("Callouts", "Alert tone")
    RrCallout("Paste the posting to see which of its terms your resume already has.")
    RrCallout("Your provider may charge your account for requests made with your API key.", tone = RrTone.Warn, icon = R.drawable.ic_ph_key)
    RrCallout("Couldn't send. Your message is kept.", tone = RrTone.Danger)
    KitTitle("Empty state", "EmptyState")
    RrEmptyState("Your job search starts here", "Save a job from any browser and it lands here.", actionLabel = "Save a job", onAction = {})
    KitTitle("AI composer and disclosure")
    RrAiComposer("", {}, {}, placeholder = "Ask about your next career step…", contextChips = {
        RrContextChip("Product designer", icon = R.drawable.ic_ph_file_text, onRemove = {})
    })
    RrDisclosureLine("When you press send, this resume goes to Work OpenAI with your key.")
    KitTitle("Toast with fuse", "Toast")
    RrToast("“Lumen letter” moved to Trash", actionLabel = "Undo", fuse = 0.62f)
    KitTitle("Tab bar", "TabBar")
    RrTabBar(
        rrAppTabs("Today", "Documents", "Applications", "Career", applicationsBadge = "2"),
        selectedIndex = 0,
        onSelect = {},
        modifier = Modifier.clip(RrShape.lg).border(1.dp, c.line, RrShape.lg),
    )
    KitTitle("Builder mode bar", "ModeBar")
    // The board pads the bar's bottom by 8 dp where a phone has its gesture-bar inset.
    Box(Modifier.clip(RrShape.lg).border(1.dp, c.line, RrShape.lg).background(c.surface).padding(bottom = 8.dp)) {
        RrModeBar(rrBuilderModes("Write", "Design", "Check", "Share"), selectedIndex = 0, onSelect = {})
    }
}
