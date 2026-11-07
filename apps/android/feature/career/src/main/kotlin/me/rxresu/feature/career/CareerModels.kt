package me.rxresu.feature.career

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.io.File
import java.security.MessageDigest
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.KSerializer
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.network.AccountChangedException
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.generated.*
import me.rxresu.core.network.generated.Story as StoryDto

internal fun RrRepositories.owner(): String? = when (val s = account.session.value) {
    is SessionState.SignedIn -> s.accountScope
    else -> null
}

/** Private, account-separated recovery files, excluded from Android backup. No credentials are stored. */
internal class CareerDrafts(context: Context, owner: String) {
    private val directory = File(context.noBackupFilesDir, "career/" + hash(owner)).apply { mkdirs() }
    private fun file(key: String) = File(directory, hash(key) + ".json")
    @Synchronized fun read(key: String): String? = file(key).takeIf(File::isFile)?.readText()
    @Synchronized fun write(key: String, value: String) {
        val target = file(key)
        val temp = File(directory, target.name + ".part")
        temp.outputStream().use { it.write(value.toByteArray()); it.fd.sync() }
        check(temp.renameTo(target)) { "Could not keep draft" }
    }
    @Synchronized fun remove(key: String) { file(key).delete() }
    private fun hash(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
}

internal open class CareerModel(protected val repositories: RrRepositories) : ViewModel() {
    private val owner = repositories.owner()
    protected val options = RequestOptions(accountScope = owner)
    protected fun checkOwner() { if (owner == null || repositories.owner() != owner) throw AccountChangedException() }
    protected fun run(onError: (Throwable) -> Unit, block: suspend () -> Unit) = viewModelScope.launch {
        try { checkOwner(); block() } catch (e: CancellationException) { throw e } catch (e: Exception) { onError(e) }
    }
}

internal data class CareerState(
    val loading: Boolean = true, val refreshing: Boolean = false, val error: Boolean = false,
    val facts: List<CareerFact> = emptyList(), val stories: List<StoryDto> = emptyList(),
    val threads: List<StartAgentThreadResponse> = emptyList(), val offers: List<SavedItem> = emptyList(),
    val schedules: List<CareerSchedule> = emptyList(), val providers: List<TestAiProviderResponse> = emptyList(),
    val scheduling: Boolean = false, val initials: String = "", val profile: CareerProfile? = null,
)
internal class CareerViewModel(repositories: RrRepositories) : CareerModel(repositories) {
    private val mutable = MutableStateFlow(CareerState())
    val state = mutable.asStateFlow()
    init { refresh() }
    fun refresh() = run({ mutable.update { it.copy(loading = false, refreshing = false, error = true) } }) {
        mutable.update { it.copy(refreshing = !it.loading, error = false) }
        val career = repositories.career
        val facts = career.listCareerFacts(options = options)
        val stories = career.listCareerStories(options = options)
        val threads = repositories.assistant.listAgentThreads(options = options).filter { it.scope == StartAgentThreadRequestScope.Career && it.applicationId == null && it.deletedAt == null }
        val offers = career.listCareerSavedItems(kind = ListCareerSavedItemsKind.Offer, options = options)
        val flags = repositories.platform.getFeatureFlags()
        val schedules = if (flags.careerSchedulingEnabled) career.listCareerSchedules(options) else emptyList()
        val providers = repositories.ai.listAiProviders(options = options).filter { it.enabled && it.testStatus == "success" }
        val profile = career.getCareerProfile(options)
        val name = repositories.account.getProfile(options).name
        checkOwner()
        mutable.value = CareerState(false, facts = facts, stories = stories, threads = threads, offers = offers, schedules = schedules, providers = providers,
            scheduling = flags.careerSchedulingEnabled, initials = name.split(' ').mapNotNull { it.firstOrNull()?.toString() }.take(2).joinToString(""), profile = profile)
    }
    fun copyConversation(id: String, done: (String) -> Unit) = run({ mutable.update { it.copy(error = true) } }) {
        val transport = me.rxresu.core.network.ApiClient(repositories.authSession, repositories.authSession, accountScope = { repositories.owner() })
        val raw = transport.execute(me.rxresu.core.network.ApiRequest("getAgentThread", "GET", "/agent/threads/{id}", mapOf("id" to id), options = options)) as kotlinx.serialization.json.JsonObject
        checkOwner(); done(coachMessages(raw).joinToString("\n\n") { it.text })
    }
    fun rename(id: String, title: String) = run({ mutable.update { it.copy(error = true) } }) {
        repositories.assistant.updateAgentThread(id, UpdateAgentThreadRequest(title = title), options); refresh()
    }
    fun deleteThread(id: String) = run({ mutable.update { it.copy(error = true) } }) { repositories.assistant.deleteAgentThread(id, options); refresh() }
}

internal data class FactsState(
    val loading: Boolean = true, val error: Boolean = false, val busy: Boolean = false,
    val facts: List<CareerFact> = emptyList(), val stories: List<StoryDto> = emptyList(),
    val profile: CareerProfile? = null, val resumes: List<DocumentSummary> = emptyList(),
    val proposals: ProposeResumeFactsResponse? = null, val applications: List<ApplicationSummary> = emptyList(),
    val forgotten: List<ListForgottenCareerFactCountsResponseItem> = emptyList(), val pendingForget: Set<String> = emptySet(),
)
internal class KnowledgeViewModel(repositories: RrRepositories) : CareerModel(repositories) {
    private val mutable = MutableStateFlow(FactsState())
    val state = mutable.asStateFlow()
    init { refresh() }
    fun refresh() = run({ mutable.update { it.copy(loading = false, error = true, busy = false) } }) {
        val facts = repositories.career.listCareerFacts(all = true, options = options)
        val stories = repositories.career.listCareerStories(options = options)
        val profile = repositories.career.getCareerProfile(options)
        val applications = repositories.applications.listApplicationSummaries(options = options)
        val forgotten = repositories.career.listForgottenCareerFactCounts(options)
        checkOwner(); mutable.update { it.copy(loading = false, error = false, busy = false, facts = facts.filter { row -> row.status != "forgotten" }, stories = stories, profile = profile, applications = applications, forgotten = forgotten) }
    }
    fun add(text: String, category: SaveCareerFactRequestCategory, applicationId: String? = null, done: () -> Unit) = mutate {
        if (text.isBlank()) return@mutate
        repositories.career.saveCareerFact(SaveCareerFactRequest(text = text.trim(), category = category, applicationId = applicationId,
            source = SaveCareerFactRequestSource(UUID.randomUUID().toString(), ExportAccountDataResponseCareerFactsItemSourceKind.Manual, text.trim())), options)
        checkOwner(); done()
    }
    fun correct(fact: CareerFact, text: String, category: SaveCareerFactRequestCategory, applicationId: String?, done: () -> Unit) = mutate {
        repositories.career.correctCareerFact(fact.id, CorrectCareerFactRequest(applicationId, CorrectCareerFactRequestBefore(fact.applicationId, fact.category, fact.text), category, text.trim()), options.copy(nullFields = if (applicationId == null) setOf("/applicationId") else emptySet()))
        checkOwner(); done()
    }

    fun forget(fact: CareerFact, undo: suspend () -> Boolean) = run({ mutable.update { it.copy(error = true, pendingForget = it.pendingForget - fact.id) } }) {
        mutable.update { it.copy(pendingForget = it.pendingForget + fact.id) }
        try {
            // Forget erases the source text. Undo must finish before that irreversible request.
            if (!undo()) { checkOwner(); repositories.career.forgetCareerFact(fact.id, options); refresh().join() }
        } finally { mutable.update { it.copy(pendingForget = it.pendingForget - fact.id) } }
    }
    fun memory(mode: SaveCareerProfileRequestMemoryMode) = mutate { repositories.career.updateCareerProfile(SaveCareerProfileRequest(memoryMode = mode), options) }
    fun chooseResume() = mutate { val rows = repositories.documents.listDocuments(options = options).filter { it.type == DocumentType.Resume }; checkOwner(); mutable.update { it.copy(resumes = rows) } }
    fun propose(id: String) = mutate { val proposals = repositories.career.proposeResumeFacts(ProposeResumeFactsRequest(id), options); checkOwner(); mutable.update { it.copy(proposals = proposals) } }
    fun saveProposals(selected: Set<Int>, done: () -> Unit) = mutate {
        val p = state.value.proposals ?: return@mutate
        repositories.career.saveResumeFacts(SaveResumeFactsRequest(p.proposals.filterIndexed { i, _ -> i in selected }, p.id, p.updatedAt), options)
        checkOwner(); mutable.update { it.copy(proposals = null) }; done()
    }
    private fun mutate(block: suspend () -> Unit) = run({ mutable.update { it.copy(error = true, busy = false) } }) {
        mutable.update { it.copy(busy = true, error = false) }; block(); refresh()
    }
}

internal enum class SaveState { Saved, Saving, KeptOnDevice, Failed }
internal data class StoryState(val loading: Boolean = true, val draft: SaveCareerStoryRequest? = null, val status: SaveState = SaveState.Saved, val error: Boolean = false, val facts: List<CareerFact> = emptyList())
internal class StoryViewModel(repositories: RrRepositories, private val drafts: CareerDrafts, private val id: String?) : CareerModel(repositories) {
    private val key = "story:${id ?: "new"}"
    private val mutable = MutableStateFlow(StoryState())
    val state = mutable.asStateFlow()
    private val saves = Mutex()
    private var generation = 0
    private var pending: Job? = null
    init { load() }
    fun load() = run({ mutable.update { it.copy(loading = false, error = true) } }) {
        val recovered = drafts.read(key)?.let { ApiJson.decodeFromString(SaveCareerStoryRequest.serializer(), it) }
        val rows = repositories.career.listCareerStories(options = options)
        val story = rows.firstOrNull { it.id == id }
        val draft = recovered ?: story?.let { SaveCareerStoryRequest(it.data.action, it.applicationId, it.data.factIds, it.id, it.data.reflection, it.data.result, it.data.situation, it.data.tags, it.data.task, it.data.title) }
            ?: if (id == null) SaveCareerStoryRequest("", id = UUID.randomUUID().toString(), situation = "", task = "", title = "") else null
        val facts = repositories.career.listCareerFacts(options = options)
        checkOwner(); mutable.value = StoryState(false, draft, if (recovered != null) SaveState.KeptOnDevice else SaveState.Saved, draft == null, facts)
    }
    fun change(next: SaveCareerStoryRequest) {
        generation++; mutable.update { it.copy(draft = next, status = SaveState.Saving, error = false) }
        try { drafts.write(key, ApiJson.encodeToString(SaveCareerStoryRequest.serializer(), next)) }
        catch (_: Exception) { mutable.update { it.copy(status = SaveState.Failed, error = true) }; return }
        pending?.cancel(); pending = viewModelScope.launch { delay(500); save() }
    }
    fun save() = run({ mutable.update { it.copy(status = SaveState.KeptOnDevice, error = true) } }) { saves.withLock {
        val next = state.value.draft ?: return@withLock
        if (next.title.isBlank()) return@withLock
        val revision = generation
        mutable.update { it.copy(status = SaveState.Saving) }
        repositories.career.saveCareerStory(next, options); checkOwner()
        if (revision == generation) { drafts.remove(key); mutable.update { it.copy(status = SaveState.Saved, error = false) } }
    } }
    fun delete(done: (SaveCareerStoryRequest) -> Unit) = run({ mutable.update { it.copy(error = true) } }) { saves.withLock {
        pending?.cancel(); val draft = state.value.draft ?: return@withLock
        draft.id?.let { repositories.career.deleteCareerStory(it, options) }; checkOwner(); drafts.remove(key); done(draft)
    } }
}

internal data class PreferencesState(val loading: Boolean = true, val profile: CareerProfile? = null, val status: SaveState = SaveState.Saved, val error: Boolean = false,
    val providers: List<TestAiProviderResponse> = emptyList(), val resumes: List<DocumentSummary> = emptyList(), val suggestions: List<String> = emptyList(), val generating: Boolean = false)
internal fun CareerProfile.preferencesRequest() = SaveCareerProfileRequest(locations, maxOfficeDays, minBase = minBase, noticeWeeks = noticeWeeks, priorities = priorities, searchRegions = searchRegions, targetRoles = targetRoles)
internal fun parseWholeAmount(value: String): Double? = value.takeIf { it.matches(Regex("[0-9]{1,12}")) }?.toDoubleOrNull()?.takeIf { it.isFinite() }
internal class PreferencesViewModel(repositories: RrRepositories, private val drafts: CareerDrafts) : CareerModel(repositories) {
    private val mutable = MutableStateFlow(PreferencesState()); val state = mutable.asStateFlow()
    private val saves = Mutex(); private var pending: Job? = null; private var generation = 0
    init { load() }
    fun load() = run({ mutable.update { it.copy(loading = false, error = true) } }) {
        val profile = repositories.career.getCareerProfile(options)
        val recovered = drafts.read("preferences")?.let { ApiJson.decodeFromString(CareerProfile.serializer(), it) }
        val providers = repositories.ai.listAiProviders(options = options).filter { it.enabled && it.testStatus == "success" }
        val resumes = repositories.documents.listDocuments(options = options).filter { it.type == DocumentType.Resume }
        checkOwner(); mutable.value = PreferencesState(false, recovered?.copy(memoryMode = profile.memoryMode) ?: profile,
            if (recovered != null) SaveState.KeptOnDevice else SaveState.Saved, providers = providers, resumes = resumes)
    }
    fun change(profile: CareerProfile) {
        generation++; mutable.update { it.copy(profile = profile, status = SaveState.Saving, error = false) }
        try { drafts.write("preferences", ApiJson.encodeToString(CareerProfile.serializer(), profile)) }
        catch (_: Exception) { mutable.update { it.copy(status = SaveState.Failed, error = true) }; return }
        pending?.cancel(); pending = viewModelScope.launch { delay(500); save() }
    }
    fun save() = run({ mutable.update { it.copy(status = SaveState.KeptOnDevice, error = true) } }) { saves.withLock {
        val profile = state.value.profile ?: return@withLock; val revision = generation
        repositories.career.updateCareerProfile(profile.preferencesRequest(), options.copy(nullFields = buildSet {
            if (profile.maxOfficeDays == null) add("/maxOfficeDays"); if (profile.noticeWeeks == null) add("/noticeWeeks"); if (profile.minBase.amount == null) add("/minBase/amount")
        })); checkOwner()
        if (generation == revision) { drafts.remove("preferences"); mutable.update { it.copy(status = SaveState.Saved, error = false) } }
    } }
    fun suggest(provider: TestAiProviderResponse, resumeId: String?, knowledge: Boolean) = run({ mutable.update { it.copy(error = true, generating = false) } }) {
        mutable.update { it.copy(generating = true, error = false) }
        val result = repositories.career.suggestCareerTargetRoles(SuggestCareerTargetRolesRequest(knowledge, providerId = provider.id, recipientVersion = provider.recipientVersion, resumeId = resumeId), options.copy(headers = aiApproval(provider)))
        checkOwner(); mutable.update { it.copy(generating = false, suggestions = result.suggestions.map { s -> s.role }) }
    }
}


internal data class OffersState(val loading: Boolean = true, val error: Boolean = false, val busy: Boolean = false,
    val offers: List<SavedItem> = emptyList(), val profile: CareerProfile? = null, val applications: List<me.rxresu.core.network.generated.Application> = emptyList())
internal class OffersViewModel(repositories: RrRepositories) : CareerModel(repositories) {
    private val mutable = MutableStateFlow(OffersState()); val state = mutable.asStateFlow()
    init { refresh() }
    fun refresh() = run({ mutable.update { it.copy(loading = false, busy = false, error = true) } }) {
        val offers = repositories.career.listCareerSavedItems(kind = ListCareerSavedItemsKind.Offer, options = options)
        val profile = repositories.career.getCareerProfile(options)
        val applications = repositories.applications.listApplications(options = options)
        checkOwner(); mutable.value = OffersState(false, offers = offers, profile = profile, applications = applications)
    }
    fun save(applicationId: String, terms: UpdateCareerOfferRequestTerms, existing: SavedItem?, done: () -> Unit) = run({ mutable.update { it.copy(busy = false, error = true) } }) {
        mutable.update { it.copy(busy = true, error = false) }
        if (existing == null) repositories.career.createCareerOffer(CreateCareerOfferRequest(applicationId, terms.base, terms.currency, terms.equity, terms.learning, terms.leave, terms.location, terms.officeDays, terms.other, terms.period, terms.respondBy, terms.startDate, terms.variable, terms.variableConditions, terms.variablePercent, terms.version), options)
        else repositories.career.updateCareerOffer(existing.id, UpdateCareerOfferRequest(offerTerms(existing.data as Offer), terms = terms), options.copy(nullFields = nullableOfferFields(terms)))
        checkOwner(); done(); refresh()
    }
    fun delete(id: String, done: () -> Unit) = run({ mutable.update { it.copy(error = true) } }) { repositories.career.deleteCareerSavedItem(id, options); checkOwner(); done(); refresh() }
}
internal fun offerTerms(offer: Offer) = UpdateCareerOfferRequestTerms(offer.base, offer.currency, offer.equity, offer.learning, offer.leave, offer.location, offer.officeDays, offer.other, offer.period, offer.respondBy, offer.startDate, offer.variable, offer.variableConditions, offer.variablePercent, offer.version)
internal fun nullableOfferFields(terms: UpdateCareerOfferRequestTerms): Set<String> = buildSet {
    val fields = ApiJson.encodeToJsonElement(UpdateCareerOfferRequestTerms.serializer(), terms) as kotlinx.serialization.json.JsonObject
    for (name in listOf("base", "equity", "learning", "leave", "location", "officeDays", "other", "respondBy", "startDate", "variable", "variableConditions", "variablePercent", "version")) if (name !in fields) add("/terms/$name")
}

internal data class ScheduleState(val loading: Boolean = true, val error: Boolean = false, val busy: Boolean = false, val available: Boolean = false,
    val existing: CareerSchedule? = null, val providers: List<TestAiProviderResponse> = emptyList(), val profile: CareerProfile? = null,
    val email: String = "", val emailVerified: Boolean = false, val web: GetWebAccessStatusResponse? = null, val applications: List<me.rxresu.core.network.generated.Application> = emptyList())
internal fun zonedScheduleInstant(date: LocalDate, time: LocalTime, zone: ZoneId): String? {
    val local = LocalDateTime.of(date, time); val offsets = zone.rules.getValidOffsets(local)
    // Skipped and repeated wall-clock times need an explicit choice; never silently change a person's time.
    return offsets.singleOrNull()?.let { local.toInstant(it).toString() }
}
internal class ScheduleViewModel(repositories: RrRepositories, private val id: String?) : CareerModel(repositories) {
    private val mutable = MutableStateFlow(ScheduleState()); val state = mutable.asStateFlow()
    init { load() }
    fun load() = run({ mutable.update { it.copy(loading = false, error = true) } }) {
        val flags = repositories.platform.getFeatureFlags()
        val existing = if (flags.careerSchedulingEnabled) repositories.career.listCareerSchedules(options).firstOrNull { it.id == id } else null
        val providers = repositories.ai.listAiProviders(options = options).filter { it.enabled && it.testStatus == "success" }
        val profile = repositories.career.getCareerProfile(options)
        val account = repositories.account.getProfile(options)
        val applications = repositories.applications.listApplications(options = options)
        val web = repositories.ai.getWebAccessStatus(options)
        checkOwner(); mutable.value = ScheduleState(false, available = flags.careerSchedulingEnabled, existing = existing, providers = providers, profile = profile, email = account.email, emailVerified = account.emailVerified && flags.smtpEnabled, web = web, applications = applications)
    }
    fun save(request: SaveCareerScheduleRequest, done: () -> Unit) = run({ mutable.update { it.copy(busy = false, error = true) } }) {
        mutable.update { it.copy(busy = true, error = false) }
        val headers = when {
            request.enabled == false || request.kind == SaveCareerScheduleRequestKind.FollowUp -> emptyMap()
            request.kind == SaveCareerScheduleRequestKind.Discovery -> {
                val captured = state.value.web ?: error("Web access unavailable")
                require(captured.search && repositories.ai.getWebAccessStatus(options).revision == captured.revision)
                mapOf("x-ai-destination" to "none", "x-web-destination" to captured.revision)
            }
            else -> {
                val provider = state.value.providers.firstOrNull { it.id == request.aiProviderId } ?: error("Choose a connection")
                require(repositories.ai.listAiProviders(options = options).firstOrNull { it.id == provider.id }?.recipientVersion == provider.recipientVersion)
                aiApproval(provider)
            }
        }
        repositories.career.saveCareerSchedule(request, options.copy(headers = headers)); checkOwner(); done()
    }
    fun delete(done: (CareerSchedule) -> Unit) = run({ mutable.update { it.copy(error = true) } }) {
        val existing = state.value.existing ?: return@run; repositories.career.deleteCareerSchedule(existing.id, options); checkOwner(); done(existing)
    }
    fun restore(schedule: CareerSchedule) = run({ mutable.update { it.copy(error = true) } }) {
        repositories.career.saveCareerSchedule(SaveCareerScheduleRequest(schedule.aiProviderId, schedule.applicationId, schedule.email, schedule.enabled,
            intervalDays = schedule.intervalDays, interviewId = schedule.interviewId, kind = SaveCareerScheduleRequestKind.entries.first { it.wireValue == schedule.kind },
            lead = SaveCareerScheduleRequestLead.entries.firstOrNull { it.wireValue == schedule.lead }, locale = schedule.locale, nextRunAt = schedule.nextRunAt, query = schedule.query, timezone = schedule.timezone), options)
    }
}
