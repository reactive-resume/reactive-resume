package me.rxresu.feature.assistant

import kotlinx.serialization.json.*
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.ServerEvent
import me.rxresu.core.network.generated.*

internal enum class Decision { Pending, Accepted, Rejected, Stale }
internal data class Proposal(
    val id: String, val messageId: String, val toolCallId: String, val section: String, val field: String,
    val item: String? = null, val role: String? = null, val location: String, val before: String, val after: String,
    val why: String = "", val newDetail: Boolean = false, val unsupported: List<String> = emptyList(),
    val evidence: List<String> = emptyList(), val factIds: List<String> = emptyList(), val operationIds: List<String> = emptyList(),
    val snapshot: Boolean = false, val structure: JsonObject? = null, val decision: Decision = Decision.Pending,
)
internal data class Question(val text: String, val answers: List<String>, val toolCallId: String = "")
internal data class ConversationContent(
    val messageId: String = "", val reply: String = "", val proposals: List<Proposal> = emptyList(),
    val question: Question? = null, val trace: List<String> = emptyList(), val done: Boolean = false, val failed: Boolean = false,
    val messages: List<SendAgentMessageRequestMessage> = emptyList(), val requirements: List<Pair<String, String>> = emptyList(),
)
internal fun JsonObject.text(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull
internal fun JsonObject.strings(key: String) = (get(key) as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
internal fun part(type: String, fields: JsonObject) = AiTailorResumeForApplicationResponseConversationMessagesItemPartsItem(type, fields)
internal fun conversationContent(messages: List<SendAgentMessageRequestMessage>): ConversationContent {
    var content = ConversationContent(messages = messages)
    val superseded = mutableSetOf<String>()
    messages.filter { it.role == AiTailorResumeForApplicationResponseConversationMessagesItemRole.Assistant }.forEach { message ->
        content = content.copy(messageId = message.id, reply = message.parts.filter { it.type == "text" }.joinToString("") { it.extraFields.text("text").orEmpty() }, question = null)
        val operationIds = (message.metadata as? JsonObject)?.strings("aiOperationIds").orEmpty()
        message.parts.forEach { part ->
            val fields = part.extraFields
            val output = fields["output"] as? JsonObject
            if (part.type == "tool-ask_user_question" && fields.text("state") == "input-available") {
                val input = fields["input"] as? JsonObject
                input?.text("question")?.let { content = content.copy(question = Question(it, input.strings("options"), fields.text("toolCallId").orEmpty())) }
            }
            if (part.type == "tool-propose_edits" && fields.text("state") == "output-available" && output != null) {
                val tool = fields.text("toolCallId") ?: return@forEach
                val edits = (output["edits"] as? JsonArray).orEmpty().mapNotNull { value ->
                    val edit = value as? JsonObject ?: return@mapNotNull null
                    val target = edit["target"] as? JsonObject ?: return@mapNotNull null
                    Proposal(id = edit.text("id") ?: return@mapNotNull null, messageId = message.id, toolCallId = tool,
                        section = target.text("sectionId").orEmpty(), field = target.text("field").orEmpty(), item = target.text("itemId"), role = target.text("roleId"),
                        location = edit.text("location").orEmpty(), before = edit.text("before") ?: return@mapNotNull null, after = edit.text("after") ?: return@mapNotNull null, why = edit.text("why").orEmpty(),
                        newDetail = (edit["addsClaims"] as? JsonPrimitive)?.booleanOrNull == true,
                        unsupported = (edit["unsupported"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.text("text") },
                        evidence = (edit["evidence"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let { evidence -> evidence.text("text") ?: evidence.text("location") } },
                        factIds = (edit["evidence"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.takeIf { it.text("kind") == "fact" }?.text("id") },
                        operationIds = operationIds, snapshot = edit["snapshot"] is JsonObject,
                        structure = edit["snapshot"] as? JsonObject,
                        decision = when (edit.text("status")) { "accepted" -> Decision.Accepted; "rejected" -> Decision.Rejected; else -> Decision.Pending })
                }
                superseded += output.strings("supersedes")
                content = content.copy(proposals = content.proposals.filter { old -> edits.none { it.id == old.id } } + edits,
                    trace = content.trace + listOfNotNull(output.text("summary")), requirements = content.requirements + (output["requirements"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let { requirement -> requirement.text("text")?.let { it to requirement.text("status").orEmpty() } } })
            }
        }
    }
    return content.copy(proposals = content.proposals.map { if (it.id in superseded && it.decision == Decision.Pending) it.copy(decision = Decision.Rejected) else it })
}

/** A resumed run replays from its first step; retain only parts preceding that run's last answered question. */
internal fun partsBeforeRun(message: SendAgentMessageRequestMessage?): List<AiTailorResumeForApplicationResponseConversationMessagesItemPartsItem> {
    val parts = message?.parts.orEmpty()
    val answer = parts.indexOfLast { it.type == "tool-ask_user_question" && it.extraFields.text("state") == "output-available" }
    val start = parts.indices.firstOrNull { it > answer && parts[it].type == "step-start" }
    return if (start == null) parts else parts.take(start)
}
internal fun reduceEvent(state: ConversationContent, event: ServerEvent): ConversationContent {
    if (event.data == "[DONE]" || event.type == "done") return state.copy(done = true)
    val data = ApiJson.parseToJsonElement(event.data) as? JsonObject ?: error("Invalid stream event")
    val type = data.text("type") ?: return state
    if (type == "error") return state.copy(failed = true, done = true)
    if (type in setOf("finish", "abort")) {
        val completed = if (data["messageMetadata"] != null) reduceEvent(state, event.copy(data = JsonObject(data + ("type" to JsonPrimitive("message-metadata"))).toString())) else state
        return completed.copy(done = true, failed = state.failed || type == "abort")
    }
    var messages = state.messages
    val id = if (type == "start") data.text("messageId") ?: state.messageId else state.messageId
    val existing = messages.firstOrNull { it.id == id }
    var message = existing ?: SendAgentMessageRequestMessage(id, parts = emptyList(), role = AiTailorResumeForApplicationResponseConversationMessagesItemRole.Assistant)
    var parts = message.parts
    when (type) {
        "start" -> { parts = partsBeforeRun(existing); message = message.copy(metadata = data["messageMetadata"]?.let { metadata -> if (metadata is JsonObject && message.metadata is JsonObject) JsonObject((message.metadata as JsonObject) + metadata) else metadata } ?: message.metadata) }
        "message-metadata" -> message = message.copy(metadata = data["messageMetadata"]?.let { metadata -> if (metadata is JsonObject && message.metadata is JsonObject) JsonObject((message.metadata as JsonObject) + metadata) else metadata } ?: message.metadata)
        "start-step" -> parts = parts + part("step-start", buildJsonObject {})
        "text-start", "reasoning-start" -> parts = parts + part(type.substringBefore('-'), buildJsonObject { put("id", data.text("id").orEmpty()); put("text", "") })
        "text-delta", "reasoning-delta" -> {
            val kind = type.substringBefore('-'); val chunkId = data.text("id").orEmpty()
            val index = parts.indexOfLast { it.type == kind && it.extraFields.text("id").orEmpty() == chunkId }
            if (index < 0) parts = parts + part(kind, buildJsonObject { put("id", chunkId); put("text", data.text("delta").orEmpty()) })
            else parts = parts.mapIndexed { i, p -> if (i == index) p.copy(extraFields = JsonObject(p.extraFields + ("text" to JsonPrimitive(p.extraFields.text("text").orEmpty() + data.text("delta").orEmpty())))) else p }
        }
        "tool-input-start", "tool-input-available", "tool-output-available", "tool-output-error", "tool-approval-request" -> {
            val toolId = data.text("toolCallId") ?: return state
            val index = parts.indexOfLast { it.extraFields.text("toolCallId") == toolId }
            val old = parts.getOrNull(index) ?: part("tool-" + (data.text("toolName") ?: "propose_edits"), buildJsonObject { put("toolCallId", toolId) })
            val fields = old.extraFields.toMutableMap()
            fields["state"] = JsonPrimitive(when (type) { "tool-output-available" -> "output-available"; "tool-output-error" -> "output-error"; "tool-approval-request" -> "approval-requested"; "tool-input-start" -> "input-streaming"; else -> "input-available" })
            listOf("input", "output", "errorText").forEach { key -> data[key]?.let { fields[key] = it } }
            if (type == "tool-approval-request") fields["approval"] = buildJsonObject { put("id", data.text("approvalId").orEmpty()) }
            val next = old.copy(extraFields = JsonObject(fields))
            parts = if (index < 0) parts + next else parts.mapIndexed { i, p -> if (i == index) next else p }
        }
        "source-url", "source-document", "file" -> parts = parts + part(type, JsonObject(data - "type"))
        else -> return state
    }
    message = message.copy(parts = parts)
    messages = messages.filterNot { it.id == id } + message
    return conversationContent(messages).copy(done = false, failed = state.failed)
}

/** Exact, unique anchor only; structural snapshots need the shared schema upgrader and stay unaccepted. */
internal fun replacePassage(current: String, proposal: Proposal): String? {
    if (proposal.snapshot) return null
    if (proposal.before.isEmpty()) return if (current.isEmpty()) proposal.after else null
    val index = current.indexOf(proposal.before)
    if (index < 0 || current.indexOf(proposal.before, index + proposal.before.length) >= 0) return null
    return current.replaceRange(index, index + proposal.before.length, proposal.after).takeIf { it != current }
}
internal fun applyResume(data: JsonObject, proposal: Proposal): JsonObject? {
    if (proposal.snapshot) {
        if (proposal.section != "resume" || proposal.field != "data") return null
        val structure = proposal.structure ?: return null
        val before = runCatching { ApiJson.parseToJsonElement(structure.text("before") ?: return null).jsonObject }.getOrNull() ?: return null
        val after = runCatching { ApiJson.parseToJsonElement(structure.text("after") ?: return null).jsonObject }.getOrNull() ?: return null
        val metadata = data["metadata"]?.jsonObject ?: return null
        if (before["locale"] != null && before["locale"] != metadata["page"]?.jsonObject?.get("locale")) return null
        val current = JsonObject(data.filterKeys { it in setOf("basics", "summary", "sections", "customSections") } + ("layout" to (metadata["layout"] ?: return null)))
        if (JsonObject(before - "locale") != current || after == before) return null
        if (after.keys.any { it !in setOf("basics", "summary", "sections", "customSections", "layout", "locale") } || !after.keys.containsAll(current.keys)) return null
        return JsonObject(data + after.filterKeys { it in setOf("basics", "summary", "sections", "customSections") } +
            ("metadata" to JsonObject(metadata + ("layout" to after.getValue("layout")))))
    }
    if (proposal.section == "summary" && proposal.field == "content" && proposal.item == null) {
        val summary = data["summary"] as? JsonObject ?: return null
        if ((summary["hidden"] as? JsonPrimitive)?.booleanOrNull == true) return null
        val next = replacePassage(summary.text("content") ?: return null, proposal) ?: return null
        return JsonObject(data + ("summary" to JsonObject(summary + ("content" to JsonPrimitive(next)))))
    }
    if (proposal.field !in setOf("description", "content") || proposal.item == null) return null
    fun updateSection(section: JsonObject): JsonObject? {
        if ((section["hidden"] as? JsonPrimitive)?.booleanOrNull == true) return null
        val items = section["items"] as? JsonArray ?: return null
        val matches = items.indices.filter { (items[it] as? JsonObject)?.text("id") == proposal.item }
        val index = matches.singleOrNull() ?: return null
        val item = items[index].jsonObject
        if ((item["hidden"] as? JsonPrimitive)?.booleanOrNull == true) return null
        val target: JsonObject
        var roleIndex: Int? = null
        val roles = item["roles"] as? JsonArray
        if (proposal.role != null) { roleIndex = roles?.indices?.filter { (roles[it] as? JsonObject)?.text("id") == proposal.role }?.singleOrNull() ?: return null; target = roles[roleIndex].jsonObject }
        else target = item
        val text = target.text(proposal.field) ?: return null
        val next = replacePassage(text, proposal) ?: return null
        val changed = JsonObject(target + (proposal.field to JsonPrimitive(next)))
        val entry = if (roleIndex != null) JsonObject(item + ("roles" to JsonArray(requireNotNull(roles).mapIndexed { i, v -> if (i == roleIndex) changed else v }))) else changed
        return JsonObject(section + ("items" to JsonArray(items.mapIndexed { i, value -> if (i == index) entry else value })))
    }
    val sections = data["sections"] as? JsonObject ?: return null
    val builtin = sections[proposal.section] as? JsonObject
    if (builtin != null) return updateSection(builtin)?.let { changed -> JsonObject(data + ("sections" to JsonObject(sections + (proposal.section to changed)))) }
    val custom = data["customSections"] as? JsonArray ?: return null
    val index = custom.indices.filter { (custom[it] as? JsonObject)?.text("id") == proposal.section }.singleOrNull() ?: return null
    val changed = updateSection(custom[index].jsonObject) ?: return null
    return JsonObject(data + ("customSections" to JsonArray(custom.mapIndexed { i, value -> if (i == index) changed else value })))
}
internal fun bulkEligible(proposals: List<Proposal>) = proposals.filter { it.decision == Decision.Pending && !it.newDetail && it.unsupported.isEmpty() && !it.snapshot }
