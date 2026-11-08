package me.rxresu.feature.documents

import java.io.InputStream
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import me.rxresu.core.data.*
import me.rxresu.core.network.*
import me.rxresu.core.network.generated.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class ImportRegressionTest {
    private val dispatcher = StandardTestDispatcher()
    @Before fun main() = Dispatchers.setMain(dispatcher)
    @After fun reset() = Dispatchers.resetMain()

    @Test fun selectedPdfWinsOverLateSuccess() = staleResponse(jsonB = false, errorA = false)
    @Test fun selectedPdfWinsOverLateError() = staleResponse(jsonB = false, errorA = true)
    @Test fun selectedJsonWinsOverLateSuccess() = staleResponse(jsonB = true, errorA = false)
    @Test fun selectedJsonWinsOverLateError() = staleResponse(jsonB = true, errorA = true)

    @Test fun replacingFileCancelsLocalReaderAndNeverUploadsIt() = runTest(dispatcher) {
        val r = FakeRepositories()
        val data = importData(r)
        var closed = false
        val vm = ImportViewModel(r.resumes, r.ai, r.account.session) { file, _ ->
            if (file.name == "A.pdf") suspendCancellableCoroutine { pending -> pending.invokeOnCancellation { closed = true } }
            else LocalImportResult(data)
        }
        runCurrent()
        vm.start(PickedFile("A.pdf", 1, null, byteArrayOf(1)))
        runCurrent()
        vm.start(PickedFile("B.pdf", 1, null, byteArrayOf(2)))
        runCurrent()
        assertTrue(closed)
        assertNotNull(vm.state.value.summary)
        assertEquals("B.pdf", vm.state.value.file?.name)
    }

    @Test fun changedAccountDropsPendingLocalDataAndRefusesCreate() = runTest(dispatcher) {
        val session = FakeAuthSession()
        val r = FakeRepositories(authSession = session)
        val data = importData(r)
        lateinit var late: Continuation<LocalImportResult>
        var writes = 0
        val resumes = object : ResumeRepository by r.resumes {
            override suspend fun importResume(body: ImportResumeRequest, options: RequestOptions): String { writes++; return "wrong-owner" }
        }
        val vm = ImportViewModel(resumes, r.ai, r.account.session) { _, _ -> suspendCoroutine { late = it } }
        runCurrent()
        vm.start(PickedFile("private.pdf", 1, null, byteArrayOf(1)))
        runCurrent()
        session.state.value = me.rxresu.core.auth.SessionState.SignedIn("https://other.invalid", "another-account")
        runCurrent()
        late.resume(LocalImportResult(data))
        runCurrent()
        assertNull(vm.state.value.file)
        assertNull(vm.state.value.summary)
        assertEquals(ImportProblem.AccountChanged, vm.state.value.problem)
        assertTrue(runCatching { vm.create() }.isFailure)
        assertEquals(0, writes)
    }

    @Test fun localErrorsRemainHonestAndCannotCreate() = runTest(dispatcher) {
        val r = FakeRepositories()
        for ((code, problem) in listOf("password" to ImportProblem.Password, "scanned" to ImportProblem.Scanned, "partial" to ImportProblem.Partial, "unsupported" to ImportProblem.UnsupportedReader)) {
            val vm = ImportViewModel(r.resumes, r.ai, r.account.session) { _, _ -> throw LocalImportException(code) }
            runCurrent()
            vm.start(PickedFile("resume.pdf", 1, null, byteArrayOf(1)))
            runCurrent()
            assertEquals(problem, vm.state.value.problem)
            assertFalse(vm.state.value.canCreate)
        }
    }

    @Test fun sizeLimitAppliesBeforeEitherReader() = runTest(dispatcher) {
        val r = FakeRepositories()
        var local = 0
        val vm = ImportViewModel(r.resumes, r.ai, r.account.session) { _, _ -> local++; error("oversize") }
        runCurrent()
        vm.start(PickedFile("resume.pdf", 10 * 1024 * 1024 + 1L, null, byteArrayOf(1)))
        runCurrent()
        assertEquals(ImportProblem.TooLarge, vm.state.value.problem)
        assertFalse(vm.state.value.canCreate)
        assertEquals(0, local)
    }

    @Test fun selectingAiRequiresExplicitReadAndPreservesApprovedDestination() = runTest(dispatcher) {
        val r = FakeRepositories()
        val data = importData(r)
        val provider = r.ai.listAiProviders().first { it.isDefault }
        var sent = 0
        val ai = object : AiRepository by r.ai {
            override suspend fun parseResumePdf(body: CreatePdfParseRequest, options: RequestOptions): CreatePdfParseResponse {
                sent++
                assertEquals(aiApproval(provider), options.headers)
                assertEquals("storyboard-alex", options.accountScope)
                return ApiJson.decodeFromJsonElement(CreatePdfParseResponse.serializer(), data)
            }
        }
        val vm = ImportViewModel(r.resumes, ai, r.account.session) { _, _ -> LocalImportResult(data) }
        runCurrent()
        vm.start(PickedFile("resume.pdf", 1, null, byteArrayOf(1)))
        runCurrent()
        assertNotNull(vm.state.value.summary)
        vm.setMethod(ImportMethod.Ai)
        runCurrent()
        assertEquals(0, sent)
        assertNull(vm.state.value.summary)
        vm.read()
        runCurrent()
        assertEquals(1, sent)
        assertNotNull(vm.state.value.summary)
    }

    @Test fun assetAllowlistRejectsOutboundRequestsAndTraversal() {
        fun path(value: String, method: String = "GET") = LocalImportReader.assetPath(android.net.Uri.parse(value), method)
        assertEquals("pdf.worker.mjs", path("https://appassets.androidplatform.net/local-import/pdf.worker.mjs"))
        assertEquals("cmaps/Adobe-Japan1-UCS2.bcmap", path("https://appassets.androidplatform.net/local-import/cmaps/Adobe-Japan1-UCS2.bcmap"))
        for (url in listOf("https://evil.invalid/local-import/reader.js", "https://appassets.androidplatform.net/other/reader.js", "https://appassets.androidplatform.net/local-import/../private", "https://appassets.androidplatform.net/local-import/%2e%2e/private", "file:///local-import/reader.js", "content://local-import/reader.js", "https://appassets.androidplatform.net/local-import/reader.js?remote=https://evil.invalid")) assertNull(path(url))
        assertNull(path("https://appassets.androidplatform.net/local-import/reader.js", "POST"))
        assertNull(path("https://user@appassets.androidplatform.net/local-import/reader.js"))
    }

    @Test fun readerPreservesCallerTimeoutCancellation() = runTest(dispatcher) {
        val reader = LocalImportReader(androidx.test.core.app.ApplicationProvider.getApplicationContext(), "More from your file")
        val result = runCatching {
            kotlinx.coroutines.withTimeout(1) { reader.read(PickedFile("file.pdf", 1, null, byteArrayOf(1))) {} }
        }
        assertTrue(result.exceptionOrNull() is kotlinx.coroutines.TimeoutCancellationException)
    }

    private fun staleResponse(jsonB: Boolean, errorA: Boolean) = runTest(dispatcher) {
        val r = FakeRepositories()
        val full = Json(ApiJson) { encodeDefaults = true }
        val sample = full.encodeToJsonElement(ResumeData.serializer(), r.resumes.getResume(StoryboardIds.resume).data).jsonObject
        // Seed data has display-only skill entries; empty lists make a complete import fixture.
        val original = JsonObject(sample + ("sections" to JsonObject(sample.getValue("sections").jsonObject.mapValues { (_, section) ->
            JsonObject(section.jsonObject + ("items" to JsonArray(emptyList())))
        })) + ("customSections" to JsonArray(emptyList())))
        fun data(name: String) = JsonObject(original + ("basics" to JsonObject(original.getValue("basics").jsonObject + ("name" to JsonPrimitive(name)))))
        lateinit var late: Continuation<LocalImportResult>
        var imported: ImportResumeRequest? = null
        val resumes = object : ResumeRepository by r.resumes {
            override suspend fun previewPdfImport(file: UploadPart, options: RequestOptions): PreviewPdfImportResponse = error("Local reading must not upload")
            override suspend fun importResume(body: ImportResumeRequest, options: RequestOptions): String {
                imported = body; return "created-B"
            }
        }
        val vm = ImportViewModel(resumes, r.ai, r.account.session) { file, _ ->
            if (file.name == "A.pdf") suspendCoroutine { late = it } else LocalImportResult(data("B"))
        }
        runCurrent()
        vm.start(PickedFile("A.pdf", 1, "application/pdf", byteArrayOf(1)))
        runCurrent()
        vm.start(if (jsonB) PickedFile("B.json", 1, "application/json", data("B").toString().toByteArray()) else PickedFile("B.pdf", 1, "application/pdf", byteArrayOf(2)))
        runCurrent()
        if (errorA) late.resumeWithException(IllegalStateException("late A")) else late.resume(LocalImportResult(data("A")))
        runCurrent()
        assertEquals(if (jsonB) "B.json" else "B.pdf", vm.state.value.file?.name)
        assertEquals("B", vm.state.value.summary?.name)
        assertNull(vm.state.value.problem)
        assertEquals("created-B", vm.create())
        assertEquals("B", full.encodeToJsonElement(ImportResumeRequest.serializer(), imported!!).jsonObject.getValue("data").jsonObject.getValue("basics").jsonObject.getValue("name").jsonPrimitive.content)
    }

    @Test fun countedReadAcceptsBoundaryAndConsumesOnlyOneExcessByte() {
        val limit = 32
        assertArrayEquals(ByteArray(limit), ByteArray(limit).inputStream().use { it.readImportBytes(limit) })
        var read = 0
        val untrusted = object : InputStream() {
            override fun read(): Int { read++; return 0 }
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int { read += length; bytes.fill(0, offset, offset + length); return length }
        }
        assertTrue(runCatching { untrusted.use { it.readImportBytes(limit) } }.exceptionOrNull() is ImportTooLarge)
        assertEquals(limit + 1, read)
    }

    @Test fun destinationConflictRenewsDisclosureWithoutReplacingFileOrSendingAgain() = runTest(dispatcher) {
        val r = FakeRepositories()
        val provider = r.ai.listAiProviders().first { it.isDefault }
        var shown = provider
        val calls = mutableListOf<ApiRequest>()
        val transport = object : ApiTransport {
            override suspend fun execute(request: ApiRequest): JsonElement {
                calls += request
                throw ApiException(409, "CONFLICT", "Your AI destination changed. Nothing was sent; review the connection and try again.")
            }
            override fun events(request: ApiRequest) = kotlinx.coroutines.flow.emptyFlow<ServerEvent>()
            override suspend fun download(request: ApiRequest): BinaryFile = error("unused")
        }
        val api = AIApi(transport)
        val ai = object : AiRepository by r.ai {
            override suspend fun listAiProviders(limit: Long?, offset: Long?, options: RequestOptions) = listOf(shown)
            override suspend fun parseResumeDocx(body: CreateDocxParseRequest, options: RequestOptions) = api.parseResumeDocx(body, options)
        }
        val vm = ImportViewModel(r.resumes, ai, r.account.session) { _, _ -> error("Word requires AI") }
        runCurrent()
        val file = PickedFile("my-words.docx", 4, null, "mine".toByteArray())
        vm.start(file)
        shown = provider.copy(label = "Changed connection", recipientVersion = "new-recipient")
        vm.read(); runCurrent()
        assertEquals(aiApproval(provider), calls.single().options.headers)
        assertSame(file, vm.state.value.file)
        assertEquals(ImportProblem.DestinationChanged, vm.state.value.problem)
        assertEquals(shown.label, vm.state.value.aiProvider)
        assertEquals(0, vm.state.value.progress)
        vm.read(); runCurrent()
        assertEquals(aiApproval(shown), calls.last().options.headers)
        assertEquals(2, calls.size)
    }
}
