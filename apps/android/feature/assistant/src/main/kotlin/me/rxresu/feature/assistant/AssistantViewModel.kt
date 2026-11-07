package me.rxresu.feature.assistant

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import me.rxresu.core.data.*
import me.rxresu.core.network.*
import me.rxresu.core.network.generated.*

internal data class AssistantState(
    val loading: Boolean = true, val failed: Boolean = false, val input: String = "", val streaming: Boolean = false,
    val stopped: Boolean = false, val threadId: String? = null, val providers: List<TestAiProviderResponse> = emptyList(), val providerId: String? = null,
    val threads: List<StartAgentThreadResponse> = emptyList(), val content: ConversationContent = ConversationContent(),
    val documentName: String = "", val letterId: String? = null, val locked: Boolean = false, val documentContext: Boolean = true, val postingContext: Boolean = true,
    val attachments: List<CreateAgentAttachmentResponse> = emptyList(), val deciding: Boolean = false, val historyUnavailable: Boolean = false,
) { val provider get() = providers.firstOrNull { it.id == providerId }; val proposals get() = content.proposals }

internal class AssistantViewModel(private val repositories: RrRepositories, private val resumeId: String, threadId: String?) : ViewModel() {
    private val mutable = MutableStateFlow(AssistantState(threadId = threadId)); val state = mutable.asStateFlow()
    private var stream: Job? = null
    private var documentJob: Job? = null
    private var resume: DocumentDraft<Resume>? = null; private var letter: DocumentDraft<CoverLetter>? = null
    private val decisions = Mutex()
    private val undoDocuments = mutableMapOf<String, Any>()
    init { viewModelScope.launch { try {
        val providers = repositories.ai.listAiProviders().filter { it.enabled }
        mutable.update { it.copy(providers = providers, providerId = (providers.firstOrNull { it.isDefault } ?: providers.firstOrNull())?.id) }
        if (threadId != null) loadThread(threadId)
        else if (resumeId.isNotEmpty()) openResume(resumeId)
        val threads = repositories.assistant.listAgentThreads()
        mutable.update { it.copy(threads = threads, loading = false) }
    } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(loading = false, failed = true) } } } }
    private suspend fun openResume(id: String) {
        val handle = repositories.resumes.openDraft(id); resume = handle
        documentJob?.cancel()
        documentJob = viewModelScope.launch { handle.state.collect { value -> mutable.update { it.copy(documentName = value.document?.name.orEmpty(), locked = value.locked || value.document?.isLocked == true) } } }
    }
    private suspend fun loadThread(id: String) {
        documentJob?.cancel(); resume = null; letter = null
        val conversation = repositories.assistant.getAgentThread(id)
        mutable.update { it.copy(threadId = id, providerId = conversation.thread.aiProviderId, letterId = conversation.thread.coverLetterId, locked = conversation.isReadOnly, historyUnavailable = conversation.messages.isNotEmpty()) }
        val letterId = conversation.thread.coverLetterId
        if (letterId != null) { val handle = repositories.letters.openDraft(letterId); letter = handle; documentJob = viewModelScope.launch { handle.state.collect { value -> mutable.update { it.copy(documentName = value.document?.name.orEmpty(), locked = conversation.isReadOnly || value.locked || value.document?.isLocked == true) } } } }
        else openResume(conversation.thread.workingResumeId ?: conversation.thread.sourceResumeId ?: resumeId)
        if (conversation.thread.activeRunId != null) resumeStream()
    }
    fun input(value: String) { mutable.update { it.copy(input = value) } }
    fun context(document: Boolean? = null, posting: Boolean? = null) { mutable.update { it.copy(documentContext = document ?: it.documentContext, postingContext = posting ?: it.postingContext) } }
    fun provider(id: String) = viewModelScope.launch {
        if (state.value.streaming || state.value.providers.none { it.id == id }) return@launch
        try {
            state.value.threadId?.let { repositories.assistant.updateAgentThread(it, UpdateAgentThreadRequest(aiProviderId = id)) }
            mutable.update { it.copy(providerId = id) }
        } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } }
    }
    fun thread(id: String) = viewModelScope.launch { stream?.cancelAndJoin(); mutable.update { it.copy(content = ConversationContent(), loading = true) }; try { loadThread(id) } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } } finally { mutable.update { it.copy(loading = false) } } }
    fun send() {
        if (state.value.input.isBlank() || state.value.streaming || state.value.locked || state.value.provider == null) return
        // Generated UIMessage parts drop text/output; never send a type-only part and lose the person's message.
        mutable.update { it.copy(failed = true) }
    }
    fun resumeStream() {
        val id = state.value.threadId ?: return
        if (state.value.streaming) return
        stream = viewModelScope.launch {
            mutable.update { it.copy(streaming = true, stopped = false, failed = false) }
            try {
                repositories.assistant.resumeAgentMessages(id).collect { event ->
                    mutable.update { current -> current.copy(content = reduceEvent(current.content, event)) }
                }
                if (!state.value.content.done) mutable.update { it.copy(failed = true) }
                if (state.value.content.failed) mutable.update { it.copy(failed = true) }
            } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } }
            finally { mutable.update { it.copy(streaming = false) } }
        }
    }
    fun stop() = viewModelScope.launch {
        try { state.value.threadId?.let { repositories.assistant.stopAgentMessage(StopAgentMessageRequest(threadId = it)) }; stream?.cancelAndJoin(); mutable.update { it.copy(stopped = true, streaming = false) } }
        catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } }
    }
    fun attach(filename: String, mime: String, bytes: ByteArray) = viewModelScope.launch {
        if (bytes.size > 25 * 1024 * 1024 || state.value.attachments.size >= 10 || state.value.provider == null || state.value.locked) { mutable.update { it.copy(failed = true) }; return@launch }
        try {
            val thread = state.value.threadId ?: repositories.assistant.startAgentThread(StartAgentThreadRequest(aiProviderId = state.value.providerId, coverLetterId = state.value.letterId, resumeId = resumeId.takeIf { state.value.letterId == null }, scope = StartAgentThreadRequestScope.Document)).id.also { id -> mutable.update { it.copy(threadId = id) } }
            val attachment = repositories.assistant.createAgentAttachment(CreateAgentAttachmentRequest(java.util.Base64.getEncoder().encodeToString(bytes), filename, mime, thread))
            mutable.update { it.copy(attachments = it.attachments + attachment) }
        } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } }
    }
    fun removeAttachment(id: String) = viewModelScope.launch { try { repositories.assistant.deleteAgentAttachment(id); mutable.update { it.copy(attachments = it.attachments.filterNot { it.id == id }) } } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } } }
    fun decide(ids: List<String>, decision: Decision, wording: String? = null) = viewModelScope.launch { decisions.withLock {
        if (state.value.locked || state.value.streaming) return@withLock
        // A wording save requires a fresh receipt read; generated parts currently discard that proof.
        if (wording != null) { mutable.update { it.copy(failed = true) }; return@withLock }
        mutable.update { it.copy(deciding = true, failed = false) }
        try {
            ids.forEach { id ->
                val proposal = state.value.proposals.firstOrNull { it.id == id } ?: return@forEach
                if (proposal.decision != Decision.Pending && decision != Decision.Pending) return@forEach
                val selected = if (wording == null) proposal else proposal.copy(after = reviewedWording(proposal.after, wording))
                if (decision == Decision.Accepted) {
                    val mark = buildJsonObject { put(id, selected.after) }
                    if (letter != null) {
                        val handle = requireNotNull(letter); val before = requireNotNull(handle.state.value.document)
                        val next = if (selected.section == "letter" && selected.field == "content") replacePassage(before.content, selected) else null
                        if (next == null) { markDecision(id, Decision.Stale); return@forEach }
                        val after = before.copy(content = next, aiOperationIds = (before.aiOperationIds.orEmpty() + selected.operationIds).distinct())
                        handle.update(after, mark); undoDocuments[id] = after; markDecision(id, decision); handle.flush(); check(handle.state.value.status == me.rxresu.core.database.SaveStatus.Saved)
                    } else {
                        val handle = requireNotNull(resume); val before = requireNotNull(handle.state.value.document)
                        val raw = ApiJson.encodeToJsonElement(ResumeData.serializer(), before.data).jsonObject
                        val next = applyResume(raw, selected)
                        if (next == null) { markDecision(id, Decision.Stale); return@forEach }
                        val after = before.copy(data = ApiJson.decodeFromJsonElement(ResumeData.serializer(), next), aiOperationIds = (before.aiOperationIds.orEmpty() + selected.operationIds).distinct())
                        handle.update(after, mark); undoDocuments[id] = after; markDecision(id, decision); handle.flush(); check(handle.state.value.status == me.rxresu.core.database.SaveStatus.Saved)
                    }
                } else if (decision == Decision.Pending && proposal.decision == Decision.Accepted) {
                    if (letter != null) { check(letter!!.state.value.document == undoDocuments[id]); letter!!.undo(); letter!!.flush() }
                    else { check(resume!!.state.value.document == undoDocuments[id]); resume!!.undo(); resume!!.flush() }
                }
                // Acceptances are receipts of the checked document save, never independent status writes.
                if (decision != Decision.Accepted) repositories.assistant.setAgentEditStatus(SetAgentEditStatusRequest(listOf(SetAgentEditStatusRequestEditsItem(after = if (wording == null) null else selected.after, id = id, status = when (decision) { Decision.Accepted -> PatchAgentMessageEditsRequestEditsItemStatus.Accepted; Decision.Rejected -> PatchAgentMessageEditsRequestEditsItemStatus.Rejected; else -> PatchAgentMessageEditsRequestEditsItemStatus.Pending })), proposal.messageId, requireNotNull(state.value.threadId), proposal.toolCallId))
                markDecision(id, decision)
            }
        } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } }
        finally { mutable.update { it.copy(deciding = false) } }
    } }
    private fun markDecision(id: String, decision: Decision) { mutable.update { it.copy(content = it.content.copy(proposals = it.proposals.map { proposal -> if (proposal.id == id) proposal.copy(decision = decision) else proposal })) } }
}
internal fun reviewedWording(block: String, text: String): String {
    val escaped = text.trim().replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
    val tags = Regex("(?is)^(<(p|li)(?:\\s[^>]*)?>).*?(</\\2>)$").matchEntire(block)
    return if (tags != null) tags.groupValues[1] + escaped + tags.groupValues[3] else if (block.isEmpty()) "<p>$escaped</p>" else escaped
}
