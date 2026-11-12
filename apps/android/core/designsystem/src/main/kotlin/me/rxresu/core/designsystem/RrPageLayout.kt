package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Pushed-screen title below a bare top bar. */
@Composable
fun RrPageTitle(title: String, modifier: Modifier = Modifier, subtitle: String? = null, subtitleColor: Color = RrTheme.colors.ink2) {
    Column(modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 4.dp).rrDesignTag(DesignTag(component = "PageTitle"))) {
        RrText(title, style = RrType.pageTitle, modifier = Modifier.semantics { heading() })
        if (subtitle != null) RrText(subtitle, style = RrType.body, color = subtitleColor, modifier = Modifier.padding(top = 6.dp))
    }
}

/** Serif section heading with an inline count or end-aligned action. */
@Composable
fun RrSectionHeading(
    title: String,
    modifier: Modifier = Modifier,
    count: String? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    first: Boolean = false,
    topPadding: Dp = if (first) 20.dp else 32.dp,
) {
    val c = RrTheme.colors
    Row(modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = topPadding, bottom = 4.dp).rrDesignTag(DesignTag(component = "SectionHeading"))) {
        RrText(title, style = RrType.sheetTitle, color = c.ink, modifier = Modifier.alignByBaseline().semantics { heading() })
        if (count != null) {
            Spacer(Modifier.width(14.dp))
            RrText(count, style = RrType.ui, color = c.ink3, modifier = Modifier.alignByBaseline())
        }
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.weight(1f))
            RrText(actionLabel, style = RrType.linkSmall, color = c.accentText, modifier = Modifier.alignByBaseline().clickable(role = Role.Button, onClick = onAction))
        }
    }
}

/** Root next-step surface. Caller supplies key line, title, paragraph and the single primary action. */
@Composable
fun RrHeroCard(modifier: Modifier = Modifier, topMargin: Dp = 20.dp, raised: Boolean = false, dashed: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    val c = RrTheme.colors
    Column(
        modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = topMargin)
            .rrDesignTag(DesignTag(component = "HeroCard", radius = RrRadius.xl, bgName = if (raised) "raised" else "surface"))
            .then(if (dashed) Modifier else Modifier.rrShadow(RrElevation.Level1, RrShape.xl))
            .clip(RrShape.xl).background(if (raised) c.raised else c.surface)
            .then(if (dashed) Modifier.rrDashedBorder(c.line, RrRadius.xl) else Modifier.border(1.dp, c.line, RrShape.xl)).padding(25.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp), content = content,
    )
}

/** Pushed-screen or sheet actions; caller gives each Large button equal RowScope weight. */
@Composable
fun RrFooterBar(modifier: Modifier = Modifier, inSheet: Boolean = false, applyBottomInset: Boolean = !inSheet, content: @Composable RowScope.() -> Unit) {
    val c = RrTheme.colors
    Column(modifier.fillMaxWidth().background(if (inSheet) c.raised else c.bg)) {
        Row(
            Modifier.fillMaxWidth().rrDesignTag(DesignTag(component = "FooterBar", bgName = if (inSheet) "raised" else "bg"))
                .drawBehind { if (!inSheet) { val h = 1.dp.toPx(); drawLine(c.line, Offset(0f, h / 2), Offset(size.width, h / 2), h) } }
                .padding(horizontal = 24.dp, vertical = 12.dp).padding(top = if (inSheet) 0.dp else 1.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically, content = content,
        )
        if (applyBottomInset) Box(Modifier.rrNavigationBarsPadding())
    }
}

/** Full-width sunken page stage. Rendered page owns its exact board size. */
@Composable
fun RrPageBand(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    val c = RrTheme.colors
    Box(
        modifier.fillMaxWidth().padding(top = 20.dp)
            .rrDesignTag(DesignTag(component = "PageBand", bgName = "sunken"))
            .background(c.sunken).drawBehind {
                val h = 1.dp.toPx()
                drawLine(c.line, Offset(0f, h / 2), Offset(size.width, h / 2), h)
                drawLine(c.line, Offset(0f, size.height - h / 2), Offset(size.width, size.height - h / 2), h)
            }.then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(vertical = 25.dp), // 24 dp content padding plus each 1 dp border.
        contentAlignment = Alignment.Center,
    ) { content() }
}

@RrPreviews
@Composable
internal fun RrPageLayoutPreview() = RrPreviewSurface {
    RrPageTitle("Application profile", subtitle = "Used to fill job forms.")
    RrSectionHeading("Sections", actionLabel = "Add", onAction = {}, first = true)
    RrHeroCard {
        RrText("Tue 10 Nov · 10:00", style = RrType.keyLine, color = RrTheme.colors.ink3)
        RrText("Technical interview at Lumen", style = RrType.heading)
        RrButton("Open briefing", {}, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), size = RrButtonSize.Large)
    }
    RrFooterBar(applyBottomInset = false) {
        RrButton("Test", {}, Modifier.weight(1f), variant = RrButtonVariant.Secondary, size = RrButtonSize.Large)
        RrButton("Save", {}, Modifier.weight(1f), size = RrButtonSize.Large)
    }
}
