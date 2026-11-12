package me.rxresu.core.page

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import me.rxresu.core.network.ServerOrigin
import me.rxresu.core.network.SessionTokens
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.serialization.json.*

/** HTTP refusal is distinct from offline; revoked/forbidden pages never silently fall back to cache. */
class PageHttpException(val status: Int) : IOException("Page request failed ($status)")

/** Source exists as JSON on this backend but has no PDF endpoint yet. Never substitutes the live resume. */
class PageSourceUnavailable(message: String) : IOException(message)

/** Discard this renderer's result when credentials change during a fetch; don't show its offline fallback. */
class PageSessionChanged : IOException("Account changed while rendering")

/**
 * One instance per account scope. [directory] MUST be private app cache inside that account's directory;
 * dispose references and delete it on sign-out. Never reuse an instance/directory for another account.
 * The contracts intentionally expose no account ID, so AppGraph/data owner must enforce that boundary.
 * Server origin is also part of every cache key. Public PDFs never receive the account bearer token.
 */
class ServerPageRenderer(
    private val tokens: SessionTokens,
    private val server: ServerOrigin,
    client: OkHttpClient,
    private val directory: File,
    private val maxBytes: Long = 64L * 1024 * 1024,
) : PageRenderer {
    // Opening per operation avoids retained native descriptors; all accesses and eviction share this lock.
    private val lock = Mutex()
    private val cookies = object : CookieJar {
        private val values = mutableListOf<Cookie>()
        @Synchronized override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            cookies.forEach { next ->
                values.removeAll { it.name == next.name && it.domain == next.domain && it.path == next.path }
                values.add(next)
            }
        }
        @Synchronized override fun loadForRequest(url: HttpUrl) = values.filter { it.expiresAt > System.currentTimeMillis() && it.matches(url) }
    }
    // Caller may supply an API client with bearer interceptors. They must never run for arbitrary public hosts.
    private val http = client.newBuilder().apply { interceptors().clear(); networkInterceptors().clear() }
        .cache(null).cookieJar(cookies).followRedirects(false).followSslRedirects(false)
        .authenticator(okhttp3.Authenticator.NONE).callTimeout(60, TimeUnit.SECONDS).build()

    init {
        require(maxBytes > 0)
        check(directory.mkdirs() || directory.isDirectory)
        directory.listFiles().orEmpty().filter {
            it.extension == "part" || (it.extension == "revision" && !File(directory, it.nameWithoutExtension + ".pdf").exists())
        }.forEach { it.delete() }
    }

    override suspend fun render(source: PageSource): RenderedDocument = withContext(Dispatchers.IO) { lock.withLock {
        val origin = server.origin.value
        val identity = sourceIdentity(origin, source)
        val file = File(directory, "$identity-${digest(source.revision)}.pdf")
        if (file.isFile && source !is PageSource.Public) return@withLock document(source, file).also { touch(file) }
        try {
            var token = if (source is PageSource.Public) null else tokens.accessToken()
            if (server.origin.value != origin) throw PageSessionChanged()
            val url = endpoint(origin, source)
            if (source is PageSource.Public && source.password != null) verifyPassword(url, source.password)
            fun request(access: String?) = Request.Builder().url(url).header("Accept", "application/pdf")
                .apply { if (access != null) header("Authorization", "Bearer $access") }.build()
            var response = http.newCall(request(token)).execute()
            if (response.code == 401 && token != null && isTokenError(response)) {
                response.close()
                val refreshed = tokens.refresh(token!!)
                if (refreshed == null || server.origin.value != origin) throw PageSessionChanged()
                token = refreshed
                response = http.newCall(request(refreshed)).execute()
            }
            response.use {
                if (!it.isSuccessful) throw PageHttpException(it.code)
                if (it.body.contentType()?.let { type -> type.type == "application" && type.subtype == "pdf" } != true)
                    throw IOException("Server returned no PDF")
                directory.mkdirs() // Sign-out clears the cache; never assume the folder survived.
                val temp = File.createTempFile("page-", ".part", directory)
                try {
                    it.body.byteStream().use { input -> temp.outputStream().use { output ->
                        val buffer = ByteArray(16 * 1024)
                        var total = 0L
                        while (true) {
                            val read = input.read(buffer)
                            if (read == -1) break
                            total += read
                            if (total + source.revision.toByteArray().size > maxBytes) throw IOException("PDF exceeds cache size limit")
                            output.write(buffer, 0, read)
                        }
                        output.fd.sync()
                    } }
                    val count = pageCount(temp)
                    if (source !is PageSource.Public && (server.origin.value != origin || tokens.accessToken() != token))
                        throw PageSessionChanged()
                    val metadata = File.createTempFile("revision-", ".part", directory)
                    try {
                        metadata.outputStream().use { output -> output.write(source.revision.toByteArray()); output.fd.sync() }
                        check(metadata.renameTo(revisionFile(file))) { "Could not commit PDF revision" }
                        check(temp.renameTo(file)) { "Could not commit PDF cache" }
                    } finally { metadata.delete() }
                    touch(file)
                    trim(file)
                    RenderedDocument(source, file, count)
                } finally { temp.delete() }
            }
        } catch (error: IOException) {
            if (error is PageHttpException || error is PageSourceUnavailable || error is PageSessionChanged) throw error
            lastGoodLocked(source, origin) ?: throw error
        }
    } }

    override suspend fun lastGood(source: PageSource): RenderedDocument? = withContext(Dispatchers.IO) { lock.withLock {
        lastGoodLocked(source, server.origin.value)
    } }

    private fun lastGoodLocked(source: PageSource, origin: String): RenderedDocument? {
        val prefix = sourceIdentity(origin, source) + "-"
        return directory.listFiles().orEmpty().filter { it.name.startsWith(prefix) && it.extension == "pdf" }
            .sortedByDescending { it.lastModified() }.firstNotNullOfOrNull {
                try {
                    val revision = revisionFile(it).readText()
                    val cachedSource = when (source) {
                        is PageSource.Resume -> source.copy(revision = revision)
                        is PageSource.Letter -> source.copy(revision = revision)
                        is PageSource.Public -> source.copy(revision = revision)
                        is PageSource.ResumeVersion -> source
                    }
                    document(cachedSource, it)
                } catch (_: IOException) { it.delete(); revisionFile(it).delete(); null }
            }
    }

    /**
     * Returns an owned ARGB bitmap; caller recycles only after Compose/Canvas stops displaying it.
     * Keep visible pages only, reuse the displayed bitmap until replacement is ready, and avoid full-document images.
     * Width is capped at 4096 and allocation at 32 MiB. Actual paper aspect ratio is preserved; paper stays white.
     */
    override suspend fun page(document: RenderedDocument, index: Int, widthPx: Int): Bitmap = withContext(Dispatchers.IO) { lock.withLock {
        require(widthPx in 1..4096)
        open(document.file).use { renderer ->
            require(index in 0 until renderer.pageCount)
            renderer.openPage(index).use { page ->
                val height = (widthPx.toDouble() * page.height / page.width).toInt().coerceAtLeast(1)
                require(widthPx.toLong() * height * 4 <= 32L * 1024 * 1024) { "Page bitmap exceeds memory limit" }
                val bitmap = Bitmap.createBitmap(widthPx, height, Bitmap.Config.ARGB_8888)
                try {
                    bitmap.eraseColor(Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    bitmap
                } catch (error: Throwable) { bitmap.recycle(); throw error }
            }
        }
    } }

    private fun document(source: PageSource, file: File) = RenderedDocument(source, file, pageCount(file))
    private fun pageCount(file: File) = try { open(file).use { it.pageCount.also { count -> require(count > 0) } } }
        catch (error: Exception) { throw IOException("Cached PDF cannot be opened", error) }
    private fun open(file: File): PdfRenderer {
        val fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        try { return PdfRenderer(fd) } catch (error: Throwable) { fd.close(); throw error }
    }

    private fun trim(keep: File) {
        val files = directory.listFiles().orEmpty().filter { it.extension == "pdf" }.sortedBy { it.lastModified() }
        var bytes = files.sumOf { it.length() + revisionFile(it).length() }
        for (file in files) {
            if (bytes <= maxBytes) break
            if (file != keep) {
                val size = file.length() + revisionFile(file).length()
                if (file.delete()) { revisionFile(file).delete(); bytes -= size }
            }
        }
    }

    private fun revisionFile(pdf: File) = File(directory, pdf.nameWithoutExtension + ".revision")

    private fun touch(file: File) {
        val previous = directory.listFiles().orEmpty().filter { it.extension == "pdf" }.maxOfOrNull { it.lastModified() } ?: 0L
        file.setLastModified(maxOf(System.currentTimeMillis(), previous + 1))
    }

    private fun isTokenError(response: okhttp3.Response): Boolean {
        val body = response.peekBody(8192).string()
        return !body.contains("NEED_PASSWORD") && (body.contains("UNAUTHORIZED") || body.contains("invalid_token"))
    }

    private fun verifyPassword(pdf: HttpUrl, password: String) {
        val segments = pdf.pathSegments
        val url = pdf.newBuilder().encodedPath("/api/openapi/resumes").addPathSegment(segments[2]).addPathSegment(segments[3])
            .addPathSegments("password/verify").build()
        val body = buildJsonObject { put("password", password) }.toString().toRequestBody("application/json".toMediaType())
        http.newCall(Request.Builder().url(url).header("Origin", originOf(pdf)).post(body).build()).execute().use {
            if (!it.isSuccessful) throw PageHttpException(it.code)
            if (it.body.string().trim() != "true") throw PageHttpException(401)
        }
    }
}

internal fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
internal fun originOf(url: HttpUrl) = url.newBuilder().encodedPath("/").query(null).fragment(null).build().toString().removeSuffix("/")
internal fun sourceIdentity(origin: String, source: PageSource): String = digest(when (source) {
    is PageSource.Resume -> "${origin.length}:$origin:resume:${source.id}"
    is PageSource.ResumeVersion -> "${origin.length}:$origin:version:${source.resumeId}:${source.versionId}"
    is PageSource.Letter -> "${origin.length}:$origin:letter:${source.id}"
    is PageSource.Public -> "public:${source.url.length}:${source.url}:${source.password?.let(::digest)}"
})

internal fun endpoint(origin: String, source: PageSource): HttpUrl {
    val api = "$origin/api/openapi/".toHttpUrl().newBuilder()
    return when (source) {
        is PageSource.Resume -> api.addPathSegment("resumes").addPathSegment(source.id).addPathSegment("pdf").build()
        is PageSource.Letter -> api.addPathSegment("cover-letters").addPathSegment(source.id).addPathSegments("exports/pdf").build()
        is PageSource.ResumeVersion -> throw PageSourceUnavailable("This server has no saved-version PDF endpoint; /resumes/{resumeId}/versions/{versionId} returns JSON only.")
        is PageSource.Public -> {
            val url = source.url.toHttpUrl()
            require(url.isHttps || (url.scheme == "http" && url.host in setOf("localhost", "127.0.0.1", "10.0.2.2")))
            require(url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null)
            val parts = url.pathSegments.filter { it.isNotEmpty() }.let { if (it.firstOrNull() == "r") it.drop(1) else it }
            if (parts.firstOrNull() == "feedback" || parts.firstOrNull() == "f")
                throw PageSourceUnavailable("This server exposes feedback snapshot JSON but no feedback PDF endpoint.")
            if (parts.size != 2) throw PageSourceUnavailable("Public PDF needs a canonical /username/slug URL; resolve aliases before rendering.")
            url.newBuilder().encodedPath("/api/resumes").addPathSegment(parts[0]).addPathSegment(parts[1]).addPathSegment("pdf").build()
        }
    }
}
