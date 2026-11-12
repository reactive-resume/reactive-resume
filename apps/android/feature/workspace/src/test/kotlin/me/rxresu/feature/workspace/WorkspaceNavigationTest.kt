package me.rxresu.feature.workspace

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrToastHostState
import me.rxresu.core.navigation.Application
import me.rxresu.core.navigation.ApplicationWorkspace
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.RrNavMotion
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.testing.RrScreenshotTest
import me.rxresu.feature.applications.applicationsGraph
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class WorkspaceNavigationTest : RrScreenshotTest() {
    @get:Rule val compose = createComposeRule()
    private lateinit var nav: NavHostController

    private fun start(route: Application) {
        val repositories = FakeRepositories()
        val toasts = RrToastHostState()
        compose.setContent {
            RrTheme(reducedMotion = true) {
                CompositionLocalProvider(LocalRepositories provides repositories, LocalToasts provides toasts) {
                    nav = rememberNavController()
                    NavHost(nav, startDestination = route) {
                        applicationsGraph(nav, RrNavMotion(true))
                        workspaceGraph(nav)
                    }
                }
            }
        }
    }

    @Test fun legacyQuestionLinkForwardsOnceAndBackReturnsOverview() {
        val question = "How do you make accessibility part of the process?"
        start(Application(StoryboardIds.lumen, WorkspaceTab.Practise, question))
        compose.runOnIdle {
            assertEquals(ApplicationWorkspace(StoryboardIds.lumen, WorkspaceTab.Practise, question), nav.currentBackStackEntry!!.toRoute<ApplicationWorkspace>())
            nav.popBackStack()
        }
        compose.onNodeWithText("Work on it").assertIsDisplayed()
        compose.runOnIdle { assertEquals(StoryboardIds.lumen, nav.currentBackStackEntry!!.toRoute<Application>().id) }
    }

    @Test fun allSevenToolsPushTheirOwnEntryAndKeepOverviewUnderneath() {
        start(Application(StoryboardIds.lumen))
        val tools = listOf("Fit" to WorkspaceTab.Fit, "Apply" to WorkspaceTab.Apply, "Interview prep" to WorkspaceTab.Prepare,
            "Practice" to WorkspaceTab.Practise, "Debrief" to WorkspaceTab.Debrief, "Messages" to WorkspaceTab.Messages, "Library" to WorkspaceTab.Saved)
        tools.forEach { (label, tab) ->
            compose.onNodeWithText(label).performScrollTo().performClick()
            compose.runOnIdle {
                assertEquals(ApplicationWorkspace(StoryboardIds.lumen, tab), nav.currentBackStackEntry!!.toRoute<ApplicationWorkspace>())
                nav.popBackStack()
            }
            compose.runOnIdle { assertEquals(StoryboardIds.lumen, nav.currentBackStackEntry!!.toRoute<Application>().id) }
        }
    }
}
