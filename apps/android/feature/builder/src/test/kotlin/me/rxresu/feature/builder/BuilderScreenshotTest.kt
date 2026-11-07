package me.rxresu.feature.builder

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.database.SaveStatus
import me.rxresu.core.navigation.BuilderMode
import me.rxresu.core.navigation.CheckTab
import me.rxresu.core.navigation.DesignGroup
import me.rxresu.core.navigation.WriteView
import me.rxresu.core.network.generated.CreateImprovementRequestAction
import me.rxresu.core.page.FakePageRenderer
import me.rxresu.core.page.PageSource
import me.rxresu.core.testing.RrScreenshotTest
import me.rxresu.core.testing.captureScreen
import org.junit.Test

/** Storyboard data: Alex Morgan's "Product designer" resume and the Lumen copy, on the bundled sample page. */
internal object Fixtures {
    private val repositories by lazy { FakeRepositories() }
    val resume by lazy { runBlocking { repositories.resumes.getResume(StoryboardIds.resume) } }
    val lumen by lazy { runBlocking { repositories.resumes.getResume(StoryboardIds.lumenResume) } }
    val lumenApplication by lazy { runBlocking { repositories.applications.getApplication(StoryboardIds.lumen) } }
    /** The fixture names the link param `url`; the check engine sends `value` (packages/resume/src/ats/rules.ts). */
    val checks by lazy {
        val raw = runBlocking { repositories.checks.getResumeChecks(StoryboardIds.resume) }
        raw.copy(findings = raw.findings.map { f -> f.params?.get("url")?.let { f.copy(params = mapOf("value" to it)) } ?: f })
    }
    val page: ImageBitmap by lazy {
        runBlocking {
            val renderer = FakePageRenderer(ApplicationProvider.getApplicationContext())
            renderer.page(renderer.render(PageSource.Resume(StoryboardIds.resume, "1")), 0, 716).asImageBitmap()
        }
    }

    /** The sample page's blocks, measured from the storyboard page (B1): header, sections and entries. */
    val blocks = listOf(
        PageBlock(BlockTarget.Header, 0, 0.067f, 0.04f, 0.65f, 0.15f),
        PageBlock(BlockTarget.Section("summary"), 0, 0.067f, 0.165f, 0.933f, 0.235f),
        PageBlock(BlockTarget.Section("experience"), 0, 0.067f, 0.248f, 0.933f, 0.453f),
        PageBlock(BlockTarget.Item("experience", "experience-northwind"), 0, 0.067f, 0.279f, 0.933f, 0.368f),
        PageBlock(BlockTarget.Item("experience", "experience-harbour"), 0, 0.067f, 0.384f, 0.933f, 0.453f),
    )

    fun state(resume: me.rxresu.core.network.generated.Resume = this.resume, status: SaveStatus = SaveStatus.Saved, page: Boolean = true) =
        BuilderUiState(resume = resume, status = status, pages = if (page) listOf(this.page) else emptyList(), blocks = blocks, checks = checks, canUndo = true)

    /** B8 draws a two-column template with Skills and Languages in the sidebar. */
    val twoColumns by lazy {
        val json = resume.toJson()
            .set(listOf("data", "metadata", "template"), JsonPrimitive("azurill"))
            .set(listOf("data", "metadata", "layout", "sidebarSide"), JsonPrimitive("left"))
            .set(listOf("data", "metadata", "layout", "pages"), JsonArray(listOf(JsonObject(mapOf(
                "fullWidth" to JsonPrimitive(false),
                "main" to JsonArray(listOf("summary", "experience", "education").map(::JsonPrimitive)),
                "sidebar" to JsonArray(listOf("skills", "languages").map(::JsonPrimitive)),
            ))))) as JsonObject
        json.toResume()
    }
}

@Composable
private fun Shell(state: BuilderUiState, mode: BuilderMode, content: @Composable () -> Unit) =
    BuilderScreen(state, mode, {}, {}, {}, {}, {}, {}, {}) { content() }

class BuilderScreenshotTest : RrScreenshotTest() {
    private fun page(dark: Boolean) = captureScreen("B1-Page", dark) {
        val state = Fixtures.state()
        Shell(state, BuilderMode.Write) { WriteMode(state, WriteView.Page, {}, NoBuilderActions, WriteNav()) }
    }

    private fun entry(dark: Boolean) = captureScreen("B2-Entry", dark) {
        val state = Fixtures.state(status = SaveStatus.Saving).copy(highlight = BlockTarget.Item("experience", "experience-northwind"), highlightAboveSheet = true)
        Box(Modifier.fillMaxSize()) {
            Shell(state, BuilderMode.Write) { WriteMode(state, WriteView.Page, {}, NoBuilderActions, WriteNav()) }
            EntrySheet(state, "experience", "experience-northwind", NoBuilderActions, {}, {}, { _, _ -> })
        }
    }

    private fun outline(dark: Boolean) = captureScreen("B3-Outline", dark) {
        val state = Fixtures.state()
        Shell(state, BuilderMode.Write) { WriteMode(state, WriteView.Outline, {}, NoBuilderActions, WriteNav(), initiallyExpanded = "experience") }
    }

    private fun improve(dark: Boolean) = captureScreen("B4-Improve", dark) {
        val line = "Built the design system now used by six product teams; cut interface defects by a third."
        val asked = ImproveRequest(line, CreateImprovementRequestAction.Verb, null, "Work OpenAI", "gpt-5-mini")
        val state = Fixtures.state().copy(improve = ImproveState.Ready(asked, "Created and scaled a design system adopted by six product teams, cutting interface defects by a third.", "", true, emptyList()))
        RichTextScreen(state, "experience", "experience-northwind", "description", NoBuilderActions, {}, {}, initialCaretLine = 1)
    }

    private fun basics(dark: Boolean) = captureScreen("B5-Basics", dark) { BasicsScreen(Fixtures.state(), NoBuilderActions, {}) }

    private fun design(id: String, group: DesignGroup, dark: Boolean, resume: me.rxresu.core.network.generated.Resume = Fixtures.resume) = captureScreen(id, dark) {
        val state = Fixtures.state(resume)
        Shell(state, BuilderMode.Design) { DesignMode(state, group, {}, NoBuilderActions) }
    }

    private fun issues(dark: Boolean) = captureScreen("B9-Issues", dark) {
        val state = Fixtures.state()
        Shell(state, BuilderMode.Check) { CheckMode(state, CheckTab.Issues, {}, NoBuilderActions, {}, {}, {}, {}) }
    }

    private fun jobMatch(dark: Boolean) = captureScreen("B10-JobMatch", dark) {
        fun terms(vararg labels: String) = labels.map { MatchTerm(it.lowercase(), it, 1) }
        val match = MatchState.Ready(
            found = terms("Design systems", "User research", "Prototyping", "Onboarding", "Figma", "Interaction design", "Product strategy", "Accessibility", "HTML and CSS"),
            missing = listOf(MatchTerm("accessibility audits", "Accessibility audits", 3)) + terms("Design tokens", "Workshop facilitation", "Service design", "Journey mapping"),
            pasted = null,
        )
        val state = Fixtures.state(Fixtures.lumen).copy(match = match, application = Fixtures.lumenApplication)
        Shell(state, BuilderMode.Check) { CheckMode(state, CheckTab.JobMatch, {}, NoBuilderActions, {}, {}, {}, {}) }
    }

    @Test fun pageLight() = page(false)
    @Test fun pageDark() = page(true)
    @Test fun entryLight() = entry(false)
    @Test fun entryDark() = entry(true)
    @Test fun outlineLight() = outline(false)
    @Test fun outlineDark() = outline(true)
    @Test fun improveLight() = improve(false)
    @Test fun improveDark() = improve(true)
    @Test fun basicsLight() = basics(false)
    @Test fun basicsDark() = basics(true)
    @Test fun templateLight() = design("B6-Template", DesignGroup.Template, false)
    @Test fun templateDark() = design("B6-Template", DesignGroup.Template, true)
    @Test fun typePageLight() = design("B7-TypePage", DesignGroup.Type, false)
    @Test fun typePageDark() = design("B7-TypePage", DesignGroup.Type, true)
    @Test fun layoutLight() = design("B8-Layout", DesignGroup.Layout, false, Fixtures.twoColumns)
    @Test fun layoutDark() = design("B8-Layout", DesignGroup.Layout, true, Fixtures.twoColumns)
    @Test fun issuesLight() = issues(false)
    @Test fun issuesDark() = issues(true)
    @Test fun jobMatchLight() = jobMatch(false)
    @Test fun jobMatchDark() = jobMatch(true)

    // States beyond the storyboard: offline, couldn't save, locked, loading, empty check, 200% text.
    @Test fun offline() = captureScreen("B1-Page-offline", false) {
        val state = Fixtures.state(status = SaveStatus.Offline)
        Shell(state, BuilderMode.Write) { WriteMode(state, WriteView.Page, {}, NoBuilderActions, WriteNav()) }
    }

    @Test fun notSaved() = captureScreen("B1-Page-not-saved", false) {
        val state = Fixtures.state(status = SaveStatus.CouldntSave)
        Shell(state, BuilderMode.Write) { WriteMode(state, WriteView.Page, {}, NoBuilderActions, WriteNav()) }
    }

    @Test fun locked() = captureScreen("B1-Page-locked", false) {
        val state = Fixtures.state().copy(locked = true)
        Shell(state, BuilderMode.Write) { WriteMode(state, WriteView.Page, {}, NoBuilderActions, WriteNav()) }
    }

    @Test fun loading() = captureScreen("B1-Page-loading", false) { Shell(BuilderUiState(), BuilderMode.Write) {} }

    @Test fun nothingToFix() = captureScreen("B9-Issues-empty", false) {
        val checks = Fixtures.checks.copy(findings = emptyList(), score = 100.0, passedRules = 14.0)
        val state = Fixtures.state().copy(checks = checks)
        Shell(state, BuilderMode.Check) { CheckMode(state, CheckTab.Issues, {}, NoBuilderActions, {}, {}, {}, {}) }
    }

    @Test fun entryFont200() = captureScreen("B2-Entry", false, fontScale = 2f) {
        val state = Fixtures.state()
        Box(Modifier.fillMaxSize()) { EntrySheet(state, "experience", "experience-northwind", NoBuilderActions, {}, {}, { _, _ -> }) }
    }

    // Finished in the follow-up: changed elsewhere, linking and copying for a job, Crop photo, Review writing.
    @Test fun changedElsewhere() = captureScreen("B1-Page-agent", false) {
        val state = Fixtures.state().copy(outsideChange = me.rxresu.core.data.OutsideChange("patch"))
        Shell(state, BuilderMode.Write) { WriteMode(state, WriteView.Page, {}, NoBuilderActions, WriteNav()) }
    }

    @Test fun changedElsewhereDark() = captureScreen("B1-Page-agent", true) {
        val state = Fixtures.state().copy(outsideChange = me.rxresu.core.data.OutsideChange("patch"))
        Shell(state, BuilderMode.Write) { WriteMode(state, WriteView.Page, {}, NoBuilderActions, WriteNav()) }
    }

    private fun lumenMatch(pasted: String? = null) = MatchState.Ready(
        found = listOf("Design systems", "Figma").map { MatchTerm(it.lowercase(), it, 1) },
        missing = listOf(MatchTerm("accessibility audits", "Accessibility audits", 3)),
        pasted = pasted,
    )

    @Test fun jobMatchChange() = captureScreen("B10-JobMatch-change", false) {
        val state = Fixtures.state(Fixtures.lumen).copy(match = lumenMatch(), application = Fixtures.lumenApplication)
        Shell(state, BuilderMode.Check) { CheckMode(state, CheckTab.JobMatch, {}, NoBuilderActions, {}, {}, {}, {}, jobMatchChanging = true) }
    }

    @Test fun jobMatchSaveAsJob() = captureScreen("B10-JobMatch-save-job", false) {
        val state = Fixtures.state().copy(match = lumenMatch(pasted = "Senior product designer at Lumen. Accessibility audits, Figma, design systems."))
        Shell(state, BuilderMode.Check) { CheckMode(state, CheckTab.JobMatch, {}, NoBuilderActions, {}, {}, {}, {}, saveJobOpen = true) }
    }

    @Test fun jobMatchNotLinked() = captureScreen("B10-JobMatch-not-linked", false) {
        val state = Fixtures.state().copy(match = MatchState.NoPosting)
        Shell(state, BuilderMode.Check) { CheckMode(state, CheckTab.JobMatch, {}, NoBuilderActions, {}, {}, {}, {}) }
    }

    @Test fun cropPhoto() = captureScreen("B5-Basics-crop", false) {
        val photo = Fixtures.page.asAndroidBitmap().copy(android.graphics.Bitmap.Config.ARGB_8888, false)
        BasicsScreen(Fixtures.state().copy(crop = PhotoCrop(photo, "photo.png", "image/png")), NoBuilderActions, {})
    }

    @Test fun cropPhotoDark() = captureScreen("B5-Basics-crop", true) {
        val photo = Fixtures.page.asAndroidBitmap().copy(android.graphics.Bitmap.Config.ARGB_8888, false)
        BasicsScreen(Fixtures.state().copy(crop = PhotoCrop(photo, "photo.png", "image/png")), NoBuilderActions, {})
    }

    @Test fun writingReview() = captureScreen("B9-Writing", false) {
        val state = Fixtures.state().copy(aiProvider = AiProvider("p", "Work OpenAI", "gpt-5-mini"))
        Shell(state, BuilderMode.Check) { CheckMode(state, CheckTab.Issues, {}, NoBuilderActions, {}, {}, {}, {}, writingTab = true) }
    }
}
