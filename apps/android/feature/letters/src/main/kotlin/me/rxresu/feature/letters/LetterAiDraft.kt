package me.rxresu.feature.letters

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.ServerEvent

@Serializable internal data class LetterAiVersion(val text: String, val operationIds: List<String>)
@Serializable internal data class LetterAiDraft(
    val text: String = "", val operationIds: List<String> = emptyList(), val revision: Long = -1,
    val baseContent: String = "", val variant: me.rxresu.core.network.generated.CreateCoverLetterDraftRequestVariant = me.rxresu.core.network.generated.CreateCoverLetterDraftRequestVariant.Draft, val versions: List<LetterAiVersion> = emptyList(),
    val generating: Boolean = false, val failed: Boolean = false, val copyId: String? = null,
)
/** Account/server-scoped, app-private recovery. Never write generated words into the authored letter before Keep. */
internal class LetterDraftRecovery(context: Context, private val key: String) {
    private val preferences = context.getSharedPreferences("letter-ai-recovery", Context.MODE_PRIVATE)
    fun read(): LetterAiDraft? = preferences.getString(key, null)?.let { runCatching { ApiJson.decodeFromString(LetterAiDraft.serializer(), it).copy(generating = false) }.getOrNull() }
    // Blocking commit runs on IO; its result proves recovery reached disk before Keep can discard it.
    @android.annotation.SuppressLint("ApplySharedPref", "UseKtx")
    fun write(value: LetterAiDraft?) { check(if (value == null) preferences.edit().remove(key).commit() else preferences.edit().putString(key, ApiJson.encodeToString(LetterAiDraft.serializer(), value.copy(generating = false))).commit()) { "Couldn't keep the generated draft" } }
}
internal fun reduceLetterDraft(current: LetterAiDraft, event: ServerEvent): LetterAiDraft {
    check(event.type != "error") { "Draft failed" }
    if (event.type == "done") return current
    return when (val value = ApiJson.parseToJsonElement(event.data)) {
        is JsonPrimitive -> { check(value.isString); current.copy(text = current.text + value.content) }
        is JsonObject -> { val operation = (value["aiOperationId"] as? JsonPrimitive)?.content ?: error("Invalid draft event"); current.copy(operationIds = (current.operationIds + operation).distinct()) }
        else -> error("Invalid draft event")
    }
}
internal fun letterDraftHtml(text: String) = text.trim().split(Regex("\\n\\s*\\n")).joinToString("") { paragraph -> "<p>" + paragraph.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br>") + "</p>" }
