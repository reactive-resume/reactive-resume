package me.rxresu.core.page

import android.content.Context
import android.graphics.Color
import java.io.File
import java.io.IOException
import java.nio.file.Files
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import me.rxresu.core.network.ServerOrigin
import me.rxresu.core.network.SessionTokens
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], shadows = [FixturePdfRendererShadow::class, FixturePdfPageShadow::class])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ServerPageRendererTest {
    private val context: Context get() = RuntimeEnvironment.getApplication()
    private val token = object : SessionTokens {
        override suspend fun accessToken() = "access"
        override suspend fun refresh(rejected: String): String? = null
    }
    private fun origin(value: String) = object : ServerOrigin { override val origin = MutableStateFlow(value) }
    private fun sample() = context.resources.openRawResource(R.raw.sample_resume).use { it.readBytes() }
    private fun pdf() = MockResponse.Builder().addHeader("Content-Type", "application/pdf").body(Buffer().write(sample())).build()
    private fun directory() = Files.createTempDirectory("page-test").toFile()

    @Test fun keysSeparateSourceOriginPasswordAndRevision() {
        val a = PageSource.Resume("a/b", "1")
        assertEquals(sourceIdentity("https://one.example", a), sourceIdentity("https://one.example", a.copy(revision = "2")))
        assertNotEquals(sourceIdentity("https://one.example", a), sourceIdentity("https://two.example", a))
        assertNotEquals(sourceIdentity("https://one.example", a), sourceIdentity("https://one.example", PageSource.Letter("a/b", "1")))
        val public = PageSource.Public("https://one.example/alex/design")
        assertNotEquals(sourceIdentity("", public), sourceIdentity("", public.copy(password = "secret")))
        assertFalse(sourceIdentity("", public.copy(password = "secret")).contains("secret"))
        assertEquals("/api/openapi/resumes/a%2Fb/pdf", endpoint("https://one.example", a).encodedPath)
        assertEquals("/api/openapi/cover-letters/letter/exports/pdf", endpoint("https://one.example", PageSource.Letter("letter", "1")).encodedPath)
        assertEquals("/api/resumes/alex/design/pdf", endpoint("https://one.example", public).encodedPath)
    }

    @Test fun cacheRevisionHitMissLastGoodAndRaster() = runBlocking {
        val dir = directory()
        try { MockWebServer().use { web ->
            web.start()
            val renderer = ServerPageRenderer(token, origin(web.url("/").toString().removeSuffix("/")), OkHttpClient(), dir)
            val source = PageSource.Resume("resume", "1")
            web.enqueue(pdf())
            val first = renderer.render(source)
            assertEquals(1, first.pageCount)
            assertEquals("Bearer access", web.takeRequest().headers["Authorization"])
            assertEquals(first.file, renderer.render(source).file)
            assertEquals(1, web.requestCount)
            web.enqueue(pdf())
            val second = renderer.render(source.copy(revision = "2"))
            assertNotEquals(first.file, second.file)
            assertEquals(second.file, renderer.lastGood(source.copy(revision = "3"))!!.file)
            assertEquals("2", renderer.lastGood(source.copy(revision = "3"))!!.source.revision)
            val bitmap = renderer.page(second, 0, 595)
            assertEquals(842, bitmap.height)
            assertEquals(Color.WHITE, bitmap.getPixel(0, 0))
            bitmap.recycle()
            assertEquals(2, web.requestCount)
        } } finally { dir.deleteRecursively() }
    }

    @Test fun offlineUsesLastGoodButHttpRefusalDoesNot() = runBlocking {
        val dir = directory()
        val web = MockWebServer()
        try {
            web.start()
            val renderer = ServerPageRenderer(token, origin(web.url("/").toString().removeSuffix("/")), OkHttpClient.Builder().retryOnConnectionFailure(false).build(), dir)
            val source = PageSource.Resume("resume", "1")
            web.enqueue(pdf())
            val first = renderer.render(source)
            web.enqueue(MockResponse.Builder().code(403).body("Forbidden").build())
            try { renderer.render(source.copy(revision = "2")); fail("HTTP refusal hidden") } catch (e: PageHttpException) { assertEquals(403, e.status) }
            web.close()
            assertEquals(first.file, renderer.render(source.copy(revision = "3")).file)
            try { renderer.render(PageSource.Resume("nothing-cached", "1")); fail("offline empty cache succeeded") } catch (_: IOException) { }
            assertNull(renderer.lastGood(PageSource.Resume("nothing-cached", "2")))
        } finally { web.close(); dir.deleteRecursively() }
    }

    @Test fun cacheSizeCapEvictsOldRevisionsAndRejectsOversize() = runBlocking {
        val dir = directory()
        try { MockWebServer().use { web ->
            web.start()
            val server = origin(web.url("/").toString().removeSuffix("/"))
            val renderer = ServerPageRenderer(token, server, OkHttpClient(), dir, sample().size.toLong() + 20)
            web.enqueue(pdf()); renderer.render(PageSource.Resume("one", "1"))
            web.enqueue(pdf()); val kept = renderer.render(PageSource.Resume("two", "1"))
            assertEquals(listOf(kept.file), dir.listFiles()!!.filter { it.extension == "pdf" })
            assertTrue(dir.listFiles()!!.sumOf(File::length) <= sample().size + 20)
            val tiny = directory()
            try {
                web.enqueue(pdf())
                try { ServerPageRenderer(token, server, OkHttpClient(), tiny, 10).render(PageSource.Resume("one", "1")); fail("oversize accepted") }
                catch (_: IOException) { }
                assertTrue(tiny.listFiles()!!.isEmpty())
            } finally { tiny.deleteRecursively() }
        } } finally { dir.deleteRecursively() }
    }

    @Test fun publicPasswordUsesCookieAndNeverBearer() = runBlocking {
        val dir = directory()
        try { MockWebServer().use { web ->
            web.start()
            val server = web.url("/").toString().removeSuffix("/")
            val apiClient = OkHttpClient.Builder().addInterceptor { chain ->
                chain.proceed(chain.request().newBuilder().header("Authorization", "Bearer must-not-leak").build())
            }.build()
            val renderer = ServerPageRenderer(token, origin("https://private.example"), apiClient, dir)
            web.enqueue(MockResponse.Builder().body("true").addHeader("Set-Cookie", "resume-access=yes; Path=/; HttpOnly").build())
            web.enqueue(pdf())
            renderer.render(PageSource.Public("$server/alex/design", "password"))
            val verify = web.takeRequest()
            assertEquals("/api/openapi/resumes/alex/design/password/verify", verify.url!!.encodedPath)
            assertNull(verify.headers["Authorization"])
            val download = web.takeRequest()
            assertNull(download.headers["Authorization"])
            assertTrue(download.headers["Cookie"].orEmpty().contains("resume-access=yes"))
        } } finally { dir.deleteRecursively() }
    }

    @Test fun unavailableSnapshotsFailExplicitly() {
        assertThrows(PageSourceUnavailable::class.java) { endpoint("https://example.org", PageSource.ResumeVersion("resume", "version")) }
        assertThrows(PageSourceUnavailable::class.java) { endpoint("https://example.org", PageSource.Public("https://example.org/feedback/token")) }
    }

    @Test fun debounceOnlyNewestSaveRenders() = runTest {
        val debouncer = RenderDebouncer(this)
        val calls = mutableListOf<Int>()
        debouncer.submit { calls.add(1) }
        advanceTimeBy(200)
        debouncer.submit { calls.add(2) }
        advanceTimeBy(350); runCurrent()
        assertEquals(listOf(2), calls)
        debouncer.submit { calls.add(3) }; debouncer.cancel()
        advanceTimeBy(400); runCurrent()
        assertEquals(listOf(2), calls)
    }
}
