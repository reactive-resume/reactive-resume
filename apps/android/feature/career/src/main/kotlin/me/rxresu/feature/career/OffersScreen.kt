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
import androidx.compose.foundation.horizontalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
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
@Composable private fun perPeriod(amount: String, period: CreateCareerOfferRequestPeriod): String = stringResource(R.string.career_1_s_2_s_78c505, amount, stringResource(when (period) {
    CreateCareerOfferRequestPeriod.Hour -> CoreStrings.string.an_hour
    CreateCareerOfferRequestPeriod.Month -> CoreStrings.string.a_month
    else -> CoreStrings.string.a_year
}))
@Composable private fun offerAmount(value: Double?, currency: String, period: CreateCareerOfferRequestPeriod): String = formatMoney(value, currency)?.let { perPeriod(it, period) } ?: stringResource(R.string.career_no_amount_stated_value_uncertain_9b0049)

internal data class OpenQuestion(val text: String, val ask: String)
/** The web's open questions (offers.tsx): each term an offer leaves out, and whom to ask about it. */
@Composable private fun openQuestions(offers: List<SavedItem>): List<OpenQuestion> {
    val checks: List<Pair<String, (Offer) -> Boolean>> = listOf(
        stringResource(R.string.career_q_base) to { o -> o.base == null },
        stringResource(R.string.career_q_bonus) to { o -> o.variable == null && o.variablePercent == null && o.variableConditions.isNullOrBlank() },
        stringResource(R.string.career_how_is_the_bonus_decided_and_how_much_of_it_was_paid_out_las_8c3849) to { o -> !o.variableConditions.isNullOrBlank() || o.variablePercent != null },
        stringResource(R.string.career_q_equity) to { o -> o.equity.isNullOrBlank() },
        stringResource(R.string.career_q_equity_worth) to { o -> !o.equity.isNullOrBlank() },
        stringResource(R.string.career_how_many_days_a_week_are_expected_in_the_office_b4c0ab) to { o -> o.officeDays == null },
        stringResource(R.string.career_q_leave) to { o -> o.leave.isNullOrBlank() },
        stringResource(R.string.career_q_learning) to { o -> o.learning == null },
        stringResource(R.string.career_q_other) to { o -> o.other.isNullOrBlank() },
        stringResource(R.string.career_q_start) to { o -> o.startDate == null },
        stringResource(R.string.career_q_respond) to { o -> o.respondBy == null },
    )
    val both = stringResource(R.string.career_ask_both)
    val askFormat = stringResource(R.string.career_ask_name, "%s")
    return checks.mapNotNull { (question, open) ->
        val who = offers.filter { (it.data as? Offer)?.let(open) == true }
        if (who.isEmpty()) null
        else OpenQuestion(question, if (who.size == offers.size && offers.size > 1) both else askFormat.format(who.joinToString(", ") { it.application?.company ?: it.title }))
    }
}
/** The web's quote of what matters to you: its first sentence when long, ending with a full stop. */
internal fun saidQuote(priorities: String): String? {
    val text = priorities.trim().ifEmpty { return null }
    val first = if (text.length > 160) text.split(Regex("(?<=[.!?])\\s")).first() else text
    return if (first.last() in ".!?") first else "$first."
}
@Composable internal fun OffersScreen(state: OffersState, back: () -> Unit, retry: () -> Unit, edit: (SavedItem?) -> Unit, copy: (String) -> Unit, plan: (List<SavedItem>) -> Unit, counter: (SavedItem) -> Unit = { plan(listOf(it)) }) {
    var a by rememberSaveable { mutableIntStateOf(0) }; var b by rememberSaveable { mutableIntStateOf(1) }
    var options by remember { mutableStateOf(false) }
    val offers = state.offers.filter { it.data is Offer }.sortedByDescending { it.createdAt }
    val left = offers.getOrNull(a) ?: offers.firstOrNull()
    val right = offers.getOrNull(b)?.takeIf { it.id != left?.id }
    val compared = listOfNotNull(left, right)
    val questions = openQuestions(compared)
    val time = rememberCareerTime()
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg)) {
        RrTopBar(onBack = back, actions = { RrIconButton(Icons.drawable.ic_ph_sparkle, stringResource(R.string.career_coach_b32c9a), { plan(compared) }, tint = RrTheme.colors.accentText, enabled = left != null) })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            RrPageTitle(stringResource(R.string.career_compare_offers), subtitle = stringResource(R.string.career_better_value), subtitleColor = RrTheme.colors.ink3)
            if (state.loading) CareerLoading() else {
                if (state.error) CareerError(retry)
                if (left == null) RrEmptyState(stringResource(R.string.career_no_offers_to_compare_yet_ba8c3b), stringResource(R.string.career_add_each_offer_s_terms_to_compare_it_nothing_is_filled_in_fo_840aa5), Modifier.padding(24.dp), actionLabel = stringResource(R.string.career_add_offer_0c1811), onAction = { edit(null) })
                else {
                    val l = left.data as Offer; val r = right?.data as? Offer
                    val unitMatch = r != null && l.currency == r.currency && l.period == r.period
                    val salary = state.profile?.minBase?.let { salaryComparison(l, it) }
                    OfferComparisonTable(if (offers.size > 2) offers else compared, state.profile, edit)
                    if (r != null && !unitMatch || r == null && salary == SalaryComparison.DifferentUnits || offers.size > 2 && offers.map { val o = it.data as Offer; o.currency to o.period }.distinct().size > 1) RrCallout(stringResource(R.string.career_different_currency_or_pay_period_not_compared_33b853), Modifier.padding(24.dp), tone = RrTone.Warn)
                    if (right != null && left.applicationId != null && left.applicationId == right.applicationId) RrSectionHeading(stringResource(R.string.career_changes_since, time.day(minOf(left.createdAt, right.createdAt)).orEmpty()))
                }
                val withTerms = offers.map { it.applicationId }.toSet()
                state.applications.filter { it.status == ApplicationStage.Offer && it.id !in withTerms }.forEach { app -> RrListRow(app.company, subtitle = stringResource(R.string.career_in_the_offer_stage_terms_not_added_234342), onClick = { edit(null) }, trailing = { RrRowCaret() }) }
            }
        }
        RrFooterBar {
            RrButton(stringResource(R.string.career_edit), { if (left == null) edit(null) else options = true }, Modifier.weight(1f), variant = RrButtonVariant.Secondary, size = RrButtonSize.Large)
            RrButton(stringResource(R.string.career_draft_counter), { left?.let(counter) }, Modifier.weight(1f), size = RrButtonSize.Large, enabled = left != null)
        }
    }
    if (options) RrBottomSheet({ options = false }, title = stringResource(R.string.career_compare_offers), initialDetent = 1) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ChoicePicker(left?.let { it.application?.company ?: it.title }.orEmpty(), stringResource(R.string.career_first_offer_df9efd), offers.mapIndexed { i, item -> i.toString() to (item.application?.company ?: item.title) }, { a = it.toInt() })
            ChoicePicker(right?.let { it.application?.company ?: it.title } ?: stringResource(R.string.career_your_requirements_b1c02b), stringResource(R.string.career_compare_with_719f56), listOf("-1" to stringResource(R.string.career_your_requirements_b1c02b)) + offers.mapIndexedNotNull { i, item -> if (i == a) null else i.toString() to (item.application?.company ?: item.title) }, { b = it.toInt() })
            RrButton(stringResource(R.string.career_swap_210dd6), { if (b >= 0) { val old = a; a = b; b = old } }, variant = RrButtonVariant.Ghost, enabled = right != null)
            compared.forEach { item -> RrListRow(item.application?.company ?: item.title, onClick = { options = false; edit(item) }) }
            RrButton(stringResource(R.string.career_add_offer_0c1811), { options = false; edit(null) }, variant = RrButtonVariant.GhostAccent)
            questions.forEach { RrListRow(it.text, subtitle = it.ask, titleMaxLines = Int.MAX_VALUE) }
            RrButton(stringResource(R.string.career_copy_questions_63abde), { copy(questions.joinToString("\n") { it.text + " · " + it.ask }) }, variant = RrButtonVariant.Secondary)
        }
    }
}
internal fun bonusValue(offer: Offer): String = offer.variablePercent?.let { java.math.BigDecimal.valueOf(it).stripTrailingZeros().toPlainString() + "%" } ?: formatMoney(offer.variable, offer.currency) ?: "—"

@Composable private fun OfferComparisonTable(items: List<SavedItem>, profile: CareerProfile?, edit: (SavedItem?) -> Unit) {
    val time = rememberCareerTime()
    val scroll = rememberScrollState()
    val cellWidth = 104.dp * androidx.compose.ui.platform.LocalDensity.current.fontScale.coerceAtLeast(1f)
    val terms = items.map { it.data as Offer }
    val comparable = terms.none { it.period == CreateCareerOfferRequestPeriod.Unknown } && terms.map { it.currency to it.period }.distinct().size == 1
    val highestBase = if (comparable) terms.mapNotNull { it.base }.maxOrNull() else null
    val fewestOfficeDays = terms.mapNotNull { it.officeDays }.minOrNull()
    val officeRequirement = profile?.maxOfficeDays?.let { stringResource(R.string.career_1_s_at_most_4aa9a9, it.toString()) } ?: "—"
    val noticeRequirement = profile?.noticeWeeks?.let { stringResource(R.string.career_1_s_weeks_notice_4b0939, it.toString()) } ?: "—"
    val work = terms.map { offer ->
        if (terms.size == 1) listOfNotNull(offer.location?.takeIf(String::isNotBlank), offer.officeDays?.let { stringResource(R.string.career_1_s_office_days_451bcb, it.toString()) }).joinToString(" · ").ifEmpty { "—" }
        else offer.location?.takeIf(String::isNotBlank) ?: "—"
    } + if (terms.size == 1) listOf(officeRequirement) else emptyList()
    @Composable fun row(label: String, values: List<String>, better: List<Boolean> = values.map { false }, header: Boolean = false) {
        val c = RrTheme.colors
        val type = RrType.body.copy(lineHeight = 20.sp, textAlign = TextAlign.End)
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).heightIn(min = if (header) 64.dp else 52.dp).drawBehind {
            drawLine(if (header) c.line2 else c.line, Offset(0f, size.height - .5.dp.toPx()), Offset(size.width, size.height - .5.dp.toPx()), 1.dp.toPx())
        }, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            RrText(label, Modifier.width(110.dp), style = RrType.ui, color = c.ink3)
            Row(Modifier.weight(1f).horizontalScroll(scroll), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                values.forEachIndexed { i, value ->
                    Box(Modifier.width(cellWidth).heightIn(min = 44.dp).clickable(enabled = i < items.size) { edit(items[i]) }, contentAlignment = Alignment.CenterEnd) {
                        RrText(value, style = type.copy(fontWeight = if (header || better[i]) FontWeight.SemiBold else FontWeight.Normal), color = if (better[i]) c.accentText else c.ink)
                    }
                }
            }
        }
    }
    fun values(read: (Offer) -> String, requirement: String = "—") = terms.map(read) + if (terms.size == 1) listOf(requirement) else emptyList()
    fun better(read: (Offer) -> Boolean) = terms.map(read) + if (terms.size == 1) listOf(false) else emptyList()
    Column(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 12.dp)) {
        row("", items.map { it.application?.company ?: it.title } + if (items.size == 1) listOf(stringResource(R.string.career_your_requirements_b1c02b)) else emptyList(), header = true)
        row(stringResource(R.string.career_base), values({ formatMoney(it.base, it.currency) ?: "—" }, profile?.minBase?.let { formatMoney(it.amount, it.currency) } ?: "—"), better { if (terms.size == 1) profile?.minBase?.let { p -> salaryComparison(it, p) == SalaryComparison.Meets } == true else comparable && it.base != null && it.base == highestBase && terms.mapNotNull { o -> o.base }.distinct().size > 1 })
        row(stringResource(R.string.career_bonus_4d963c), values(::bonusValue))
        row(stringResource(R.string.career_equity_0786ff), values({ it.equity?.takeIf(String::isNotBlank) ?: "—" }))
        row(stringResource(R.string.career_work), work, better { it.officeDays != null && it.officeDays == fewestOfficeDays && terms.mapNotNull { o -> o.officeDays }.distinct().size > 1 })
        row(stringResource(R.string.career_holidays), values({ it.leave?.takeIf(String::isNotBlank) ?: "—" }))
        row(stringResource(R.string.career_start), values({ time.shortDate(it.startDate) ?: "—" }, noticeRequirement))
        row(stringResource(R.string.career_reply_by), terms.mapIndexed { i, offer -> (if (i == 0) time.day(offer.respondBy) else time.shortDate(offer.respondBy)) ?: "—" } + if (terms.size == 1) listOf("—") else emptyList())
    }
}

@Composable internal fun OfferEntrySheet(state: OffersState, existing: SavedItem?, close: () -> Unit, save: (String, UpdateCareerOfferRequestTerms) -> Unit, delete: () -> Unit) {
    val initial = (existing?.data as? Offer)?.let(::offerTerms)
    var draft by remember(existing?.id) { mutableStateOf(initial ?: UpdateCareerOfferRequestTerms(currency = "EUR", period = CreateCareerOfferRequestPeriod.Year)) }
    var application by rememberSaveable(existing?.id) { mutableStateOf(existing?.applicationId.orEmpty()) }
    var invalidFields by remember { mutableStateOf(emptySet<String>()) }
    val fieldError: (String, Boolean) -> Unit = { key, invalid -> invalidFields = if (invalid) invalidFields + key else invalidFields - key }
    RrBottomSheet(close, title = stringResource(R.string.career_edit_terms_be01d1), initialDetent = 1, confirmDiscard = draft != initial, footer = { SheetFooter {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (existing != null) RrButton(stringResource(R.string.career_delete_offer_33c178), delete, variant = RrButtonVariant.DangerGhost, size = RrButtonSize.Large)
            RrButton(stringResource(R.string.career_save_terms_6fae42), { save(application, draft) }, Modifier.weight(1f), size = RrButtonSize.Large, enabled = application.isNotEmpty() && invalidFields.isEmpty() && !state.busy, loading = state.busy)
        }
    } }) {
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
            DateEntry(stringResource(R.string.career_starts_fc612a), draft.startDate, { draft = draft.copy(startDate = it) }, withYear = true)
            DateEntry(stringResource(R.string.career_respond_by_962d5e), draft.respondBy, { draft = draft.copy(respondBy = it) })
        }
    }
}
@Composable private fun NumberEntry(label: String, value: Double?, change: (Double?) -> Unit, error: (Boolean) -> Unit, max: Double = 999999999999.0) {
    var text by remember { mutableStateOf(value?.toLong()?.toString().orEmpty()) }; var invalid by remember { mutableStateOf(false) }
    RrTextField(text, { text = it; val amount = parseWholeAmount(it); invalid = it.isNotBlank() && (amount == null || amount > max); error(invalid); if (!invalid) change(amount) }, label = label, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), error = if (invalid) stringResource(R.string.career_enter_a_full_amount_such_as_95000_your_previous_amount_is_un_6a700c) else null)
}
@Composable internal fun DateEntry(label: String, value: String?, change: (String) -> Unit, withYear: Boolean = false) {
    var open by remember { mutableStateOf(false) }; val time = rememberCareerTime()
    RrPickerField((if (withYear) time.dateWithYear(value) else time.day(value)) ?: value.orEmpty(), { open = true }, label = label, trailingIcon = Icons.drawable.ic_ph_calendar_blank)
    if (open) RrBottomSheet({ open = false }, title = label, fitContent = true) { RrDatePicker(value?.let { runCatching { LocalDate.parse(it) }.getOrNull() }, { change(it.toString()); open = false }, Modifier.padding(16.dp)) }
}
