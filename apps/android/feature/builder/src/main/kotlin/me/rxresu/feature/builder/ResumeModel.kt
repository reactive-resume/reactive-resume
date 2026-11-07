// The resume as JSON for editing. The generated DTOs mirror packages/schema closely but with machine names, so the
// builder edits the JSON tree (same shape the web writes) and decodes back to `Resume` before `draft.update`.
package me.rxresu.feature.builder

import java.util.UUID
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.Resume

internal fun Resume.toJson(): JsonObject = ApiJson.encodeToJsonElement(Resume.serializer(), this).jsonObject
internal fun JsonObject.toResume(): Resume = ApiJson.decodeFromJsonElement(Resume.serializer(), this)

internal fun JsonElement?.str(): String = (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull.orEmpty()
internal fun JsonElement?.bool(): Boolean = (this as? JsonPrimitive)?.booleanOrNull == true
internal fun JsonElement?.num(): Double? = (this as? JsonPrimitive)?.doubleOrNull
internal fun JsonElement?.obj(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
internal fun JsonElement?.arr(): List<JsonElement> = (this as? JsonArray).orEmpty()

/** A JSON path: object keys, or array indexes as strings. */
internal typealias Path = List<String>

internal fun JsonElement.at(path: Path): JsonElement? = path.fold<String, JsonElement?>(this) { node, key ->
    when (node) {
        is JsonObject -> node[key]
        is JsonArray -> key.toIntOrNull()?.let(node::getOrNull)
        else -> null
    }
}

/** Copy with [value] at [path]; objects gain missing keys, arrays replace an existing index. */
internal fun JsonElement.set(path: Path, value: JsonElement): JsonElement {
    if (path.isEmpty()) return value
    val key = path.first()
    return when (this) {
        is JsonArray -> {
            val index = key.toInt()
            JsonArray(mapIndexed { i, child -> if (i == index) child.set(path.drop(1), value) else child })
        }
        else -> {
            val map = obj()
            JsonObject(map + (key to (map[key] ?: JsonObject(emptyMap())).set(path.drop(1), value)))
        }
    }
}

internal fun JsonElement.update(path: Path, change: (JsonElement?) -> JsonElement) = set(path, change(at(path)))

internal fun newId(): String = UUID.randomUUID().toString()

/** Where a section lives: `data.sections.<key>`, `data.summary`, or `data.customSections[i]` (key = its id). */
internal data class SectionRef(val key: String, val path: Path, val kind: SectionKind, val custom: Boolean)

/** Section types from packages/schema (`sectionTypeSchema`). [anchor] is the field that names an entry on the page. */
internal enum class SectionKind(val key: String, val anchor: String) {
    Summary("summary", "content"),
    Profiles("profiles", "network"),
    Experience("experience", "company"),
    Education("education", "school"),
    Projects("projects", "name"),
    Skills("skills", "name"),
    Languages("languages", "language"),
    Interests("interests", "name"),
    Awards("awards", "title"),
    Certifications("certifications", "title"),
    Publications("publications", "title"),
    Volunteer("volunteer", "organization"),
    References("references", "name"),
    ;

    /** The heading the page prints for an empty title in English, for matching page text. */
    val englishTitle: String get() = name

    /** Uses `period` (ranges) or `date` (single dates) as the legacy date text, or neither. */
    val dateField: String?
        get() = when (this) {
            Experience, Education, Projects, Volunteer -> "period"
            Awards, Certifications, Publications -> "date"
            else -> null
        }

    companion object {
        fun of(key: String) = entries.firstOrNull { it.key == key }
        /** The order of "Sections most resumes also have" in Add section. */
        val addable = listOf(Experience, Education, Skills, Projects, Languages, Certifications, Awards, Interests, Volunteer, Publications, References, Profiles)
    }
}

/** A field as the entry sheet draws it. */
internal enum class FieldType { Text, Url, Email, Phone, Dates, Date, RichText, Level, Keywords }
internal data class FieldSpec(val key: String, val type: FieldType = FieldType.Text, val more: Boolean = false)

/** Fields per section type, in the web's order (features/resume/editor/write). Rare ones sit under "More options". */
internal fun SectionKind.fields(): List<FieldSpec> = when (this) {
    SectionKind.Summary -> listOf(FieldSpec("content", FieldType.RichText))
    SectionKind.Experience -> listOf(FieldSpec("company"), FieldSpec("position"), FieldSpec("period", FieldType.Dates), FieldSpec("location"), FieldSpec("description", FieldType.RichText), FieldSpec("website", FieldType.Url, more = true))
    SectionKind.Education -> listOf(FieldSpec("school"), FieldSpec("degree"), FieldSpec("area"), FieldSpec("grade"), FieldSpec("period", FieldType.Dates), FieldSpec("location"), FieldSpec("description", FieldType.RichText), FieldSpec("website", FieldType.Url, more = true))
    SectionKind.Projects -> listOf(FieldSpec("name"), FieldSpec("period", FieldType.Dates), FieldSpec("description", FieldType.RichText), FieldSpec("website", FieldType.Url, more = true))
    SectionKind.Skills -> listOf(FieldSpec("name"), FieldSpec("proficiency"), FieldSpec("level", FieldType.Level), FieldSpec("keywords", FieldType.Keywords))
    SectionKind.Languages -> listOf(FieldSpec("language"), FieldSpec("fluency"), FieldSpec("level", FieldType.Level))
    SectionKind.Interests -> listOf(FieldSpec("name"), FieldSpec("keywords", FieldType.Keywords))
    SectionKind.Profiles -> listOf(FieldSpec("network"), FieldSpec("username"), FieldSpec("website", FieldType.Url))
    SectionKind.Awards -> listOf(FieldSpec("title"), FieldSpec("awarder"), FieldSpec("date", FieldType.Date), FieldSpec("description", FieldType.RichText), FieldSpec("website", FieldType.Url, more = true))
    SectionKind.Certifications -> listOf(FieldSpec("title"), FieldSpec("issuer"), FieldSpec("date", FieldType.Date), FieldSpec("description", FieldType.RichText), FieldSpec("website", FieldType.Url, more = true))
    SectionKind.Publications -> listOf(FieldSpec("title"), FieldSpec("publisher"), FieldSpec("date", FieldType.Date), FieldSpec("description", FieldType.RichText), FieldSpec("website", FieldType.Url, more = true))
    SectionKind.Volunteer -> listOf(FieldSpec("organization"), FieldSpec("location"), FieldSpec("period", FieldType.Dates), FieldSpec("description", FieldType.RichText), FieldSpec("website", FieldType.Url, more = true))
    SectionKind.References -> listOf(FieldSpec("name"), FieldSpec("position"), FieldSpec("phone", FieldType.Phone), FieldSpec("description", FieldType.RichText), FieldSpec("website", FieldType.Url, more = true))
}

private val website = JsonObject(mapOf("url" to JsonPrimitive(""), "label" to JsonPrimitive(""), "inlineLink" to JsonPrimitive(false)))
private val noDates = JsonObject(mapOf("start" to JsonNull, "end" to JsonNull, "present" to JsonPrimitive(false)))

/** A new, empty entry with every field the schema requires (drafts aren't printed until the anchor is filled). */
internal fun SectionKind.newItem(id: String = newId()): JsonObject {
    val fields = mutableMapOf<String, JsonElement>("id" to JsonPrimitive(id), "hidden" to JsonPrimitive(false))
    fun text(vararg keys: String) = keys.forEach { fields[it] = JsonPrimitive("") }
    when (this) {
        SectionKind.Summary -> text("content")
        SectionKind.Experience -> { text("company", "position", "location", "period", "description"); fields["roles"] = JsonArray(emptyList()); fields["dates"] = noDates; fields["website"] = website }
        SectionKind.Education -> { text("school", "degree", "area", "grade", "location", "period", "description"); fields["dates"] = noDates; fields["website"] = website }
        SectionKind.Projects -> { text("name", "period", "description"); fields["dates"] = noDates; fields["website"] = website }
        SectionKind.Skills -> { text("name", "proficiency", "icon", "iconColor"); fields["level"] = JsonPrimitive(0); fields["keywords"] = JsonArray(emptyList()) }
        SectionKind.Languages -> { text("language", "fluency"); fields["level"] = JsonPrimitive(0) }
        SectionKind.Interests -> { text("name", "icon", "iconColor"); fields["keywords"] = JsonArray(emptyList()) }
        SectionKind.Profiles -> { text("network", "username", "icon", "iconColor"); fields["website"] = website }
        SectionKind.Awards -> { text("title", "awarder", "date", "description"); fields["dates"] = noDates; fields["website"] = website }
        SectionKind.Certifications -> { text("title", "issuer", "date", "description"); fields["dates"] = noDates; fields["website"] = website }
        SectionKind.Publications -> { text("title", "publisher", "date", "description"); fields["dates"] = noDates; fields["website"] = website }
        SectionKind.Volunteer -> { text("organization", "location", "period", "description"); fields["dates"] = noDates; fields["website"] = website }
        SectionKind.References -> { text("name", "position", "phone", "description"); fields["website"] = website }
    }
    return JsonObject(fields)
}

/** Read-only view of a resume's JSON with the lookups every screen needs. */
internal class ResumeDoc(val json: JsonObject) {
    val data get() = json["data"].obj()
    val name get() = json["name"].str()
    val metadata get() = data["metadata"].obj()
    val basics get() = data["basics"].obj()
    val locale get() = metadata["page"].obj()["locale"].str().ifBlank { "en-US" }

    /** Built-in sections in schema order, then custom sections. Summary first. */
    val sections: List<SectionRef> by lazy {
        buildList {
            add(SectionRef("summary", listOf("data", "summary"), SectionKind.Summary, custom = false))
            data["sections"].obj().keys.forEach { key ->
                SectionKind.of(key)?.let { add(SectionRef(key, listOf("data", "sections", key), it, custom = false)) }
            }
            data["customSections"].arr().forEachIndexed { i, section ->
                val kind = SectionKind.of(section.obj()["type"].str()) ?: return@forEachIndexed
                add(SectionRef(section.obj()["id"].str(), listOf("data", "customSections", "$i"), kind, custom = true))
            }
        }
    }

    fun section(key: String) = sections.firstOrNull { it.key == key }
    fun sectionJson(ref: SectionRef) = json.at(ref.path).obj()
    fun title(ref: SectionRef) = sectionJson(ref)["title"].str()
    fun hidden(ref: SectionRef) = sectionJson(ref)["hidden"].bool()

    /** Summary is one implicit entry (id "summary"); others list `items`. */
    fun items(ref: SectionRef): List<JsonObject> =
        if (ref.kind == SectionKind.Summary) listOf(JsonObject(sectionJson(ref) + ("id" to JsonPrimitive("summary"))))
        else sectionJson(ref)["items"].arr().map { it.obj() }

    fun itemIndex(ref: SectionRef, itemId: String) = items(ref).indexOfFirst { it["id"].str() == itemId }
    fun itemPath(ref: SectionRef, itemId: String): Path? =
        if (ref.kind == SectionKind.Summary) ref.path else itemIndex(ref, itemId).takeIf { it >= 0 }?.let { ref.path + "items" + "$it" }

    /** Layout pages: section keys in the main column and sidebar, per page. */
    val pages: List<PageLayout>
        get() = metadata["layout"].obj()["pages"].arr().map { page ->
            val p = page.obj()
            PageLayout(p["main"].arr().map { it.str() }, p["sidebar"].arr().map { it.str() }, p["fullWidth"].bool())
        }

    /** The page index a section prints on, or null when it isn't placed. */
    fun pageOf(key: String) = pages.indexOfFirst { key in it.main || key in it.sidebar }.takeIf { it >= 0 }

    val template get() = metadata["template"].str()
}

internal data class PageLayout(val main: List<String>, val sidebar: List<String>, val fullWidth: Boolean)

/** Plain text from the rich text HTML the web stores (`<ul><li>…</li></ul>`, `<p>…</p>`). */
internal fun htmlText(html: String): List<String> =
    html.replace(Regex("(?i)</(li|p|div|h[1-6])>|<br\\s*/?>"), "\n")
        .replace(Regex("<[^>]+>"), "")
        .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ")
        .lines().map { it.trim() }.filter { it.isNotEmpty() }

internal fun escapeHtml(text: String) = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

/** The one line an outline row shows under an entry's name. */
internal fun SectionKind.subtitle(item: JsonObject): String {
    val parts = when (this) {
        SectionKind.Experience -> listOf(item["position"].str(), item["period"].str())
        SectionKind.Education -> listOf(listOf(item["degree"].str(), item["area"].str()).filter { it.isNotBlank() }.joinToString(", "), item["period"].str())
        SectionKind.Projects, SectionKind.Volunteer -> listOf(item["period"].str())
        SectionKind.Skills -> listOf(item["proficiency"].str())
        SectionKind.Languages -> listOf(item["fluency"].str())
        SectionKind.Profiles -> listOf(item["username"].str())
        SectionKind.Awards -> listOf(item["awarder"].str(), item["date"].str())
        SectionKind.Certifications -> listOf(item["issuer"].str(), item["date"].str())
        SectionKind.Publications -> listOf(item["publisher"].str(), item["date"].str())
        SectionKind.References -> listOf(item["position"].str())
        SectionKind.Interests -> listOf(item["keywords"].arr().joinToString(", ") { it.str() })
        SectionKind.Summary -> emptyList()
    }
    return parts.filter { it.isNotBlank() }.joinToString(" · ")
}

/** An entry's display name: its anchor field, or the summary's first words. */
internal fun SectionKind.itemTitle(item: JsonObject): String =
    if (this == SectionKind.Summary) htmlText(item["content"].str()).firstOrNull().orEmpty() else item[anchor].str()
