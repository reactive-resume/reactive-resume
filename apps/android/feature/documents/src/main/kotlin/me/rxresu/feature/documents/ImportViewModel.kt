package me.rxresu.feature.documents

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.util.Base64
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import me.rxresu.core.data.AiRepository
import me.rxresu.core.data.ResumeRepository
import me.rxresu.core.data.approvedFor
import me.rxresu.core.network.ApiException
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.UploadPart
import me.rxresu.core.network.generated.CreateDocxParseRequest
import me.rxresu.core.network.generated.CreateDocxParseRequestMediaType
import me.rxresu.core.network.generated.CreatePdfParseRequest
import me.rxresu.core.network.generated.CreatePdfParseRequestFile
import me.rxresu.core.network.generated.CreatePdfParseResponse
import me.rxresu.core.network.generated.CreateResumeImportRequestData
import me.rxresu.core.network.generated.ImportResumeFileFormat
import me.rxresu.core.network.generated.ImportResumeFileLocale
import me.rxresu.core.network.generated.ImportResumeRequest
import me.rxresu.core.network.generated.ResumeData
import me.rxresu.core.network.generated.TestAiProviderResponse

/** Keeps default values, so a reader's response converts into the import request, which requires them. */
private val Full = kotlinx.serialization.json.Json(ApiJson) { encodeDefaults = true }

/** A file chosen in the system picker or shared from another app. */
class PickedFile(val name: String, val size: Long, val mime: String?, val bytes: ByteArray, val pages: Int? = null)

enum class ImportFormat { Pdf, Word, LinkedIn, ReactiveResume, JsonResume, Unsupported }

enum class ImportMethod { Server, Ai }

enum class ImportProblem { Unreadable, WordNeedsAi, WrongType, CreateFailed, DestinationChanged }

/** What the reader found, for "Check what was found". */
data class ImportSummary(
    val name: String,
    val headline: String,
    val location: String,
    val experience: Int,
    val education: Int,
    val skills: Int,
    val languages: Int,
    val more: Int,
) {
    val hasBasics: Boolean get() = name.isNotBlank()
    val empty: Boolean get() = experience + education + skills + languages + more == 0
}

data class ImportUiState(
    val file: PickedFile? = null,
    val format: ImportFormat = ImportFormat.Unsupported,
    val method: ImportMethod = ImportMethod.Server,
    /** The default AI provider's label ("Work OpenAI"), or null without AI. */
    val aiProvider: String? = null,
    val aiDestination: String? = null,
    /** Steps done: 0 reading the file, 1 finding sections, 2 filling in entries, 3 all done. */
    val progress: Int = 0,
    val running: Boolean = false,
    val summary: ImportSummary? = null,
    val problem: ImportProblem? = null,
    val locale: String = "en-US",
    val creating: Boolean = false,
) {
    /** PDF and Word go through a reader; JSON and LinkedIn exports are imported as they are. */
    val readable: Boolean get() = format == ImportFormat.Pdf || format == ImportFormat.Word
    val canCreate: Boolean get() = file != null && !running && !creating && problem != ImportProblem.WordNeedsAi && problem != ImportProblem.Unreadable &&
        problem != ImportProblem.WrongType && (!readable || summary != null)
}

/**
 * D4: reads a file into a resume. PDF reads its text layer on the server (no AI) or with AI; Word needs AI.
 * JSON and LinkedIn exports are converted by the server when the resume is created.
 */
class ImportViewModel(private val resumes: ResumeRepository, private val ai: AiRepository) : ViewModel() {
    private val _state = MutableStateFlow(ImportUiState())
    val state: StateFlow<ImportUiState> = _state.asStateFlow()
    private var data: JsonObject? = null
    private var provider: TestAiProviderResponse? = null
    private var generation = 0L
    private var work: Job? = null

    init { viewModelScope.launch { refreshProvider() } }

    private suspend fun refreshProvider() {
        val next = runCatching { ai.listAiProviders() }.getOrNull().orEmpty().filter { it.enabled }
            .let { list -> list.firstOrNull { it.isDefault } ?: list.firstOrNull() }
        provider = next
        _state.update { it.copy(aiProvider = next?.label, aiDestination = next?.baseURL, problem = if (it.problem == ImportProblem.WordNeedsAi && next != null) null else it.problem) }
    }

    fun start(file: PickedFile) {
        work?.cancel()
        generation++
        val format = formatOf(file)
        data = null
        val method = if (format == ImportFormat.Word) ImportMethod.Ai else ImportMethod.Server
        _state.update { ImportUiState(file = file, format = format, method = method, aiProvider = it.aiProvider, aiDestination = it.aiDestination, locale = it.locale) }
        when (format) {
            ImportFormat.Unsupported -> _state.update { it.copy(problem = ImportProblem.WrongType) }
            ImportFormat.Word -> if (_state.value.aiProvider == null) _state.update { it.copy(problem = ImportProblem.WordNeedsAi) }
            ImportFormat.Pdf -> read()
            ImportFormat.ReactiveResume -> {
                // A Reactive Resume file already is resume data: summarise it on the device.
                val json = runCatching { ApiJson.parseToJsonElement(file.bytes.decodeToString()).jsonObject }.getOrNull()
                data = json
                _state.update { it.copy(progress = 3, summary = json?.let(::summarise)) }
            }
            else -> _state.update { it.copy(progress = 3) }
        }
    }

    /** Switching to AI never sends anything by itself: the screen shows the disclosure, then calls [read]. */
    fun setMethod(method: ImportMethod) {
        if (_state.value.format != ImportFormat.Pdf || method == _state.value.method) return
        work?.cancel()
        generation++
        data = null
        _state.update { it.copy(method = method, progress = 0, running = false, summary = null, problem = null) }
        if (method == ImportMethod.Server) read()
    }

    fun setLocale(locale: String) = _state.update { it.copy(locale = locale) }

    /** Runs the chosen reader. Steps advance when the work does. */
    fun read() {
        val s = _state.value
        val file = s.file ?: return
        if (!s.readable || s.running) return
        val disclosed = if (s.method == ImportMethod.Ai) provider ?: return else null
        val selected = generation
        work = viewModelScope.launch {
            _state.update { it.copy(running = true, progress = 1, summary = null, problem = null) }
            try {
                val found: JsonElement = when {
                    s.method == ImportMethod.Server -> resumes.previewPdfImport(UploadPart("file", file.bytes, file.name, "application/pdf")).data
                        ?.let { Full.encodeToJsonElement(ResumeData.serializer(), it) } ?: throw IllegalStateException("No resume data")
                    s.format == ImportFormat.Word -> Full.encodeToJsonElement(
                        CreatePdfParseResponse.serializer(),
                        ai.parseResumeDocx(CreateDocxParseRequest(file = upload(file), mediaType = wordType(file), aiProviderId = disclosed!!.id), RequestOptions().approvedFor(disclosed)),
                    )
                    else -> Full.encodeToJsonElement(CreatePdfParseResponse.serializer(), ai.parseResumePdf(CreatePdfParseRequest(file = upload(file), aiProviderId = disclosed!!.id), RequestOptions().approvedFor(disclosed)))
                }
                if (selected != generation) return@launch
                _state.update { it.copy(progress = 2) }
                val json = found.jsonObject
                data = json
                _state.update { it.copy(progress = 3, running = false, summary = summarise(json)) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (selected != generation) return@launch
                if (e is ApiException && e.status == 409 && e.message.startsWith("Your AI destination changed")) {
                    refreshProvider()
                    if (selected == generation) _state.update { it.copy(running = false, progress = 0, problem = ImportProblem.DestinationChanged) }
                } else _state.update { it.copy(running = false, problem = ImportProblem.Unreadable) }
            }
        }
    }

    /** Creates the resume and returns its id. */
    suspend fun create(): String {
        val s = _state.value
        check(s.canCreate)
        val selected = generation
        val file = requireNotNull(s.file)
        _state.update { it.copy(creating = true, problem = null) }
        try {
            val read = data
            return if (read != null && (s.readable || s.format == ImportFormat.ReactiveResume)) {
                val localized = withLocale(read, s.locale)
                resumes.importResume(ImportResumeRequest(ApiJson.decodeFromJsonElement(CreateResumeImportRequestData.serializer(), localized)))
            } else {
                val format = when (s.format) {
                    ImportFormat.LinkedIn -> ImportResumeFileFormat.LINKEDIN
                    ImportFormat.JsonResume -> ImportResumeFileFormat.JSONRESUME
                    ImportFormat.Pdf -> ImportResumeFileFormat.PDF
                    else -> ImportResumeFileFormat.REACTIVERESUME
                }
                resumes.importResumeFile(UploadPart("file", file.bytes, file.name, file.mime ?: "application/octet-stream"), format, ImportResumeFileLocale.entries.firstOrNull { it.wireValue == s.locale })
            }
        } catch (e: Exception) {
            if (selected == generation) _state.update { it.copy(problem = ImportProblem.CreateFailed) }
            throw e
        } finally {
            if (selected == generation) _state.update { it.copy(creating = false) }
        }
    }

    companion object {
        fun formatOf(file: PickedFile): ImportFormat {
            val ext = file.name.substringAfterLast('.', "").lowercase()
            return when {
                ext == "pdf" || file.mime == "application/pdf" -> ImportFormat.Pdf
                ext == "docx" || ext == "doc" || file.mime?.contains("wordprocessingml") == true || file.mime == "application/msword" -> ImportFormat.Word
                ext == "zip" || file.mime == "application/zip" -> ImportFormat.LinkedIn
                ext == "json" || file.mime == "application/json" -> {
                    val json = runCatching { ApiJson.parseToJsonElement(file.bytes.decodeToString()).jsonObject }.getOrNull()
                    when {
                        json == null -> ImportFormat.Unsupported
                        "sections" in json && "basics" in json -> ImportFormat.ReactiveResume
                        "basics" in json -> ImportFormat.JsonResume
                        else -> ImportFormat.Unsupported
                    }
                }
                else -> ImportFormat.Unsupported
            }
        }

        /** Counts from resume data, read as JSON so any reader's response shape works. */
        fun summarise(data: JsonObject): ImportSummary {
            fun JsonObject.text(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull.orEmpty()
            val basics = data["basics"] as? JsonObject ?: JsonObject(emptyMap())
            val sections = data["sections"] as? JsonObject ?: JsonObject(emptyMap())
            fun count(key: String) = ((sections[key] as? JsonObject)?.get("items") as? JsonArray)?.size ?: 0
            return ImportSummary(
                name = basics.text("name"),
                headline = basics.text("headline"),
                location = basics.text("location"),
                experience = count("experience"),
                education = count("education"),
                skills = count("skills"),
                languages = count("languages"),
                more = (data["customSections"] as? JsonArray)?.size ?: 0,
            )
        }

        /** Sets the resume language (section titles, date words, text direction); content is not translated. */
        fun withLocale(data: JsonObject, locale: String): JsonObject {
            val metadata = data["metadata"] as? JsonObject ?: return data
            val page = metadata["page"] as? JsonObject ?: return data
            return JsonObject(data + ("metadata" to JsonObject(metadata + ("page" to JsonObject(page + ("locale" to JsonPrimitive(locale)))))))
        }

        private fun upload(file: PickedFile) = CreatePdfParseRequestFile(Base64.getEncoder().encodeToString(file.bytes), file.name)

        private fun wordType(file: PickedFile) =
            if (file.name.lowercase().endsWith(".doc")) CreateDocxParseRequestMediaType.ApplicationMsword
            else CreateDocxParseRequestMediaType.ApplicationVndOpenxmlformatsOfficedocumentWordprocessingmlDocument
    }
}
