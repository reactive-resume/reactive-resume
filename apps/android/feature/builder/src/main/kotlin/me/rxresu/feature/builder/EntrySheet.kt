package me.rxresu.feature.builder

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.foundation.interaction.FocusInteraction
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import java.time.Month
import java.time.format.TextStyle
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrContextChip
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrMonthPicker
import me.rxresu.core.designsystem.RrPickerField
import me.rxresu.core.designsystem.RrSlider
import me.rxresu.core.designsystem.RrStrip
import me.rxresu.core.designsystem.RrSwitchRow
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.RrTopBar
import me.rxresu.core.designsystem.RrPageTitle
import me.rxresu.core.designsystem.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import me.rxresu.core.navigation.BuilderEntry
import me.rxresu.core.navigation.BuilderRichText
import me.rxresu.core.strings.R as S
import me.rxresu.core.designsystem.R as D

@Composable
internal fun EntryRoute(route: BuilderEntry, vm: BuilderViewModel, nav: NavController) {
    val state by vm.state.collectAsStateWithLifecycle()
    EntryScreen(state, route.section, route.itemId, vm,
        onBack = { vm.flush(); nav.popBackStack() },
        onMore = { nav.navigate(me.rxresu.core.navigation.BuilderMore(route.resumeId)) },
        onDescription = { id, field -> nav.navigate(BuilderRichText(route.resumeId, route.section, id, field)) },
        onPreview = { nav.navigate(me.rxresu.core.navigation.PagePreview(route.resumeId, section = route.section, itemId = route.itemId)) })
}

@Composable
internal fun EntryScreen(state: BuilderUiState, section: String, itemId: String?, actions: BuilderActions, onBack: () -> Unit, onMore: () -> Unit, onDescription: (String, String) -> Unit, onPreview: () -> Unit) {
    DisposableEffect(actions) { onDispose { actions.setEditing(false) } }
    val doc = state.doc ?: return
    val ref = doc.section(section) ?: return
    var selectedId by rememberSaveable(itemId) { mutableStateOf(itemId) }
    val item = doc.items(ref).firstOrNull { it["id"].str() == selectedId }
    LaunchedEffect(selectedId, item == null) {
        if (selectedId == null) actions.addItem(section) { selectedId = it } else if (item == null) onBack()
    }
    if (item == null) return
    var rename by remember { mutableStateOf(false) }
    var moreFields by rememberSaveable(itemId) { mutableStateOf(false) }
    var options by remember { mutableStateOf(false) }
    val title = ref.kind.itemTitle(item).ifBlank { stringResource(S.string.draft) }
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg)) {
        RrTopBar(onBack = onBack) { RrIconButton(D.drawable.ic_ph_dots_three, stringResource(S.string.more), onMore) }
        RrPageTitle(title, modifier = Modifier.clickable(enabled = !state.locked) { rename = true }, subtitle = stringResource(R.string.builder_entry_status, doc.displayTitle(ref)), subtitleColor = RrTheme.colors.ink3)
        if (state.locked) RrStrip(stringResource(S.string.locked_unlock_to_edit), tone = RrTone.Warn)
        Box(Modifier.weight(1f)) { EntryFields(doc, ref, item, state.locked, actions, onDescription, moreFields) }
        Row(Modifier.padding(start = 24.dp, bottom = 8.dp).rrNavigationBarsPadding().heightIn(min = 44.dp).clickable(enabled = true, role = androidx.compose.ui.semantics.Role.Button, onClick = onPreview), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RrIcon(D.drawable.ic_ph_file_text, null, size = 20.dp, tint = RrTheme.colors.accentText)
            RrText(stringResource(R.string.builder_see_page), style = RrType.textLink, color = RrTheme.colors.accentText)
        }
    }
    if (rename) RrBottomSheet(onDismissRequest = { rename = false }, title = stringResource(fieldLabel(ref.kind.anchor)), fitContent = true) {
        Column(Modifier.padding(24.dp)) {
            TextField(stringResource(fieldLabel(ref.kind.anchor)), item[ref.kind.anchor].str(), state.locked, actions = actions) { text -> actions.editItem(section, selectedId!!) { JsonObject(it + (ref.kind.anchor to JsonPrimitive(text))) } }
            if (ref.kind.fields().any { it.more }) RrButton(stringResource(R.string.builder_more_fields), { moreFields = true; rename = false }, variant = RrButtonVariant.GhostAccent)
            RrButton(stringResource(S.string.entry_options), { rename = false; options = true }, variant = RrButtonVariant.GhostAccent)
            RrButton(stringResource(S.string.done), { rename = false })
        }
    }
    if (options) EntryMenu(doc, ref, selectedId!!, actions, WriteNav()) { options = false }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EntryFields(doc: ResumeDoc, ref: SectionRef, item: JsonObject, locked: Boolean, actions: BuilderActions, onDescription: (String, String) -> Unit, more: Boolean) {
    val id = item["id"].str()
    val write = { change: (JsonObject) -> JsonObject -> actions.editItem(ref.key, id, change) }
    val focus = remember(id) { androidx.compose.ui.focus.FocusRequester() }
    val fields = ref.kind.fields().filter { it.key != ref.kind.anchor || item[it.key].str().isBlank() }
    LaunchedEffect(id) { if (!locked && fields.firstOrNull()?.type in listOf(FieldType.Text, FieldType.Phone, FieldType.Email)) focus.requestFocus() }
    Column(Modifier.verticalScroll(rememberScrollState()).padding(start = 24.dp, end = 24.dp, top = 24.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        fields.filter { !it.more || more }.forEach { spec ->
            when (spec.type) {
                FieldType.Text, FieldType.Phone, FieldType.Email -> TextField(
                    modifier = if (spec == fields.firstOrNull()) Modifier.focusRequester(focus) else Modifier,
                    label = stringResource(fieldLabel(spec.key)),
                    value = item[spec.key].str(),
                    readOnly = locked,
                    helper = if (spec.key == ref.kind.anchor && item[spec.key].str().isBlank()) ref.kind.draftHint?.let { stringResource(it) } else null,
                    keyboard = if (spec.type == FieldType.Phone) KeyboardType.Phone else KeyboardType.Text,
                    ltr = spec.type == FieldType.Phone,
                    actions = actions,
                ) { value -> write { JsonObject(it + (spec.key to JsonPrimitive(value))) } }
                FieldType.Url -> {
                    val website = item["website"].obj()
                    TextField(stringResource(S.string.link), website["url"].str(), locked, keyboard = KeyboardType.Uri, ltr = true, actions = actions) { value ->
                        write { it.set(listOf("website", "url"), JsonPrimitive(value)) as JsonObject }
                    }
                    RrSwitchRow(stringResource(S.string.show_link_in_title), website["inlineLink"].bool(), { on -> write { it.set(listOf("website", "inlineLink"), JsonPrimitive(on)) as JsonObject } }, enabled = !locked)
                }
                FieldType.Dates, FieldType.Date -> DatesField(doc, ref.kind, item, single = spec.type == FieldType.Date, locked = locked, write = write)
                FieldType.RichText -> {
                    val lines = htmlText(item[spec.key].str())
                    RrCard(onClick = { onDescription(id, spec.key) }, contentPadding = PaddingValues(21.dp)) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            RrText(stringResource(fieldLabel(spec.key)), style = RrType.formLabel, color = RrTheme.colors.ink2, modifier = Modifier.weight(1f))
                            RrIcon(D.drawable.ic_ph_sparkle, null, size = 16.dp, tint = RrTheme.colors.accentText)
                            Spacer(Modifier.width(6.dp))
                            RrText(stringResource(S.string.improve), style = RrType.small.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium), color = RrTheme.colors.accentText)
                        }
                        RrText(lines.joinToString(" ").let { if (it.length > 123) it.take(123).trimEnd() + "…" else it }, style = RrType.body, color = RrTheme.colors.ink2, maxLines = 3, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    }
                }
                FieldType.Level -> {
                    val level = item["level"].num()?.toInt() ?: 0
                    val value = if (level == 0) stringResource(S.string.hidden) else stringResource(R.string.builder_level_value, level)
                    Column {
                        Row { RrText(stringResource(S.string.level), style = RrType.fieldLabel, color = RrTheme.colors.ink2, modifier = Modifier.weight(1f)); RrText(value, style = RrType.small, color = RrTheme.colors.ink3) }
                        RrSlider(level.toFloat(), { v -> write { JsonObject(it + ("level" to JsonPrimitive(v.toInt()))) } }, Modifier.fillMaxWidth(), 0f..5f, steps = 4, enabled = !locked, valueDescription = value)
                    }
                }
                FieldType.Keywords -> {
                    val keywords = item["keywords"].arr().map { it.str() }
                    var draft by rememberSaveable(id) { mutableStateOf("") }
                    fun add() { val k = draft.trim().trimEnd(','); if (k.isNotEmpty()) write { JsonObject(it + ("keywords" to JsonArray((keywords + k).map(::JsonPrimitive)))) }; draft = "" }
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        RrTextField(
                            draft, { if (it.endsWith(",")) { draft = it; add() } else draft = it }, Modifier.fillMaxWidth(),
                            label = stringResource(S.string.keywords), placeholder = stringResource(R.string.builder_add_keyword), readOnly = locked,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { add() }),
                        )
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            keywords.forEach { k -> RrContextChip(k, onRemove = if (locked) null else ({ write { JsonObject(it + ("keywords" to JsonArray((keywords - k).map(::JsonPrimitive)))) } })) }
                        }
                    }
                }
            }
        }
    }
}

/**
 * A text field that shows typing at once and writes to the draft after a short pause (and on blur or close), so a
 * word is one undo step rather than one per letter. Focus toggles the draft's editing flag.
 */
@Composable
internal fun TextField(
    label: String,
    value: String,
    readOnly: Boolean,
    modifier: Modifier = Modifier,
    helper: String? = null,
    error: String? = null,
    keyboard: KeyboardType = KeyboardType.Text,
    ltr: Boolean = false,
    singleLine: Boolean = true,
    actions: BuilderActions = NoBuilderActions,
    onWrite: (String) -> Unit,
) {
    var text by remember(label) { mutableStateOf(value) }
    var pending by remember { mutableStateOf(false) }
    val latestWrite by rememberUpdatedState(onWrite)
    val interaction = remember { MutableInteractionSource() }
    LaunchedEffect(value) { if (!pending) text = value }
    LaunchedEffect(text, pending) { if (pending) { delay(400); latestWrite(text); pending = false } }
    LaunchedEffect(interaction) {
        interaction.interactions.collect { i ->
            when (i) {
                is FocusInteraction.Focus -> actions.setEditing(true)
                is FocusInteraction.Unfocus -> { if (pending) { latestWrite(text); pending = false }; actions.setEditing(false) }
            }
        }
    }
    DisposableEffect(Unit) { onDispose { if (pending) latestWrite(text) } }
    RrTextField(
        text, { text = it; pending = true }, modifier.fillMaxWidth(),
        label = label, helper = helper, error = error, readOnly = readOnly, ltr = ltr, singleLine = singleLine, minLines = if (singleLine) 1 else 3,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard), interactionSource = interaction,
    )
}

/** A year ("2022") or year and month ("2022-03") from packages/schema dates. */
internal data class YearMonth(val year: Int, val month: Int?) : Comparable<YearMonth> {
    override fun compareTo(other: YearMonth) = compareValuesBy(this, other, { it.year }, { it.month ?: 0 })
    override fun toString() = if (month == null) "$year" else "$year-%02d".format(month)

    /** "Mar 2022", or "2022" (the web's short date format). */
    fun format(locale: Locale): String = if (month == null) "$year" else "${Month.of(month).getDisplayName(TextStyle.SHORT, locale).trimEnd('.')} $year"

    companion object {
        fun parse(text: String?): YearMonth? {
            val m = Regex("^(\\d{4})(?:-(0[1-9]|1[0-2]))?$").find(text ?: return null) ?: return null
            return YearMonth(m.groupValues[1].toInt(), m.groupValues[2].ifEmpty { null }?.toInt())
        }
    }
}

/** Writes structured dates and keeps the legacy text (`period` or `date`) in step, as the web's syncResumeDates does. */
internal fun writeDates(item: JsonObject, kind: SectionKind, start: YearMonth?, end: YearMonth?, present: Boolean, raw: String?, locale: Locale, presentLabel: String): JsonObject {
    val dates = buildMap<String, kotlinx.serialization.json.JsonElement> {
        put("start", start?.let { JsonPrimitive(it.toString()) } ?: JsonNull)
        put("end", end?.let { JsonPrimitive(it.toString()) } ?: JsonNull)
        put("present", JsonPrimitive(present))
        if (!raw.isNullOrBlank()) put("raw", JsonPrimitive(raw))
    }
    val text = when {
        !raw.isNullOrBlank() -> raw
        start == null -> ""
        kind.dateField == "date" -> start.format(locale)
        present -> "${start.format(locale)} – $presentLabel"
        end != null -> "${start.format(locale)} – ${end.format(locale)}"
        else -> start.format(locale)
    }
    return JsonObject(item + ("dates" to JsonObject(dates)) + (kind.dateField!! to JsonPrimitive(text)))
}

@Composable
private fun DatesField(doc: ResumeDoc, kind: SectionKind, item: JsonObject, single: Boolean, locked: Boolean, write: ((JsonObject) -> JsonObject) -> Unit) {
    val dates = item["dates"] as? JsonObject ?: LegacyDates.read(item[kind.dateField!!].str())
    val start = YearMonth.parse(dates["start"].str())
    val end = YearMonth.parse(dates["end"].str())
    val present = dates["present"].bool()
    val raw = dates["raw"].str().ifBlank { null }
    val locale = Locale.forLanguageTag(doc.locale)
    val presentLabel = stringResource(S.string.present)
    var picking by remember { mutableStateOf<Boolean?>(null) } // true = start, false = end
    val save = { s: YearMonth?, e: YearMonth?, p: Boolean, r: String? -> write { writeDates(it, kind, s, e, p, r, locale, presentLabel) } }
    val reversed = !present && start != null && end != null && end < start
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            RrPickerField(
                raw ?: start?.format(locale).orEmpty(), { picking = true }, Modifier.weight(1f),
                label = stringResource(if (single) S.string.date else S.string.start), placeholder = stringResource(S.string.mar_2022),
                trailingIcon = null, enabled = !locked,
            )
            if (!single && raw == null) RrPickerField(
                if (present) presentLabel else end?.format(locale).orEmpty(), { picking = false }, Modifier.weight(1f),
                label = stringResource(S.string.end), placeholder = stringResource(S.string.mar_2022),
                trailingIcon = null, enabled = !locked,
                error = if (reversed) stringResource(S.string.the_end_date_is_before_the_start_date_check_both_dates) else null,
            )
        }
        if (raw != null && start == null) RrText(stringResource(S.string.saved_as_written_automated_date_checks_and_sorting_are_unavailable_for_this_text), style = RrType.small, color = RrTheme.colors.ink3)
    }
    picking?.let { isStart ->
        MonthPickerSheet(
            initial = if (isStart) start else end,
            present = if (isStart) null else present,
            raw = raw,
            onDismiss = { picking = null },
            onPick = { value, isPresent, text ->
                picking = null
                if (isStart) save(value, end, present, text) else save(start, if (isPresent) end else value, isPresent, text)
            },
        )
    }
}

/**
 * The month picker sheet (same on both platforms): [RrMonthPicker] with Present for end dates, and Custom date text,
 * which is saved as written. Done keeps the stored value (a year-only date too) unless a month was picked.
 */
@Composable
private fun MonthPickerSheet(initial: YearMonth?, present: Boolean?, raw: String?, onDismiss: () -> Unit, onPick: (YearMonth?, Boolean, String?) -> Unit) {
    var picked by rememberSaveable { mutableStateOf(initial?.month?.let { java.time.YearMonth.of(initial.year, it) }) }
    var changed by rememberSaveable { mutableStateOf(false) }
    var isPresent by rememberSaveable { mutableStateOf(present == true) }
    var custom by rememberSaveable { mutableStateOf(raw != null) }
    var text by rememberSaveable { mutableStateOf(raw.orEmpty()) }
    RrBottomSheet(
        onDismissRequest = onDismiss,
        fitContent = true,
        title = stringResource(S.string.dates),
        footer = {
            RrButton(stringResource(S.string.done), {
                val value = if (changed && !custom && !isPresent) picked?.let { YearMonth(it.year, it.monthValue) } else initial
                onPick(value, isPresent && !custom, if (custom) text.ifBlank { null } else null)
            }, Modifier.fillMaxWidth().padding(16.dp))
        },
    ) {
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            RrSwitchRow(stringResource(S.string.custom_date_text), custom, { custom = it })
            if (custom) {
                RrTextField(text, { text = it }, Modifier.fillMaxWidth(), placeholder = stringResource(S.string.mar_2022))
            } else {
                RrMonthPicker(
                    picked,
                    { picked = it; changed = true; isPresent = false },
                    present = isPresent,
                    onPresent = if (present != null) ({ isPresent = !isPresent }) else null,
                )
            }
            Spacer(Modifier.height(4.dp))
        }
    }
}

/**
 * Read-time upgrade for entries saved before structured dates (schema dates.ts `upgradeResumeDates`): reads
 * "Mar 2022 – Present", "2017 – 2019" or "March 2022"; anything else is kept as custom text.
 */
internal object LegacyDates {
    private val months = listOf("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")

    private fun point(text: String): YearMonth? {
        val m = Regex("^(?:([A-Za-z]+)\\.?\\s+)?(\\d{4})$").find(text.trim()) ?: return null
        val month = m.groupValues[1].takeIf { it.isNotEmpty() }?.let { name -> months.indexOf(name.lowercase().take(3)).takeIf { it >= 0 }?.plus(1) ?: return null }
        return YearMonth(m.groupValues[2].toInt(), month)
    }

    fun read(text: String): JsonObject {
        fun dates(start: YearMonth?, end: YearMonth?, present: Boolean, raw: String? = null) = JsonObject(buildMap {
            put("start", start?.let { JsonPrimitive(it.toString()) } ?: JsonNull)
            put("end", end?.let { JsonPrimitive(it.toString()) } ?: JsonNull)
            put("present", JsonPrimitive(present))
            if (raw != null) put("raw", JsonPrimitive(raw))
        })
        if (text.isBlank()) return dates(null, null, false)
        val parts = text.split(Regex("\\s+[–—-]\\s+|\\s+to\\s+"))
        val start = point(parts[0])
        val endText = parts.getOrNull(1)?.trim()
        val present = endText != null && endText.lowercase() in setOf("present", "current", "now")
        val end = endText?.takeIf { !present }?.let(::point)
        return if (start == null || parts.size > 2 || (endText != null && !present && end == null)) dates(null, null, false, text) else dates(start, end, present)
    }
}
