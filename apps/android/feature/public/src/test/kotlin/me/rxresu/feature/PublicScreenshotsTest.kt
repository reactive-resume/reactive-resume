package me.rxresu.feature.publiclink

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.*
import me.rxresu.core.network.UploadPart
import me.rxresu.core.network.generated.*
import me.rxresu.core.page.PageSource
import me.rxresu.core.page.FakePageRenderer
import androidx.test.core.app.ApplicationProvider
import android.content.Context
import me.rxresu.core.testing.*
import org.junit.Test

class PublicScreenshotsTest : RrScreenshotTest() {
    private var screenshotScale = 1f
    private var rtl = false
    private fun capture(id: String, dark: Boolean, draw: @Composable (RrRepositories) -> Unit) {
        val fakes = FakeRepositories(pageRenderer = FakePageRenderer(ApplicationProvider.getApplicationContext<Context>()))
        try { captureScreen(if (rtl) "$id-rtl" else id, dark, fontScale = screenshotScale, wrap = { c -> CompositionLocalProvider(androidx.compose.ui.platform.LocalLayoutDirection provides if (rtl) androidx.compose.ui.unit.LayoutDirection.Rtl else androidx.compose.ui.unit.LayoutDirection.Ltr, LocalRepositories provides fakes) { c() } }) { draw(fakes) } } finally { fakes.close() }
    }
    private fun public(dark: Boolean) {
        val renderer = FakePageRenderer(ApplicationProvider.getApplicationContext<Context>())
        val fakes = FakeRepositories(pageRenderer = renderer)
        val state = runBlocking {
            fakes.resumes.updateResume(StoryboardIds.resume, UpdateResumeRequest(showDownloadButtons = true))
            val url = "https://example.invalid/alex/product-designer"
            PublicState(loading = false, address = publicAddress(url), resume = fakes.publicResume.getResumeBySlug("alex", "product-designer"), document = fakes.pages.render(PageSource.Public(url)))
        }
        val bitmap = runBlocking { renderer.page(requireNotNull(state.document), 0, 716) }
        val readyRenderer = object : me.rxresu.core.page.PageRenderer by renderer {
            override suspend fun page(document: me.rxresu.core.page.RenderedDocument, index: Int, widthPx: Int) = bitmap
        }
        try { captureScreen(if (rtl) "P1-Public-rtl" else "P1-Public", dark, fontScale = screenshotScale, wrap = { c -> CompositionLocalProvider(androidx.compose.ui.platform.LocalLayoutDirection provides if (rtl) androidx.compose.ui.unit.LayoutDirection.Rtl else androidx.compose.ui.unit.LayoutDirection.Ltr, LocalRepositories provides fakes) { c() } }) {
            PublicScreen(state, "rx.cv/alex", readyRenderer, {}, {}, {}, {}, {}, {}, {}, {}, {})
        } } finally { fakes.close() }
    }
    private fun ats(dark: Boolean) = capture("P2-ATS-result", dark) { fakes ->
        val sample = runBlocking { fakes.checks.createPdfCheck(UploadPart("file", byteArrayOf(), "my-cv-final.pdf", "application/pdf")) }
        val result = sample.copy(score = 64.0, fullText = "ALEX MORGAN Senior product\ndesigner Lisbon alex@morgan\nNorthwind Labs 2022 Present\nLed the redesign of onboard-\ning lifting activation from…", file = sample.file.copy(name = "my-cv-final.pdf", sizeBytes = 1_900_000.0), findings = listOf(
            CreatePdfCheckResponseTipsItem(CreatePdfCheckResponseChecksItemCategory.Layout, CreatePdfCheckResponseCappedByItem.MULTICOLUMNLAYOUT, severity = CreatePdfCheckResponseChecksItemSeverity.Warning),
            CreatePdfCheckResponseTipsItem(CreatePdfCheckResponseChecksItemCategory.Parseability, CreatePdfCheckResponseCappedByItem.FILETOOLARGE, severity = CreatePdfCheckResponseChecksItemSeverity.Warning)
        ))
        AtsScreen(AtsState(result = result), fakes.pages, null, {}, {}, {}, {}, {}, {}, {}, {})
    }
    @Test fun publicLight() = public(false)
    @Test fun publicDark() = public(true)
    @Test fun atsLight() = capture("P2-ATS", false) { fakes -> AtsScreen(AtsState(), fakes.pages, null, {}, {}, {}, {}, {}, {}, {}, {}) }
    @Test fun resultLight() = ats(false)
    @Test fun atsDark() = capture("P2-ATS", true) { fakes -> AtsScreen(AtsState(), fakes.pages, null, {}, {}, {}, {}, {}, {}, {}, {}) }
    @Test fun resultDark() = ats(true)
    @Test fun passwordLight() = capture("P1-Public-password", false) { fakes -> PublicScreen(PublicState(loading = false, problem = PublicProblem.Password), "https://example.invalid/alex/design", fakes.pages, {}, {}, {}, {}, {}, {}, {}, {}, {}) }
    @Test fun passwordDark() = capture("P1-Public-password", true) { fakes -> PublicScreen(PublicState(loading = false, problem = PublicProblem.WrongPassword, password = "wrong"), "https://example.invalid/alex/design", fakes.pages, {}, {}, {}, {}, {}, {}, {}, {}, {}) }
    @Test fun signedOutAts() = capture("P2-ATS-signed-out", false) { fakes -> AtsScreen(AtsState(), fakes.pages, null, {}, {}, {}, {}, {}, {}, {}, {}) }
    @Test fun signedOutAtsDark() = capture("P2-ATS-signed-out", true) { fakes -> AtsScreen(AtsState(), fakes.pages, null, {}, {}, {}, {}, {}, {}, {}, {}) }
    @Test fun publicFont200() { screenshotScale = 2f; public(false) }
    @Test fun publicRtl() { rtl = true; public(false) }
    @Test fun atsFont200() { screenshotScale = 2f; capture("P2-ATS", false) { fakes -> AtsScreen(AtsState(), fakes.pages, null, {}, {}, {}, {}, {}, {}, {}, {}) } }
    @Test fun atsRtl() { rtl = true; capture("P2-ATS", false) { fakes -> AtsScreen(AtsState(), fakes.pages, null, {}, {}, {}, {}, {}, {}, {}, {}) } }

}
