package me.rxresu.feature.career

import androidx.lifecycle.viewModelScope
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.network.*
import me.rxresu.core.network.generated.*

internal data class CoachMessage(val id: String, val text: String, val mine: Boolean, val parts: List<JsonObject> = emptyList(), val used: JsonObject? = null)
internal data class CoachFact(val callId: String, val fact: SaveCareerFactRequest, val savedId: String? = null)
internal data class CoachState(val loading: Boolean = true, val draft: String = "", val providers: List<TestAiProviderResponse> = emptyList(),
    val selected: String? = null, val messages: List<CoachMessage> = emptyList(), val memory: Boolean = true, val applications: Boolean = true,
    val knowledgeReady: Boolean = false, val error: Boolean = false, val thread: StartAgentThreadResponse? = null, val readOnly: Boolean = false,
    val facts: List<CareerFact> = emptyList(), val stories: List<Story> = emptyList(),
    val busy: Boolean = false, val pendingFacts: List<CoachFact> = emptyList(), val sources: List<Pair<String, String>> = emptyList(), val server: String = "")

/** UIMessage parts are open JSON in the published contract. The generator currently erases their text/tool fields. */
internal fun coachMessages(raw: JsonObject): List<CoachMessage> = (raw["messages"] as? JsonArray).orEmpty().mapNotNull { item ->
    val row = item as? JsonObject ?: return@mapNotNull null
    val id = row["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
    val parts = (row["parts"] as? JsonArray).orEmpty().filterIsInstance<JsonObject>()
    CoachMessage(id, parts.filter { it["type"]?.jsonPrimitive?.contentOrNull == "text" }.joinToString("\n\n") { it["text"]?.jsonPrimitive?.contentOrNull.orEmpty() }, row["role"]?.jsonPrimitive?.contentOrNull == "user", parts, (row["metadata"] as? JsonObject)?.get("context") as? JsonObject)
}
internal fun coachChunks(data: String): List<JsonObject> {
    if (data.trim() == "[DONE]") return emptyList()
    val parsed = runCatching { ApiJson.parseToJsonElement(data) }.getOrNull()
    if (parsed is JsonPrimitive && parsed.isString) return coachChunks(parsed.content)
    if (parsed is JsonObject) {
        if (parsed["type"] is JsonPrimitive) return listOf(parsed)
        (parsed["json"] as? JsonPrimitive)?.takeIf { it.isString }?.let { return coachChunks(it.content) }
    }
    return data.lineSequence().filter { it.startsWith("data:") }.flatMap { coachChunks(it.removePrefix("data:").trim()).asSequence() }.toList()
}
internal fun aiApproval(provider: TestAiProviderResponse): Map<String, String> = mapOf("x-ai-destination" to JsonArray(listOf(JsonPrimitive(provider.id), JsonPrimitive(provider.recipientVersion))).toString())

internal class CoachViewModel(repositories: RrRepositories, private val drafts: CareerDrafts, private val id: String?, starter: String?,
    private val transport: ApiTransport = ApiClient(repositories.authSession, repositories.authSession, timezone = repositories.time.timezone, accountScope = { repositories.owner() }),
) : CareerModel(repositories) {
    private val key = "coach:${id ?: "new"}"
    private val mutable = MutableStateFlow(CoachState(draft = starter.orEmpty(), server = repositories.authSession.origin.value)); val state = mutable.asStateFlow()
    private var streaming: Job? = null
    private var starterPending: String? = starter
    init { load() }
    private suspend fun history(threadId: String): JsonObject = transport.execute(ApiRequest("getAgentThread", "GET", "/agent/threads/{id}", mapOf("id" to threadId), options = options)).jsonObject
    fun load() = run({ mutable.update { it.copy(loading = false, error = true) } }) {
        val starter = starterPending
        if (starter != null && id == null) {
            // A new starter must not replace an earlier conversation's unsent words.
            drafts.read("$key:thread")?.let { old ->
                drafts.read(key)?.let { drafts.write("coach:$old", it) }
                drafts.read("$key:message")?.let { drafts.write("coach:$old:message", it) }
            }
            drafts.remove("$key:thread"); drafts.remove("$key:message"); drafts.write(key, starter); starterPending = null
        }
        drafts.read(key)?.let { recovered -> mutable.update { it.copy(draft = recovered) } }
        val providers = repositories.ai.listAiProviders(options = options).filter { it.enabled && it.testStatus == "success" }
        val recoveredId = id ?: drafts.read("$key:thread")
        val raw = recoveredId?.let { history(it) }
        val thread = raw?.get("thread")?.let { ApiJson.decodeFromJsonElement(StartAgentThreadResponse.serializer(), it) }
        checkOwner()
        mutable.update { it.copy(loading = false, providers = providers, selected = thread?.aiProviderId, thread = thread,
            readOnly = raw?.get("isReadOnly")?.jsonPrimitive?.booleanOrNull == true, messages = raw?.let(::coachMessages).orEmpty(), error = false) }
        refreshProposals(); loadKnowledge()
        if (thread?.activeRunId != null) resume(thread.id)
    }
    fun loadKnowledge() = run({ mutable.update { it.copy(knowledgeReady = false, error = true) } }) {
        repositories.career.getCareerProfile(options)
        val facts = repositories.career.listCareerFacts(options = options).filter { it.status == "active" && it.applicationId == null }
        val stories = repositories.career.listCareerStories(options = options).filter { it.applicationId == null && it.data.factIds.orEmpty().all { id -> facts.any { fact -> fact.id == id } } }
        checkOwner(); mutable.update { it.copy(knowledgeReady = true, error = false, facts = facts, stories = stories) }
    }
    fun adoptThread(): Boolean {
        val thread = state.value.thread ?: return false
        if (id != null) return true
        return try {
            drafts.write("coach:${thread.id}", state.value.draft)
            drafts.remove(key); drafts.remove("$key:thread"); drafts.remove("$key:message")
            true
        } catch (_: Exception) { mutable.update { it.copy(error = true) }; false }
    }
    fun draft(text: String) {
        mutable.update { it.copy(draft = text) }
        try { drafts.write(key, text) } catch (_: Exception) { mutable.update { it.copy(error = true) } }
    }
    fun memory(value: Boolean) { mutable.update { it.copy(memory = value) } }
    fun applications(value: Boolean) { mutable.update { it.copy(applications = value) } }
    fun provider(provider: TestAiProviderResponse) = run({ mutable.update { it.copy(error = true) } }) {
        val fresh = repositories.ai.listAiProviders(options = options).firstOrNull { it.id == provider.id }
        require(fresh?.recipientVersion == provider.recipientVersion)
        state.value.thread?.let { repositories.assistant.updateAgentThread(it.id, UpdateAgentThreadRequest(aiProviderId = provider.id), options.copy(headers = aiApproval(provider))) }
        checkOwner(); mutable.update { it.copy(selected = provider.id) }
    }
    fun send() {
        val before = state.value
        val provider = before.providers.firstOrNull { it.id == before.selected } ?: return
        if (before.busy || before.readOnly || before.draft.isBlank() || before.memory && !before.knowledgeReady) return
        streaming = run({ mutable.update { it.copy(busy = false, error = true) } }) {
            mutable.update { it.copy(busy = true, error = false) }
            val fresh = repositories.ai.listAiProviders(options = options).firstOrNull { it.id == provider.id }
            require(fresh?.recipientVersion == provider.recipientVersion && fresh.enabled && fresh.testStatus == "success")
            val thread = before.thread ?: repositories.assistant.startAgentThread(StartAgentThreadRequest(aiProviderId = provider.id, scope = StartAgentThreadRequestScope.Career), options)
            checkOwner(); drafts.write("$key:thread", thread.id)
            mutable.update { it.copy(thread = thread) }
            val messageId = drafts.read("$key:message") ?: UUID.randomUUID().toString().also { drafts.write("$key:message", it) }
            val previous = coachMessages(history(thread.id))
            val sentText = previous.firstOrNull { it.id == messageId }?.text ?: before.draft
            if (previous.any { it.id == messageId }) {
                mutable.update { it.copy(messages = previous) }; collectReply(repositories.assistant.resumeAgentMessages(thread.id, options))
            } else {
                val used = buildJsonObject {
                    putJsonArray("facts") { if (before.memory) before.facts.take(30).forEach { add(JsonPrimitive(it.id)) } }
                    putJsonArray("stories") { if (before.memory) before.stories.take(8).forEach { add(JsonPrimitive(it.id)) } }
                    put("preferences", before.memory); put("applications", before.applications); putJsonArray("offers") {}; put("web", false)
                }
                val message = buildJsonObject { put("id", messageId); put("role", "user"); putJsonObject("metadata") { put("context", used) }; putJsonArray("parts") { add(buildJsonObject { put("type", "text"); put("text", before.draft) }) } }
                val body = buildJsonObject {
                    put("threadId", thread.id); put("message", message)
                    putJsonObject("context") { put("document", true); put("posting", true); put("application", before.applications); put("memory", before.memory); put("web", false) }
                }
                mutable.update { it.copy(messages = previous + CoachMessage(messageId, before.draft, true, used = used)) }
                collectReply(transport.events(ApiRequest("sendAgentMessage", "POST", "/agent/messages/send", body = body, options = options.copy(headers = aiApproval(provider)))))
            }
            val raw = history(thread.id); checkOwner()
            mutable.update { it.copy(messages = coachMessages(raw), busy = false, draft = if (it.draft == sentText) "" else it.draft) }
            drafts.write(key, state.value.draft); drafts.remove("$key:message"); refreshProposals()
        }
    }
    private fun resume(threadId: String) {
        streaming = run({ mutable.update { it.copy(busy = false, error = true) } }) {
            mutable.update { it.copy(busy = true) }; collectReply(repositories.assistant.resumeAgentMessages(threadId, options))
            val raw = history(threadId); checkOwner(); mutable.update { it.copy(messages = coachMessages(raw), busy = false) }; refreshProposals()
        }
    }
    private suspend fun collectReply(events: kotlinx.coroutines.flow.Flow<ServerEvent>) {
        var replyId = UUID.randomUUID().toString()
        events.collect { event -> checkOwner(); coachChunks(event.data).forEach { chunk ->
            when (chunk["type"]?.jsonPrimitive?.contentOrNull) {
                "start" -> replyId = chunk["messageId"]?.jsonPrimitive?.contentOrNull ?: replyId
                "text-delta" -> {
                    val delta = chunk["delta"]?.jsonPrimitive?.contentOrNull.orEmpty()
                    mutable.update { current -> val old = current.messages.firstOrNull { it.id == replyId }
                        current.copy(messages = current.messages.filterNot { it.id == replyId } + (old?.copy(text = old.text + delta) ?: CoachMessage(replyId, delta, false))) }
                }
                "error" -> throw IllegalStateException("Coach reply failed")
            }
        } }
    }
    fun stop() = run({ mutable.update { it.copy(error = true) } }) {
        state.value.thread?.let { repositories.assistant.stopAgentMessage(StopAgentMessageRequest(threadId = it.id), options) }
        streaming?.cancel(); mutable.update { it.copy(busy = false) }; state.value.thread?.id?.let { threadId -> val raw = history(threadId); checkOwner(); mutable.update { it.copy(messages = coachMessages(raw)) }; refreshProposals() }
    }
    private fun refreshProposals() {
        val notes = state.value.messages.flatMap { it.parts }.filter { it["type"]?.jsonPrimitive?.contentOrNull == "tool-remember_fact" && it["state"]?.jsonPrimitive?.contentOrNull == "output-available" }.mapNotNull { part ->
            val output = part["output"] as? JsonObject ?: return@mapNotNull null
            val callId = part["toolCallId"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            if (output["status"]?.jsonPrimitive?.contentOrNull !in setOf("proposed", "saved")) return@mapNotNull null
            if (drafts.read("dismissed:$callId") != null) return@mapNotNull null
            val fact = runCatching { ApiJson.decodeFromJsonElement(SaveCareerFactRequest.serializer(), output["fact"] ?: JsonNull) }.getOrNull() ?: return@mapNotNull null
            CoachFact(callId, fact, output["id"]?.jsonPrimitive?.contentOrNull)
        }
        mutable.update { it.copy(pendingFacts = notes) }
    }
    fun remember(fact: CoachFact, done: () -> Unit) = run({ mutable.update { it.copy(error = true) } }) {
        repositories.career.saveCareerFact(fact.fact, options); checkOwner(); dismiss(fact.callId); done()
    }
    fun dismiss(callId: String) {
        try { drafts.write("dismissed:$callId", "true"); mutable.update { it.copy(pendingFacts = it.pendingFacts.filterNot { fact -> fact.callId == callId }) } }
        catch (_: Exception) { mutable.update { it.copy(error = true) } }
    }
    fun rename(title: String) = run({ mutable.update { it.copy(error = true) } }) {
        state.value.thread?.let { val t = repositories.assistant.updateAgentThread(it.id, UpdateAgentThreadRequest(title = title), options); checkOwner(); mutable.update { s -> s.copy(thread = t) } }
    }
    fun delete(done: () -> Unit) = run({ mutable.update { it.copy(error = true) } }) {
        state.value.thread?.let { repositories.assistant.deleteAgentThread(it.id, options) }; checkOwner(); drafts.remove(key); drafts.remove("$key:thread"); drafts.remove("$key:message"); done()
    }
}
