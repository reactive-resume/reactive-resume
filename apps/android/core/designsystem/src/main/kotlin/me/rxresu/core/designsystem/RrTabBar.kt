package me.rxresu.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

data class RrTab(
    val label: String,
    @DrawableRes val icon: Int,
    @DrawableRes val selectedIcon: Int,
    val badge: String? = null,
    val badgeDescription: String? = null,
    val warn: Boolean = false,
)

private val BadgeText = TextStyle(fontFamily = GeistMono, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 16.sp)

/** Shared 64 dp dock; device safe area sits below the visible item row. */
@Composable
fun RrTabBar(
    tabs: List<RrTab>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    onReselect: (Int) -> Unit = {},
) {
    val c = RrTheme.colors
    Column(modifier.fillMaxWidth().rrDesignTag(DesignTag(component = "Dock", bgName = "bg")).background(c.bg)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
        Row(
            Modifier.fillMaxWidth().height(RrLayout.dock)
                .padding(horizontal = 8.dp).selectableGroup(),
        ) {
            tabs.forEachIndexed { i, tab ->
                val selected = i == selectedIndex
                val fg = if (selected) c.accentText else c.ink2
                Box(
                    Modifier.weight(1f).height(RrLayout.dock).rrDesignTag(DesignTag(component = "DockItem"))
                        .selectable(selected, role = Role.Tab) { if (selected) onReselect(i) else onSelect(i) }
                        .then(if (tab.badgeDescription != null) Modifier.semantics { stateDescription = tab.badgeDescription } else Modifier),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        RrIcon(if (selected) tab.selectedIcon else tab.icon, null, size = 24.dp, tint = fg)
                        val density = LocalDensity.current
                        CompositionLocalProvider(LocalDensity provides Density(density.density, density.fontScale.coerceAtMost(1.3f))) {
                            RrText(tab.label, style = RrType.dockLabel, color = fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    if (tab.badge != null) RrText(
                        tab.badge, style = BadgeText, color = c.warnInk,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        modifier = Modifier.align(Alignment.TopCenter).offset(x = 14.dp, y = 8.dp)
                            .defaultMinSize(minWidth = 16.dp, minHeight = 16.dp).clip(RrShape.full).background(c.warn).padding(horizontal = 4.dp),
                    )
                    if (tab.warn) Box(Modifier.align(Alignment.TopCenter).offset(x = 13.5.dp, y = 10.dp).size(7.dp).clip(RrShape.full).background(c.warn))
                }
            }
        }
        Box(Modifier.rrNavigationBarsPadding())
    }
}

/** The app's four tabs with their icons. Labels and badge come from the caller. */
fun rrAppTabs(today: String, documents: String, applications: String, career: String, applicationsBadge: String? = null, applicationsBadgeDescription: String? = null) = listOf(
    RrTab(today, R.drawable.ic_ph_house_simple, R.drawable.ic_ph_house_simple_fill),
    RrTab(documents, R.drawable.ic_ph_files, R.drawable.ic_ph_files_fill),
    RrTab(applications, R.drawable.ic_ph_briefcase, R.drawable.ic_ph_briefcase_fill, applicationsBadge, applicationsBadgeDescription),
    RrTab(career, R.drawable.ic_ph_compass, R.drawable.ic_ph_compass_fill),
)

@RrPreviews
@Composable
internal fun RrTabBarPreview() = RrPreviewSurface {
    RrTabBar(rrAppTabs("Today", "Documents", "Applications", "Career", "2", "2 new"), 0, {})
}
