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
    val documentId: String = "", val documentName: String = "", val letterId: String? = null, val locked: Boolean = false, val documentContext: Boolean = true, val postingContext: Boolean = true,
    val facts: Map<String, String> = emptyMap(), val wordingSavedId: String? = null, val attachments: List<CreateAgentAttachmentResponse> = emptyList(), val deciding: Boolean = false, val historyUnavailable: Boolean = false,
    /** The wording the person is writing for one proposal; kept here so closing or leaving Proposals never loses it. */
    val wording: WordingDraft? = null,
    /** The last send was refused because the connection changed after it was shown; the disclosure now names the current one. */
    val destinationChanged: Boolean = false,
) { val provider get() = providers.firstOrNull { it.id == providerId }; val proposals get() = content.proposals }

/** Wording for [proposal] as it was when editing began; a refreshed proposal never replaces [text]. */
internal data class WordingDraft(val proposal: Proposal, val text: String) { val dirty get() = text != plain(proposal.after) }

@OptIn(FlowPreview::class)
internal class AssistantViewModel(private val repositories: RrRepositories, private val resumeId: String, threadId: String?) : ViewModel() {
    private val mutable = MutableStateFlow(AssistantState(threadId = threadId)); val state = mutable.asStateFlow()
    private var stream: Job? = null
    private var documentJob: Job? = null
    private var resume: DocumentDraft<Resume>? = null; private var letter: DocumentDraft<CoverLetter>? = null
    private val decisions = Mutex()
    private val threadCreation = Mutex()
    private var readOnly = false
    private var retryRequest: SendAgentMessageRequest? = null
    init { viewModelScope.launch {
        suspend fun attempt(block: suspend () -> Unit) { try { block() } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } } }
        attempt { loadProviders() }
        attempt { if (threadId != null) loadThread(threadId) else if (resumeId.isNotEmpty()) openResume(resumeId) }
        attempt { val threads = repositories.assistant.listAgentThreads(); mutable.update { it.copy(threads = threads) } }
        mutable.update { it.copy(loading = false) }
    } }
    /** Reloads the connections, keeping the chosen one when it still exists (the thread and the draft stay). */
    private suspend fun loadProviders() {
        val providers = repositories.ai.listAiProviders().filter { it.enabled }
        mutable.update { s -> s.copy(providers = providers, providerId = s.providerId?.takeIf { id -> providers.any { it.id == id } } ?: (providers.firstOrNull { it.isDefault } ?: providers.firstOrNull())?.id) }
    }

    /** Back from connection setup (or any return to the Assistant): pick up added or changed connections. */
    fun refreshProviders() = viewModelScope.launch { try { loadProviders() } catch (e: CancellationException) { throw e } catch (_: Exception) {} }

    /** The approval of the connection the person was shown, sent with every AI request (`x-ai-destination`). */
    private fun approval(provider: TestAiProviderResponse? = state.value.provider) = provider?.let { RequestOptions().approvedFor(it) } ?: RequestOptions()

    /** A failed AI request: a changed destination (409, nothing sent) renews the disclosure; the person's words stay. */
    private suspend fun failed(e: Exception) {
        val changed = e is ApiException && e.status == 409
        if (changed) try { loadProviders() } catch (ce: CancellationException) { throw ce } catch (_: Exception) {}
        mutable.update { it.copy(failed = true, destinationChanged = changed) }
    }

    fun editWording(proposal: Proposal) = mutable.update { s -> s.copy(wording = s.wording?.takeIf { it.proposal.id == proposal.id } ?: WordingDraft(proposal, plain(proposal.after))) }
    fun wording(text: String) = mutable.update { s -> s.copy(wording = s.wording?.copy(text = text)) }
    fun cancelWording() = mutable.update { it.copy(wording = null) }

    private suspend fun openResume(id: String) {
        val handle = repositories.resumes.openDraft(id); resume = handle
        documentJob?.cancel()
        documentJob = viewModelScope.launch { handle.state.collect { value -> mutable.update { it.copy(documentId = value.document?.id.orEmpty(), documentName = value.document?.name.orEmpty(), locked = readOnly || value.locked || value.document?.isLocked == true) } } }
    }
    private suspend fun loadThread(id: String) {
        documentJob?.cancel(); resume = null; letter = null
        val conversation = repositories.assistant.getAgentThread(id)
        readOnly = conversation.isReadOnly
        retryRequest = null
        mutable.update { it.copy(threadId = id, providerId = conversation.thread.aiProviderId, letterId = conversation.thread.coverLetterId, locked = conversation.isReadOnly,
            content = conversationContent(conversation.messages), attachments = conversation.attachments.filter { file -> file.messageId == null }, historyUnavailable = false) }
        val letterId = conversation.thread.coverLetterId
        if (letterId != null) { val handle = repositories.letters.openDraft(letterId); letter = handle; documentJob = viewModelScope.launch { handle.state.collect { value -> mutable.update { it.copy(documentId = value.document?.id.orEmpty(), documentName = value.document?.name.orEmpty(), locked = conversation.isReadOnly || value.locked || value.document?.isLocked == true) } } } }
        else openResume(conversation.thread.workingResumeId ?: conversation.thread.sourceResumeId ?: resumeId)
        refreshFacts()
        if (conversation.thread.activeRunId != null) resumeStream()
    }
    fun input(value: String) { if (value != state.value.input) retryRequest = null; mutable.update { it.copy(input = value) } }
    fun context(document: Boolean? = null, posting: Boolean? = null) { mutable.update { it.copy(documentContext = document ?: it.documentContext, postingContext = posting ?: it.postingContext) } }
    fun provider(id: String) = viewModelScope.launch {
        if (state.value.streaming || state.value.providers.none { it.id == id }) return@launch
        try {
            state.value.threadId?.let { repositories.assistant.updateAgentThread(it, UpdateAgentThreadRequest(aiProviderId = id), approval(state.value.providers.first { p -> p.id == id })) }
            mutable.update { it.copy(providerId = id) }
        } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } }
    }
    fun thread(id: String) = viewModelScope.launch { if (state.value.deciding) return@launch; stream?.cancelAndJoin(); mutable.update { it.copy(content = ConversationContent(), loading = true) }; try { loadThread(id) } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } } finally { mutable.update { it.copy(loading = false) } } }
    private suspend fun ensureThread(): String = threadCreation.withLock {
        state.value.threadId ?: repositories.assistant.startAgentThread(StartAgentThreadRequest(aiProviderId = state.value.providerId,
            coverLetterId = state.value.letterId, resumeId = resumeId.takeIf { state.value.letterId == null }, scope = StartAgentThreadRequestScope.Document), approval()).id.also { id -> mutable.update { it.copy(threadId = id) } }
    }
    private suspend fun flushDocument() {
        resume?.let { it.flushSaved() }
        letter?.let { it.flushSaved() }
        check(!state.value.locked)
    }
    fun send() {
        val current = state.value
        if (current.loading || current.input.isBlank() || current.streaming || current.locked || current.provider == null) return
        current.content.question?.takeIf { it.toolCallId.isNotEmpty() }?.let { answer(it.toolCallId, current.input); return }
        mutable.update { it.copy(streaming = true, failed = false, stopped = false, destinationChanged = false) }
        stream = viewModelScope.launch {
            try {
                flushDocument()
                val id = ensureThread()
                val message = retryRequest?.message ?: SendAgentMessageRequestMessage(java.util.UUID.randomUUID().toString(), parts =
                    listOf(part("text", buildJsonObject { put("text", current.input) })) + current.attachments.map { file -> part("file", buildJsonObject {
                        put("filename", file.filename); put("mediaType", file.mediaType); put("url", "agent-attachment:" + file.id)
                    }) }, role = AiTailorResumeForApplicationResponseConversationMessagesItemRole.User)
                val request = (retryRequest ?: SendAgentMessageRequest(current.attachments.map { it.id }, message = message, threadId = id)).copy(context = SendAgentMessageRequestContext(document = current.documentContext, posting = current.postingContext))
                retryRequest = request
                // Same message id on Retry: an uncertain response must not duplicate the person's turn.
                mutable.update { it.copy(content = conversationContent(it.content.messages.filterNot { old -> old.id == message.id } + message)) }
                collectStream(repositories.assistant.sendAgentMessage(request, approval(current.provider)))
                if (!state.value.failed) {
                    retryRequest = null
                    mutable.update { it.copy(input = if (it.input == current.input) "" else it.input, attachments = it.attachments.filterNot { file -> current.attachments.any { used -> used.id == file.id } }) }
                }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { failed(e) }
            finally { mutable.update { it.copy(streaming = false) } }
        }
    }
    private suspend fun collectStream(events: Flow<ServerEvent>) {
        mutable.update { it.copy(content = it.content.copy(done = false, failed = false)) }
        val decoder = AssistantStreamDecoder()
        events.timeout(kotlin.time.Duration.parse("45s")).collect { outer -> decoder.accept(outer).forEach { event -> mutable.update { it.copy(content = reduceEvent(it.content, event)) } } }
        check(state.value.content.done && !state.value.content.failed)
        refreshReceipts()
    }
    private suspend fun refreshReceipts(): ConversationContent {
        val fresh = repositories.assistant.getAgentThread(requireNotNull(state.value.threadId))
        readOnly = fresh.isReadOnly
        check(fresh.thread.id == state.value.threadId && (state.value.content.messages.isEmpty() || fresh.messages.isNotEmpty()))
        val content = conversationContent(fresh.messages)
        mutable.update { it.copy(content = content, locked = it.locked || fresh.isReadOnly) }
        refreshFacts()
        return content
    }
    private suspend fun refreshFacts() {
        if (state.value.proposals.none { it.factIds.isNotEmpty() }) return
        val facts = try { repositories.career.listCareerFacts(all = true).filter { it.status == "active" }.associate { it.id to it.text } } catch (e: CancellationException) { throw e } catch (_: Exception) { emptyMap() }
        mutable.update { it.copy(facts = facts) }
    }
    fun resumeStream() {
        val id = state.value.threadId ?: return
        if (state.value.streaming) return
        mutable.update { it.copy(streaming = true, stopped = false, failed = false) }
        stream = viewModelScope.launch {
            try { collectStream(repositories.assistant.resumeAgentMessages(id)) }
            catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } }
            finally { mutable.update { it.copy(streaming = false) } }
        }
    }
    fun continueReply() { if (state.value.locked) return; input("Continue"); send() }
    fun answer(toolCallId: String, answer: String) { input(answer); continueTool(toolCallId) { fields -> JsonObject(fields + mapOf("output" to JsonPrimitive(answer), "state" to JsonPrimitive("output-available"))) } }
    fun approve(toolCallId: String, approved: Boolean) = continueTool(toolCallId) { fields ->
        val approval = fields["approval"] as? JsonObject ?: error("Missing approval")
        JsonObject(fields + mapOf("approval" to JsonObject(approval + ("approved" to JsonPrimitive(approved))), "state" to JsonPrimitive("approval-responded")))
    }
    private fun continueTool(toolCallId: String, change: (JsonObject) -> JsonObject) {
        if (state.value.streaming || state.value.locked || state.value.provider == null) return
        val last = state.value.content.messages.lastOrNull()?.takeIf { it.role == AiTailorResumeForApplicationResponseConversationMessagesItemRole.Assistant } ?: return
        if (last.parts.none { it.extraFields.text("toolCallId") == toolCallId && it.extraFields.text("state") in setOf("input-available", "approval-requested") }) return
        if ((!state.value.documentContext || !state.value.postingContext) && (last.metadata as? JsonObject)?.text("contextScope") != "[${state.value.documentContext},${state.value.postingContext}]") { mutable.update { it.copy(failed = true) }; return }
        mutable.update { it.copy(streaming = true, failed = false, destinationChanged = false) }
        val provider = state.value.provider
        stream = viewModelScope.launch {
            try {
                flushDocument()
                val message = last.copy(parts = last.parts.map { if (it.extraFields.text("toolCallId") == toolCallId) it.copy(extraFields = change(it.extraFields)) else it })
                mutable.update { it.copy(content = conversationContent(it.content.messages.dropLast(1) + message)) }
                if (message.parts.any { it.extraFields.text("state") == "approval-requested" || (it.type == "tool-ask_user_question" && it.extraFields.text("state") == "input-available") }) return@launch
                val request = SendAgentMessageRequest(message = message, threadId = requireNotNull(state.value.threadId), context = SendAgentMessageRequestContext(document = state.value.documentContext, posting = state.value.postingContext))
                retryRequest = request
                collectStream(repositories.assistant.sendAgentMessage(request, approval(provider)))
                retryRequest = null
                mutable.update { it.copy(input = "") }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { failed(e) }
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
            val thread = ensureThread()
            val attachment = repositories.assistant.createAgentAttachment(CreateAgentAttachmentRequest(java.util.Base64.getEncoder().encodeToString(bytes), filename, mime, thread))
            mutable.update { it.copy(attachments = it.attachments + attachment) }
        } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } }
    }
    fun removeAttachment(id: String) = viewModelScope.launch { try { repositories.assistant.deleteAgentAttachment(id); mutable.update { it.copy(attachments = it.attachments.filterNot { it.id == id }) } } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } } }
    fun decide(ids: List<String>, decision: Decision, wording: String? = null, expectedAfter: String? = null) = viewModelScope.launch { decisions.withLock {
        if (state.value.locked || state.value.streaming) return@withLock
        mutable.update { it.copy(deciding = true, failed = false, wordingSavedId = null) }
        try {
            ids.distinct().forEach { id ->
                val reviewed = state.value.proposals.firstOrNull { it.id == id } ?: error("Proposal unavailable")
                if (expectedAfter != null) check(reviewed.after == expectedAfter)
                val proposal = refreshReceipts().proposals.singleOrNull { it.id == id } ?: error("Receipt unavailable")
                check(!state.value.locked && proposal.after == reviewed.after && proposal.before == reviewed.before && proposal.structure == reviewed.structure && proposal.decision == reviewed.decision)
                if (wording != null) {
                    check(decision == Decision.Pending && proposal.decision == Decision.Pending && !proposal.snapshot)
                    repositories.assistant.setAgentEditStatus(SetAgentEditStatusRequest(listOf(SetAgentEditStatusRequestEditsItem(after = proposal.after, id = id, status = PatchAgentMessageEditsRequestEditsItemStatus.Pending, text = wording)), proposal.messageId, requireNotNull(state.value.threadId), proposal.toolCallId))
                    val saved = refreshReceipts().proposals.single { it.id == id }
                    check(saved.after == reviewedWording(proposal.after, wording, proposal.before) && saved.decision == Decision.Pending)
                    mutable.update { it.copy(wordingSavedId = id, wording = it.wording?.takeUnless { draft -> draft.proposal.id == id }) }
                } else if (decision == Decision.Accepted) {
                    check(proposal.decision == Decision.Pending)
                    val mark = buildJsonObject { if (proposal.snapshot) put(id, "snapshot:" + id) else put(id, proposal.after) }
                    if (letter != null) {
                        val handle = requireNotNull(letter); val before = requireNotNull(handle.state.value.document)
                        val next = if (proposal.section == "letter" && proposal.field == "content") replacePassage(before.content, proposal) else null
                        if (next == null) { markDecision(id, Decision.Stale); return@forEach }
                        handle.update(before.copy(content = next, aiOperationIds = (before.aiOperationIds.orEmpty() + proposal.operationIds).distinct()), mark)
                        handle.flushSaved()
                    } else {
                        val handle = requireNotNull(resume); val before = requireNotNull(handle.state.value.document)
                        val next = applyResume(ApiJson.encodeToJsonElement(ResumeData.serializer(), before.data).jsonObject, proposal)
                        if (next == null) { markDecision(id, Decision.Stale); return@forEach }
                        handle.update(before.copy(data = ApiJson.decodeFromJsonElement(ResumeData.serializer(), next), aiOperationIds = (before.aiOperationIds.orEmpty() + proposal.operationIds).distinct()), mark)
                        handle.flushSaved()
                    }
                    check(refreshReceipts().proposals.single { it.id == id }.decision == Decision.Accepted)
                } else {
                    if (decision == Decision.Pending && proposal.decision == Decision.Accepted) {
                        val reverse = proposal.copy(before = proposal.after, after = proposal.before, structure = proposal.structure?.let { structure -> buildJsonObject { put("before", structure.getValue("after")); put("after", structure.getValue("before")) } })
                        val mark = buildJsonObject { put(id, false) }
                        if (letter != null) {
                            val handle = requireNotNull(letter); val current = requireNotNull(handle.state.value.document)
                            val next = replacePassage(current.content, reverse) ?: error("Applied passage changed")
                            handle.update(current.copy(content = next), mark); handle.flushSaved()
                        } else {
                            val handle = requireNotNull(resume); val current = requireNotNull(handle.state.value.document)
                            val next = applyResume(ApiJson.encodeToJsonElement(ResumeData.serializer(), current.data).jsonObject, reverse) ?: error("Applied passage changed")
                            handle.update(current.copy(data = ApiJson.decodeFromJsonElement(ResumeData.serializer(), next)), mark); handle.flushSaved()
                        }
                    }
                    repositories.assistant.setAgentEditStatus(SetAgentEditStatusRequest(listOf(SetAgentEditStatusRequestEditsItem(id = id, status = if (decision == Decision.Rejected) PatchAgentMessageEditsRequestEditsItemStatus.Rejected else PatchAgentMessageEditsRequestEditsItemStatus.Pending)), proposal.messageId, requireNotNull(state.value.threadId), proposal.toolCallId))
                    check(refreshReceipts().proposals.single { it.id == id }.decision == decision)
                }
            }
        } catch (e: CancellationException) { throw e } catch (_: Exception) { mutable.update { it.copy(failed = true) } }
        finally { mutable.update { it.copy(deciding = false) } }
    } }
    private fun markDecision(id: String, decision: Decision) { mutable.update { it.copy(content = it.content.copy(proposals = it.proposals.map { proposal -> if (proposal.id == id) proposal.copy(decision = decision) else proposal })) } }
}
internal fun reviewedWording(block: String, text: String, before: String = ""): String {
    val addition = before.isNotEmpty() && block.startsWith(before) && block.length > before.length
    val added = if (addition) block.removePrefix(before) else block
    val leaf = Regex("""(?is)<(p|li)(?:\s[^>]*)?>(?:(?!</?(?:p|li)[\s>]).)*?</\1>""").find(added)?.value ?: added
    val escaped = text.trim().replace(Regex("""\s+"""), " ").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
    val tags = Regex("""(?is)^(<(p|li)(?:\s[^>]*)?>).*?(</\2>)$""").matchEntire(leaf)
    val replacement = if (tags != null) tags.groupValues[1] + escaped + tags.groupValues[3] else if (leaf.isEmpty()) "<p>$escaped</p>" else escaped
    val changed = added.replaceFirst(leaf, replacement)
    return if (addition) before + changed else changed
}

// TODO(lead): make DocumentDraft.flush publish its terminal save status before returning.
private suspend fun <T> DocumentDraft<T>.flushSaved() {
    flush()
    check(state.first { it.status != me.rxresu.core.database.SaveStatus.Saving }.status == me.rxresu.core.database.SaveStatus.Saved)
}
