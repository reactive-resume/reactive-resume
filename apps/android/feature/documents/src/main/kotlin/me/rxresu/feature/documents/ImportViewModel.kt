package me.rxresu.feature.documents

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.util.Base64
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
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
import me.rxresu.core.auth.SessionState
import me.rxresu.core.network.ApiException
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.generated.CreateDocxParseRequest
import me.rxresu.core.network.generated.CreateDocxParseRequestMediaType
import me.rxresu.core.network.generated.CreatePdfParseRequest
import me.rxresu.core.network.generated.CreatePdfParseRequestFile
import me.rxresu.core.network.generated.CreatePdfParseResponse
import me.rxresu.core.network.generated.CreateResumeImportRequestData
import me.rxresu.core.network.generated.ImportResumeRequest
import me.rxresu.core.network.generated.TestAiProviderResponse

/** Keeps default values, so a reader's response converts into the import request, which requires them. */
private val Full = kotlinx.serialization.json.Json(ApiJson) { encodeDefaults = true }

/** A file chosen in the system picker or shared from another app. */
class PickedFile(val name: String, val size: Long, val mime: String?, val bytes: ByteArray, val pages: Int? = null)

enum class ImportFormat { Pdf, Word, LinkedIn, ReactiveResume, JsonResume, Unsupported }

enum class ImportMethod { Local, Ai }

enum class ImportProblem { Unreadable, WordNeedsAi, WrongType, CreateFailed, DestinationChanged, AccountChanged, Scanned, Password, Partial, TooLarge, UnsupportedReader, LegacyWord }

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
    val method: ImportMethod = ImportMethod.Local,
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
    val canCreate: Boolean get() = file != null && !running && !creating && (problem == null || problem == ImportProblem.CreateFailed) && summary != null
}

/**
 * D4: the bundled shared reader handles PDF, JSON and LinkedIn locally. Word requires an explicit AI action.
 * Only Create sends the locally read data to the selected account.
 */
internal class ImportViewModel(
    private val resumes: ResumeRepository,
    private val ai: AiRepository,
    private val session: StateFlow<SessionState>,
    private val readLocal: suspend (PickedFile, (Int) -> Unit) -> LocalImportResult,
) : ViewModel() {
    private val _state = MutableStateFlow(ImportUiState())
    val state: StateFlow<ImportUiState> = _state.asStateFlow()
    private var data: JsonObject? = null
    private var provider: TestAiProviderResponse? = null
    private var generation = 0L
    private var work: Job? = null
    private var owner: String? = null

    init {
        viewModelScope.launch { refreshProvider() }
        viewModelScope.launch {
            session.map { it.importScope() }.distinctUntilChanged().collect { scope ->
                if (owner != null && scope != owner) {
                    work?.cancel()
                    generation++
                    data = null
                    provider = null
                    _state.update { ImportUiState(problem = ImportProblem.AccountChanged) }
                }
            }
        }
    }

    private suspend fun refreshProvider() {
        val scope = session.value.importScope()
        val next = runCatching { ai.listAiProviders(options = RequestOptions(accountScope = scope)) }.getOrNull().orEmpty().filter { it.enabled }
            .let { list -> list.firstOrNull { it.isDefault } ?: list.firstOrNull() }
        if (scope != session.value.importScope()) return
        provider = next
        _state.update { it.copy(aiProvider = next?.label, aiDestination = next?.baseURL, problem = if (it.problem == ImportProblem.WordNeedsAi && next != null) null else it.problem) }
    }

    fun start(file: PickedFile) {
        work?.cancel()
        generation++
        owner = session.value.importScope()
        val oversized = file.size > 10 * 1024 * 1024 || file.bytes.size > 10 * 1024 * 1024
        val format = if (oversized) ImportFormat.Unsupported else formatOf(file)
        data = null
        val method = if (format == ImportFormat.Word) ImportMethod.Ai else ImportMethod.Local
        _state.update { ImportUiState(file = file, format = format, method = method, aiProvider = it.aiProvider, aiDestination = it.aiDestination, locale = it.locale) }
        if (owner == null) {
            _state.update { ImportUiState(problem = ImportProblem.AccountChanged) }
            return
        }
        if (oversized) {
            _state.update { it.copy(problem = ImportProblem.TooLarge) }
            return
        }
        if (file.name.endsWith(".doc", true) || file.mime == "application/msword") {
            _state.update { it.copy(problem = ImportProblem.LegacyWord) }
            return
        }
        when (format) {
            ImportFormat.Unsupported -> _state.update { it.copy(problem = ImportProblem.WrongType) }
            ImportFormat.Word -> if (_state.value.aiProvider == null) _state.update { it.copy(problem = ImportProblem.WordNeedsAi) }
            else -> read()
        }
    }

    /** Switching to AI never sends anything by itself: the screen shows the disclosure, then calls [read]. */
    fun setMethod(method: ImportMethod) {
        if (_state.value.format != ImportFormat.Pdf || method == _state.value.method) return
        work?.cancel()
        generation++
        data = null
        _state.update { it.copy(method = method, progress = 0, running = false, summary = null, problem = null) }
        if (method == ImportMethod.Local) read()
    }

    fun setLocale(locale: String) = _state.update { it.copy(locale = locale) }

    /** Runs the chosen reader. Steps advance when the work does. */
    fun read() {
        val s = _state.value
        val file = s.file ?: return
        if (s.format == ImportFormat.Unsupported || s.running || !currentOwner()) return
        val disclosed = if (s.method == ImportMethod.Ai) provider ?: return else null
        val selected = generation
        work = viewModelScope.launch {
            _state.update { it.copy(running = true, progress = 1, summary = null, problem = null) }
            try {
                var pages: Int? = file.pages
                val found: JsonElement = when {
                    s.method == ImportMethod.Local -> readLocal(file) { stage ->
                        if (selected == generation && currentOwner()) _state.update { it.copy(progress = stage + 1) }
                    }.let { pages = it.pages ?: pages; it.data }
                    s.format == ImportFormat.Word -> Full.encodeToJsonElement(
                        CreatePdfParseResponse.serializer(),
                        ai.parseResumeDocx(CreateDocxParseRequest(file = upload(file), mediaType = wordType(file), aiProviderId = disclosed!!.id), RequestOptions(accountScope = owner).approvedFor(disclosed)),
                    )
                    else -> Full.encodeToJsonElement(CreatePdfParseResponse.serializer(), ai.parseResumePdf(CreatePdfParseRequest(file = upload(file), aiProviderId = disclosed!!.id), RequestOptions(accountScope = owner).approvedFor(disclosed)))
                }
                if (selected != generation || !currentOwner()) return@launch
                _state.update { it.copy(progress = 2) }
                val json = found.jsonObject
                data = json
                _state.update { it.copy(file = PickedFile(file.name, file.size, file.mime, file.bytes, pages), progress = 3, running = false, summary = summarise(json)) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (selected != generation || !currentOwner()) return@launch
                if (e is ApiException && e.status == 409 && e.message.startsWith("Your AI destination changed")) {
                    refreshProvider()
                    if (selected == generation) _state.update { it.copy(running = false, progress = 0, problem = ImportProblem.DestinationChanged) }
                } else _state.update { it.copy(running = false, problem = when ((e as? LocalImportException)?.code) {
                    "scanned" -> ImportProblem.Scanned
                    "password" -> ImportProblem.Password
                    "partial" -> ImportProblem.Partial
                    "too-large" -> ImportProblem.TooLarge
                    "wrong-type" -> ImportProblem.WrongType
                    "unsupported" -> ImportProblem.UnsupportedReader
                    else -> ImportProblem.Unreadable
                }) }
            }
        }
    }

    /** Creates the resume and returns its id. */
    suspend fun create(): String {
        val s = _state.value
        check(s.canCreate)
        check(currentOwner()) { "Account changed" }
        val selected = generation
        _state.update { it.copy(creating = true, problem = null) }
        try {
            val localized = withLocale(requireNotNull(data), s.locale)
            val id = resumes.importResume(ImportResumeRequest(ApiJson.decodeFromJsonElement(CreateResumeImportRequestData.serializer(), localized)), RequestOptions(accountScope = owner))
            check(selected == generation && currentOwner()) { "Import changed" }
            return id
        } catch (e: Exception) {
            if (selected == generation) _state.update { it.copy(problem = ImportProblem.CreateFailed) }
            throw e
        } finally {
            if (selected == generation) _state.update { it.copy(creating = false) }
        }
    }

    private fun currentOwner() = owner != null && owner == session.value.importScope()

    private fun SessionState.importScope(): String? = when (this) {
        is SessionState.SignedIn -> accountScope
        is SessionState.Expired -> accountScope
        else -> null
    }

    companion object {
        fun formatOf(file: PickedFile): ImportFormat {
            val ext = file.name.substringAfterLast('.', "").lowercase()
            val pdf = file.bytes.size >= 4 && file.bytes.copyOfRange(0, 4).contentEquals("%PDF".toByteArray())
            val zip = file.bytes.size >= 4 && file.bytes.copyOfRange(0, 4).contentEquals(byteArrayOf(0x50, 0x4b, 0x03, 0x04))
            return when {
                pdf || ext == "pdf" || file.mime == "application/pdf" -> ImportFormat.Pdf
                ext == "docx" || ext == "doc" || file.mime?.contains("wordprocessingml") == true || file.mime == "application/msword" -> ImportFormat.Word
                ext == "zip" || file.mime == "application/zip" -> ImportFormat.LinkedIn
                zip -> ImportFormat.Word
                ext == "json" || file.mime == "application/json" || file.bytes.take(64).toByteArray().decodeToString().trimStart().startsWith("{") -> {
                    val raw = runCatching { ApiJson.parseToJsonElement(file.bytes.decodeToString()).jsonObject }.getOrNull()
                    val json = if (raw?.get("data") is JsonObject && "sections" !in raw && "metadata" !in raw) raw["data"]!!.jsonObject else raw
                    when {
                        json == null -> ImportFormat.Unsupported
                        "sections" in json || "metadata" in json -> ImportFormat.ReactiveResume
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
