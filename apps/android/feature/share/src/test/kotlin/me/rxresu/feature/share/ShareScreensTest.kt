package me.rxresu.feature.share

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.*
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
                ShareState(draft = DraftState(resume.copy(isPublic = !private)), loading = false, username = "alex", origin = "https://rxresu.me", slug = resume.slug,
                    daily = repositories.resumes.getResumeDailyStatistics(resume.id, 30), links = repositories.resumes.listFeedbackLinks(resume.id), versions = repositories.resumes.listResumeVersions(resume.id))
            }
            captureScreen(id, dark, fontScale = font, wrap = { content -> CompositionLocalProvider(LocalRepositories provides repositories) { content() } }) {
                when (id) {
                    "B12-WebPage" -> WebPageScreen(state, {}, {}, {}, { _, _ -> }, {}, {}, {})
                    "B13-Visitors" -> VisitorsScreen(state, {}, {}, {}, {})
                    "B14-Download" -> RrBottomSheet({}, title = "Download", initialDetent = 1, footer = { Row(Modifier.padding(RrSpace.s4)) { RrButton("Save to Files", {}, Modifier.weight(1f), variant = RrButtonVariant.Secondary, size = RrButtonSize.Large); RrButton("Share", {}, Modifier.weight(1f), size = RrButtonSize.Large) } }) { DownloadContent(ExportState(name = "Alex Morgan Resume"), DocumentKind.Resume, {}, {}) }
                    "B15-Versions" -> VersionsScreen(state, state.versions.firstOrNull()?.id, {}, {}, {}, {}, {})
                    "B18-More" -> { Column { RrTopBar("Product designer", onBack = {}); RrStrip("This resume is locked. Unlock it from its menu to edit.") }; RrBottomSheet({}, detents = listOf(0.82f)) { MoreContent(state.copy(draft = DraftState(state.resume!!.copy(isLocked = true), locked = true))) {} } }
                    else -> Column(Modifier.fillMaxSize()) {
                        RrTopBar("Product designer", onBack = {}, status = { RrText("Saved") })
                        Box(Modifier.weight(1f)) { ShareContent(state) {} }
                        RrModeBar(rrBuilderModes("Write", "Design", "Check", "Share", checkWarn = true), 3, {})
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
    @Test fun moreLight() = capture("B18-More", false)
    @Test fun moreDark() = capture("B18-More", true)
    @Test fun privateShare() = capture("B11-Private", false, private = true)
    @Test fun largeShare() = capture("B11-Share", false, font = 2f)
}
