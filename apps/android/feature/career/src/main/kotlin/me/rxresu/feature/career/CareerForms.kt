@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package me.rxresu.feature.career


import androidx.compose.ui.res.stringResource
import me.rxresu.core.strings.R as CoreStrings

import androidx.compose.animation.Crossfade
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
        choices.forEach { (key, text) -> RrChoiceRow(text, value == text, { onSelect(key); open = false }, Modifier.fillMaxWidth()) }
    }
}

@Composable internal fun PreferencesScreen(state: PreferencesState, change: (CareerProfile) -> Unit, back: () -> Unit, retry: () -> Unit, suggest: () -> Unit) {
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).windowInsetsPadding(WindowInsets.navigationBars).imePadding()) {
        RrTopBar(stringResource(R.string.career_job_search_preferences_d56450), onBack = back, status = {
            if (state.status == SaveState.Saved) { RrIcon(Icons.drawable.ic_ph_cloud_check, null, size = 14.dp); RrText(stringResource(R.string.career_saved_just_now_782509)) } else SaveStatus(state.status)
        }, actions = { if (state.error) RrButton(stringResource(R.string.career_retry_9f5cd8), retry, variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Small) })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (state.loading) CareerLoading() else state.profile?.let { p ->
                if (state.error) RrCallout(stringResource(R.string.career_couldn_t_save_your_preferences_try_again_4d0c00), tone = RrTone.Warn, actionLabel = stringResource(R.string.career_retry_9f5cd8), onAction = retry)
                ChipList(stringResource(R.string.career_target_roles_6513c7), p.targetRoles, stringResource(R.string.career_add_a_role_a21c9b), { change(p.copy(targetRoles = it)) })
                RrButton(stringResource(R.string.career_suggest_target_roles_15ef23), suggest, variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Small, icon = Icons.drawable.ic_ph_sparkle)
                ChipList(stringResource(R.string.career_where_you_want_to_work_6e7ca5), p.locations, stringResource(R.string.career_add_a_place_29c5ff), { change(p.copy(locations = it)) })
                CountryList(p.searchRegions.orEmpty(), { change(p.copy(searchRegions = it)) })
                RrText(stringResource(R.string.career_web_searches_look_for_work_here_up_to_three_countries_ffb993), style = RrType.small, color = RrTheme.colors.ink3)
                Box(Modifier.fillMaxWidth().height(1.dp).background(RrTheme.colors.line))
                RrText(stringResource(R.string.career_requirements_09a428), style = RrType.eyebrow, color = RrTheme.colors.ink3)
                RequirementStepper(stringResource(R.string.career_office_days_a_week_at_most_d190a3), p.maxOfficeDays, 7, { change(p.copy(maxOfficeDays = it)) })
                RequirementStepper(stringResource(R.string.career_notice_period_fc421f), p.noticeWeeks, 104, { change(p.copy(noticeWeeks = it)) }, stringResource(R.string.career_wk_13bd1f))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                    var amount by remember(p.minBase.amount) { mutableStateOf(p.minBase.amount?.toLong()?.toString().orEmpty()) }
                    var invalid by remember { mutableStateOf(false) }
                    RrTextField(amount, { value ->
                        amount = value; val number = parseWholeAmount(value); invalid = value.isNotBlank() && number == null
                        if (!invalid) change(p.copy(minBase = p.minBase.copy(amount = number)))
                    }, Modifier.weight(1f), label = stringResource(R.string.career_minimum_base_salary_173ce2), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), error = if (invalid) stringResource(R.string.career_enter_a_full_amount_such_as_95000_your_previous_amount_is_un_6a700c) else null)
                    ChoicePicker(periodLabel(p.minBase.period), stringResource(R.string.career_pay_period_830dee), periods(), { key -> change(p.copy(minBase = p.minBase.copy(period = CreateCareerOfferRequestPeriod.entries.first { it.wireValue == key }))) }, Modifier.weight(1f))
                }
                ChoicePicker(p.minBase.currency, stringResource(R.string.career_currency_e070de), java.util.Currency.getAvailableCurrencies().map { it.currencyCode }.sorted().map { it to it }, { change(p.copy(minBase = p.minBase.copy(currency = it))) })
                RrText(stringResource(R.string.career_used_to_check_roles_and_offers_each_is_a_number_so_the_coach_7ce2be), style = RrType.small, color = RrTheme.colors.ink3)
                RrTextField(p.priorities, { change(p.copy(priorities = it)) }, label = stringResource(R.string.career_what_matters_to_you_866341), singleLine = false, minLines = 3)
            } ?: CareerError(retry)
        }
    }
}
@Composable private fun ChipList(label: String, values: List<String>, addLabel: String, change: (List<String>) -> Unit, max: Int = 20) {
    var adding by remember { mutableStateOf(false) }; var text by rememberSaveable { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        RrText(label, style = RrType.fieldLabel, color = RrTheme.colors.ink2)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            values.forEach { value -> RrContextChip(value, onRemove = { change(values - value) }) }
            if (values.size < max) RrAddChip(addLabel, { adding = true })
        }
        if (adding) {
            val submit = { if (text.isNotBlank() && values.size < max) { change((values + text.trim()).distinct()); text = ""; adding = false } }
            RrTextField(text, { text = it }, label = addLabel, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { submit() }), trailing = {
                RrIconButton(Icons.drawable.ic_ph_plus, addLabel, submit, size = RrIconButtonSize.Small, enabled = text.isNotBlank())
            })
        }
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
    RrBottomSheet(close, title = stringResource(R.string.career_suggest_target_roles_15ef23), initialDetent = 1, footer = {
        if (state.suggestions.isNotEmpty()) RrButton(stringResource(R.string.career_use_reviewed_roles_in_preferences_9c179a), { apply(state.suggestions.filter { it in selected }) }, Modifier.fillMaxWidth(), enabled = selected.isNotEmpty(), size = RrButtonSize.Large)
    }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ChoicePicker(state.providers.firstOrNull { it.id == provider }?.label ?: stringResource(R.string.career_choose_a_connection_428239), stringResource(R.string.career_ai_connection_6497f8), state.providers.map { it.id to it.label }, { provider = it })
            ChoicePicker(state.resumes.firstOrNull { it.id == resume }?.name ?: stringResource(R.string.career_none_6eef66), stringResource(R.string.career_resume_to_share_f54e59), listOf("" to stringResource(R.string.career_none_6eef66)) + state.resumes.map { it.id to it.name }, { resume = it.ifEmpty { null } })
            RrSwitchRow(stringResource(R.string.career_knowledge_on_4bf78f), knowledge, { knowledge = it })
            val chosen = state.providers.firstOrNull { it.id == provider }
            RrDisclosureLine(stringResource(R.string.career_when_you_generate_suggestions_the_selected_resume_and_knowle_7cf237))
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
            values.forEach { code -> RrContextChip(countries.firstOrNull { it.first == code }?.second ?: code, onRemove = { change(values - code) }) }
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
