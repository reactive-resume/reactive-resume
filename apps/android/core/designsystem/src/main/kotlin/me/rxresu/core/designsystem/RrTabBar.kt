package me.rxresu.core.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * One tab of [RrTabBar].
 *
 * @param badge a short count on the icon ("2"); TalkBack reads [badgeDescription] ("2 new") as the state.
 */
data class RrTab(
    val label: String,
    @DrawableRes val icon: Int,
    @DrawableRes val selectedIcon: Int,
    val badge: String? = null,
    val badgeDescription: String? = null,
)

private val TabLabel = RrType.caption
private val BadgeText = TextStyle(fontFamily = GeistMono, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 16.sp)

/**
 * Bottom tab bar (56 dp plus the navigation bar inset): `surface`, line on top, the selected tab in accent text with
 * its filled icon. Only on the four tab roots. Re-tapping the selected tab calls [onReselect] (scroll to top). No
 * haptic: tab switches are navigation.
 */
@Composable
fun RrTabBar(
    tabs: List<RrTab>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    onReselect: (Int) -> Unit = {},
) {
    val c = RrTheme.colors
    Column(modifier.fillMaxWidth().background(c.surface)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).selectableGroup()) {
            tabs.forEachIndexed { i, tab ->
                val selected = i == selectedIndex
                val fg = if (selected) c.accentText else c.ink2
                Column(
                    Modifier
                        .weight(1f)
                        .defaultMinSize(minHeight = 56.dp)
                        .selectable(selected, role = Role.Tab) { if (selected) onReselect(i) else onSelect(i) }
                        .then(if (tab.badgeDescription != null) Modifier.semantics { stateDescription = tab.badgeDescription } else Modifier)
                        .padding(vertical = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
                ) {
                    Box {
                        RrIcon(if (selected) tab.selectedIcon else tab.icon, null, tint = fg)
                        if (tab.badge != null) {
                            RrText(
                                tab.badge,
                                style = BadgeText,
                                color = c.warnInk,
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                modifier = Modifier
                                    .offset(x = 22.dp, y = (-2).dp)
                                    .defaultMinSize(minWidth = 16.dp, minHeight = 16.dp)
                                    .clip(RrShape.sm)
                                    .background(c.warn)
                                    .padding(horizontal = 4.dp),
                            )
                        }
                    }
                    RrText(tab.label, style = TabLabel, color = fg, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                }
            }
        }
        Box(Modifier.windowInsetsPadding(WindowInsets.navigationBars))
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
