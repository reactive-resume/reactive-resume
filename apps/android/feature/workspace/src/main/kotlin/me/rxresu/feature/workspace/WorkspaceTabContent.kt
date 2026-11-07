package me.rxresu.feature.workspace

import androidx.compose.runtime.Composable
import androidx.navigation.NavController
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.navigation.WorkspaceTab

/** W1–W5: one workspace tab inside the Application screen (provided to `LocalWorkspaceTab` by :app). */
@Composable
fun WorkspaceTabContent(applicationId: String, tab: WorkspaceTab, nav: NavController) = RrText(tab.name)
