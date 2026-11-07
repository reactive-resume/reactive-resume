package me.rxresu.feature.publiclink

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import kotlinx.coroutines.flow.first
import me.rxresu.core.page.FakePageRenderer
import kotlinx.serialization.json.*
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.*
import me.rxresu.core.network.*
import me.rxresu.core.network.generated.*
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class PublicModelsTest {
    private val context get() = ApplicationProvider.getApplicationContext<android.app.Application>()
    @Before fun setup() { Dispatchers.setMain(StandardTestDispatcher()) }
    @After fun cleanup() { Dispatchers.resetMain() }
    @Test fun markersUseOneBasedPagesAndTopLeftPdfPoints() {
        val finding = CreatePdfCheckResponseTipsItem(CreatePdfCheckResponseChecksItemCategory.Layout, CreatePdfCheckResponseCappedByItem.MULTICOLUMNLAYOUT,
            evidence = CreatePdfCheckResponseChecksItemFindingsItemEvidence(CreatePdfCheckResponseChecksItemFindingsItemEvidenceBox(20.0, 40.0, 150.0, 200.0), 2.0), severity = CreatePdfCheckResponseChecksItemSeverity.Warning)
        assertTrue(pdfMarkers(listOf(finding), 0, 600, 800).isEmpty())
        assertEquals(listOf(PdfMarker(1, .25f, .25f)), pdfMarkers(listOf(finding), 1, 600, 800))
        assertTrue(pdfMarkers(listOf(finding), 1, 0, 800).isEmpty())
    }
    @Test fun canonicalUrlsPreserveOriginAndRejectCredentialsOrAppSections() {
        assertEquals("https://self.example", publicAddress("https://self.example/alex/design?tracking=yes")?.origin)
        assertEquals("token", publicAddress("https://self.example/feedback/token")?.feedbackToken)
        assertNull(publicAddress("https://user:secret@self.example/alex/design"))
        assertNull(publicAddress("http://self.example/alex/design"))
        assertNull(publicAddress("https://self.example/auth/native-callback"))
        assertNull(publicAddress("https://self.example/a/b/c"))
    }
    @Test fun aliasResolutionHasNoAccountCredentialsAndUsesCanonicalDestination() = runTest {
        val requests = mutableListOf<okhttp3.Request>()
        val client = OkHttpClient.Builder().followRedirects(false).addInterceptor { chain ->
            val request = chain.request(); requests += request
            if (request.url.host == "rx.cv") Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(302).message("Found").header("Location", "https://self.example/alex/design").body("".toResponseBody()).build()
            else Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK").body("<html></html>".toResponseBody()).build()
        }.build()
        val result = resolvePublicAddress("https://rx.cv/alex", client)
        assertEquals("https://self.example/alex/design", result.url)
        assertTrue(requests.all { it.header("Authorization") == null && it.header("Cookie") == null })
    }
    @Test fun publicResumeLoadsSignedOutAndDoesNotPretendOwner() = runTest {
        val session = FakeAuthSession()
        val repositories = FakeRepositories(authSession = session, pageRenderer = FakePageRenderer(context), coroutineScope = backgroundScope)
        repositories.resumes.updateResume(StoryboardIds.resume, UpdateResumeRequest(showDownloadButtons = true))
        session.state.value = SessionState.SignedOut
        val model = PublicViewModel(repositories, "https://example.invalid/alex/product-designer"); advanceUntilIdle(); model.state.first { !it.loading }
        assertNotNull(model.state.value.resume); assertFalse(model.state.value.owner); assertNotNull(model.state.value.document)
        repositories.close()
    }
    @Test fun wrongPasswordStaysInlineAndKeepsInput() = runTest {
        val controls = FakeControls()
        controls.set("getResumeBySlug", FakeMode.Error(ApiException(401, "NEED_PASSWORD", "Password required")))
        controls.responses.value = mapOf("verifyResumePassword" to JsonPrimitive(false))
        val repositories = FakeRepositories(controls, coroutineScope = backgroundScope)
        val model = PublicViewModel(repositories, "https://example.invalid/alex/product-designer"); advanceUntilIdle(); model.state.first { !it.loading }
        assertEquals(PublicProblem.Password, model.state.value.problem)
        model.password("wrong"); model.load(); advanceUntilIdle()
        assertEquals(PublicProblem.WrongPassword, model.state.value.problem); assertEquals("wrong", model.state.value.password)
        assertNull(model.state.value.document); repositories.close()
    }
    @Test fun disabledDownloadsNeverRequestPdf() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        repositories.resumes.updateResume(StoryboardIds.resume, UpdateResumeRequest(showDownloadButtons = false))
        val model = PublicViewModel(repositories, "https://example.invalid/alex/product-designer"); advanceUntilIdle(); model.state.first { !it.loading }
        assertEquals(PublicProblem.PreviewUnavailable, model.state.value.problem); assertNull(model.state.value.document); repositories.close()
    }
    @Test fun selectingPdfNeverUploadsUntilCheckAndSignedOutCheckWorks() = runTest {
        val controls = FakeControls(); controls.set("createPdfCheck", FakeMode.Error(ApiException(500, "FAIL", "failed")))
        val session = FakeAuthSession().apply { state.value = SessionState.SignedOut }
        val repositories = FakeRepositories(controls, authSession = session, coroutineScope = backgroundScope)
        val selected = SelectedPdf("content://sample/file", "resume.pdf", "%PDF-1.7".toByteArray(), File.createTempFile("sample", ".pdf", context.cacheDir))
        val model = AtsViewModel(context, repositories) { selected }; model.posting("Design systems"); model.choose(selected.uri); advanceUntilIdle()
        assertNotNull(model.state.value.selected); assertNull(model.state.value.problem); assertNull(model.state.value.result)
        model.check(); advanceUntilIdle()
        assertEquals(PdfProblem.Failed, model.state.value.problem); assertEquals("Design systems", model.state.value.posting); assertNotNull(model.state.value.selected)
        controls.set("createPdfCheck", FakeMode.Ready); model.check(); advanceUntilIdle()
        assertNotNull(model.state.value.result); repositories.close()
    }
    @Test fun tooLargeInputFailsBeforeCheckingAndRetainsPosting() = runTest {
        val repositories = FakeRepositories(coroutineScope = backgroundScope)
        val model = AtsViewModel(context, repositories) { throw PdfTooLarge() }
        model.posting("Keep this posting"); model.choose("content://sample/large"); advanceUntilIdle()
        assertEquals(PdfProblem.TooLarge, model.state.value.problem); assertEquals("Keep this posting", model.state.value.posting)
        assertNull(model.state.value.selected); repositories.close()
    }
    @Test fun boundedReadsNeverConsumeBeyondLimit() {
        val stream = "abcdef".byteInputStream()
        assertEquals("abc", stream.readBounded(3).decodeToString())
        assertEquals('d'.code, stream.read())
        assertTrue("x".byteInputStream().readBounded(0).isEmpty())
    }

}
