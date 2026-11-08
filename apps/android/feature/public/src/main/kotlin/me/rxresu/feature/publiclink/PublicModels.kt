package me.rxresu.feature.publiclink

import android.content.Context
import android.app.Application
import androidx.lifecycle.AndroidViewModel
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.io.File
import java.io.IOException
import java.net.URI
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.PublicRepository
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.network.*
import me.rxresu.core.network.generated.*
import me.rxresu.core.page.PageHttpException
import me.rxresu.core.page.PageSource
import me.rxresu.core.page.PageSourceUnavailable
import me.rxresu.core.page.RenderedDocument
import okhttp3.OkHttpClient
import okhttp3.Request

internal data class PublicAddress(val url: String, val origin: String, val username: String? = null, val slug: String? = null, val feedbackToken: String? = null)
internal fun publicAddress(input: String): PublicAddress? = runCatching {
    val uri = URI(input)
    if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null) return null
    val pieces = uri.path.orEmpty().split('/').filter(String::isNotEmpty).let { if (it.firstOrNull() == "r") it.drop(1) else it }
    val origin = URI(uri.scheme, null, uri.host, uri.port, null, null, null).toASCIIString()
    val clean = URI(uri.scheme, null, uri.host, uri.port, uri.path, null, null).toASCIIString()
    when {
        pieces.size == 2 && pieces[0] == "feedback" -> PublicAddress(clean, origin, feedbackToken = pieces[1])
        pieces.size == 2 && pieces[0] !in setOf("auth", "api", "dashboard", "builder", "assets") -> PublicAddress(clean, origin, pieces[0], pieces[1])
        else -> null
    }
}.getOrNull()

/** Aliases use a fresh unauthenticated client; no bearer/cookies can cross a redirect. */
internal suspend fun resolvePublicAddress(input: String, http: OkHttpClient): PublicAddress {
    publicAddress(input)?.takeIf { URI(it.url).host != "rx.cv" }?.let { return it }
    return withContext(Dispatchers.IO) {
    var current = URI(input)
    repeat(5) {
        require(current.scheme == "https" && current.host != null && current.userInfo == null)
        http.newCall(Request.Builder().url(current.toASCIIString()).header("Accept", "text/html").build()).execute().use { response ->
            if (response.code in 300..399) {
                current = current.resolve(response.header("Location") ?: throw IOException("Link has no destination"))
            } else {
                if (!response.isSuccessful) throw ApiException(response.code, null, "Link unavailable")
                val html = response.body.byteStream().use { it.readBounded(262144).decodeToString() }
                val tag = Regex("<link\\b[^>]*>", RegexOption.IGNORE_CASE).findAll(html).map { it.value }.firstOrNull { Regex("rel\\s*=\\s*['\"]canonical['\"]", RegexOption.IGNORE_CASE).containsMatchIn(it) }
                val canonical = tag?.let { Regex("href\\s*=\\s*['\"]([^'\"]+)['\"]", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1) }
                return@withContext publicAddress(canonical?.let { current.resolve(it).toString() } ?: current.toString()) ?: throw PageSourceUnavailable("Canonical public link unavailable")
            }
        }
    }
    throw IOException("Too many redirects")
    }
}

internal fun publicRepositoryFor(address: PublicAddress, repositories: RrRepositories): PublicRepository {
    if (address.origin.trimEnd('/') == repositories.authSession.origin.value.trimEnd('/')) return repositories.publicResume
    // Public links can point to another server. A tokenless transport owns that origin and its password grant only.
    val origin = object : ServerOrigin { override val origin = MutableStateFlow(address.origin) }
    val tokens = object : SessionTokens { override suspend fun accessToken(): String? = null; override suspend fun refresh(rejected: String): String? = null }
    val transport = ApiClient(origin, tokens)
    return object : PublicRepository, ResumeSharingApiOperations by ResumeSharingApi(transport), FeedbackLinksApiOperations by FeedbackLinksApi(transport) {}
}

internal enum class PublicProblem { Password, WrongPassword, NotShared, Revoked, Expired, Invalid, PreviewUnavailable, Offline }
internal data class PublicState(val loading: Boolean = true, val address: PublicAddress? = null, val resume: GetResumeBySlugResponse? = null,
    val feedback: ViewFeedbackLinkResponse? = null, val document: RenderedDocument? = null, val problem: PublicProblem? = null,
    val password: String = "", val owner: Boolean = false, val sending: Boolean = false, val commentError: Boolean = false)
internal class PublicViewModel(private val repositories: RrRepositories, private val url: String) : ViewModel() {
    private val mutable = MutableStateFlow(PublicState()); val state = mutable.asStateFlow()
    private var publicRepository: PublicRepository? = null
    private val http = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build()
    private var loadJob: Job? = null
    init { load() }
    fun password(value: String) { mutable.update { it.copy(password = value) } }
    fun load() {
        loadJob?.cancel(); loadJob = viewModelScope.launch {
            mutable.update { it.copy(loading = true, problem = null, document = null) }
            try {
                val address = state.value.address ?: resolvePublicAddress(url, http)
                val public = publicRepository ?: publicRepositoryFor(address, repositories).also { publicRepository = it }
                mutable.update { it.copy(address = address) }
                if (address.feedbackToken != null) {
                    val feedback = public.viewFeedbackLink(address.feedbackToken)
                    mutable.update { it.copy(loading = false, feedback = feedback, problem = PublicProblem.PreviewUnavailable) }
                } else {
                    if (state.value.password.isNotEmpty()) {
                        val valid = public.verifyResumePassword(requireNotNull(address.username), requireNotNull(address.slug), VerifyResumePasswordRequest(state.value.password))
                        if (!valid) { mutable.update { it.copy(loading = false, problem = PublicProblem.WrongPassword) }; return@launch }
                    }
                    val resume = public.getResumeBySlug(requireNotNull(address.username), requireNotNull(address.slug))
                    val owner = if (address.origin == repositories.authSession.origin.value && repositories.account.session.value is SessionState.SignedIn)
                        runCatching { repositories.documents.listDocuments().any { it.id == resume.id } }.getOrDefault(false) else false
                    mutable.update { it.copy(resume = resume, owner = owner) }
                    if (!resume.showDownloadButtons) { mutable.update { it.copy(loading = false, problem = PublicProblem.PreviewUnavailable) }; return@launch }
                    val document = repositories.pages.render(PageSource.Public(address.url, state.value.password.ifEmpty { null }))
                    mutable.update { it.copy(loading = false, document = document, password = "") }
                }
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                val problem = when {
                    e is ApiException && e.code == "NEED_PASSWORD" -> if (state.value.password.isEmpty()) PublicProblem.Password else PublicProblem.WrongPassword
                    e is ApiException && e.data?.toString()?.contains("revoked") == true -> PublicProblem.Revoked
                    e is ApiException && e.data?.toString()?.contains("expired") == true -> PublicProblem.Expired
                    e is ApiException && e.status == 404 -> PublicProblem.NotShared
                    e is PageSourceUnavailable || e is PageHttpException && e.status == 403 -> PublicProblem.PreviewUnavailable
                    e is IllegalArgumentException -> PublicProblem.Invalid
                    else -> PublicProblem.Offline
                }
                mutable.update { it.copy(loading = false, problem = problem) }
            }
        }
    }
    fun comment(name: String, body: String, done: () -> Unit) = viewModelScope.launch {
        val token = state.value.address?.feedbackToken ?: return@launch
        if (state.value.feedback?.allowComments != true || name.isBlank() || body.isBlank()) return@launch
        mutable.update { it.copy(sending = true, commentError = false) }
        try {
            val public = requireNotNull(publicRepository)
            public.commentOnFeedbackLink(token, CommentOnFeedbackLinkRequest(name.trim(), body.trim()))
            val feedback = public.viewFeedbackLink(token)
            mutable.update { it.copy(feedback = feedback, sending = false) }; done()
        } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(sending = false, commentError = true) } }
    }
}

internal const val MAX_PDF_BYTES = 25_000_000
internal data class SelectedPdf(val uri: String, val name: String, val bytes: ByteArray, val file: File)
internal enum class PdfProblem { TooLarge, Password, Unreadable, Failed }
internal enum class AtsVerdict { Clean, Mostly, Hard }
internal fun atsVerdict(result: CreatePdfCheckResponse): AtsVerdict = when {
    result.score >= 80 && result.findings.isEmpty() -> AtsVerdict.Clean
    result.score >= 50 -> AtsVerdict.Mostly
    else -> AtsVerdict.Hard
}
internal data class AtsState(val selected: SelectedPdf? = null, val posting: String = "", val working: Boolean = false, val result: CreatePdfCheckResponse? = null, val problem: PdfProblem? = null)
internal class AtsViewModel(application: Application, private val repositories: RrRepositories, private val read: suspend (String) -> SelectedPdf = { readPdf(application, it) }) : AndroidViewModel(application) {
    private val mutable = MutableStateFlow(AtsState()); val state = mutable.asStateFlow()
    private var generation = 0; private var work: Job? = null
    private var celebrated: CreatePdfCheckResponse? = null
    fun takeSuccess(): Boolean {
        val result = state.value.result ?: return false
        if (atsVerdict(result) != AtsVerdict.Clean || celebrated === result) return false
        celebrated = result
        return true
    }
    fun posting(value: String) { mutable.update { it.copy(posting = value.take(20000)) } }
    fun choose(uri: String) {
        generation++; work?.cancel(); state.value.selected?.file?.delete(); val revision = generation
        mutable.update { AtsState(posting = it.posting, working = true) }
        work = viewModelScope.launch {
            try {
                val file = read(uri)
                if (generation == revision) mutable.update { it.copy(selected = file, working = false) }
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                if (generation == revision) mutable.update { it.copy(working = false, problem = if (e is PdfTooLarge) PdfProblem.TooLarge else PdfProblem.Unreadable) }
            }
        }
    }
    fun check() {
        val selected = state.value.selected ?: return; val posting = state.value.posting
        if (state.value.working) return
        val revision = generation
        work = viewModelScope.launch {
            mutable.update { it.copy(working = true, problem = null) }
            try {
                val result = repositories.checks.createPdfCheck(UploadPart("file", selected.bytes, selected.name, "application/pdf"), posting.ifBlank { null }, RequestOptions(authenticated = false))
                if (generation == revision) mutable.update { it.copy(working = false, result = result) }
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                if (generation == revision) mutable.update { it.copy(working = false, problem = if ((e as? ApiException)?.code == "ENCRYPTED_PDF" || e.message.orEmpty().contains("password", true)) PdfProblem.Password else PdfProblem.Failed) }
            }
        }
    }
    override fun onCleared() { state.value.selected?.file?.delete() }
}
internal class PdfTooLarge : IOException()
internal suspend fun readPdf(context: Context, value: String): SelectedPdf = withContext(Dispatchers.IO) {
    val uri = Uri.parse(value); require(uri.scheme == "content")
    val resolver = context.contentResolver
    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (!cursor.moveToFirst()) null else {
            val size = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (size >= 0 && !cursor.isNull(size) && cursor.getLong(size) > MAX_PDF_BYTES) throw PdfTooLarge()
            cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { cursor.getString(it) }
        }
    } ?: "resume.pdf"
    val bytes = requireNotNull(resolver.openInputStream(uri)).use { it.readBounded(MAX_PDF_BYTES + 1) }
    if (bytes.size > MAX_PDF_BYTES) throw PdfTooLarge()
    require(bytes.size >= 5 && bytes.copyOfRange(0, 5).decodeToString() == "%PDF-")
    val file = File.createTempFile("ats-", ".pdf", context.cacheDir).apply { writeBytes(bytes) }
    SelectedPdf(value, name, bytes, file)
}

/** Bounded read available on every supported Android version. */
internal fun java.io.InputStream.readBounded(limit: Int): ByteArray {
    require(limit >= 0)
    val out = java.io.ByteArrayOutputStream(minOf(limit, 16384))
    val buffer = ByteArray(minOf(limit, 16384).coerceAtLeast(1))
    var remaining = limit
    while (remaining > 0) {
        val read = read(buffer, 0, minOf(buffer.size, remaining))
        if (read < 0) break
        if (read == 0) { val one = read(); if (one < 0) break; out.write(one); remaining-- }
        else { out.write(buffer, 0, read); remaining -= read }
    }
    return out.toByteArray()
}
