package me.rxresu.feature.applications

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.navigation.compose.rememberNavController
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.testing.RrScreenshotTest
import me.rxresu.core.testing.captureScreen
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import me.rxresu.core.data.FakeControls
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.navigation.ApplicationsView
import org.junit.Test
import org.robolectric.annotation.Config

/** Sheets drawn over the screen they open from, as the app's dialog destinations do. */
@Config(qualifiers = GB_SCREEN)
class SheetScreenshotTest : RrScreenshotTest() {
    private fun overDetail(name: String, dark: Boolean, id: String = StoryboardIds.lumen, sheet: @Composable () -> Unit) =
        captureScreen(name, dark, wrap = fakeWrap()) {
            val nav = rememberNavController()
            Box { ApplicationRoute(id, WorkspaceTab.Overview, nav); sheet() }
        }

    @Test fun moveLight() = overDetail("J7-Stage", false) { MoveRoute(StoryboardIds.lumen, rememberNavController()) }
    @Test fun moveDark() = overDetail("J7-Stage", true) { MoveRoute(StoryboardIds.lumen, rememberNavController()) }
    @Test fun interviewLight() = overDetail("J8-Interview", false) { InterviewRoute(StoryboardIds.lumen, StoryboardIds.interview, rememberNavController()) }
    @Test fun interviewDark() = overDetail("J8-Interview", true) { InterviewRoute(StoryboardIds.lumen, StoryboardIds.interview, rememberNavController()) }
    @Test fun interviewNew() = overDetail("J8-Interview-new", false) { InterviewRoute(StoryboardIds.lumen, null, rememberNavController()) }

    /** The built-in reader's answer for the Lumen link (the storyboard's J5). */
    private fun lumenPosting() = FakeControls().apply {
        responses.value = mapOf(
            "createPostingParse" to buildJsonObject {
                put("company", "Lumen"); put("role", "Senior product designer"); put("location", "Lisbon · Hybrid"); put("salary", "")
                put("filledBy", "page"); put("jobDescription", "Senior product designer. Grow our design system across teams.")
                put("sourceUrl", "https://lumen.jobs/roles/senior-product-designer")
                put("requirements", buildJsonArray { repeat(12) { add(JsonPrimitive("Requirement ${it + 1}")) } })
                put("postingSource", buildJsonObject { put("completeness", "unknown"); put("format", "text"); put("method", "builtin"); put("truncated", false) })
            },
        )
    }

    private fun saveJob(name: String, dark: Boolean, url: String?) =
        captureScreen(name, dark, wrap = fakeWrap(FakeRepositories(lumenPosting()))) {
            Box { ApplicationsRoute(ApplicationsView.List, rememberNavController()); SaveJobRoute(url, rememberNavController()) }
        }

    @Test fun saveJobLight() = saveJob("J5-SaveJob", false, "https://lumen.jobs/roles/senior-product-designer")
    @Test fun saveJobDark() = saveJob("J5-SaveJob", true, "https://lumen.jobs/roles/senior-product-designer")
    @Test fun saveJobBlank() = saveJob("J5-SaveJob-blank", false, null)
}
