package me.rxresu.feature.applications

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
        captureScreen(name, dark, wrap = fakeWrap(FakeRepositories(controls)), fontScale = fontScale) { ApplicationsRoute(view, rememberNavController()) }

    @Test fun listLight() = tab("J1-List", ApplicationsView.List, false)
    @Test fun listDark() = tab("J1-List", ApplicationsView.List, true)
    @Test fun listEmpty() = tab("J1-List-empty", ApplicationsView.List, false, FakeControls(FakeMode.Empty))
    @Test fun listFont200() = tab("J1-List", ApplicationsView.List, false, fontScale = 2f)
    @Test fun boardLight() = tab("J2-Board", ApplicationsView.Board, false)
    @Test fun boardDark() = tab("J2-Board", ApplicationsView.Board, true)
    @Test fun calendarLight() = tab("J3-Calendar", ApplicationsView.Calendar, false)
    @Test fun calendarDark() = tab("J3-Calendar", ApplicationsView.Calendar, true)
    @Test fun insightsLight() = tab("J4-Insights", ApplicationsView.Insights, false)
    @Test fun insightsDark() = tab("J4-Insights", ApplicationsView.Insights, true)
}
