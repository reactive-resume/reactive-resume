package me.rxresu.feature.builder

import androidx.compose.foundation.clickable
import androidx.compose.ui.Alignment
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import me.rxresu.core.designsystem.*
import me.rxresu.core.navigation.*
import me.rxresu.core.strings.R as S
import me.rxresu.core.designsystem.R as D

@Composable
internal fun SectionRoute(route: BuilderSection, vm: BuilderViewModel, nav: NavController) {
    val state by vm.state.collectAsState()
    if (state.doc?.section(route.section)?.kind == SectionKind.Summary) {
        RichTextRoute(BuilderRichText(route.resumeId, route.section, "summary", "content"), vm, nav)
        return
    }
    SectionScreen(state, route.section, vm, { nav.popBackStack() }, { nav.navigate(BuilderMore(route.resumeId)) },
        { nav.navigate(BuilderEntry(route.resumeId, route.section, it)) },
        { vm.addItem(route.section) { nav.navigate(BuilderEntry(route.resumeId, route.section, it)) } })
}

/** Entry rows and all actions operate on the same draft as the overview. */
@Composable
internal fun SectionScreen(state: BuilderUiState, key: String, actions: BuilderActions, onBack: () -> Unit, onMore: () -> Unit, onEntry: (String) -> Unit, onAdd: () -> Unit) {
    val doc = state.doc ?: return
    val section = doc.section(key) ?: return
    val items = doc.items(section)
    var entryMenu by remember { mutableStateOf<String?>(null) }
    var sectionMenu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg)) {
        RrTopBar(onBack = onBack) { RrIconButton(D.drawable.ic_ph_dots_three, stringResource(S.string.more), onMore) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            RrPageTitle(doc.displayTitle(section), modifier = Modifier.clickable(enabled = !state.locked) { sectionMenu = true }, subtitle = pluralStringResource(R.plurals.builder_section_status, items.size, items.size, (doc.pageOf(key) ?: 0) + 1), subtitleColor = RrTheme.colors.ink3)
            Spacer(Modifier.height(20.dp))
            if (items.isEmpty()) RrEmptyState(stringResource(R.string.builder_nothing_here), "")
            RrListGroup(topDivider = true) {
                ReorderColumn(items, { it["id"].str() }, { from, to -> actions.reorderItem(key, items[from]["id"].str(), to - from) }, { entryMenu = it["id"].str() }, enabled = !state.locked) { item, _ ->
                    val hidden = item["hidden"].bool()
                    RrListRow(section.kind.itemTitle(item), subtitle = if (hidden) stringResource(R.string.builder_not_on_page) else section.kind.storyboardSubtitle(item),
                        modifier = if (hidden) Modifier.alpha(0.45f) else Modifier,
                        divider = item != items.lastOrNull(), onClick = { onEntry(item["id"].str()) }, trailing = { RrRowCaret() })
                }
            }
            Row(Modifier.padding(horizontal = 24.dp).heightIn(min = 44.dp).clickable(enabled = !state.locked, role = androidx.compose.ui.semantics.Role.Button, onClick = onAdd), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RrIcon(D.drawable.ic_ph_plus, null, size = 20.dp, tint = RrTheme.colors.accentText)
            RrText(stringResource(section.kind.addLabel), style = RrType.textLink, color = RrTheme.colors.accentText)
        }
        }
        RrText(stringResource(R.string.builder_section_hint), style = RrType.ui, color = RrTheme.colors.ink3, modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 16.dp).rrNavigationBarsPadding())
    }
    entryMenu?.let { EntryMenu(doc, section, it, actions, WriteNav()) { entryMenu = null } }
    if (sectionMenu) SectionMenu(doc, section, actions) { sectionMenu = false }
}

internal fun SectionKind.storyboardSubtitle(item: kotlinx.serialization.json.JsonObject): String {
    val dates = item["dates"] as? kotlinx.serialization.json.JsonObject ?: LegacyDates.read(item[dateField.orEmpty()].str())
    val start = YearMonth.parse(dates["start"].str())?.year
    val end = YearMonth.parse(dates["end"].str())?.year
    return if (this == SectionKind.Experience && start != null) listOf(item["position"].str(), "$start – ${if (dates["present"].bool()) "now" else end ?: ""}").filter(String::isNotBlank).joinToString(" · ") else subtitle(item)
}

@Composable
internal fun BuilderDesignRoute(route: BuilderDesign, state: BuilderUiState, actions: BuilderActions, nav: NavController) {
    DesignPickerScreen(state, route.picker, actions, { nav.popBackStack() }, { nav.navigate(BuilderDesign(route.resumeId, DesignPicker.Advanced)) })
}

@Composable
internal fun DesignPickerScreen(state: BuilderUiState, picker: DesignPicker, actions: BuilderActions, onBack: () -> Unit, onAdvanced: () -> Unit = {}) {
    val doc = state.doc ?: return
    val enabled = !state.locked
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).rrNavigationBarsPadding()) {
        RrTopBar(onBack = onBack)
        val scroll = rememberScrollState()
        val autoScroll = remember(scroll) { ReorderAutoScroll(scroll) }
        Column(Modifier.weight(1f).reorderViewport(autoScroll).verticalScroll(scroll)) {
            RrPageTitle(stringResource(when (picker) {
                DesignPicker.Template, DesignPicker.Colour -> S.string.template
                DesignPicker.Typography -> R.string.builder_typography
                DesignPicker.Page -> S.string.page
                DesignPicker.Layout -> S.string.layout
                DesignPicker.Photo -> S.string.photo
                DesignPicker.Entries -> S.string.entries
                DesignPicker.Advanced -> S.string.advanced
            }))
            when (picker) {
                DesignPicker.Template, DesignPicker.Colour -> { TemplatePicker(doc, actions, enabled, state.pages.firstOrNull()); AccentRow(doc, actions, enabled) }
                DesignPicker.Typography -> TypeGroup(doc, actions, enabled, onAdvanced)
                DesignPicker.Page -> PageGroup(doc, actions, enabled)
                DesignPicker.Layout -> LayoutGroup(state, doc, actions, enabled, autoScroll)
                DesignPicker.Photo -> PhotoDesign(doc, actions, enabled)
                DesignPicker.Entries -> EntryDesign(doc, actions, enabled)
                DesignPicker.Advanced -> AdvancedGroup(doc, actions, enabled)
            }
        }
    }
}
