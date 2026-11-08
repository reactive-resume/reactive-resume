package me.rxresu.feature.documents

import java.io.InputStream
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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

    private fun staleResponse(jsonB: Boolean, errorA: Boolean) = runTest(dispatcher) {
        val r = FakeRepositories()
        val full = Json(ApiJson) { encodeDefaults = true }
        val sample = full.encodeToJsonElement(ResumeData.serializer(), r.resumes.getResume(StoryboardIds.resume).data).jsonObject
        // Seed data has display-only skill entries; empty lists make a complete import fixture.
        val original = JsonObject(sample + ("sections" to JsonObject(sample.getValue("sections").jsonObject.mapValues { (_, section) ->
            JsonObject(section.jsonObject + ("items" to JsonArray(emptyList())))
        })) + ("customSections" to JsonArray(emptyList())))
        fun data(name: String) = JsonObject(original + ("basics" to JsonObject(original.getValue("basics").jsonObject + ("name" to JsonPrimitive(name)))))
        fun preview(name: String) = ApiJson.decodeFromJsonElement(PreviewPdfImportResponse.serializer(), buildJsonObject {
            put("data", data(name)); put("source", ApiJson.parseToJsonElement("""{"lines":[],"links":[],"partial":false}"""))
        })
        lateinit var late: Continuation<PreviewPdfImportResponse>
        var imported: ImportResumeRequest? = null
        val resumes = object : ResumeRepository by r.resumes {
            override suspend fun previewPdfImport(file: UploadPart, options: RequestOptions): PreviewPdfImportResponse =
                if (file.filename == "A.pdf") suspendCoroutine { late = it } else preview("B")
            override suspend fun importResume(body: ImportResumeRequest, options: RequestOptions): String {
                imported = body; return "created-B"
            }
        }
        val vm = ImportViewModel(resumes, r.ai)
        runCurrent()
        vm.start(PickedFile("A.pdf", 1, "application/pdf", byteArrayOf(1)))
        runCurrent()
        vm.start(if (jsonB) PickedFile("B.json", 1, "application/json", data("B").toString().toByteArray()) else PickedFile("B.pdf", 1, "application/pdf", byteArrayOf(2)))
        runCurrent()
        if (errorA) late.resumeWithException(IllegalStateException("late A")) else late.resume(preview("A"))
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
        val vm = ImportViewModel(r.resumes, ai)
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
