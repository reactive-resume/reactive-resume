package me.rxresu.feature.assistant

import kotlinx.serialization.json.*
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.ServerEvent

internal enum class Decision { Pending, Accepted, Rejected, Stale }
internal data class Proposal(
    val id: String, val messageId: String, val toolCallId: String, val section: String, val field: String,
    val item: String? = null, val role: String? = null, val location: String, val before: String, val after: String,
    val why: String = "", val newDetail: Boolean = false, val unsupported: List<String> = emptyList(),
    val evidence: List<String> = emptyList(), val operationIds: List<String> = emptyList(),
    val snapshot: Boolean = false, val decision: Decision = Decision.Pending,
)
internal data class Question(val text: String, val answers: List<String>)
internal data class ConversationContent(
    val messageId: String = "", val reply: String = "", val proposals: List<Proposal> = emptyList(),
    val question: Question? = null, val trace: List<String> = emptyList(), val done: Boolean = false, val failed: Boolean = false,
)
private fun JsonObject.text(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull
private fun JsonObject.strings(key: String) = (get(key) as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
internal fun reduceEvent(state: ConversationContent, event: ServerEvent): ConversationContent {
    if (event.data == "[DONE]" || event.type == "done") return state.copy(done = true)
    val data = ApiJson.parseToJsonElement(event.data) as? JsonObject ?: error("Invalid stream event")
    return when (data.text("type")) {
        "start" -> state.copy(messageId = data.text("messageId") ?: state.messageId, reply = "", done = false, failed = false)
        "text-delta" -> state.copy(reply = state.reply + (data.text("delta") ?: ""))
        "error" -> state.copy(failed = true, done = true)
        "finish", "abort" -> state.copy(done = true)
        "tool-output-available" -> {
            val output = data["output"] as? JsonObject ?: return state
            val tool = data.text("toolCallId") ?: return state
            val edits = (output["edits"] as? JsonArray).orEmpty().map { value ->
                val edit = value.jsonObject; val target = edit["target"]?.jsonObject ?: error("Missing proposal target")
                Proposal(id = requireNotNull(edit.text("id")), messageId = state.messageId, toolCallId = tool,
                    section = target.text("sectionId").orEmpty(), field = target.text("field").orEmpty(), item = target.text("itemId"), role = target.text("roleId"),
                    location = edit.text("location").orEmpty(), before = requireNotNull(edit.text("before")), after = requireNotNull(edit.text("after")), why = edit.text("why").orEmpty(),
                    newDetail = (edit["addsClaims"] as? JsonPrimitive)?.booleanOrNull == true,
                    unsupported = (edit["unsupported"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.text("text") },
                    evidence = (edit["evidence"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let { evidence -> evidence.text("text") ?: evidence.text("location") } },
                    operationIds = output.strings("aiOperationIds"), snapshot = edit["snapshot"] != null,
                    decision = when (edit.text("status")) { "accepted" -> Decision.Accepted; "rejected" -> Decision.Rejected; else -> Decision.Pending })
            }
            val supersedes = output.strings("supersedes").toSet()
            val retained = state.proposals.filter { old -> edits.none { it.id == old.id } }.map { if (it.id in supersedes && it.decision == Decision.Pending) it.copy(decision = Decision.Rejected) else it }
            val question = output.text("question")?.let { Question(it, output.strings("options")) }
            state.copy(proposals = retained + edits, question = question ?: state.question, trace = state.trace + listOfNotNull(output.text("summary")))
        }
        else -> state
    }
}

/** Exact, unique anchor only; structural snapshots need the shared schema upgrader and stay unaccepted. */
internal fun replacePassage(current: String, proposal: Proposal): String? {
    if (proposal.snapshot) return null
    if (proposal.before.isEmpty()) return if (current.isEmpty()) proposal.after else null
    val index = current.indexOf(proposal.before)
    if (index < 0 || current.indexOf(proposal.before, index + proposal.before.length) >= 0) return null
    return current.replaceRange(index, index + proposal.before.length, proposal.after)
}
internal fun applyResume(data: JsonObject, proposal: Proposal): JsonObject? {
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
