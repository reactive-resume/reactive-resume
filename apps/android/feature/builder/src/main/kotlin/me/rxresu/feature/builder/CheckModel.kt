// Check issues as the web words and fixes them (apps/web/src/features/resume/editor/check/issues.ts).
package me.rxresu.feature.builder

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import me.rxresu.core.network.generated.GetResumeChecksResponseIgnoredItem
import me.rxresu.core.strings.R as S

/** A one-tap fix: [done] reads "Link updated" in the toast "Link updated. Issue resolved.". */
internal class CheckFix(val done: String, val apply: (JsonObject) -> JsonObject)

internal enum class CheckCategory(val key: String, @StringRes val title: Int, @StringRes val description: Int) {
    Contact("contact", S.string.contact_details, S.string.name_email_phone_and_location_are_found_and_links_are_full_addresses),
    Dates("dates", S.string.dates, S.string.every_entry_has_dates_in_a_form_systems_read_in_order_and_none_in_the_future),
    Layout("layout", S.string.layout, S.string.text_comes_out_in_the_order_a_person_reads_it_at_a_size_and_spacing_that_survive),
    Headings("headings", S.string.section_headings, S.string.sections_use_headings_systems_recognize_and_work_experience_shows),
    Writing("writing", S.string.writing, S.string.every_role_says_what_you_did_opinions_on_wording_live_in_the_writing_tab),
    ;

    companion object {
        fun of(code: String) = when (code) {
            "MISSING_NAME", "MISSING_EMAIL", "MALFORMED_EMAIL", "MISSING_PHONE", "MISSING_LOCATION", "MALFORMED_URL", "PICTURE_PRESENT" -> Contact
            "EMPTY_PERIOD", "UNPARSEABLE_PERIOD", "UNPARSEABLE_DATE", "REVERSED_PERIOD", "FUTURE_DATED_PERIOD" -> Dates
            "NO_VISIBLE_EXPERIENCE", "NON_STANDARD_SECTION_TITLE" -> Headings
            "MISSING_EXPERIENCE_DESCRIPTION", "FRAGMENTED_ENTRY" -> Writing
            else -> Layout
        }
    }
}

/** One open issue, worded and ready to draw. [write] opens the field in Write when there's no one-tap fix. */
internal data class IssueView(
    val key: String,
    val number: Int,
    val category: CheckCategory,
    val title: String,
    val body: String,
    val fixLabel: String?,
    val fix: CheckFix?,
    val write: BlockTarget?,
    val target: BlockTarget?,
    val keepLabel: Boolean,
)

/** Check pointers are relative to the resume data ("/sections/experience/items/0/website/url"). */
internal object CheckPointer {
    fun path(pointer: String): Path = listOf("data") + pointer.trim('/').split('/').filter { it.isNotEmpty() }.map { it.replace("~1", "/").replace("~0", "~") }

    /** The block a pointer belongs to: basics and picture → header, an entry, a section, or none (design settings). */
    fun target(doc: ResumeDoc, pointer: String): BlockTarget? {
        val parts = path(pointer).drop(1)
        return when (parts.firstOrNull()) {
            "basics", "picture" -> BlockTarget.Header
            "summary" -> BlockTarget.Section("summary")
            "sections" -> {
                val key = parts.getOrNull(1) ?: return null
                val ref = doc.section(key) ?: return null
                itemTarget(doc, ref, parts.drop(2)) ?: BlockTarget.Section(key)
            }
            "customSections" -> {
                val index = parts.getOrNull(1)?.toIntOrNull() ?: return null
                val ref = doc.sections.filter { it.custom }.getOrNull(index) ?: return null
                itemTarget(doc, ref, parts.drop(2)) ?: BlockTarget.Section(ref.key)
            }
            else -> null
        }
    }

    private fun itemTarget(doc: ResumeDoc, ref: SectionRef, rest: List<String>): BlockTarget? {
        if (rest.firstOrNull() != "items") return null
        val item = doc.items(ref).getOrNull(rest.getOrNull(1)?.toIntOrNull() ?: return null) ?: return null
        return BlockTarget.Item(ref.key, item["id"].str())
    }

    /** The entry a pointer points into, for "{entry}" in issue text. */
    fun item(doc: ResumeDoc, pointer: String): Pair<SectionRef, JsonObject>? {
        val target = target(doc, pointer) as? BlockTarget.Item ?: return null
        val ref = doc.section(target.section) ?: return null
        return doc.items(ref).firstOrNull { it["id"].str() == target.itemId }?.let { ref to it }
    }
}

private fun JsonElement?.param() = (this as? JsonPrimitive)?.content.orEmpty()

/** Words every open finding the way the web does, numbered in order like the page markers. */
@Composable
internal fun issueViews(doc: ResumeDoc, findings: List<GetResumeChecksResponseIgnoredItem>): List<IssueView> = findings.mapIndexed { i, f ->
    val code = f.code.wireValue
    val p = f.params.orEmpty()
    val value = p["value"].param()
    val minimum = p["minimum"].param()
    val path = CheckPointer.path(f.pointer)
    val sectionKey = p["section"].param()
    val sectionName = doc.section(sectionKey)?.let { doc.displayTitle(it) } ?: sectionKey
    val entry = CheckPointer.item(doc, f.pointer)?.let { (ref, item) -> ref.kind.itemTitle(item).takeIf { it.isNotBlank() }?.let { "“$it”" } } ?: stringResource(S.string.this_entry)
    val target = CheckPointer.target(doc, f.pointer)
    fun set(v: JsonElement): (JsonObject) -> JsonObject = { it.set(path, v) as JsonObject }
    var title = ""
    var body = ""
    var label: String? = null
    var fix: CheckFix? = null
    var write: BlockTarget? = null
    when (code) {
        "MISSING_NAME" -> { title = stringResource(S.string.your_name_is_missing); body = stringResource(S.string.systems_file_you_under_the_name_at_the_top_of_the_page); label = stringResource(S.string.add_your_name); write = BlockTarget.Header }
        "MISSING_EMAIL" -> { title = stringResource(S.string.no_email_address); body = stringResource(S.string.most_systems_file_candidates_by_email_address); label = stringResource(S.string.add_an_email); write = BlockTarget.Header }
        "MALFORMED_EMAIL" -> { title = stringResource(S.string.email_address_won_t_be_recognized); body = stringResource(S.string.value_isn_t_a_plain_address_like_name_example_com, value); label = stringResource(S.string.edit_the_email); write = BlockTarget.Header }
        "MISSING_PHONE" -> { title = stringResource(S.string.no_phone_number); body = stringResource(S.string.some_application_systems_ask_for_one_before_you_can_apply); label = stringResource(S.string.add_a_phone_number); write = BlockTarget.Header }
        "MISSING_LOCATION" -> { title = stringResource(S.string.no_location); body = stringResource(S.string.a_city_and_country_let_roles_be_matched_to_where_you_are); label = stringResource(S.string.add_a_location); write = BlockTarget.Header }
        "MALFORMED_URL" -> {
            title = stringResource(S.string.a_link_isn_t_a_full_address)
            body = stringResource(R.string.builder_link_plain_text, value)
            if (!Regex("^[a-zA-Z][a-zA-Z0-9+.-]*:").containsMatchIn(value)) {
                label = stringResource(R.string.builder_fix_use_https, value); fix = CheckFix(stringResource(S.string.link_updated), set(JsonPrimitive("https://$value")))
            } else { label = stringResource(S.string.edit_the_link); write = target }
        }
        "PICTURE_PRESENT" -> { title = stringResource(S.string.your_resume_has_a_photo); body = stringResource(S.string.some_systems_mishandle_images_and_photos_are_discouraged_in_some_countries); label = stringResource(S.string.hide_the_photo); fix = CheckFix(stringResource(S.string.photo_hidden)) { it.set(listOf("data", "picture", "hidden"), JsonPrimitive(true)) as JsonObject } }
        "EMPTY_PERIOD" -> { title = stringResource(S.string.an_entry_has_no_dates); body = stringResource(S.string.entry_doesn_t_say_when_dates_place_it_on_your_timeline, entry); label = stringResource(S.string.add_dates); write = target }
        "UNPARSEABLE_PERIOD" -> { title = stringResource(S.string.dates_won_t_be_read); body = stringResource(S.string.value_isn_t_a_form_systems_recognize_such_as_mar_2020_present, value); label = stringResource(S.string.fix_the_dates); write = target }
        "UNPARSEABLE_DATE" -> { title = stringResource(S.string.a_date_won_t_be_read); body = stringResource(S.string.value_isn_t_a_form_systems_recognize_such_as_march_2022, value); label = stringResource(S.string.fix_the_date); write = target }
        "REVERSED_PERIOD" -> { title = stringResource(S.string.dates_run_backwards); body = stringResource(S.string.value_ends_before_it_starts, value); label = stringResource(S.string.fix_the_dates); write = target }
        "FUTURE_DATED_PERIOD" -> { title = stringResource(S.string.dates_start_in_the_future); body = stringResource(S.string.value_starts_after_today_check_the_year_or_mark_it_as_current, value); label = stringResource(S.string.fix_the_dates); write = target }
        "SECTION_MISSING_FROM_LAYOUT" -> {
            title = stringResource(S.string.name_never_prints, sectionName); body = stringResource(S.string.it_has_entries_but_isn_t_placed_on_a_page)
            label = stringResource(S.string.add_it_to_page_1); fix = CheckFix(stringResource(S.string.name_added_to_page_1, sectionName)) { it.withPages(placeOnFirstPage(ResumeDoc(it).pages, sectionKey)) }
        }
        "MULTI_COLUMN_PROSE_SECTION" -> {
            title = stringResource(S.string.name_is_split_into_columns_columns, sectionName, p["columns"].param()); body = stringResource(S.string.columns_can_scramble_the_order_text_is_read_in)
            label = stringResource(S.string.use_one_column); fix = CheckFix(stringResource(S.string.name_uses_one_column, sectionName), set(JsonPrimitive(1)))
        }
        "PROSE_SECTION_IN_SIDEBAR" -> {
            title = stringResource(S.string.name_sits_in_the_sidebar, sectionName); body = stringResource(S.string.sidebars_are_often_read_last_or_mixed_into_the_main_column)
            label = stringResource(S.string.move_it_to_the_main_column)
            fix = CheckFix(stringResource(S.string.name_moved_to_the_main_column, sectionName)) { json -> json.withPages(ResumeDoc(json).pages.map { if (sectionKey in it.sidebar) it.copy(sidebar = it.sidebar - sectionKey, main = it.main + sectionKey) else it }) }
        }
        "TWO_COLUMN_LAYOUT" -> {
            val names = p["sections"].param().split(',').filter { it.isNotBlank() }.map { key -> doc.section(key)?.let { doc.displayTitle(it) } ?: key }.joinToString(", ")
            title = stringResource(S.string.sidebar_is_read_after_the_main_column); body = stringResource(S.string.names_come_last_in_the_text_most_systems_still_find_them_some_don_t, names)
            label = stringResource(S.string.switch_to_one_column); fix = CheckFix(stringResource(S.string.switched_to_one_column)) { it.withPages(oneColumn(ResumeDoc(it).pages)) }
        }
        "SMALL_BODY_FONT" -> {
            title = stringResource(S.string.body_text_is_very_small); body = stringResource(S.string.text_under_minimum_pt_can_be_misread_when_a_system_re_renders_it, minimum)
            label = stringResource(S.string.use_minimum_pt, minimum); fix = CheckFix(stringResource(S.string.body_text_set_to_minimum_pt, minimum), set(JsonPrimitive(minimum.toDoubleOrNull() ?: 9.0)))
        }
        "TIGHT_LINE_HEIGHT" -> {
            title = stringResource(S.string.lines_are_packed_tightly); body = stringResource(R.string.builder_tight_lines)
            label = stringResource(R.string.builder_use_line_height, minimum); fix = CheckFix(stringResource(S.string.line_height_set_to_minimum, minimum), set(JsonPrimitive(minimum.toDoubleOrNull() ?: 1.15)))
        }
        "TIGHT_PAGE_MARGINS" -> {
            title = stringResource(S.string.margins_are_very_narrow); body = stringResource(S.string.text_this_close_to_the_edge_can_be_cut_off_use_at_least_minimum_pt, minimum)
            label = stringResource(S.string.use_minimum_pt_margins, minimum); fix = CheckFix(stringResource(S.string.margins_set_to_minimum_pt, minimum), set(JsonPrimitive(minimum.toDoubleOrNull() ?: 8.0)))
        }
        "NO_VISIBLE_EXPERIENCE" -> { title = stringResource(S.string.no_work_experience_shows); body = stringResource(S.string.systems_look_for_an_experience_section_projects_or_volunteering_can_show_the_same_history); label = stringResource(S.string.add_experience); write = BlockTarget.Section("experience") }
        "NON_STANDARD_SECTION_TITLE" -> {
            title = stringResource(S.string.title_isn_t_a_heading_systems_look_for, p["title"].param()); body = stringResource(S.string.they_look_for_headings_such_as_experience_education_and_skills)
            label = stringResource(S.string.use_the_standard_heading); fix = CheckFix(stringResource(S.string.heading_changed), set(JsonPrimitive("")))
        }
        "MISSING_EXPERIENCE_DESCRIPTION" -> { title = stringResource(S.string.a_role_has_no_description); body = stringResource(S.string.entry_names_the_role_but_not_what_you_did_so_it_adds_no_keywords, entry); label = stringResource(S.string.describe_the_role); write = target }
        "FRAGMENTED_ENTRY" -> {
            title = stringResource(S.string.looks_like_part_of_the_entry_above); body = stringResource(R.string.builder_fragmented_entry_body, entry)
            label = stringResource(S.string.merge_into_previous_entry); fix = CheckFix(stringResource(S.string.merged_into_the_entry_above)) { mergeIntoPrevious(it, doc, f.pointer) }
        }
        else -> { title = code; body = "" }
    }
    IssueView(f.key, i + 1, CheckCategory.of(code), title, body, label, fix, write, target, keepLabel = code == "TWO_COLUMN_LAYOUT")
}

/** Check's "Switch to one column": sidebars join their page's main column and pages become full width. */
internal fun oneColumn(pages: List<PageLayout>) = pages.map { if (!it.fullWidth && it.sidebar.isNotEmpty()) PageLayout(it.main + it.sidebar, emptyList(), true) else it.copy(fullWidth = true) }

/** Appends a fragment's heading and text to the entry above it and removes it (web mergeIntoPreviousEntry). */
internal fun mergeIntoPrevious(json: JsonObject, doc: ResumeDoc, pointer: String): JsonObject {
    val (ref, item) = CheckPointer.item(doc, pointer) ?: return json
    val items = doc.items(ref)
    val index = items.indexOfFirst { it["id"] == item["id"] }
    if (index <= 0) return json
    val previous = items[index - 1]
    val heading = ref.kind.itemTitle(item).takeIf { it.isNotBlank() }?.let { "<p>${escapeHtml(it)}</p>" }.orEmpty()
    val merged = JsonObject(previous + ("description" to JsonPrimitive(previous["description"].str() + heading + item["description"].str())))
    return json.set(ref.path + "items", JsonArray(items.mapIndexedNotNull { i, it -> when (i) { index - 1 -> merged; index -> null; else -> it } })) as JsonObject
}
