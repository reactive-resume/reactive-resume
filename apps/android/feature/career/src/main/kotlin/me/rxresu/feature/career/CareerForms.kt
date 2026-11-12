@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package me.rxresu.feature.career


import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import me.rxresu.core.strings.R as CoreStrings

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as Icons
import me.rxresu.core.network.generated.*

@Composable internal fun ChoicePicker(value: String, label: String?, choices: List<Pair<String, String>>, onSelect: (String) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    var open by remember { mutableStateOf(false) }
    RrPickerField(value, { open = true }, modifier, label = label, enabled = enabled)
    if (open) RrBottomSheet({ open = false }, title = label, fitContent = true) {
        choices.forEach { (key, text) -> RrChoiceRow(text, value == text, { onSelect(key); open = false }, Modifier.fillMaxWidth().padding(horizontal = 12.dp)) }
    }
}

@Composable internal fun PreferencesScreen(state: PreferencesState, change: (CareerProfile) -> Unit, back: () -> Unit, retry: () -> Unit, suggest: () -> Unit, schedule: () -> Unit = {}) {
    var editor by rememberSaveable { mutableStateOf<String?>(null) }
    val p = state.profile
    val time = rememberCareerTime()
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).rrNavigationBarsPadding().imePadding()) {
        RrTopBar(onBack = { if (editor == null) back() else editor = null }, actions = {
            if (state.status != SaveState.Saved) SaveStatus(state.status)
            if (state.error) RrButton(stringResource(R.string.career_retry_9f5cd8), retry, variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Small)
        })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            RrPageTitle(editor ?: stringResource(R.string.career_job_search), subtitle = if (editor == null) stringResource(R.string.career_job_search_intro) else null)
            if (state.loading) CareerLoading() else if (p == null) CareerError(retry) else {
                if (state.error) RrCallout(stringResource(R.string.career_couldn_t_save_your_preferences_try_again_4d0c00), Modifier.padding(24.dp), tone = RrTone.Warn, actionLabel = stringResource(R.string.career_retry_9f5cd8), onAction = retry)
                if (editor == null) {
                    Spacer(Modifier.height(20.dp))
                    RrListGroup(topDivider = true) {
                        RrListRow(stringResource(R.string.career_roles), subtitle = p.targetRoles.joinToString(", "), divider = true, onClick = { editor = "roles" }, trailing = { RrRowCaret() })
                        RrListRow(stringResource(R.string.career_places), subtitle = p.locations.joinToString(" · "), divider = true, onClick = { editor = "places" }, trailing = { RrRowCaret() })
                        RrListRow(stringResource(R.string.career_work), subtitle = p.maxOfficeDays?.let { when (it) { 0L -> stringResource(R.string.career_remote); in 1L..4L -> stringResource(R.string.career_hybrid_or_remote); else -> pluralStringResource(R.plurals.career_office_days_max, it.toInt(), it) } } ?: stringResource(R.string.career_not_set_93039e), divider = true, onClick = { editor = "work" }, trailing = { RrRowCaret() })
                        RrListRow(stringResource(R.string.career_pay), subtitle = formatMoney(p.minBase.amount, p.minBase.currency)?.let { stringResource(R.string.career_from_amount, it) } ?: stringResource(R.string.career_no_pay_filter), divider = true, onClick = { editor = "pay" }, trailing = { RrRowCaret() })
                        RrListRow(stringResource(R.string.career_what_matters_to_you_866341), subtitle = p.priorities, onClick = { editor = "priorities" }, trailing = { RrRowCaret() })
                    }
                    RrSectionHeading(stringResource(R.string.career_discovery))
                    val discovery = state.schedules.firstOrNull { it.kind == "discovery" }
                    RrListGroup {
                        RrSwitchRow(stringResource(R.string.career_find_new_roles), discovery?.enabled == true, { schedule() }, subtitle = if (!state.scheduling) stringResource(R.string.career_not_available_on_this_server_911d05) else discovery?.let { discoverySummary(it, time) }, divider = true)
                        RrListRow(stringResource(R.string.career_where_to_look), subtitle = p.searchRegions.orEmpty().joinToString(" · "), onClick = schedule, trailing = { RrRowCaret() })
                    }
                } else Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    when (editor) {
                        "roles" -> {
                            ChipList(stringResource(R.string.career_target_roles_6513c7), p.targetRoles, stringResource(R.string.career_add_a_role_a21c9b), { change(p.copy(targetRoles = it)) })
                            RrButton(stringResource(R.string.career_suggest_target_roles_15ef23), suggest, variant = RrButtonVariant.GhostAccent, icon = Icons.drawable.ic_ph_sparkle)
                        }
                        "places" -> {
                            ChipList(stringResource(R.string.career_where_you_want_to_work_6e7ca5), p.locations, stringResource(R.string.career_add_a_place_29c5ff), { change(p.copy(locations = it)) })
                            RrListRow(stringResource(R.string.career_search_countries_0dac37), subtitle = p.searchRegions.orEmpty().joinToString(" · "), onClick = { editor = "countries" }, trailing = { RrRowCaret() })
                        }
                        "countries" -> {
                            CountryList(p.searchRegions.orEmpty(), { change(p.copy(searchRegions = it)) })
                            RrText(stringResource(R.string.career_web_searches_look_for_work_here_up_to_three_countries_ffb993), style = RrType.small, color = RrTheme.colors.ink3)
                        }
                        "work" -> {
                            RequirementStepper(stringResource(R.string.career_office_days_a_week_at_most_d190a3), p.maxOfficeDays, 5, { change(p.copy(maxOfficeDays = it)) })
                            RequirementStepper(stringResource(R.string.career_notice_period_fc421f), p.noticeWeeks, 52, { change(p.copy(noticeWeeks = it)) }, stringResource(R.string.career_wk_13bd1f))
                        }
                        "pay" -> {
                            var amount by remember(p.minBase.amount) { mutableStateOf(p.minBase.amount?.toLong()?.toString().orEmpty()) }
                            var invalid by remember { mutableStateOf(false) }
                            RrTextField(amount, { value ->
                                amount = value; val number = parseWholeAmount(value); invalid = value.isNotBlank() && number == null
                                if (!invalid) change(p.copy(minBase = p.minBase.copy(amount = number)))
                            }, label = stringResource(R.string.career_minimum_base_salary_173ce2), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), error = if (invalid) stringResource(R.string.career_enter_a_full_amount_such_as_95000_your_previous_amount_is_un_6a700c) else null)
                            RrButton(stringResource(R.string.career_no_pay_filter), { amount = ""; invalid = false; change(p.copy(minBase = p.minBase.copy(amount = null))) }, variant = RrButtonVariant.Ghost)
                            ChoicePicker(periodLabel(p.minBase.period), stringResource(R.string.career_pay_period_830dee), periods(), { key -> change(p.copy(minBase = p.minBase.copy(period = CreateCareerOfferRequestPeriod.entries.first { it.wireValue == key }))) })
                            ChoicePicker(p.minBase.currency, stringResource(R.string.career_currency_e070de), java.util.Currency.getAvailableCurrencies().map { it.currencyCode }.sorted().map { it to it }, { change(p.copy(minBase = p.minBase.copy(currency = it))) })
                        }
                        else -> RrTextField(p.priorities, { change(p.copy(priorities = it)) }, label = stringResource(R.string.career_what_matters_to_you_866341), singleLine = false, minLines = 3)
                    }
                }
            }
        }
    }
}
// TODO(lead): move to designsystem. Removable chip on accent-soft (C5 lists, C7 "Look for"): 32 dp like RrAddChip,
// the × names what it removes, and it fades in at d1 when added.
@Composable internal fun AccentChip(text: String, remove: () -> Unit) {
    val c = RrTheme.colors; val haptic = rememberRrHaptics()
    val reduced = RrTheme.reducedMotion
    val alpha = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) { alpha.animateTo(1f, tween(RrMotion.D1)) }
    val label = stringResource(Icons.string.ds_remove_item, text)
    Row(Modifier.graphicsLayer { this.alpha = alpha.value }.defaultMinSize(minHeight = 32.dp).clip(RrShape.sm).background(c.accentSoft).padding(start = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
        RrText(text, Modifier.padding(vertical = 6.dp), style = RrType.ui, color = c.accentText)
        Box(Modifier.size(32.dp).clickable(role = Role.Button, onClickLabel = label) { haptic(RrHaptic.Light); remove() }.semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
            RrIcon(Icons.drawable.ic_ph_x, null, size = 16.dp, tint = c.accentText)
        }
    }
}

/** Sheet actions under a hairline, inset like the boards. */
@Composable internal fun SheetFooter(content: @Composable ColumnScope.() -> Unit) = Column {
    Box(Modifier.fillMaxWidth().height(1.dp).background(RrTheme.colors.line))
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), content = content)
}

/** Chips for a list of words with an inline field behind "Add" (Return adds). */
@Composable internal fun ChipList(label: String?, values: List<String>, addLabel: String, change: (List<String>) -> Unit, max: Int = 20, helper: String? = null) {
    var adding by remember { mutableStateOf(false) }; var text by rememberSaveable { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (label != null) RrText(label, style = RrType.fieldLabel, color = RrTheme.colors.ink2)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            values.forEach { value -> key(value) { AccentChip(value) { change(values - value) } } }
            if (values.size < max) RrAddChip(addLabel, { adding = true })
        }
        if (adding) {
            val submit = { if (text.isNotBlank() && values.size < max) { change((values + text.trim()).distinct()); text = ""; adding = false } }
            RrTextField(text, { text = it }, label = addLabel, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { submit() }), trailing = {
                RrIconButton(Icons.drawable.ic_ph_plus, addLabel, submit, size = RrIconButtonSize.Small, enabled = text.isNotBlank())
            })
        }
        if (helper != null) RrText(helper, style = RrType.small, color = RrTheme.colors.ink3)
    }
}
@Composable private fun RequirementStepper(label: String, value: Long?, max: Long, change: (Long?) -> Unit, suffix: String = "") = Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
    RrText(label, Modifier.weight(1f), style = RrType.ui)
    RrStepper(value?.let { "$it $suffix".trim() } ?: stringResource(R.string.career_not_set_93039e), { change(value?.minus(1)?.takeIf { it >= 0 }) }, { change(((value ?: -1) + 1).coerceAtMost(max)) }, label, canDecrease = value != null, canIncrease = value == null || value < max)
}
@Composable internal fun periodLabel(period: CreateCareerOfferRequestPeriod) = when (period.wireValue) { "month" -> stringResource(R.string.career_per_month_1a3680); "hour" -> stringResource(R.string.career_per_hour_9bc58c); else -> stringResource(R.string.career_per_year_db9375) }
@Composable private fun periods() = CreateCareerOfferRequestPeriod.entries.filter { it != CreateCareerOfferRequestPeriod.Unknown }.map { it.wireValue to periodLabel(it) }

@Composable internal fun RoleSuggestionsSheet(state: PreferencesState, close: () -> Unit, generate: (TestAiProviderResponse, String?, Boolean) -> Unit, apply: (List<String>) -> Unit) {
    var provider by remember { mutableStateOf<String?>(null) }; var resume by remember { mutableStateOf<String?>(null) }; var knowledge by remember { mutableStateOf(true) }
    var selected by remember(state.suggestions) { mutableStateOf(state.suggestions.toSet()) }
    RrBottomSheet(close, title = stringResource(R.string.career_suggest_target_roles_15ef23), initialDetent = 1, footer = { SheetFooter {
        if (state.suggestions.isNotEmpty()) RrButton(stringResource(R.string.career_use_reviewed_roles_in_preferences_9c179a), { apply(state.suggestions.filter { it in selected }) }, Modifier.fillMaxWidth(), enabled = selected.isNotEmpty(), size = RrButtonSize.Large)
    } }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ChoicePicker(state.providers.firstOrNull { it.id == provider }?.label ?: stringResource(R.string.career_choose_a_connection_428239), stringResource(R.string.career_ai_connection_6497f8), state.providers.map { it.id to it.label }, { provider = it })
            ChoicePicker(state.resumes.firstOrNull { it.id == resume }?.name ?: stringResource(R.string.career_none_6eef66), stringResource(R.string.career_resume_to_share_f54e59), listOf("" to stringResource(R.string.career_none_6eef66)) + state.resumes.map { it.id to it.name }, { resume = it.ifEmpty { null } })
            RrSwitchRow(stringResource(R.string.career_knowledge_on_4bf78f), knowledge, { knowledge = it })
            val chosen = state.providers.firstOrNull { it.id == provider }
            if (state.error) CareerError { chosen?.let { generate(it, resume, knowledge) } }
            if (state.generating) RrWorkingLabel(listOf(stringResource(R.string.career_working_13b7bf)))
            else RrButton(stringResource(R.string.career_generate_role_suggestions_099288), { chosen?.let { generate(it, resume, knowledge) } }, enabled = chosen != null, variant = if (state.suggestions.isEmpty()) RrButtonVariant.Primary else RrButtonVariant.Secondary)
            state.suggestions.forEach { role -> RrChoiceRow(role, role in selected, { selected = if (role in selected) selected - role else selected + role }, radio = false) }
        }
    }
}

@Composable internal fun CountryList(values: List<String>, change: (List<String>) -> Unit) {
    var open by remember { mutableStateOf(false) }; var query by rememberSaveable { mutableStateOf("") }
    val locale = androidx.compose.ui.platform.LocalConfiguration.current.locales[0]
    val countries = remember(locale) { java.util.Locale.getISOCountries().map { code -> code to java.util.Locale.Builder().setRegion(code).build().getDisplayCountry(locale) }.sortedBy { it.second } }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        RrText(stringResource(R.string.career_countries_to_search_a05336), style = RrType.fieldLabel, color = RrTheme.colors.ink2)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            values.forEach { code -> key(code) { AccentChip(countries.firstOrNull { it.first == code }?.second ?: code) { change(values - code) } } }
            if (values.size < 3) RrAddChip(stringResource(R.string.career_add_a_country_3c7a6e), { open = true })
        }
    }
    if (open) RrBottomSheet({ open = false }, title = stringResource(R.string.career_countries_to_search_a05336), initialDetent = 1) {
        Column(Modifier.padding(16.dp)) {
            RrSearchField(query, { query = it }, stringResource(R.string.career_search_countries_0dac37))
            androidx.compose.foundation.lazy.LazyColumn { items(countries.size) { index ->
                val (code, label) = countries[index]
                if (query.isBlank() || label.contains(query, true) || code.equals(query, true)) RrChoiceRow(label, code in values, {
                    if (code in values) change(values - code) else if (values.size < 3) change(values + code)
                    open = false
                }, enabled = code in values || values.size < 3)
            } }
        }
    }
}
