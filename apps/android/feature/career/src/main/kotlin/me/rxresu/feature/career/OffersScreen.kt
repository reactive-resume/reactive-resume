@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package me.rxresu.feature.career

import androidx.compose.ui.res.stringResource
import me.rxresu.core.strings.R as CoreStrings

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Currency
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as Icons
import me.rxresu.core.network.generated.*

internal enum class SalaryComparison { Meets, Below, DifferentUnits, Unknown }
internal fun salaryComparison(offer: Offer, requirement: SaveCareerProfileRequestMinBase): SalaryComparison = when {
    offer.base == null || requirement.amount == null -> SalaryComparison.Unknown
    offer.currency != requirement.currency || offer.period != requirement.period -> SalaryComparison.DifferentUnits
    requireNotNull(offer.base) >= requireNotNull(requirement.amount) -> SalaryComparison.Meets
    else -> SalaryComparison.Below
}
internal fun formatMoney(amount: Double?, currency: String): String? = amount?.let { value ->
    runCatching { NumberFormat.getCurrencyInstance().apply { this.currency = Currency.getInstance(currency); maximumFractionDigits = 0 }.format(value) }.getOrElse { "$value $currency" }
}
@Composable private fun offerAmount(value: Double?, currency: String, period: CreateCareerOfferRequestPeriod): String = formatMoney(value, currency)?.let { amount -> stringResource(R.string.career_1_s_2_s_78c505, amount, periodLabel(period).lowercase()) } ?: stringResource(R.string.career_no_amount_stated_value_uncertain_9b0049)
@Composable internal fun OffersScreen(state: OffersState, back: () -> Unit, retry: () -> Unit, edit: (SavedItem?) -> Unit, copy: (String) -> Unit, plan: (List<SavedItem>) -> Unit) {
    var a by rememberSaveable { mutableIntStateOf(0) }; var b by rememberSaveable { mutableIntStateOf(-1) }
    val offers = state.offers.filter { it.data is Offer }.sortedByDescending { it.createdAt }
    val left = offers.getOrNull(a) ?: offers.firstOrNull(); val right = offers.getOrNull(b)?.takeIf { it.id != left?.id }
    val leftData = left?.data as? Offer; val rightData = right?.data as? Offer
    val questions = buildList {
        if (leftData?.variablePercent != null || leftData?.variable != null) add(stringResource(R.string.career_how_is_the_bonus_decided_and_how_much_of_it_was_paid_out_las_8c3849))
        if (leftData?.officeDays == null || (state.profile?.maxOfficeDays != null && requireNotNull(leftData.officeDays) > requireNotNull(state.profile.maxOfficeDays))) add(stringResource(R.string.career_how_many_days_a_week_are_expected_in_the_office_b4c0ab))
        if (leftData?.base == null) add(stringResource(R.string.career_what_is_the_base_salary_currency_and_pay_period_625a66))
    }
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).windowInsetsPadding(WindowInsets.navigationBars)) {
        RrTopBar(stringResource(R.string.career_offers_43c943), onBack = back, actions = { RrButton(stringResource(R.string.career_add_offer_0c1811), { edit(null) }, variant = RrButtonVariant.GhostAccent, size = RrButtonSize.Small, icon = Icons.drawable.ic_ph_plus) })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            if (state.loading) CareerLoading() else {
                if (state.error) CareerError(retry)
                RrText(stringResource(R.string.career_compared_in_their_original_currency_and_pay_period_comparing_bcd5e0), Modifier.padding(horizontal = 16.dp, vertical = 12.dp), style = RrType.small, color = RrTheme.colors.ink3)
                if (left == null || leftData == null) RrEmptyState(stringResource(R.string.career_no_offers_to_compare_yet_ba8c3b), stringResource(R.string.career_add_each_offer_s_terms_to_compare_it_nothing_is_filled_in_fo_840aa5), Modifier.padding(16.dp), actionLabel = stringResource(R.string.career_add_offer_0c1811), onAction = { edit(null) })
                else {
                    if (offers.size > 1) Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        ChoicePicker(left.application?.company ?: left.title, stringResource(R.string.career_first_offer_df9efd), offers.mapIndexed { i, item -> i.toString() to listOfNotNull(item.application?.company ?: item.title, (item.data as? Offer)?.version?.wireValue, item.createdAt.take(10)).joinToString(" · ") }, { a = it.toInt() })
                        ChoicePicker(right?.application?.company ?: stringResource(R.string.career_your_requirements_b1c02b), stringResource(R.string.career_compare_with_719f56), listOf("-1" to stringResource(R.string.career_your_requirements_b1c02b)) + offers.mapIndexed { i, item -> i.toString() to listOfNotNull(item.application?.company ?: item.title, (item.data as? Offer)?.version?.wireValue, item.createdAt.take(10)).joinToString(" · ") }.filterIndexed { i, _ -> i != a }, { b = it.toInt() })
                        RrButton(stringResource(R.string.career_swap_210dd6), { if (b >= 0) { val old = a; a = b; b = old } }, variant = RrButtonVariant.Ghost, enabled = right != null)
                    }
                    if (right != null && left.applicationId != null && left.applicationId == right.applicationId) {
                        val earlier = minOf(left, right, compareBy { it.createdAt })
                        RrSectionHeader(stringResource(R.string.career_changes_since, (earlier.data as Offer).version?.wireValue ?: earlier.createdAt.take(10)))
                    }
                    Crossfade(left to right, animationSpec = tween(if (RrTheme.reducedMotion) 0 else RrMotion.D2), label = "offer-pair") { (left, right) ->
                        val leftData = left.data as Offer
                        val rightData = right?.data as? Offer
                        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                            ComparisonRow("", left.application?.company ?: left.title, right?.application?.company ?: stringResource(R.string.career_your_requirements_b1c02b), header = true, onLeft = { edit(left) }, onRight = if (right != null) { { edit(right) } } else null)
                            val salary = state.profile?.minBase?.let { salaryComparison(leftData, it) } ?: SalaryComparison.Unknown
                            ComparisonRow(stringResource(R.string.career_base_salary_66e706), offerAmount(leftData.base, leftData.currency, leftData.period),
                                rightData?.let { offerAmount(it.base, it.currency, it.period) } ?: state.profile?.minBase?.let { min ->
                                    if (salary == SalaryComparison.DifferentUnits) stringResource(R.string.career_different_currency_or_pay_period_not_compared_33b853) else formatMoney(min.amount, min.currency)?.let { amount -> stringResource(R.string.career_1_s_minimum_be4835, amount) + if (salary == SalaryComparison.Meets) " ✓" else "" }
                                } ?: stringResource(R.string.career_not_set_93039e), tone = if (rightData == null) when (salary) { SalaryComparison.Meets -> RrTone.Accent; SalaryComparison.Below, SalaryComparison.DifferentUnits -> RrTone.Warn; else -> null } else null)
                            ComparisonRow(stringResource(R.string.career_bonus_4d963c), leftData.variablePercent?.let { stringResource(R.string.career_up_to_1_s_4ec3dc, it.toInt().toString()) } ?: formatMoney(leftData.variable, leftData.currency) ?: stringResource(R.string.career_not_stated_c092c4), rightData?.let { it.variablePercent?.let { n -> stringResource(R.string.career_up_to_1_s_4ec3dc, n.toInt().toString()) } ?: formatMoney(it.variable, it.currency) } ?: stringResource(R.string.career_not_set_93039e))
                            ComparisonRow(stringResource(R.string.career_equity_0786ff), leftData.equity ?: stringResource(R.string.career_not_stated_c092c4), rightData?.equity ?: stringResource(R.string.career_not_set_93039e))
                            val office = listOfNotNull(leftData.location, leftData.officeDays?.let { stringResource(R.string.career_1_s_office_days_451bcb, it.toString()) }).joinToString(" · ").ifEmpty { stringResource(R.string.career_not_stated_c092c4) }
                            ComparisonRow(stringResource(R.string.career_where_you_work_e70df6), office, rightData?.let { listOfNotNull(it.location, it.officeDays?.toString()).joinToString(" · ") } ?: state.profile?.maxOfficeDays?.let { stringResource(R.string.career_1_s_at_most_4aa9a9, it.toString()) } ?: stringResource(R.string.career_not_set_93039e), tone = if (rightData == null && leftData.officeDays != null && state.profile?.maxOfficeDays != null && requireNotNull(leftData.officeDays) > requireNotNull(state.profile.maxOfficeDays)) RrTone.Warn else null)
                            ComparisonRow(stringResource(R.string.career_leave_7e3520), leftData.leave ?: stringResource(R.string.career_not_stated_c092c4), rightData?.leave ?: stringResource(R.string.career_not_set_93039e))
                            ComparisonRow(stringResource(R.string.career_learning_1016fc), formatMoney(leftData.learning, leftData.currency) ?: stringResource(R.string.career_not_stated_c092c4), rightData?.let { formatMoney(it.learning, it.currency) } ?: stringResource(R.string.career_not_set_93039e))
                            ComparisonRow(stringResource(R.string.career_starts_fc612a), leftData.startDate ?: stringResource(R.string.career_not_stated_c092c4), rightData?.startDate ?: state.profile?.noticeWeeks?.let { stringResource(R.string.career_1_s_weeks_notice_4b0939, it.toString()) } ?: stringResource(R.string.career_not_set_93039e))
                            ComparisonRow(stringResource(R.string.career_respond_by_962d5e), leftData.respondBy ?: stringResource(R.string.career_not_stated_c092c4), rightData?.respondBy.orEmpty())
                        }
                    }
                    RrSectionHeader(stringResource(R.string.career_open_questions_f30a3e))
                    RrListGroup(Modifier.padding(horizontal = 16.dp)) { questions.forEach { RrListRow(it) } }
                }
                val withTerms = offers.map { it.applicationId }.toSet()
                state.applications.filter { it.status == ApplicationStage.Offer && it.id !in withTerms }.forEach { app -> RrListRow(app.company, subtitle = stringResource(R.string.career_in_the_offer_stage_terms_not_added_234342), onClick = { edit(null) }, trailing = { RrRowCaret() }) }
                Spacer(Modifier.height(16.dp))
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RrButton(stringResource(R.string.career_copy_questions_63abde), { copy(questions.joinToString("\n\n")) }, Modifier.weight(1f), variant = RrButtonVariant.Secondary, size = RrButtonSize.Large, icon = Icons.drawable.ic_ph_copy, enabled = questions.isNotEmpty())
            RrButton(stringResource(R.string.career_plan_what_to_ask_c18f9e), { plan(listOfNotNull(left, right)) }, Modifier.weight(1f), size = RrButtonSize.Large, icon = Icons.drawable.ic_ph_sparkle, enabled = left != null)
        }
    }
}
@Composable private fun ComparisonRow(label: String, left: String, right: String, header: Boolean = false, tone: RrTone? = null, onLeft: (() -> Unit)? = null, onRight: (() -> Unit)? = null) = Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = if (header) 6.dp else 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
    RrText(label, Modifier.weight(.25f), style = RrType.small, color = RrTheme.colors.ink3)
    RrText(left, Modifier.weight(.375f).then(if (onLeft != null) Modifier.heightIn(min = 44.dp).clickable(onClick = onLeft) else Modifier), style = if (header) RrType.caption else RrType.small)
    RrText(right, Modifier.weight(.375f).then(if (onRight != null) Modifier.heightIn(min = 44.dp).clickable(onClick = onRight) else Modifier), style = if (header) RrType.caption else RrType.small, color = when (tone) { RrTone.Accent -> RrTheme.colors.accentText; RrTone.Warn -> RrTheme.colors.warnText; else -> RrTheme.colors.ink2 })
}

@Composable internal fun OfferEntrySheet(state: OffersState, existing: SavedItem?, close: () -> Unit, save: (String, UpdateCareerOfferRequestTerms) -> Unit, delete: () -> Unit) {
    val initial = (existing?.data as? Offer)?.let(::offerTerms)
    var draft by remember(existing?.id) { mutableStateOf(initial ?: UpdateCareerOfferRequestTerms(currency = "EUR", period = CreateCareerOfferRequestPeriod.Year)) }
    var application by rememberSaveable(existing?.id) { mutableStateOf(existing?.applicationId.orEmpty()) }
    var invalidFields by remember { mutableStateOf(emptySet<String>()) }
    val fieldError: (String, Boolean) -> Unit = { key, invalid -> invalidFields = if (invalid) invalidFields + key else invalidFields - key }
    RrBottomSheet(close, title = stringResource(R.string.career_edit_terms_be01d1), initialDetent = 1, confirmDiscard = draft != initial, footer = {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (existing != null) RrButton(stringResource(R.string.career_delete_offer_33c178), delete, variant = RrButtonVariant.DangerGhost, size = RrButtonSize.Large)
            RrButton(stringResource(R.string.career_save_terms_6fae42), { save(application, draft) }, Modifier.weight(1f), size = RrButtonSize.Large, enabled = application.isNotEmpty() && invalidFields.isEmpty() && !state.busy, loading = state.busy)
        }
    }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.error) CareerError {}
            ChoicePicker(state.applications.firstOrNull { it.id == application }?.company ?: stringResource(R.string.career_choose_application_76fe06), stringResource(R.string.career_application_b291be), state.applications.map { it.id to (it.company + " · " + it.role) }, { application = it }, enabled = existing == null)
            ChoicePicker(draft.version?.wireValue ?: stringResource(R.string.career_written_offer_f8c669), stringResource(R.string.career_offer_type_d5f1c5), CreateCareerOfferRequestVersion.entries.filter { it != CreateCareerOfferRequestVersion.Unknown }.map { it.wireValue to it.wireValue }, { key -> draft = draft.copy(version = CreateCareerOfferRequestVersion.entries.first { it.wireValue == key }) })
            ChoicePicker(draft.currency, stringResource(R.string.career_currency_e070de), Currency.getAvailableCurrencies().map { it.currencyCode }.sorted().map { it to it }, { draft = draft.copy(currency = it) })
            ChoicePicker(periodLabel(draft.period), stringResource(R.string.career_pay_period_830dee), CreateCareerOfferRequestPeriod.entries.filter { it != CreateCareerOfferRequestPeriod.Unknown }.map { it.wireValue to periodLabel(it) }, { key -> draft = draft.copy(period = CreateCareerOfferRequestPeriod.entries.first { it.wireValue == key }) })
            NumberEntry(stringResource(R.string.career_base_salary_66e706), draft.base, { draft = draft.copy(base = it) }, { fieldError("base", it) })
            NumberEntry(stringResource(R.string.career_bonus_4d963c), draft.variablePercent, { draft = draft.copy(variablePercent = it) }, { fieldError("variablePercent", it) })
            RrTextField(draft.variableConditions.orEmpty(), { draft = draft.copy(variableConditions = it) }, label = stringResource(R.string.career_bonus_and_conditions_03d85f), singleLine = false)
            RrTextField(draft.equity.orEmpty(), { draft = draft.copy(equity = it) }, label = stringResource(R.string.career_equity_0786ff))
            RrTextField(draft.location.orEmpty(), { draft = draft.copy(location = it) }, label = stringResource(R.string.career_where_you_work_e70df6))
            NumberEntry(stringResource(R.string.career_office_days_0f7ef5), draft.officeDays?.toDouble(), { draft = draft.copy(officeDays = it?.toLong()) }, { fieldError("officeDays", it) }, max = 7.0)
            RrTextField(draft.leave.orEmpty(), { draft = draft.copy(leave = it) }, label = stringResource(R.string.career_leave_7e3520))
            NumberEntry(stringResource(R.string.career_learning_budget_47c638), draft.learning, { draft = draft.copy(learning = it) }, { fieldError("learning", it) })
            RrTextField(draft.other.orEmpty(), { draft = draft.copy(other = it) }, label = stringResource(R.string.career_other_benefits_714a1a), singleLine = false)
            DateEntry(stringResource(R.string.career_starts_fc612a), draft.startDate, { draft = draft.copy(startDate = it) })
            DateEntry(stringResource(R.string.career_respond_by_962d5e), draft.respondBy, { draft = draft.copy(respondBy = it) })
        }
    }
}
@Composable private fun NumberEntry(label: String, value: Double?, change: (Double?) -> Unit, error: (Boolean) -> Unit, max: Double = 999999999999.0) {
    var text by remember { mutableStateOf(value?.toLong()?.toString().orEmpty()) }; var invalid by remember { mutableStateOf(false) }
    RrTextField(text, { text = it; val amount = parseWholeAmount(it); invalid = it.isNotBlank() && (amount == null || amount > max); error(invalid); if (!invalid) change(amount) }, label = label, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), error = if (invalid) stringResource(R.string.career_enter_a_full_amount_such_as_95000_your_previous_amount_is_un_6a700c) else null)
}
@Composable internal fun DateEntry(label: String, value: String?, change: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    RrPickerField(value.orEmpty(), { open = true }, label = label, trailingIcon = Icons.drawable.ic_ph_calendar_blank)
    if (open) RrBottomSheet({ open = false }, title = label, fitContent = true) { RrDatePicker(value?.let { runCatching { LocalDate.parse(it) }.getOrNull() }, { change(it.toString()); open = false }, Modifier.padding(16.dp)) }
}
