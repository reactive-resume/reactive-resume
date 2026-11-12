package me.rxresu.core.data

import androidx.compose.runtime.staticCompositionLocalOf
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emptyFlow
import me.rxresu.core.auth.AuthSession
import me.rxresu.core.auth.SessionState
import me.rxresu.core.database.SaveStatus
import me.rxresu.core.network.generated.*
import me.rxresu.core.network.generated.Application
import me.rxresu.core.page.PageRenderer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import me.rxresu.core.network.ApiJson
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.decodeFromJsonElement

/** Null data means not loaded. A failed refresh retains cached data and exposes its error. */
data class Resource<T>(val data: T? = null, val loading: Boolean = false, val offline: Boolean = false, val error: Throwable? = null)

@Serializable data class DocumentQuery(val text: String = "", val type: String = "all", val tags: List<String> = emptyList(), val sort: String = "edited", val trashed: Boolean = false, val publicOnly: Boolean = false)
@Serializable data class ApplicationQuery(val text: String = "", val stage: ApplicationStage? = null, val laneId: String? = null, val tags: List<String> = emptyList(), val showClosed: Boolean = false, val sort: ApplicationSort = ApplicationSort.Activity)
@Serializable enum class ApplicationSort { Activity, Company, Created }

/** Operation names/DTOs are generated from docs/spec.json; inherited methods are part of this public contract. */
interface AccountRepository : AuthenticationApiOperations, ApplicationProfileApiOperations, FilesApiOperations {
    val session: StateFlow<SessionState>
    fun observeProfile(): Flow<Resource<AccountProfile>>
    suspend fun signOut()
    fun securityInfo(): AccountSecurityInfo
}
sealed interface AccountSecurityInfo {
    data class BrowserRequired(val url: String):AccountSecurityInfo
    data class Available(val twoStepEnabled: Boolean,val backupCodesRemaining: Int,val passkeys: List<String>,val connectedProviders: List<String>,val sessionCount: Int):AccountSecurityInfo
}
interface DocumentsRepository : DocumentsApiOperations {
    fun observe(query: DocumentQuery = DocumentQuery()): Flow<Resource<List<DocumentSummary>>>
    suspend fun refresh()
    suspend fun duplicate(type: DocumentType, id: String, name: String? = null): String
}
interface ResumeRepository : ResumesApiOperations, ResumeSharingApiOperations, ResumeStatisticsApiOperations, CustomDomainApiOperations, FeedbackLinksApiOperations {
    suspend fun openDraft(id: String): DocumentDraft<Resume>
}
interface LettersRepository : CoverLettersApiOperations {
    suspend fun openDraft(id: String): DocumentDraft<CoverLetter>
}
interface ApplicationsRepository : ApplicationsApiOperations {
    fun observe(query: ApplicationQuery = ApplicationQuery()): Flow<Resource<List<Application>>>
    suspend fun refresh()
    suspend fun calendar(): List<CalendarItem>
    suspend fun insights(query: ApplicationQuery = ApplicationQuery()): ApplicationInsights
}
interface ChecksRepository : ChecksApiOperations {
    suspend fun getResumeChecks(id: String): GetResumeChecksResponse
}
interface AiRepository : AIApiOperations, AIProvidersApiOperations, IntegrationsApiOperations
interface AssistantRepository : AgentApiOperations
interface CareerRepository : CareerApiOperations
/** Workspace shares Career's persisted results/answers and Applications' posting, tailoring, and packet operations. */
interface WorkspaceRepository : CareerApiOperations, ApplicationsApiOperations
interface PublicRepository : ResumeSharingApiOperations, FeedbackLinksApiOperations
interface PlatformRepository : SystemApiOperations, FeatureFlagsApiOperations, PlatformStatisticsApiOperations

interface SearchRepository {
    fun search(query: String, scope: SearchScope = SearchScope.All): Flow<Resource<List<SearchHit>>>
    val recentSearches: Flow<List<String>>
    suspend fun remember(query: String)
}
enum class SearchScope { All, Documents, Applications, Career, Settings }
data class SearchHit(val id: String, val title: String, val subtitle: String, val kind: String, val documentId: String? = null, val applicationId: String? = null)

@Serializable
data class CalendarItem(val id: String, val applicationId: String, val company: String, val title: String, val at: String, val kind: String, val timezone: String? = null, val durationMinutes: Long? = null)
data class ApplicationInsights(val total: Int, val heardBack: Int, val medianDaysToReply: Double?, val byStage: Map<ApplicationStage, Int>, val byWeek: Map<String, Int>, val bySource: Map<String, Int>, val closed: Int)

interface DocumentDraft<T> {
    val state: StateFlow<DraftState<T>>
    /**
     * Someone else's change (an AI agent, another device) replaced the clean document after a refetch or a resume
     * update event. The draft records it as one undo step, so [undo] takes it back.
     */
    val outsideChanges: Flow<OutsideChange> get() = emptyFlow()
    /**
     * Persist before scheduling autosave. Retain UI's authored value if storage throws. An update passing the same
     * non-null [undoStep] as the update before it joins that update's undo step (the web's `coalesceKey` with
     * `sameStep`), so a multi-step action such as Fit to one page is undone at once.
     */
    suspend fun update(value: T, proposalApplications: JsonObject? = null, undoStep: String? = null)
    suspend fun undo()
    suspend fun redo()
    suspend fun flush()
    suspend fun refresh()
    suspend fun setEditing(editing: Boolean)
    /** Flushes before metadata writes; takes their checked revision without resetting undo history. */
    suspend fun writeMetadata(write: suspend (T) -> T): T
    suspend fun close()
}
/** [mutation] is the resume update stream's kind ("patch" is an AI agent, "lock"/"password" sharing), null after a refetch. */
data class OutsideChange(val mutation: String?)
data class DraftState<T>(val document: T?, val status: SaveStatus = SaveStatus.Saved, val locked: Boolean = false, val canUndo: Boolean = false, val canRedo: Boolean = false, val recoveredCopyId: String? = null, val recoveredCopyName: String? = null, val error: Throwable? = null, val proposalApplications: JsonObject = JsonObject(emptyMap()))
interface DraftsRepository {
    suspend fun sync(): Boolean
    fun pending(): Flow<List<PendingDraft>>
}
data class PendingDraft(val id: String, val type: String, val name: String, val status: SaveStatus)

class TimeSource(val clock: Clock = Clock.systemUTC(), val timezone: () -> ZoneId = { ZoneId.systemDefault() }) {
    fun now(): Instant = clock.instant()
    fun today() = now().atZone(timezone()).toLocalDate()
    companion object { fun storyboard() = TimeSource(Clock.fixed(Instant.parse("2026-11-07T09:00:00Z"),ZoneId.of("Europe/Lisbon"))) { ZoneId.of("Europe/Lisbon") } }
}

class RrRepositories(
    val account: AccountRepository,
    val documents: DocumentsRepository,
    val resumes: ResumeRepository,
    val letters: LettersRepository,
    val applications: ApplicationsRepository,
    val checks: ChecksRepository,
    val ai: AiRepository,
    val assistant: AssistantRepository,
    val workspace: WorkspaceRepository,
    val career: CareerRepository,
    val search: SearchRepository,
    val publicResume: PublicRepository,
    val platform: PlatformRepository,
    val preferences: PreferencesRepository,
    val today: TodayRepository,
    val drafts: DraftsRepository,
    val pages: PageRenderer,
    val authSession: AuthSession,
    val time: TimeSource,
    val workerFactory: androidx.work.WorkerFactory? = null,
    private val dispose: () -> Unit = {},
) : AutoCloseable {
    override fun close() = dispose()
}

val LocalRepositories = staticCompositionLocalOf<RrRepositories> { error("Provide RrRepositories in the app graph.") }

/** Write responses omit the read-only application link. Keep it when taking a metadata write's new revision. */
fun Resume.withWriteResult(result: PatchResumeResponse): Resume = ApiJson.decodeFromJsonElement(
    JsonObject(ApiJson.encodeToJsonElement(Resume.serializer(),this).let { it as JsonObject }+ApiJson.encodeToJsonElement(PatchResumeResponse.serializer(),result).let { it as JsonObject })
)

/**
 * Implemented by the Application, for code that runs outside composition (widget, notification workers, share
 * targets): `(context.applicationContext as RepositoriesProvider).repositories`.
 */
interface RepositoriesProvider {
    val repositories: RrRepositories
}
