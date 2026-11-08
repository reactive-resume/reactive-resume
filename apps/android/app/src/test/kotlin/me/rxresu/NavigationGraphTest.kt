package me.rxresu

import android.app.Application
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import androidx.test.core.app.ApplicationProvider
import me.rxresu.core.auth.FakeAuthService
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrToastHostState
import me.rxresu.core.navigation.*
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.robolectric.annotation.Config

/** Exercises the registration boundary used by RrApp, with real feature graphs and fake repositories. */
@Config(application = Application::class)
class NavigationGraphTest : RrScreenshotTest() {
    @get:Rule val rule = createComposeRule()
    private lateinit var nav: NavHostController

    private fun start(route: Any) {
        val repositories = FakeRepositories()
        val auth = FakeAuthService(ApplicationProvider.getApplicationContext())
        val toasts = RrToastHostState()
        rule.setContent {
            CompositionLocalProvider(LocalInspectionMode provides true, LocalRepositories provides repositories, LocalToasts provides toasts) {
                RrTheme(reducedMotion = true) {
                    nav = rememberNavController()
                    NavHost(nav, startDestination = route) { appDestinations(nav, RrNavMotion(true), auth) }
                }
            }
        }
    }

    private fun visit(route: Any) {
        rule.runOnIdle { nav.navigate(route) }
        rule.runOnIdle { assertTrue("Route not registered: $route", requireNotNull(nav.currentDestination).hasRoute(route::class)) }
    }

    @Test fun sectionEntryAndFocusedDesignPushAndReturnToTheirParent() {
        start(Builder(StoryboardIds.resume))
        visit(BuilderSection(StoryboardIds.resume, "experience"))
        visit(BuilderEntry(StoryboardIds.resume, "experience", "experience-northwind"))
        rule.runOnIdle { assertTrue(nav.popBackStack()) }
        rule.runOnIdle { assertTrue(requireNotNull(nav.currentDestination).hasRoute<BuilderSection>()) }
        rule.runOnIdle { assertTrue(nav.popBackStack()) }
        for (picker in DesignPicker.entries) {
            visit(BuilderDesign(StoryboardIds.resume, picker))
            rule.runOnIdle {
                assertEquals(picker, requireNotNull(nav.currentBackStackEntry).toRoute<BuilderDesign>().picker)
                assertTrue(nav.popBackStack())
            }
        }
        rule.runOnIdle { assertTrue(requireNotNull(nav.currentDestination).hasRoute<Builder>()) }
    }

    @Test fun workspaceToolsPreserveApplicationAndPracticeQuestionOnTheRealGraph() {
        start(me.rxresu.core.navigation.Application(StoryboardIds.lumen))
        for (tab in WorkspaceTab.entries.filter { it != WorkspaceTab.Overview }) {
            val question = if (tab == WorkspaceTab.Practise) "Tell me about the design system." else null
            visit(ApplicationWorkspace(StoryboardIds.lumen, tab, question))
            rule.runOnIdle {
                val route = requireNotNull(nav.currentBackStackEntry).toRoute<ApplicationWorkspace>()
                assertEquals(StoryboardIds.lumen, route.applicationId)
                assertEquals(question, route.practiceQuestion)
                assertTrue(nav.popBackStack())
            }
        }
        rule.runOnIdle { assertTrue(requireNotNull(nav.currentDestination).hasRoute<me.rxresu.core.navigation.Application>()) }
    }

    @Test fun legacyWorkspaceLinkReturnsToOverviewWithoutForwardingAgain() {
        start(me.rxresu.core.navigation.Application(StoryboardIds.lumen, WorkspaceTab.Prepare))
        rule.waitUntil { nav.currentDestination?.hasRoute<ApplicationWorkspace>() == true }
        rule.runOnIdle { assertTrue(nav.popBackStack()) }
        rule.runOnIdle { assertTrue(requireNotNull(nav.currentDestination).hasRoute<me.rxresu.core.navigation.Application>()) }
    }

    @Test fun assistantPreviewAndProviderUseFullScreenDestinationsWhileFormatsIsASheet() {
        start(Builder(StoryboardIds.resume))
        for (route in listOf(Assistant(StoryboardIds.resume), PagePreview(StoryboardIds.resume), AiProviderSheet())) {
            visit(route)
            rule.runOnIdle {
                assertEquals("composable", requireNotNull(nav.currentDestination).navigatorName)
                assertTrue(nav.popBackStack())
            }
        }
        visit(Download(StoryboardIds.resume, DocumentKind.Resume))
        rule.runOnIdle { assertEquals("dialog", requireNotNull(nav.currentDestination).navigatorName) }
    }
}
