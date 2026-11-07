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
    private fun capture(id: String, dark: Boolean, draw: @Composable (RrRepositories) -> Unit) {
        val fakes = FakeRepositories(pageRenderer = FakePageRenderer(ApplicationProvider.getApplicationContext<Context>()))
        try { captureScreen(id, dark, wrap = { c -> CompositionLocalProvider(LocalRepositories provides fakes) { c() } }) { draw(fakes) } } finally { fakes.close() }
    }
    private fun public(dark: Boolean) {
        val renderer = FakePageRenderer(ApplicationProvider.getApplicationContext<Context>())
        val fakes = FakeRepositories(pageRenderer = renderer)
        val state = runBlocking {
            fakes.resumes.updateResume(StoryboardIds.resume, UpdateResumeRequest(showDownloadButtons = true))
            val url = "https://example.invalid/alex/product-designer"
            PublicState(loading = false, address = publicAddress(url), resume = fakes.publicResume.getResumeBySlug("alex", "product-designer"), document = fakes.pages.render(PageSource.Public(url)))
        }
        val bitmap = runBlocking { renderer.page(requireNotNull(state.document), 0, 1080) }
        val readyRenderer = object : me.rxresu.core.page.PageRenderer by renderer {
            override suspend fun page(document: me.rxresu.core.page.RenderedDocument, index: Int, widthPx: Int) = bitmap
        }
        try { captureScreen("P1-Public", dark, wrap = { c -> CompositionLocalProvider(LocalRepositories provides fakes) { c() } }) {
            PublicScreen(state, "rxresu.me/alex/product-designer", readyRenderer, {}, {}, {}, {}, {}, {}, {}, {}, {})
        } } finally { fakes.close() }
    }
    private fun ats(dark: Boolean) = capture("P2-ATS", dark) { fakes ->
        val sample = runBlocking { fakes.checks.createPdfCheck(UploadPart("file", byteArrayOf(), "my-cv-final.pdf", "application/pdf")) }
        val result = sample.copy(score = 64.0, fullText = "ALEX MORGAN Senior product\ndesigner Lisbon alex@morgan\nNorthwind Labs 2022 Present\nLed the redesign of onboard-\ning lifting activation from…", file = sample.file.copy(name = "my-cv-final.pdf", sizeBytes = 1_900_000.0), findings = listOf(
            CreatePdfCheckResponseTipsItem(CreatePdfCheckResponseChecksItemCategory.Layout, CreatePdfCheckResponseCappedByItem.MULTICOLUMNLAYOUT, severity = CreatePdfCheckResponseChecksItemSeverity.Warning),
            CreatePdfCheckResponseTipsItem(CreatePdfCheckResponseChecksItemCategory.Parseability, CreatePdfCheckResponseCappedByItem.FILETOOLARGE, severity = CreatePdfCheckResponseChecksItemSeverity.Warning)
        ))
        AtsScreen(AtsState(result = result), fakes.pages, null, {}, {}, {}, {}, {}, {}, {}, {})
    }
    @Test fun publicLight() = public(false)
    @Test fun publicDark() = public(true)
    @Test fun atsLight() = ats(false)
    @Test fun atsDark() = ats(true)
    @Test fun passwordLight() = capture("P1-Public-password", false) { fakes -> PublicScreen(PublicState(loading = false, problem = PublicProblem.Password), "https://example.invalid/alex/design", fakes.pages, {}, {}, {}, {}, {}, {}, {}, {}, {}) }
    @Test fun passwordDark() = capture("P1-Public-password", true) { fakes -> PublicScreen(PublicState(loading = false, problem = PublicProblem.WrongPassword, password = "wrong"), "https://example.invalid/alex/design", fakes.pages, {}, {}, {}, {}, {}, {}, {}, {}, {}) }
    @Test fun signedOutAts() = capture("P2-ATS-signed-out", false) { fakes -> AtsScreen(AtsState(), fakes.pages, null, {}, {}, {}, {}, {}, {}, {}, {}) }
    @Test fun signedOutAtsDark() = capture("P2-ATS-signed-out", true) { fakes -> AtsScreen(AtsState(), fakes.pages, null, {}, {}, {}, {}, {}, {}, {}, {}) }
}
