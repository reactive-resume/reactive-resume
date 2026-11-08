package me.rxresu.feature.builder

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.database.SaveStatus
import me.rxresu.core.navigation.BuilderMode
import me.rxresu.core.navigation.CheckTab
import me.rxresu.core.network.generated.CreateImprovementRequestAction
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
        raw.copy(passedRules = 4.0, findings = raw.findings.map { f -> f.params?.get("url")?.let { f.copy(params = mapOf("value" to it)) } ?: f })
    }
    val page: ImageBitmap by lazy { me.rxresu.core.page.StoryboardPageImages.bitmap(me.rxresu.core.page.StoryboardImage.ResumeOverview, 340).asImageBitmap() }
    val designPage: ImageBitmap by lazy { me.rxresu.core.page.StoryboardPageImages.bitmap(me.rxresu.core.page.StoryboardImage.ResumeDesign, 300).asImageBitmap() }
    val templatePage: ImageBitmap by lazy { me.rxresu.core.page.StoryboardPageImages.bitmap(me.rxresu.core.page.StoryboardImage.TemplateOnyx, 360).asImageBitmap() }
    val photo: ImageBitmap by lazy { me.rxresu.core.page.StoryboardPageImages.bitmap(me.rxresu.core.page.StoryboardImage.Photo, 128).asImageBitmap() }

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
    private fun overview(dark: Boolean) = captureScreen("B1-Overview", dark) {
        val state = Fixtures.state()
        Shell(state, BuilderMode.Write) { OverviewScreen(state, NoBuilderActions, WriteNav(), {}, {}) }
    }
    private fun section(dark: Boolean) = captureScreen("B2-Section", dark) { SectionScreen(Fixtures.state(), "experience", NoBuilderActions, {}, {}, {}, {}) }
    private fun entry(dark: Boolean) = captureScreen("B3-Entry", dark) { EntryScreen(Fixtures.state(), "experience", "experience-northwind", NoBuilderActions, {}, {}, { _, _ -> }, {}) }
    private fun improve(dark: Boolean) = captureScreen("B4-Improve", dark) {
        val line = "Built the design system now used by six product teams; cut interface defects by a third."
        val asked = ImproveRequest(line, CreateImprovementRequestAction.Verb, null, "Work OpenAI", "gpt-5-mini")
        val resume = Fixtures.resume.toJson().set(listOf("data", "sections", "experience", "items", "0", "description"), JsonPrimitive("<ul><li>Led the redesign of onboarding, lifting activation from 41% to 58% in two quarters.</li><li>Built the design system now used by six product teams; cut interface defects by a third.</li><li>Ran 40+ customer interviews a year.</li></ul>")) as JsonObject
        val state = Fixtures.state(resume.toResume()).copy(improve = ImproveState.Ready(asked, "Created and scaled the design system adopted by six product teams, cutting interface defects by a third.", "", true, emptyList()))
        RichTextScreen(state, "experience", "experience-northwind", "description", NoBuilderActions, {}, {}, initialCaretLine = 1)
    }
    private fun basics(dark: Boolean) = captureScreen("B5-Basics", dark) {
        val fields = Fixtures.resume.toJson().at(listOf("data", "basics", "customFields")).arr()
        val resume = Fixtures.resume.toJson().set(listOf("data", "basics", "customFields"), JsonArray(fields.take(1))) as JsonObject
        BasicsScreen(Fixtures.state(resume.toResume()), NoBuilderActions, {}, photo = Fixtures.photo)
    }
    private fun design(dark: Boolean) = captureScreen("B6-Design", dark) {
        val state = Fixtures.state().copy(pages = listOf(Fixtures.designPage))
        Shell(state, BuilderMode.Design) { DesignOverview(state, NoBuilderActions, {}, {}) }
    }
    private fun template(dark: Boolean) = captureScreen("B7-Template", dark) { DesignPickerScreen(Fixtures.state().copy(pages = listOf(Fixtures.templatePage)), me.rxresu.core.navigation.DesignPicker.Template, NoBuilderActions, {}) }
    private fun layout(dark: Boolean) = captureScreen("B8-Layout", dark) { DesignPickerScreen(Fixtures.state(), me.rxresu.core.navigation.DesignPicker.Layout, NoBuilderActions, {}) }
    private fun issues(dark: Boolean) = captureScreen("B9-Check", dark) {
        val state = Fixtures.state()
        Shell(state, BuilderMode.Check) { CheckMode(state, CheckTab.Issues, {}, NoBuilderActions, {}, {}, {}, {}) }
    }
    private fun jobMatch(dark: Boolean) = captureScreen("B10-JobMatch", dark) {
        fun terms(vararg labels: String) = labels.map { MatchTerm(it.lowercase(), it, 1) }
        val match = MatchState.Ready(
            found = emptyList(), matched = 9, total = 14,
            missing = listOf(MatchTerm("accessibility audits", "Accessibility audits", 3)) + terms("Design tokens", "Workshop facilitation"), pasted = null)
        val state = Fixtures.state(Fixtures.lumen).copy(match = match, application = Fixtures.lumenApplication)
        Shell(state, BuilderMode.Check) { CheckMode(state, CheckTab.JobMatch, {}, NoBuilderActions, {}, {}, {}, {}) }
    }
    @Test fun overviewLight() = overview(false)
    @Test fun overviewDark() = overview(true)
    private fun overviewMiddle(dark: Boolean) = captureScreen("B1-Overview-middle", dark) {
        val state = Fixtures.state()
        val scroll = androidx.compose.foundation.rememberScrollState(700)
        Shell(state, BuilderMode.Write) { OverviewScreen(state, NoBuilderActions, WriteNav(), {}, {}, scrollState = scroll) }
    }
    @Test fun overviewMiddleLight() = overviewMiddle(false)
    @Test fun overviewMiddleDark() = overviewMiddle(true)
    @Test fun sectionLight() = section(false)
    @Test fun sectionDark() = section(true)
    @Test fun entryLight() = entry(false)
    @Test fun entryDark() = entry(true)
    @Test fun improveLight() = improve(false)
    @Test fun improveDark() = improve(true)
    @Test fun basicsLight() = basics(false)
    @Test fun basicsDark() = basics(true)
    @Test fun designLight() = design(false)
    @Test fun designDark() = design(true)
    @Test fun templateLight() = template(false)
    @Test fun templateDark() = template(true)
    @Test fun layoutLight() = layout(false)
    @Test fun layoutDark() = layout(true)
    @Test fun issuesLight() = issues(false)
    @Test fun issuesDark() = issues(true)
    @Test fun jobMatchLight() = jobMatch(false)
    @Test fun jobMatchDark() = jobMatch(true)

    @Test fun typographyLight() = captureScreen("B6-Typography", false) { DesignPickerScreen(Fixtures.state(), me.rxresu.core.navigation.DesignPicker.Typography, NoBuilderActions, {}) }
    @Test fun typographyDark() = captureScreen("B6-Typography", true) { DesignPickerScreen(Fixtures.state(), me.rxresu.core.navigation.DesignPicker.Typography, NoBuilderActions, {}) }
    @Test fun paperLight() = captureScreen("B6-Page", false) { DesignPickerScreen(Fixtures.state(), me.rxresu.core.navigation.DesignPicker.Page, NoBuilderActions, {}) }
    @Test fun paperDark() = captureScreen("B6-Page", true) { DesignPickerScreen(Fixtures.state(), me.rxresu.core.navigation.DesignPicker.Page, NoBuilderActions, {}) }
    @Test fun summaryDark() = captureScreen("B4-Summary", true) { RichTextScreen(Fixtures.state(), "summary", "summary", "content", NoBuilderActions, {}, {}) }
    @Test fun summary() = captureScreen("B4-Summary", false) { RichTextScreen(Fixtures.state(), "summary", "summary", "content", NoBuilderActions, {}, {}) }
    @Test fun allSectionForms() {
        SectionKind.entries.filter { it != SectionKind.Summary }.forEach { kind ->
            val base = ResumeDoc(Fixtures.resume.toJson())
            val ref = base.section(kind.key)!!
            val item = base.items(ref).firstOrNull() ?: kind.newItem("entry-${kind.key}")
            val resume = base.json.set(ref.path + "items", JsonArray(listOf(item))) as JsonObject
            listOf(false, true).forEach { dark -> captureScreen("B3-${kind.englishTitle}", dark) { EntryScreen(Fixtures.state(resume.toResume()), kind.key, item["id"].str(), NoBuilderActions, {}, {}, { _, _ -> }, {}) } }
        }
    }
    @Test fun overviewRtl() = captureScreen("B1-Overview-rtl", false) {
        androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalLayoutDirection provides androidx.compose.ui.unit.LayoutDirection.Rtl) {
            val state = Fixtures.state(); Shell(state, BuilderMode.Write) { OverviewScreen(state, NoBuilderActions, WriteNav(), {}, {}) }
        }
    }
    @Test fun entryFont200() = captureScreen("B3-Entry", false, fontScale = 2f) { EntryScreen(Fixtures.state(), "experience", "experience-northwind", NoBuilderActions, {}, {}, { _, _ -> }, {}) }
    @Test fun offline() = captureScreen("B1-Overview-offline", false) { val state = Fixtures.state(status = SaveStatus.Offline); Shell(state, BuilderMode.Write) { OverviewScreen(state, NoBuilderActions, WriteNav(), {}, {}) } }
    @Test fun notSaved() = captureScreen("B1-Overview-not-saved", false) { val state = Fixtures.state(status = SaveStatus.CouldntSave); Shell(state, BuilderMode.Write) { OverviewScreen(state, NoBuilderActions, WriteNav(), {}, {}) } }
    @Test fun locked() = captureScreen("B1-Overview-locked", false) { val state = Fixtures.state().copy(locked = true); Shell(state, BuilderMode.Write) { OverviewScreen(state, NoBuilderActions, WriteNav(), {}, {}) } }
    @Test fun loading() = captureScreen("B1-Overview-loading", false) { Shell(BuilderUiState(), BuilderMode.Write) {} }
    @Test fun nothingToFix() = captureScreen("B9-Check-empty", false) { val state = Fixtures.state().copy(checks = Fixtures.checks.copy(findings = emptyList(), score = 100.0, passedRules = 14.0)); Shell(state, BuilderMode.Check) { CheckMode(state, CheckTab.Issues, {}, NoBuilderActions, {}, {}, {}, {}) } }
    @Test fun changedElsewhere() = captureScreen("B1-Overview-agent", false) { val state = Fixtures.state().copy(outsideChange = me.rxresu.core.data.OutsideChange("patch")); Shell(state, BuilderMode.Write) { OverviewScreen(state, NoBuilderActions, WriteNav(), {}, {}) } }
    @Test fun cropPhoto() = captureScreen("B5-Basics-crop", false) { BasicsScreen(Fixtures.state().copy(crop = PhotoCrop(Fixtures.photo.asAndroidBitmap(), "photo.png", "image/png")), NoBuilderActions, {}) }
    @Test fun writingReview() = captureScreen("B9-Writing", false) { val state = Fixtures.state().copy(aiProvider = AiProvider("p", "Work OpenAI", "gpt-5-mini", "1")); Shell(state, BuilderMode.Check) { CheckMode(state, CheckTab.Issues, {}, NoBuilderActions, {}, {}, {}, {}, writingTab = true) } }
    private fun lumenMatch(pasted: String? = null) = MatchState.Ready(found = listOf(MatchTerm("figma", "Figma", 1)), missing = listOf(MatchTerm("accessibility audits", "Accessibility audits", 3)), pasted = pasted)
    @Test fun jobMatchChange() = captureScreen("B10-JobMatch-change", false) {
        val state = Fixtures.state(Fixtures.lumen).copy(match = lumenMatch(), application = Fixtures.lumenApplication)
        Shell(state, BuilderMode.Check) { CheckMode(state, CheckTab.JobMatch, {}, NoBuilderActions, {}, {}, {}, {}, jobMatchChanging = true) }
    }
    @Test fun jobMatchSaveAsJob() = captureScreen("B10-JobMatch-save-job", false) {
        val state = Fixtures.state().copy(match = lumenMatch("Senior product designer at Lumen. Accessibility audits, Figma, design systems."))
        Shell(state, BuilderMode.Check) { CheckMode(state, CheckTab.JobMatch, {}, NoBuilderActions, {}, {}, {}, {}, saveJobOpen = true) }
    }
    @Test fun jobMatchNotLinked() = captureScreen("B10-JobMatch-not-linked", false) {
        val state = Fixtures.state().copy(match = MatchState.NoPosting)
        Shell(state, BuilderMode.Check) { CheckMode(state, CheckTab.JobMatch, {}, NoBuilderActions, {}, {}, {}, {}) }
    }
    @Test fun changedElsewhereDark() = captureScreen("B1-Overview-agent", true) {
        val state = Fixtures.state().copy(outsideChange = me.rxresu.core.data.OutsideChange("patch"))
        Shell(state, BuilderMode.Write) { OverviewScreen(state, NoBuilderActions, WriteNav(), {}, {}) }
    }
    @Test fun cropPhotoDark() = captureScreen("B5-Basics-crop", true) { BasicsScreen(Fixtures.state().copy(crop = PhotoCrop(Fixtures.photo.asAndroidBitmap(), "photo.png", "image/png")), NoBuilderActions, {}) }
    @Test fun advanced() = captureScreen("B6-Advanced", false) { DesignPickerScreen(Fixtures.state(), me.rxresu.core.navigation.DesignPicker.Advanced, NoBuilderActions, {}) }
    @Test fun photoDesign() = captureScreen("B6-Photo", false) { DesignPickerScreen(Fixtures.state(), me.rxresu.core.navigation.DesignPicker.Photo, NoBuilderActions, {}) }
    @Test fun entryDesign() = captureScreen("B6-Entries", false) { DesignPickerScreen(Fixtures.state(), me.rxresu.core.navigation.DesignPicker.Entries, NoBuilderActions, {}) }
    @Test fun advancedDark() = captureScreen("B6-Advanced", true) { DesignPickerScreen(Fixtures.state(), me.rxresu.core.navigation.DesignPicker.Advanced, NoBuilderActions, {}) }
    @Test fun photoDesignDark() = captureScreen("B6-Photo", true) { DesignPickerScreen(Fixtures.state(), me.rxresu.core.navigation.DesignPicker.Photo, NoBuilderActions, {}) }
    @Test fun entryDesignDark() = captureScreen("B6-Entries", true) { DesignPickerScreen(Fixtures.state(), me.rxresu.core.navigation.DesignPicker.Entries, NoBuilderActions, {}) }


}
