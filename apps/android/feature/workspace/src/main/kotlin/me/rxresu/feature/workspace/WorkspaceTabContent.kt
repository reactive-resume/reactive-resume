package me.rxresu.feature.workspace

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.toRoute
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrMenu
import me.rxresu.core.designsystem.RrMenuItem
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTopBar
import me.rxresu.core.navigation.ApplicationWorkspace
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.navigation.screen
import me.rxresu.core.strings.R as S

/** Each workspace tool owns a pushed destination and its own back-stack state. */
fun NavGraphBuilder.workspaceGraph(nav: NavController) {
    screen<ApplicationWorkspace> { entry ->
        val route = entry.toRoute<ApplicationWorkspace>()
        WorkspaceTabContent(route.applicationId, route.tab, nav)
    }
}

/** W1–W5 and the undrawn tools retain their own view models and back-stack entry. */
@Composable
fun WorkspaceTabContent(applicationId: String, tab: WorkspaceTab, nav: NavController) {
    when (tab) {
        WorkspaceTab.Fit -> FitTab(applicationId, nav)
        WorkspaceTab.Apply -> ApplyTab(applicationId, nav)
        WorkspaceTab.Prepare -> PrepareTab(applicationId, nav)
        WorkspaceTab.Practise -> PractiseTab(applicationId, nav)
        WorkspaceTab.Debrief -> DebriefTab(applicationId, nav)
        WorkspaceTab.Messages -> MessagesTab(applicationId, nav)
        WorkspaceTab.Saved -> LibraryTab(applicationId, nav)
        WorkspaceTab.Overview -> Unit
    }
}

@Composable
internal fun WorkspaceFrame(
    showMore: Boolean = true,
    onBack: () -> Unit,
    onCoach: (() -> Unit)? = null,
    onSettings: () -> Unit = {},
    menuItems: (@Composable (() -> Unit) -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg)) {
        RrTopBar(onBack = onBack, actions = {
            onCoach?.let { RrIconButton(D.drawable.ic_ph_sparkle, stringResource(S.string.ask_the_coach), it) }
            if (showMore) Box {
                RrIconButton(D.drawable.ic_ph_dots_three, stringResource(S.string.more), { menu = true })
                RrMenu(menu, { menu = false }) {
                    if (menuItems != null) menuItems { menu = false }
                    else RrMenuItem(stringResource(S.string.set_up_ai), { menu = false; onSettings() }, icon = D.drawable.ic_ph_sparkle)
                }
            }
        })
        Box(Modifier.weight(1f)) { content() }
    }
}
