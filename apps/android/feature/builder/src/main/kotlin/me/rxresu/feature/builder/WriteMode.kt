package me.rxresu.feature.builder

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.draw.alpha
import me.rxresu.core.designsystem.RrPageTitle
import me.rxresu.core.designsystem.RrPageBand
import me.rxresu.core.designsystem.RrPaperPage
import me.rxresu.core.designsystem.RrSectionHeading
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMenuItem
import me.rxresu.core.designsystem.RrMenuLabel
import me.rxresu.core.designsystem.RrRowCaret
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.strings.R as S
import me.rxresu.core.designsystem.R as D

/** Field-first destinations share one draft owner. */
internal class WriteNav(
    val entry: (section: String, itemId: String?) -> Unit = { _, _ -> },
    val basics: () -> Unit = {},
    val richText: (section: String, itemId: String, field: String) -> Unit = { _, _, _ -> },
    val check: () -> Unit = {},
    val section: (String) -> Unit = {},
)

/** Opens the editor represented by a page block; Summary opens its text directly. */
internal fun WriteNav.open(doc: ResumeDoc, target: BlockTarget, onOutline: () -> Unit) {
    when (target) {
        BlockTarget.Header -> basics()
        is BlockTarget.Item -> entry(target.section, target.itemId)
        is BlockTarget.Section -> {
            val ref = doc.section(target.key) ?: return onOutline()
            if (ref.kind == SectionKind.Summary) richText(ref.key, "summary", "content")
            else section(ref.key)
        }
    }
}

/** B1: field-first overview; page opens the full-screen preview. */
@Composable
internal fun OverviewScreen(state: BuilderUiState, actions: BuilderActions, nav: WriteNav, onSection: (String) -> Unit, onPreview: () -> Unit, modifier: Modifier = Modifier, scrollState: androidx.compose.foundation.ScrollState = rememberScrollState()) {
    val doc = state.doc ?: return
    var menu by remember { mutableStateOf<SectionRef?>(null) }
    var adding by remember { mutableStateOf(false) }
    var custom by remember { mutableStateOf(false) }
    val placed = doc.pages.flatMap { it.main + it.sidebar }.distinct().mapNotNull(doc::section)
    val visible = placed.filterNot(doc::hidden)
    val hidden = doc.sections.filter { doc.hidden(it) || it !in placed }.filter { it.custom || doc.items(it).isNotEmpty() || doc.hidden(it) }
    Column(modifier.fillMaxSize().verticalScroll(scrollState)) {
        val status = when {
            state.locked -> stringResource(R.string.builder_locked_status)
            state.status == me.rxresu.core.database.SaveStatus.Offline -> stringResource(R.string.builder_offline_status)
            state.status == me.rxresu.core.database.SaveStatus.Saving -> stringResource(S.string.saving)
            state.status == me.rxresu.core.database.SaveStatus.CouldntSave -> stringResource(R.string.builder_not_saved_retry)
            else -> pluralStringResource(R.plurals.builder_overview_status, state.pages.size.coerceAtLeast(1), state.pages.size.coerceAtLeast(1), if (doc.json["isPublic"].bool()) stringResource(R.string.builder_public) else stringResource(R.string.builder_private))
        }
        RrPageTitle(doc.name, modifier = Modifier.clickable(enabled = state.status == me.rxresu.core.database.SaveStatus.CouldntSave, onClick = actions::flush), subtitle = status, subtitleColor = RrTheme.colors.ink3)
        RrPageBand(onClick = onPreview) {
            RrPaperPage(state.pages.firstOrNull(), stringResource(R.string.builder_preview_page), Modifier.padding(vertical = 1.dp).width(170.dp))
        }
        RrSectionHeading(stringResource(S.string.sections))
        RrListRow(stringResource(S.string.basics), subtitle = listOf(doc.basics["name"].str(), doc.basics["headline"].str()).filter(String::isNotBlank).joinToString(" · "), onClick = nav.basics, divider = visible.isNotEmpty(), trailing = { RrRowCaret() })
        visible.forEachIndexed { index, ref ->
            val summary = if (ref.kind == SectionKind.Summary) htmlText(doc.sectionJson(ref)["content"].str()).joinToString(" ").let { if (it.length > 36) it.take(36).trimEnd() + "…" else it }
                else if (ref.kind == SectionKind.Skills) pluralStringResource(R.plurals.builder_skills_count, doc.items(ref).size, doc.items(ref).size)
                else doc.items(ref).filterNot { it["hidden"].bool() }.joinToString(", ") { ref.kind.itemTitle(it) }
            RrListRow(doc.displayTitle(ref), subtitle = summary, divider = index < visible.lastIndex,
                onClick = { if (ref.kind == SectionKind.Summary) nav.richText(ref.key, "summary", "content") else onSection(ref.key) },
                onLongClick = if (state.locked) null else ({ menu = ref }), trailing = { RrRowCaret() })
        }
        if (hidden.isNotEmpty()) {
            RrSectionHeading(stringResource(S.string.hidden_sections))
            hidden.forEachIndexed { index, ref -> RrListRow(doc.displayTitle(ref), subtitle = stringResource(R.string.builder_not_on_page), modifier = Modifier.alpha(0.45f), divider = index < hidden.lastIndex,
                onClick = { if (ref.kind == SectionKind.Summary) nav.richText(ref.key, "summary", "content") else onSection(ref.key) }, onLongClick = if (state.locked) null else ({ menu = ref }), trailing = { RrRowCaret() }) }
        }
        RrButton(stringResource(S.string.add_section), { adding = true }, Modifier.padding(horizontal = 24.dp), variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Large, icon = D.drawable.ic_ph_plus, enabled = !state.locked)
        Spacer(Modifier.height(24.dp))
    }
    menu?.let { SectionMenu(doc, it, actions) { menu = null } }
    if (adding) AddSectionSheet(doc, actions, { adding = false; custom = true }) { adding = false }
    if (custom) CustomSectionSheet(actions) { custom = false }
}

@Composable
internal fun SectionMenu(doc: ResumeDoc, ref: SectionRef, actions: BuilderActions, onDismiss: () -> Unit) {
    val title = doc.displayTitle(ref)
    val hidden = doc.hidden(ref)
    var renaming by remember { mutableStateOf(false) }
    if (renaming) {
        RrBottomSheet(onDismissRequest = onDismiss, title = stringResource(R.string.builder_rename_section), fitContent = true) {
            Column(Modifier.padding(24.dp)) {
                TextField(stringResource(S.string.name), doc.title(ref), false, actions = actions) { actions.set(ref.path + "title", kotlinx.serialization.json.JsonPrimitive(it)) }
                RrButton(stringResource(S.string.done), onDismiss)
            }
        }
        return
    }
    RrBottomSheet(onDismissRequest = onDismiss, fitContent = true, title = title) {
        RrMenuItem(stringResource(R.string.builder_rename_section), { renaming = true })
        val pageIndex = doc.pageOf(ref.key)
        if (pageIndex != null) {
            RrMenuItem(stringResource(S.string.move_up), { actions.moveSection(ref.key, -1); onDismiss() }, icon = D.drawable.ic_ph_caret_up)
            RrMenuItem(stringResource(S.string.move_down), { actions.moveSection(ref.key, 1); onDismiss() }, icon = D.drawable.ic_ph_caret_down)
        }
        RrMenuLabel(stringResource(S.string.move_to_6ffcfca36b))
        doc.pages.forEachIndexed { i, _ ->
            RrMenuItem(stringResource(S.string.page_0, "${i + 1}") + " · " + stringResource(S.string.main), { actions.placeSection(ref.key, i, sidebar = false); onDismiss() })
            if (templateColumns(doc.template) == 2 && !doc.pages[i].fullWidth) {
                RrMenuItem(stringResource(S.string.page_0, "${i + 1}") + " · " + stringResource(S.string.sidebar), { actions.placeSection(ref.key, i, sidebar = true); onDismiss() })
            }
        }
        RrMenuItem(stringResource(S.string.new_page), { actions.placeSection(ref.key, doc.pages.size, sidebar = false); onDismiss() }, icon = D.drawable.ic_ph_file_plus)
        RrMenuItem(
            if (hidden) stringResource(S.string.show_title_on_the_page, title) else stringResource(S.string.hide_title_from_the_page, title),
            { actions.setSectionHidden(ref.key, !hidden); onDismiss() },
            icon = if (hidden) D.drawable.ic_ph_eye else D.drawable.ic_ph_eye_slash,
        )
        if (ref.kind != SectionKind.Summary) {
            RrMenuItem(
                stringResource(if (ref.custom) S.string.delete_section else S.string.clear_section),
                { actions.clearSection(ref.key, title); onDismiss() },
                icon = D.drawable.ic_ph_trash,
                danger = true,
            )
        }
    }
}

@Composable
internal fun EntryMenu(doc: ResumeDoc, ref: SectionRef, itemId: String, actions: BuilderActions, nav: WriteNav, onDismiss: () -> Unit) {
    val item = doc.items(ref).firstOrNull { it["id"].str() == itemId } ?: return onDismiss()
    val hidden = item["hidden"].bool()
    val haptics = rememberRrHaptics()
    RrBottomSheet(onDismissRequest = onDismiss, fitContent = true, title = ref.kind.itemTitle(item).ifBlank { stringResource(S.string.entry_options) }) {
        RrMenuItem(stringResource(if (hidden) S.string.show_on_page else S.string.hide_from_page), { actions.setItemHidden(ref.key, itemId, !hidden); onDismiss() }, icon = if (hidden) D.drawable.ic_ph_eye else D.drawable.ic_ph_eye_slash)
        RrMenuItem(stringResource(S.string.move_up), { actions.reorderItem(ref.key, itemId, -1); onDismiss() }, icon = D.drawable.ic_ph_caret_up)
        RrMenuItem(stringResource(S.string.move_down), { actions.reorderItem(ref.key, itemId, 1); onDismiss() }, icon = D.drawable.ic_ph_caret_down)
        RrMenuItem(stringResource(S.string.duplicate), { actions.duplicateItem(ref.key, itemId); onDismiss() }, icon = D.drawable.ic_ph_copy)
        val targets = doc.sections.filter { it.kind == ref.kind && it.key != ref.key }
        if (targets.isNotEmpty()) {
            RrMenuLabel(stringResource(S.string.move_to_6ffcfca36b))
            targets.forEach { t -> RrMenuItem(doc.displayTitle(t), { actions.moveItem(ref.key, itemId, t.key); onDismiss() }) }
        }
        RrMenuItem(stringResource(S.string.delete_entry), { haptics(RrHaptic.Light); actions.deleteItem(ref.key, itemId); onDismiss() }, icon = D.drawable.ic_ph_trash, danger = true)
    }
}

/** Add section: "Sections most resumes also have:" (unused built-ins) and Custom section. */
@Composable
private fun AddSectionSheet(doc: ResumeDoc, actions: BuilderActions, onCustom: () -> Unit, onDismiss: () -> Unit) {
    val placed = doc.pages.flatMap { it.main + it.sidebar }.toSet()
    val unused = SectionKind.addable.filter { kind -> doc.section(kind.key)?.let { doc.hidden(it) || it.key !in placed } ?: false }
    RrBottomSheet(onDismissRequest = onDismiss, fitContent = true, title = stringResource(S.string.add_section)) {
        if (unused.isNotEmpty()) {
            RrMenuLabel(stringResource(R.string.builder_sections_most_resumes_have))
            unused.forEach { kind -> RrMenuItem(stringResource(kind.defaultTitle), { actions.addSection(kind); onDismiss() }, icon = D.drawable.ic_ph_plus) }
        }
        RrMenuItem(stringResource(S.string.custom_section), onCustom, icon = D.drawable.ic_ph_note_pencil)
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun CustomSectionSheet(actions: BuilderActions, onDismiss: () -> Unit) {
    RrBottomSheet(onDismissRequest = onDismiss, fitContent = true, title = stringResource(S.string.custom_section)) {
        RrMenuLabel(stringResource(S.string.what_goes_in_it))
        val title = stringResource(S.string.custom_section)
        (SectionKind.addable + SectionKind.Summary).forEach { kind ->
            val name = stringResource(kind.defaultTitle)
            RrMenuItem(name, { actions.addCustomSection(kind, name.ifBlank { title }); onDismiss() })
        }
    }
}

/** Polite announcement for reorders ("Experience moved to position 3 of 6"). */
@Suppress("DEPRECATION") // Compose has no live-region announcement for a one-off message yet.
private fun announce(view: android.view.View, text: String) = view.announceForAccessibility(text)

/** The tab over a picked block: "Experience · Northwind Labs", or the section or name alone. */
@Composable
internal fun highlightLabel(doc: ResumeDoc, target: BlockTarget): String? = when (target) {
    BlockTarget.Header -> stringResource(S.string.basics)
    is BlockTarget.Section -> doc.section(target.key)?.let { doc.displayTitle(it) }
    is BlockTarget.Item -> doc.section(target.section)?.let { ref ->
        val item = doc.items(ref).firstOrNull { it["id"].str() == target.itemId }
        listOfNotNull(doc.displayTitle(ref), item?.let { ref.kind.itemTitle(it) }?.ifBlank { null }).joinToString(" · ")
    }
}
