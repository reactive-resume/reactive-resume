package me.rxresu.feature.workspace

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.navigation.compose.rememberNavController
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.builtins.ListSerializer
import me.rxresu.core.data.FakeControls
import me.rxresu.core.data.FakeMode
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.data.TimeSource
import me.rxresu.core.designsystem.RrToastHostState
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.LocalWorkspaceTab
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.CreateCareerOfferResponseDataFitRequirementsItemOrigin
import me.rxresu.core.network.generated.FitResult
import me.rxresu.core.network.generated.SavedItem
import me.rxresu.core.testing.RrScreenshotTest
import me.rxresu.core.testing.captureScreen
import me.rxresu.feature.applications.ApplicationRoute
import org.junit.Test
import org.robolectric.annotation.Config

/** W1–W5 and the extra workspace states, drawn inside the Application screen (J6 frame) as the app does. */
@Config(qualifiers = "en-rGB-w390dp-h844dp-xhdpi")
class WorkspaceScreenshotTest : RrScreenshotTest() {
    private fun wrap(repos: RrRepositories, tab: (@Composable (String, WorkspaceTab, androidx.navigation.NavController) -> Unit)? = null): @Composable (@Composable () -> Unit) -> Unit = { content ->
        CompositionLocalProvider(
            LocalRepositories provides repos,
            LocalToasts provides RrToastHostState(),
            LocalWorkspaceTab provides (tab ?: { id, t, n -> WorkspaceTabContent(id, t, n) }),
        ) { content() }
    }

    private fun shot(name: String, dark: Boolean, id: String, tab: WorkspaceTab, repos: RrRepositories = FakeRepositories(), slot: (@Composable (String, WorkspaceTab, androidx.navigation.NavController) -> Unit)? = null) =
        captureScreen(name, dark, wrap = wrap(repos, slot)) { ApplicationRoute(id, tab, rememberNavController()) }

    /** The storyboard's fit: three requirements from the posting and one inferred, as the board groups them. */
    private fun boardFit(): RrRepositories {
        val controls = FakeControls()
        val saved = runBlocking { FakeRepositories(controls).workspace.listCareerSavedItems(applicationId = StoryboardIds.lumen) }
        val edited = saved.map { item ->
            val fit = item.data as? FitResult ?: return@map item
            val four = fit.requirements.take(4).mapIndexed { i, r -> if (i == 3) r.copy(origin = CreateCareerOfferResponseDataFitRequirementsItemOrigin.Inferred) else r }
            item.copy(data = fit.copy(requirements = four))
        }
        controls.responses.value = mapOf("listCareerSavedItems" to ApiJson.encodeToJsonElement(ListSerializer(SavedItem.serializer()), edited))
        return FakeRepositories(controls)
    }

    /** Kiln Studio as the board draws it: saved, not applied yet. */
    private fun savedKiln(): RrRepositories {
        val controls = FakeControls()
        val app = runBlocking { FakeRepositories(controls).applications.getApplication(StoryboardIds.kiln) }.copy(status = ApplicationStage.Saved)
        controls.responses.value = mapOf("getApplication" to ApiJson.encodeToJsonElement(Application.serializer(), app))
        return FakeRepositories(controls)
    }

    /** The board's recording: 0:48 into the take, with the bars as drawn. */
    private val boardRecording = RecordingState(
        recording = true,
        elapsedMs = 48_000,
        levels = listOf(12, 24, 40, 28, 52, 36, 20, 44, 30, 16, 38, 48, 26, 14, 32, 22, 10).map { (it - 8) / 48f },
    )

    private fun recordingSlot(repos: RrRepositories): @Composable (String, WorkspaceTab, androidx.navigation.NavController) -> Unit {
        val state = runBlocking {
            val context = repos.workspaceContext(StoryboardIds.lumen)
            PractiseState(
                context, context.app.interviews().first(), listOf("Walk me through a design system decision and its trade-offs.", "How do you make accessibility part of the process?", "Tell me about a time you disagreed with a colleague. How did you resolve it?", "Why do you want this role at Lumen?"), 0,
                mapOf("Walk me through a design system decision and its trade-offs." to "Building the shared system"), emptyMap(),
                chooseTranscriber(context.providers),
                context.saved.mapNotNull { (it.data as? me.rxresu.core.network.generated.PracticeAttempt)?.let { a -> Instant.parse(it.createdAt) to a } },
            )
        }
        return { _, _, _ ->
            PractiseScreen(state, boardRecording, false, rememberDates(ZoneId.of("Europe/Lisbon")), {}, {}, {}, {}, {}, {}, {}, {}, {}, {})
        }
    }

    private fun afterInterview() = FakeRepositories(time = TimeSource(Clock.fixed(Instant.parse("2026-11-10T12:00:00Z"), ZoneId.of("Europe/Lisbon"))) { ZoneId.of("Europe/Lisbon") })

    @Test fun fitLight() = shot("W1-Fit", false, StoryboardIds.lumen, WorkspaceTab.Fit, boardFit())
    @Test fun fitDark() = shot("W1-Fit", true, StoryboardIds.lumen, WorkspaceTab.Fit, boardFit())
    @Test fun fitNoAi() {
        val controls = FakeControls().apply {
            set("listAiProviders", FakeMode.Error())
            responses.value = mapOf("listCareerSavedItems" to kotlinx.serialization.json.JsonArray(emptyList()))
        }
        shot("W1-Fit-no-ai", false, StoryboardIds.lumen, WorkspaceTab.Fit, FakeRepositories(controls))
    }
    @Test fun fitFirstRun() {
        val controls = FakeControls().apply { responses.value = mapOf("listCareerSavedItems" to kotlinx.serialization.json.JsonArray(emptyList())) }
        shot("W1-Fit-first-run", false, StoryboardIds.lumen, WorkspaceTab.Fit, FakeRepositories(controls))
    }

    @Test fun applyLight() = shot("W2-Apply", false, StoryboardIds.kiln, WorkspaceTab.Apply, savedKiln())
    @Test fun applyDark() = shot("W2-Apply", true, StoryboardIds.kiln, WorkspaceTab.Apply, savedKiln())

    @Test fun prepLight() = shot("W3-Prep", false, StoryboardIds.lumen, WorkspaceTab.Prepare)
    @Test fun prepDark() = shot("W3-Prep", true, StoryboardIds.lumen, WorkspaceTab.Prepare)
    @Test fun prepNoInterview() = shot("W3-Prep-no-interview", false, StoryboardIds.fieldnote, WorkspaceTab.Prepare)

    @Test fun practiceLight() = FakeRepositories().let { shot("W4-Practice", false, StoryboardIds.lumen, WorkspaceTab.Practise, it, recordingSlot(it)) }
    @Test fun practiceDark() = FakeRepositories().let { shot("W4-Practice", true, StoryboardIds.lumen, WorkspaceTab.Practise, it, recordingSlot(it)) }
    @Test fun practiceIdle() = shot("W4-Practice-idle", false, StoryboardIds.lumen, WorkspaceTab.Practise)

    @Test fun messagesLight() = shot("W5-Messages", false, StoryboardIds.fieldnote, WorkspaceTab.Messages)
    @Test fun messagesDark() = shot("W5-Messages", true, StoryboardIds.fieldnote, WorkspaceTab.Messages)

    @Test fun debrief() = shot("W5-Debrief", false, StoryboardIds.lumen, WorkspaceTab.Debrief, afterInterview())
    @Test fun debriefDark() = shot("W5-Debrief", true, StoryboardIds.lumen, WorkspaceTab.Debrief, afterInterview())
    @Test fun library() = shot("W5-Library", false, StoryboardIds.lumen, WorkspaceTab.Saved)
    @Test fun libraryDark() = shot("W5-Library", true, StoryboardIds.lumen, WorkspaceTab.Saved)
    @Test fun libraryEmpty() {
        val controls = FakeControls().apply { responses.value = mapOf("listCareerSavedItems" to kotlinx.serialization.json.JsonArray(emptyList())) }
        shot("W5-Library-empty", false, StoryboardIds.kiln, WorkspaceTab.Saved, FakeRepositories(controls))
    }
    @Test fun fitFont200() = captureScreen("W1-Fit", false, wrap = wrap(boardFit()), fontScale = 2f) { ApplicationRoute(StoryboardIds.lumen, WorkspaceTab.Fit, rememberNavController()) }
}
