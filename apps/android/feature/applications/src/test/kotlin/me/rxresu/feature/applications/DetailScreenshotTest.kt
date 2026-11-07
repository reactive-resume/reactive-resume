package me.rxresu.feature.applications

import androidx.navigation.compose.rememberNavController
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.testing.RrScreenshotTest
import me.rxresu.core.testing.captureScreen
import org.junit.Test
import org.robolectric.annotation.Config

@Config(qualifiers = GB_SCREEN)
class DetailScreenshotTest : RrScreenshotTest() {
    private fun j6(dark: Boolean, id: String = StoryboardIds.lumen, name: String = "J6-Detail") =
        captureScreen(name, dark, wrap = fakeWrap()) { ApplicationRoute(id, WorkspaceTab.Overview, rememberNavController()) }

    @Test fun light() = j6(false)
    @Test fun dark() = j6(true)
    @Test fun closed() = j6(false, "application-closed-0", "J6-Detail-closed")
    @Test fun followUp() = j6(false, StoryboardIds.fieldnote, "J6-Detail-follow-up")
    @Test fun fitTab() = captureScreen("J6-Detail-fit-tab", false, wrap = fakeWrap()) { ApplicationRoute(StoryboardIds.lumen, WorkspaceTab.Fit, rememberNavController()) }
}
