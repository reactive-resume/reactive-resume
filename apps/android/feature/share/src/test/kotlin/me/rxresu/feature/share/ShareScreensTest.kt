package me.rxresu.feature.share

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.*
import me.rxresu.core.page.*
import me.rxresu.core.network.generated.*
import androidx.compose.ui.graphics.asImageBitmap
import me.rxresu.core.designsystem.*
import me.rxresu.core.navigation.DocumentKind
import me.rxresu.core.testing.*
import org.junit.Test

class ShareScreensTest : RrScreenshotTest() {
    private fun capture(id: String, dark: Boolean, private: Boolean = false, font: Float = 1f) {
        val repositories = FakeRepositories()
        try {
            val state = runBlocking {
                val resume = repositories.resumes.openDraft(StoryboardIds.resume).state.value.document!!
                val pdf = RenderedDocument(PageSource.Resume(resume.id, resume.updatedAt), java.io.File("unused-fixture.pdf"), 1)
                val now = repositories.time.now().atZone(java.time.ZoneId.systemDefault()).toLocalDate()
                fun timestamp(day: java.time.LocalDate, hour: Int, minute: Int) = day.atTime(hour, minute).atZone(java.time.ZoneId.systemDefault()).toInstant().toString()
                val versions = listOf(
                    ResumeVersionSummary(timestamp(now, 18, 2), "editing", GetResumeVersionResponseKind.Auto),
                    ResumeVersionSummary(timestamp(now, 9, 14), "ai", GetResumeVersionResponseKind.Ai),
                    ResumeVersionSummary(timestamp(java.time.LocalDate.of(2026, 11, 3), 14, 20), "sent", GetResumeVersionResponseKind.Sent, "Sent to Lumen"),
                    ResumeVersionSummary(timestamp(java.time.LocalDate.of(2026, 10, 28), 10, 0), "import", GetResumeVersionResponseKind.Import),
                )
                ShareState(thumbnail = repositories.pages.page(pdf, 0, 144).asImageBitmap(), draft = DraftState(resume.copy(isPublic = !private, showDownloadButtons = true, allowWordDownload = false)), loading = false, primaryLoaded = true, username = "alex", origin = "https://rxresu.me", aliasUrl = "https://rx.cv", slug = resume.slug,
                    daily = repositories.resumes.getResumeDailyStatistics(resume.id, 30), links = repositories.resumes.listFeedbackLinks(resume.id), versions = versions)
            }
            captureScreen(id, dark, fontScale = font, wrap = { content -> CompositionLocalProvider(LocalRepositories provides repositories) { content() } }) {
                when (id) {
                    "B12-Password" -> PasswordScreen(state, {}, {})
                    "B19-Notes" -> PrivateNotesScreen("Follow up after the portfolio review.", false, false, {}, {})
                    "B12-WebPage" -> WebPageScreen(state, {}, {}, {}, { _, _ -> }, {}, {}, {})
                    "B13-Visitors" -> VisitorsScreen(state, {}, {}, {}, {})
                    "L2-LetterExport" -> DownloadSheet(ExportState(name = "Alex Morgan Cover Letter", paired = true, format = FileFormat.Pair), DocumentKind.Letter, {}, {}, {}, {}, {})
                    "L2-LetterOnlyExport" -> DownloadSheet(ExportState(name = "Alex Morgan Cover Letter", paired = true), DocumentKind.Letter, {}, {}, {}, {}, {})
                    "B14-Download" -> { RrTopBar(onBack = {}); DownloadSheet(ExportState(name = "Alex Morgan Resume"), DocumentKind.Resume, {}, {}, {}, {}, {}) }
                    "B15-Versions" -> VersionsScreen(state, null, {}, {}, {}, {}, {})
                    "B19-More" -> {
                        val locked = state.copy(draft = DraftState(state.resume!!.copy(isLocked = true, createdAt = "2026-10-28T10:00:00Z", updatedAt = repositories.time.now().minusSeconds(12 * 60).toString(), tags = listOf("Design"), data = state.resume!!.data.copy(metadata = state.resume!!.data.metadata.copy(page = state.resume!!.data.metadata.page.copy(locale = "en-GB")))), locked = true))
                        Column { RrTopBar(onBack = {}); RrPageTitle("Product designer", subtitle = "Locked · 1 page · Public") }
                        RrBottomSheet({}, fixedHeight = 790.dp, title = "Product designer") { MoreContent(locked) {} }
                    }
                    else -> Column(Modifier.fillMaxSize()) {
                        RrTopBar(onBack = {}) {
                            RrIconButton(me.rxresu.core.designsystem.R.drawable.ic_ph_sparkle, "Assistant", {}, tint = RrTheme.colors.accentText)
                            RrIconButton(me.rxresu.core.designsystem.R.drawable.ic_ph_dots_three, "More", {})
                        }
                        Box(Modifier.weight(1f)) { ShareContent(state) {} }
                        RrModeBar(rrBuilderModes("Edit", "Design", "Check", "Share", checkWarn = true), 3, {})
                    }
                }
            }
        } finally { repositories.close() }
    }
    @Test fun shareLight() = capture("B11-Share", false)
    @Test fun shareDark() = capture("B11-Share", true)
    @Test fun webLight() = capture("B12-WebPage", false)
    @Test fun webDark() = capture("B12-WebPage", true)
    @Test fun visitorsLight() = capture("B13-Visitors", false)
    @Test fun visitorsDark() = capture("B13-Visitors", true)
    @Test fun downloadLight() = capture("B14-Download", false)
    @Test fun downloadDark() = capture("B14-Download", true)
    @Test fun versionsLight() = capture("B15-Versions", false)
    @Test fun versionsDark() = capture("B15-Versions", true)
    @Test fun moreLight() = capture("B19-More", false)
    @Test fun moreDark() = capture("B19-More", true)
    @Test fun letterExportLight() = capture("L2-LetterExport", false)
    @Test fun letterExportDark() = capture("L2-LetterExport", true)
    @Test fun letterOnlyExportLight() = capture("L2-LetterOnlyExport", false)
    @Test fun letterOnlyExportDark() = capture("L2-LetterOnlyExport", true)
    @Test fun passwordLight() = capture("B12-Password", false)
    @Test fun passwordDark() = capture("B12-Password", true)
    @Test fun notesLight() = capture("B19-Notes", false)
    @Test fun notesDark() = capture("B19-Notes", true)
    @Test fun privateShare() = capture("B11-Private", false, private = true)
    @Test fun largeShare() = capture("B11-Share", false, font = 2f)
}
