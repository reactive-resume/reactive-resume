package me.rxresu.feature.builder

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMenuItem
import me.rxresu.core.designsystem.RrMenuLabel
import me.rxresu.core.designsystem.RrRowCaret
import me.rxresu.core.designsystem.RrSectionHeader
import me.rxresu.core.designsystem.RrSegment
import me.rxresu.core.designsystem.RrSegmentedControl
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.WriteView
import me.rxresu.core.strings.R as S
import me.rxresu.core.designsystem.R as D

/** Where Write mode sends a tap: entry sheet (B2), basics (B5), rich text (B4) or Check. */
internal class WriteNav(
    val entry: (section: String, itemId: String?) -> Unit = { _, _ -> },
    val basics: () -> Unit = {},
    val richText: (section: String, itemId: String, field: String) -> Unit = { _, _, _ -> },
    val check: () -> Unit = {},
)

/** Opens what a page block stands for; a section title opens its first entry, an empty section the Outline. */
internal fun WriteNav.open(doc: ResumeDoc, target: BlockTarget, onOutline: () -> Unit) {
    when (target) {
        BlockTarget.Header -> basics()
        is BlockTarget.Item -> entry(target.section, target.itemId)
        is BlockTarget.Section -> {
            val ref = doc.section(target.key) ?: return onOutline()
            if (ref.kind == SectionKind.Summary) richText(ref.key, "summary", "content")
            else doc.items(ref).firstOrNull()?.let { entry(ref.key, it["id"].str()) } ?: onOutline()
        }
    }
}

/** B1 and B3: the Page or Outline toggle above the page canvas or the section outline. */
@Composable
internal fun WriteMode(
    state: BuilderUiState,
    view: WriteView,
    onView: (WriteView) -> Unit,
    actions: BuilderActions,
    nav: WriteNav,
    modifier: Modifier = Modifier,
    zoom: PageZoomState = remember { PageZoomState() },
    markers: List<Pair<BlockTarget, Int>> = emptyList(),
    initiallyExpanded: String? = null,
) {
    val doc = state.doc ?: return
    val haptics = rememberRrHaptics()
    var scale by remember { mutableFloatStateOf(1f) }
    Column(modifier.fillMaxSize().background(RrTheme.colors.sunken)) {
        if (!(view == WriteView.Page && state.highlightAboveSheet)) Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            RrSegmentedControl(
                listOf(RrSegment(stringResource(S.string.page), D.drawable.ic_ph_file_text), RrSegment(stringResource(R.string.builder_outline), D.drawable.ic_ph_list_bullets)),
                selectedIndex = view.ordinal,
                onSelect = { haptics(RrHaptic.Selection); onView(WriteView.entries[it]) },
                modifier = Modifier.width(184.dp),
                containerColor = RrTheme.colors.bg,
            )
            Spacer(Modifier.weight(1f))
            val count = state.pages.size.coerceAtLeast(doc.pages.size).coerceAtLeast(1)
            if (view == WriteView.Page) PagePosition(1, count, scale)
            else RrText(pluralStringResource(R.plurals.builder_page_count, count, count), style = RrType.mono, color = RrTheme.colors.ink3)
        }
        if (view == WriteView.Page) {
            PageCanvas(
                pages = state.pages,
                blocks = state.blocks,
                pageCountHint = doc.pages.size.coerceAtLeast(1),
                highlight = state.highlight,
                highlightLabel = state.highlight?.let { highlightLabel(doc, it) },
                sheetCover = if (state.highlightAboveSheet) 1f - EntryDetents.first() else null,
                markers = markers,
                zoom = zoom,
                onZoomChange = { scale = it },
                onTap = { page, x, y ->
                    val hit = state.blocks?.let { PageBlocks.hit(it, page, x, y) }
                    if (hit == null) onView(WriteView.Outline)
                    else { actions.highlight(hit.target); nav.open(doc, hit.target) { onView(WriteView.Outline) } }
                },
            )
        } else {
            Outline(state, doc, actions, nav, Modifier.weight(1f), initiallyExpanded)
        }
    }
}

private sealed interface OutlineMenu {
    data class Section(val ref: SectionRef) : OutlineMenu
    data class Entry(val ref: SectionRef, val itemId: String) : OutlineMenu
    data object Add : OutlineMenu
    data object AddCustom : OutlineMenu
}

/** B3: sections grouped by page, then Sidebar, then Hidden sections. One section open at a time. */
@Composable
private fun Outline(state: BuilderUiState, doc: ResumeDoc, actions: BuilderActions, nav: WriteNav, modifier: Modifier, initiallyExpanded: String?) {
    var expanded by rememberSaveable { mutableStateOf(initiallyExpanded) }
    var menu by remember { mutableStateOf<OutlineMenu?>(null) }
    val view = LocalView.current
    val twoColumns = templateColumns(doc.template) == 2
    val visible = doc.sections.filter { !doc.hidden(it) }
    val placed = doc.pages.flatMap { it.main + it.sidebar }.toSet()
    val hiddenOrUnplaced = doc.sections.filter { (doc.hidden(it) || it.key !in placed) && (it.custom || doc.items(it).isNotEmpty() && it.kind != SectionKind.Summary || doc.hidden(it)) }
    val locked = state.locked
    Box(modifier.fillMaxWidth().background(RrTheme.colors.bg)) {
        Column(Modifier.fillMaxSize()) {
            val scroll = rememberScrollState()
            val autoScroll = remember(scroll) { ReorderAutoScroll(scroll) }
            Column(Modifier.weight(1f).reorderViewport(autoScroll).verticalScroll(scroll).padding(bottom = 16.dp)) {
                doc.pages.forEachIndexed { pageIndex, page ->
                    val columns = if (twoColumns && !page.fullWidth) listOf(page.main to false, page.sidebar to true) else listOf(page.main + page.sidebar to false)
                    columns.forEach { (keys, sidebar) ->
                        val refs = keys.mapNotNull { doc.section(it) }.filter { it in visible }
                        RrSectionHeader(if (sidebar) stringResource(S.string.sidebar) else stringResource(S.string.page_0, "${pageIndex + 1}"))
                        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                            Column {
                                if (pageIndex == 0 && !sidebar) {
                                    RrListRow(
                                        stringResource(S.string.basics),
                                        subtitle = listOf(doc.basics["name"].str(), doc.basics["headline"].str()).filter { it.isNotBlank() }.joinToString(" · "),
                                        icon = D.drawable.ic_ph_identification_card,
                                        onClick = nav.basics,
                                        trailing = { RrRowCaret() },
                                    )
                                }
                                ReorderColumn(
                                    items = refs,
                                    key = { it.key },
                                    enabled = !locked,
                                    autoScroll = autoScroll,
                                    onActions = { menu = OutlineMenu.Section(it) },
                                    onMove = { from, to ->
                                        val moved = refs.moved(from, to).map { it.key }
                                        actions.setLayout { pages -> pages.mapIndexed { i, p -> if (i != pageIndex) p else if (sidebar) p.copy(sidebar = mergeOrder(p.sidebar, moved)) else p.copy(main = mergeOrder(p.main, moved)) } }
                                        announce(view, view.context.getString(R.string.builder_section_moved, doc.title(refs[from]).ifBlank { view.context.getString(refs[from].kind.defaultTitle) }, to + 1, refs.size))
                                    },
                                ) { ref, _ -> SectionRow(doc, ref, expanded == ref.key, locked, actions, nav, autoScroll, onToggle = { expanded = if (expanded == ref.key) null else ref.key }, onMenu = { menu = it }) }
                            }
                        }
                    }
                }
                if (hiddenOrUnplaced.isNotEmpty()) {
                    RrSectionHeader(stringResource(S.string.hidden_sections))
                    RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                        Column {
                            hiddenOrUnplaced.forEach { ref ->
                                val title = doc.displayTitle(ref)
                                RrListRow(
                                    title,
                                    subtitle = if (!doc.hidden(ref)) stringResource(R.string.builder_not_on_page) else null,
                                    icon = D.drawable.ic_ph_eye_slash,
                                    onClick = { menu = OutlineMenu.Section(ref) },
                                    trailing = { RrText(pluralStringResource(S.plurals.entries_plural_one_entry_other_entries, doc.items(ref).size, doc.items(ref).size), color = RrTheme.colors.ink3) },
                                )
                            }
                        }
                    }
                    hiddenOrUnplaced.firstOrNull { !doc.hidden(it) && doc.items(it).isNotEmpty() }?.let { ref ->
                        RrCallout(
                            stringResource(S.string.name_never_prints, doc.displayTitle(ref)) + " " + stringResource(S.string.it_has_entries_but_isn_t_placed_on_a_page),
                            Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                            tone = RrTone.Warn,
                            actionLabel = stringResource(S.string.check),
                            onAction = nav.check,
                        )
                    }
                }
            }
            Box(Modifier.fillMaxWidth().background(RrTheme.colors.bg).padding(horizontal = 16.dp, vertical = 8.dp)) {
                RrButton(stringResource(S.string.add_section), { menu = OutlineMenu.Add }, Modifier.fillMaxWidth(), RrButtonVariant.Secondary, RrButtonSize.Large, icon = D.drawable.ic_ph_plus, enabled = !locked)
            }
        }
        when (val m = menu) {
            null -> Unit
            is OutlineMenu.Section -> SectionMenu(doc, m.ref, actions) { menu = null }
            is OutlineMenu.Entry -> EntryMenu(doc, m.ref, m.itemId, actions, nav) { menu = null }
            OutlineMenu.Add -> AddSectionSheet(doc, actions, onCustom = { menu = OutlineMenu.AddCustom }) { menu = null }
            OutlineMenu.AddCustom -> CustomSectionSheet(actions) { menu = null }
        }
    }
}

/** Keeps sections of [order] in their new order while leaving keys not shown in this group where they were. */
internal fun mergeOrder(existing: List<String>, order: List<String>): List<String> {
    val shown = order.toSet()
    val queue = ArrayDeque(order)
    return existing.map { if (it in shown) queue.removeFirst() else it } + queue
}

@Composable
private fun SectionRow(doc: ResumeDoc, ref: SectionRef, open: Boolean, locked: Boolean, actions: BuilderActions, nav: WriteNav, autoScroll: ReorderAutoScroll?, onToggle: () -> Unit, onMenu: (OutlineMenu) -> Unit) {
    val title = doc.displayTitle(ref)
    val items = doc.items(ref)
    val c = RrTheme.colors
    val moveUp = stringResource(S.string.move_up)
    val moveDown = stringResource(S.string.move_down)
    Column(Modifier.background(if (open) c.raised else c.surface)) {
        RrListRow(
            title,
            modifier = Modifier.semantics {
                customActions = listOf(
                    CustomAccessibilityAction(moveUp) { actions.moveSection(ref.key, -1); true },
                    CustomAccessibilityAction(moveDown) { actions.moveSection(ref.key, 1); true },
                )
            },
            leading = { RrIcon(D.drawable.ic_ph_dots_six_vertical, stringResource(S.string.reorder_0, title), tint = c.ink3) },
            onClick = if (ref.kind == SectionKind.Summary) ({ nav.richText(ref.key, "summary", "content") }) else onToggle,
            onLongClick = { onMenu(OutlineMenu.Section(ref)) },
            onLongClickLabel = stringResource(S.string.options_for_0, title),
            trailing = {
                if (ref.kind == SectionKind.Summary) RrRowCaret()
                else {
                    RrText("${items.size}", color = c.ink3)
                    RrIcon(if (open) D.drawable.ic_ph_caret_up else D.drawable.ic_ph_caret_down, null, size = 20.dp, tint = c.ink2)
                }
            },
        )
        if (open && ref.kind != SectionKind.Summary) {
            ReorderColumn(
                items = items,
                key = { it["id"].str() },
                enabled = !locked,
                autoScroll = autoScroll,
                onActions = { onMenu(OutlineMenu.Entry(ref, it["id"].str())) },
                onMove = { from, to -> actions.reorderItem(ref.key, items[from]["id"].str(), to - from) },
            ) { item, _ ->
                val id = item["id"].str()
                RrListRow(
                    ref.kind.itemTitle(item).ifBlank { stringResource(S.string.draft) },
                    subtitle = ref.kind.subtitle(item).ifBlank { null },
                    modifier = Modifier.padding(start = 40.dp).semantics {
                        customActions = listOf(
                            CustomAccessibilityAction(moveUp) { actions.reorderItem(ref.key, id, -1); true },
                            CustomAccessibilityAction(moveDown) { actions.reorderItem(ref.key, id, 1); true },
                        )
                    },
                    leading = { RrIcon(D.drawable.ic_ph_dots_six_vertical, null, tint = c.ink3) },
                    onClick = { nav.entry(ref.key, id) },
                    onLongClick = { onMenu(OutlineMenu.Entry(ref, id)) },
                    onLongClickLabel = stringResource(S.string.entry_options),
                )
            }
            RrButton(stringResource(ref.kind.addLabel), { nav.entry(ref.key, null) }, Modifier.padding(start = 40.dp, top = 4.dp, bottom = 4.dp), RrButtonVariant.GhostAccent, RrButtonSize.Large, icon = D.drawable.ic_ph_plus, enabled = !locked)
        }
    }
}

@Composable
private fun SectionMenu(doc: ResumeDoc, ref: SectionRef, actions: BuilderActions, onDismiss: () -> Unit) {
    val title = doc.displayTitle(ref)
    val hidden = doc.hidden(ref)
    RrBottomSheet(onDismissRequest = onDismiss, fitContent = true, title = title) {
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
