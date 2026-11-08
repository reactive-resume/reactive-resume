package me.rxresu.feature.workspace

import androidx.compose.runtime.Composable
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.toRoute
import me.rxresu.core.navigation.ApplicationWorkspace
import me.rxresu.core.navigation.screen
import me.rxresu.core.navigation.WorkspaceTab

/** Each workspace tool owns a pushed destination and its own back-stack state. */
fun NavGraphBuilder.workspaceGraph(nav: NavController) {
    screen<ApplicationWorkspace> { entry ->
        val route = entry.toRoute<ApplicationWorkspace>()
        WorkspaceTabContent(route.applicationId, route.tab, nav)
    }
}

/** W1–W5: one workspace tab inside the Application screen (provided to `LocalWorkspaceTab` by :app). */
@Composable
fun WorkspaceTabContent(applicationId: String, tab: WorkspaceTab, nav: NavController) = when (tab) {
    WorkspaceTab.Fit -> FitTab(applicationId, nav)
    WorkspaceTab.Apply -> ApplyTab(applicationId, nav)
    WorkspaceTab.Prepare -> PrepareTab(applicationId, nav)
    WorkspaceTab.Practise -> PractiseTab(applicationId, nav)
    WorkspaceTab.Debrief -> DebriefTab(applicationId, nav)
    WorkspaceTab.Messages -> MessagesTab(applicationId, nav)
    WorkspaceTab.Saved -> LibraryTab(applicationId, nav)
    // Overview is drawn by :feature:applications.
    WorkspaceTab.Overview -> Unit
}
