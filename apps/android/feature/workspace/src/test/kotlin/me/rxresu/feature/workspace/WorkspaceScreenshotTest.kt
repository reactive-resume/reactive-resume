package me.rxresu.feature.workspace

import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
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
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.Application
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.network.generated.CreateCareerOfferResponseDataFitRequirementsItemOrigin
import me.rxresu.core.network.generated.FitResult
import me.rxresu.core.network.generated.SavedItem
import me.rxresu.core.testing.RrScreenshotTest
import me.rxresu.core.testing.captureScreen
import org.junit.Test
import org.robolectric.annotation.Config

/** Pushed workspace screens with the same real view models as their destinations. */
@Config(qualifiers = me.rxresu.core.testing.RR_SCREEN_QUALIFIERS)
class WorkspaceScreenshotTest : RrScreenshotTest() {
    private fun wrap(repos: RrRepositories, tab: (@Composable (String, WorkspaceTab, androidx.navigation.NavController) -> Unit)? = null): @Composable (@Composable () -> Unit) -> Unit = { content ->
        CompositionLocalProvider(
            androidx.compose.ui.platform.LocalConfiguration provides android.content.res.Configuration(androidx.compose.ui.platform.LocalConfiguration.current).apply { setLocale(java.util.Locale.UK) },
            LocalRepositories provides repos,
            LocalToasts provides RrToastHostState(),
        ) { content() }
    }

    @org.junit.Before fun clock24() { android.provider.Settings.System.putString(androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>().contentResolver, android.provider.Settings.System.TIME_12_24, "24") }

    private fun shot(name: String, dark: Boolean, id: String, tab: WorkspaceTab, repos: RrRepositories = FakeRepositories(), slot: (@Composable (String, WorkspaceTab, androidx.navigation.NavController) -> Unit)? = null) =
        captureScreen(name, dark, wrap = wrap(repos)) {
            if (slot != null) WorkspaceFrame(onBack = {}) { slot(id, tab, rememberNavController()) }
            else WorkspaceTabContent(id, tab, rememberNavController())
        }

    /** The storyboard's fit: three requirements from the posting and one inferred, as the board groups them. */
    private fun boardFit(): RrRepositories {
        val controls = FakeControls()
        val saved = runBlocking { FakeRepositories(controls).workspace.listCareerSavedItems(applicationId = StoryboardIds.lumen) }
        val edited = saved.map { item ->
            val fit = item.data as? FitResult ?: return@map item
            val four = fit.requirements.take(4).mapIndexed { i, r -> r.copy(origin = if (i == 3) CreateCareerOfferResponseDataFitRequirementsItemOrigin.Inferred else r.origin,
                evidence = listOf("Northwind Labs entry", "in Skills only", "", "Harbour Studio entry")[i]) }
            item.copy(data = fit.copy(requirements = four, summary = "From “Lumen · Senior product designer” and 12 Knowledge facts · checked today 08:40"))
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

    private fun sentLumen(): RrRepositories {
        val controls = FakeControls()
        val base = FakeRepositories(controls)
        val workspace = runBlocking { base.workspace.getCareerWorkspace(StoryboardIds.lumen) }
        val answers = listOf(
            me.rxresu.core.network.generated.SaveCareerWorkspaceRequestAnswersItem(answer = "Building the shared system at Northwind Labs.", factIds = emptyList(), id = "answer-design", question = "Design systems experience"),
            me.rxresu.core.network.generated.SaveCareerWorkspaceRequestAnswersItem(answer = "4 weeks", factIds = emptyList(), id = "answer-notice", question = "Notice period"),
            me.rxresu.core.network.generated.SaveCareerWorkspaceRequestAnswersItem(answer = "Lisbon", factIds = emptyList(), id = "answer-location", question = "Location"),
        )
        controls.responses.value = mapOf("getCareerWorkspace" to ApiJson.encodeToJsonElement(me.rxresu.core.network.generated.CareerWorkspace.serializer(), workspace.copy(answers = answers,
            submissionReview = me.rxresu.core.network.generated.DeleteCareerWorkspaceAnswerResponseSubmissionReview(answers = true, at = "2026-11-02T14:20:00Z", checklist = emptyList(), documents = true))))
        return FakeRepositories(controls)
    }

    /** The board's recording: 0:48 into the take, with the bars as drawn. */
    private val boardRecording = RecordingState(
        recording = true,
        elapsedMs = 48_000,
        levels = listOf(20, 35, 60, 45, 80, 55, 30, 65, 90, 50, 35, 70, 40, 25, 55, 75, 45, 30, 20, 40, 15, 10, 8, 6).map { it / 100f },
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
            PractiseScreen(state, boardRecording, false, rememberDates(ZoneId.of("Europe/Lisbon")), {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, now = repos.time.now())
        }
    }

    private fun boardMessages(): RrRepositories {
        val controls = FakeControls()
        val saved = runBlocking { FakeRepositories(controls).workspace.listCareerSavedItems(applicationId = StoryboardIds.fieldnote) }
        val edited = saved.map { item ->
            val draft = item.data as? me.rxresu.core.network.generated.MessageDraft ?: return@map item
            item.copy(data = draft.copy(reply = "Hi Joana,\n\nI applied for the design systems designer role on 28 October and wanted to check in. I'm still very interested, especially in the token work your posting describes.\n\nHappy to share more about the system I built at Northwind Labs if useful.\n\nBest,\nAlex"))
        }
        controls.responses.value = mapOf("listCareerSavedItems" to ApiJson.encodeToJsonElement(ListSerializer(SavedItem.serializer()), edited))
        return FakeRepositories(controls)
    }

    /** The board supplies two sources; the current API exposes only the posting URL. Presentation override only. */
    private fun prepSlot(repos: RrRepositories): @Composable (String, WorkspaceTab, androidx.navigation.NavController) -> Unit = { id, _, _ ->
        val vm = viewModel { PrepareViewModel(repos, id) }
        val load by vm.state.collectAsStateWithLifecycle()
        Loaded(load, vm::load) { state ->
            PrepareScreen(state.copy(companySourceCount = 2), rememberDates(repos.time.timezone()), {}, {}, {}, {}, {}, {}, {}, {})
        }
    }

    private fun boardPrep(): RrRepositories {
        val controls = FakeControls()
        val saved = runBlocking { FakeRepositories(controls).workspace.listCareerSavedItems(applicationId = StoryboardIds.lumen) }
        val edited = saved.map { item ->
            val briefing = item.data as? me.rxresu.core.network.generated.Briefing ?: return@map item
            item.copy(data = briefing.copy(practiceQuestions = briefing.practiceQuestions.orEmpty() + listOf("Tell me about a time you disagreed with a colleague. How did you resolve it?", "Why do you want this role at Lumen?")))
        }
        controls.responses.value = mapOf("listCareerSavedItems" to ApiJson.encodeToJsonElement(ListSerializer(SavedItem.serializer()), edited))
        return FakeRepositories(controls)
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

    @Test fun applyLight() = shot("W2-Apply", false, StoryboardIds.lumen, WorkspaceTab.Apply, sentLumen())
    @Test fun applyDark() = shot("W2-Apply", true, StoryboardIds.lumen, WorkspaceTab.Apply, sentLumen())

    @Test fun applyBeforeSubmit() = shot("W2-Apply-before-submit", false, StoryboardIds.kiln, WorkspaceTab.Apply, savedKiln())

    @Test fun prepLight() = boardPrep().let { shot("W3-Prep", false, StoryboardIds.lumen, WorkspaceTab.Prepare, it, prepSlot(it)) }
    @Test fun prepDark() = boardPrep().let { shot("W3-Prep", true, StoryboardIds.lumen, WorkspaceTab.Prepare, it, prepSlot(it)) }
    @Test fun prepNoInterview() = shot("W3-Prep-no-interview", false, StoryboardIds.fieldnote, WorkspaceTab.Prepare)

    @Test fun practiceLight() = FakeRepositories().let { shot("W4-Practice", false, StoryboardIds.lumen, WorkspaceTab.Practise, it, recordingSlot(it)) }
    @Test fun practiceDark() = FakeRepositories().let { shot("W4-Practice", true, StoryboardIds.lumen, WorkspaceTab.Practise, it, recordingSlot(it)) }
    @Test fun practiceIdle() = shot("W4-Practice-idle", false, StoryboardIds.lumen, WorkspaceTab.Practise)

    @Test fun messagesLight() = shot("W5-Messages", false, StoryboardIds.fieldnote, WorkspaceTab.Messages, boardMessages())
    @Test fun messagesDark() = shot("W5-Messages", true, StoryboardIds.fieldnote, WorkspaceTab.Messages, boardMessages())

    @Test fun debrief() = shot("W5-Debrief", false, StoryboardIds.lumen, WorkspaceTab.Debrief, afterInterview())
    @Test fun debriefDark() = shot("W5-Debrief", true, StoryboardIds.lumen, WorkspaceTab.Debrief, afterInterview())
    @Test fun library() = shot("W5-Library", false, StoryboardIds.lumen, WorkspaceTab.Saved)
    @Test fun libraryDark() = shot("W5-Library", true, StoryboardIds.lumen, WorkspaceTab.Saved)
    @Test fun libraryEmpty() {
        val controls = FakeControls().apply { responses.value = mapOf("listCareerSavedItems" to kotlinx.serialization.json.JsonArray(emptyList())) }
        shot("W5-Library-empty", false, StoryboardIds.kiln, WorkspaceTab.Saved, FakeRepositories(controls))
    }
    @Test fun fitFont200() = captureScreen("W1-Fit", false, wrap = wrap(boardFit()), fontScale = 2f) { WorkspaceTabContent(StoryboardIds.lumen, WorkspaceTab.Fit, rememberNavController()) }
}
