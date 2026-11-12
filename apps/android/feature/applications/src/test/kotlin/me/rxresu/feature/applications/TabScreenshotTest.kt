package me.rxresu.feature.applications

import androidx.compose.foundation.layout.*
import androidx.compose.ui.Modifier
import me.rxresu.core.designsystem.RrTabBar
import me.rxresu.core.designsystem.rrAppTabs
import androidx.navigation.compose.rememberNavController
import me.rxresu.core.data.FakeControls
import me.rxresu.core.data.FakeMode
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.navigation.ApplicationsView
import me.rxresu.core.testing.RrScreenshotTest
import me.rxresu.core.testing.captureScreen
import org.junit.Test
import org.robolectric.annotation.Config

@Config(qualifiers = GB_SCREEN)
class TabScreenshotTest : RrScreenshotTest() {
    private fun tab(name: String, view: ApplicationsView, dark: Boolean, controls: FakeControls = FakeControls(), fontScale: Float = 1f) =
        captureScreen(name, dark, wrap = fakeWrap(if (name != "J1-List-empty") applicationStoryboard(insights = view == ApplicationsView.Insights, calendar = view == ApplicationsView.Calendar) else FakeRepositories(controls)), fontScale = fontScale) {
            Column {
                Box(Modifier.weight(1f)) { ApplicationsRoute(view, rememberNavController(), companyInitials = mapOf(me.rxresu.core.data.StoryboardIds.fieldnote to "FN")) }
                if (view != ApplicationsView.Insights) RrTabBar(rrAppTabs("Today", "Documents", "Applications", "Career"), 2, {})
            }
        }

    @Test fun listLight() = tab("J1-List", ApplicationsView.List, false)
    @Test fun listDark() = tab("J1-List", ApplicationsView.List, true)
    @Test fun listEmpty() = tab("J1-List-empty", ApplicationsView.List, false, FakeControls(FakeMode.Empty))
    @Test fun listFont200() = tab("J1-List", ApplicationsView.List, false, fontScale = 2f)
    @Test fun boardLight() = tab("J2-Board", ApplicationsView.Board, false)
    @Test fun boardFont200() = tab("J2-Board", ApplicationsView.Board, false, fontScale = 2f)
    @Test fun boardDark() = tab("J2-Board", ApplicationsView.Board, true)
    @Test fun calendarLight() = tab("J3-Calendar", ApplicationsView.Calendar, false)
    @Test fun calendarFont200() = tab("J3-Calendar", ApplicationsView.Calendar, false, fontScale = 2f)
    @Test fun calendarDark() = tab("J3-Calendar", ApplicationsView.Calendar, true)
    @Test fun insightsLight() = tab("J4-Insights", ApplicationsView.Insights, false)
    @Test fun insightsFont200() = tab("J4-Insights", ApplicationsView.Insights, false, fontScale = 2f)
    @Test fun insightsDark() = tab("J4-Insights", ApplicationsView.Insights, true)
    @Test fun pipelineLight() = pipeline(false)
    @Test fun pipelineDark() = pipeline(true)
    private fun pipeline(dark: Boolean) {
        val repos = FakeRepositories()
        val insights = kotlinx.coroutines.runBlocking { repos.applications.insights() }
        captureScreen("J4-Pipeline", dark, wrap = fakeWrap(repos)) { PipelineFlow(insights) }
    }
}
