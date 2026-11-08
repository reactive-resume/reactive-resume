package me.rxresu.feature.settings

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.liveRegion
import java.util.Locale
import kotlinx.serialization.json.*
import me.rxresu.core.designsystem.*
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.*
import me.rxresu.core.strings.R as CR

@Composable
internal fun ProfileScreen(
    s: ProfileState,
    edit: ((ProfileData) -> ProfileData) -> Unit = {},
    save: () -> Unit = {},
    reload: () -> Unit = {},
    delete: () -> Unit = {},
    back: () -> Unit = {},
    timezone: String = "UTC",
) {
    var discard by remember { mutableStateOf(false) }
    var remove by remember { mutableStateOf(false) }
    var section by remember { mutableStateOf<String?>(null) }
    var country by remember { mutableStateOf(false) }
    val haptic = rememberRrHaptics()
    val scroll = rememberScrollState()
    val reduced = RrTheme.reducedMotion
    val invalidField = if (s.invalid) invalidProfileField(s.draft) else null
    LaunchedEffect(s.invalid) {
        if (s.invalid && invalidField?.contains(':') == true) {
            val parent = invalidField.substringBefore(':')
            if (parent != "authorization") section = parent
        }
    }
    val validationError = stringResource(CR.string.check_email_addresses_links_names_countries_and_salary_a_salary_amount_needs_currency_and_pay_period)
    @Composable fun target(path: String) = invalidProfileTarget(path == invalidField, scroll, reduced)
    fun error(path: String): String? = validationError.takeIf { path == invalidField }
    val context = LocalContext.current
    LaunchedEffect(s.saved, s.invalid, s.error) {
        when {
            s.invalid || s.error -> haptic(RrHaptic.Error)
            s.saved -> haptic(RrHaptic.Success)
        }
    }
    val leave = { if (s.dirty) discard = true else back() }
    BackHandler(s.dirty) { leave() }
    val locale = LocalConfiguration.current.locales[0]
    val is24 = android.text.format.DateFormat.is24HourFormat(androidx.compose.ui.platform.LocalContext.current)
    val updated =
        remember(s.record, locale, timezone, is24) {
            s.record?.reviewedAt?.let { value ->
                val zone = runCatching { java.time.ZoneId.of(timezone) }.getOrDefault(java.time.ZoneOffset.UTC)
                SettingsDates(locale, zone, is24).dayTime(value) ?: value
            }
        }
    SettingsFrame(
        stringResource(CR.string.profile),
        leave,
        scroll = scroll,
        status =
            updated?.let { { RrText(stringResource(R.string.screen_last_updated) + " " + it) } },
        actions = {
            RrButton(
                stringResource(CR.string.save),
                save,
                Modifier.padding(end = 8.dp),
                size = RrButtonSize.Small,
                loading = s.busy,
                enabled = !s.loading && !s.loadFailed,
            )
        },
    ) {
        if (s.loading) RrSkeletonText(Modifier.padding(16.dp), lines = 5)
        else if (s.loadFailed) {
            ErrorCallout()
            RrButton(
                stringResource(R.string.screen_reload),
                reload,
                variant = RrButtonVariant.Secondary,
            )
        } else
            Column(
                Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                RrText(
                    stringResource(
                        R.string
                            .screen_the_details_application_forms_ask_for_answers_and_packets_in_apply_use_them
                    ),
                    style = RrType.small,
                    color = RrTheme.colors.ink2,
                )
                if (s.error) ErrorCallout()
                if (s.invalid)
                    RrCallout(
                        stringResource(
                            CR.string
                                .check_email_addresses_links_names_countries_and_salary_a_salary_amount_needs_currency_and_pay_period
                        ),
                        tone = RrTone.Danger,
                    )
                if (s.reloaded)
                    RrCallout(
                        stringResource(CR.string.saved_profile_reloaded_unsaved_changes_discarded),
                        tone = RrTone.Accent,
                    )
                if (s.saved)
                    RrCallout(stringResource(CR.string.profile_saved), tone = RrTone.Accent)
                RrText(
                    stringResource(CR.string.contact_details),
                    style = RrType.eyebrow,
                    color = RrTheme.colors.ink3,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RrTextField(
                        s.draft.givenName.orEmpty(),
                        { v -> edit { it.copy(givenName = v) } },
                        Modifier.weight(1f).then(target("givenName")),
                        error = error("givenName"),
                        label = stringResource(CR.string.given_name),
                        enabled = !s.busy,
                    )
                    RrTextField(
                        s.draft.familyName.orEmpty(),
                        { v -> edit { it.copy(familyName = v) } },
                        Modifier.weight(1f).then(target("familyName")),
                        error = error("familyName"),
                        label = stringResource(CR.string.family_name),
                        enabled = !s.busy,
                    )
                }
                RrTextField(
                    emailText(s.draft.email),
                    { v -> edit { it.copy(email = JsonPrimitive(v)) } },
                    modifier = target("email"),
                    label = stringResource(CR.string.application_email),
                    ltr = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    enabled = !s.busy,
                    error =
                        if (s.invalid && !validEmail(s.draft.email))
                            stringResource(CR.string.enter_a_valid_email_address)
                        else null,
                )
                RrTextField(
                    s.draft.phone.orEmpty(),
                    { v -> edit { it.copy(phone = v) } },
                    label = stringResource(CR.string.application_phone),
                    ltr = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    enabled = !s.busy,
                )
                RrText(
                    stringResource(CR.string.work_authorization_and_sponsorship),
                    Modifier.padding(top = 6.dp),
                    style = RrType.eyebrow,
                    color = RrTheme.colors.ink3,
                )
                RrListGroup {
                    s.draft.workAuthorization.orEmpty().forEachIndexed { index, item ->
                        val name =
                            Locale.Builder()
                                .setRegion(item.countryCode)
                                .build()
                                .getDisplayCountry(LocalConfiguration.current.locales[0])
                        RrListRow(
                            stringResource(R.string.screen_authorized_to_work_in) + " " + name,
                            modifier = target("authorization:$index"),
                            subtitle = error("authorization:$index"),
                            onClick = { section = "authorization:$index" },
                            trailing = { RrRowValue(answerText(item.authorized)) },
                        )
                        RrListRow(
                            stringResource(R.string.screen_needs_sponsorship_in) + " " + name,
                            onClick = { section = "sponsorship:$index" },
                            trailing = { RrRowValue(answerText(item.needsSponsorship)) },
                        )
                    }
                    RrListRow(
                        stringResource(CR.string.add_authorization_country),
                        icon = me.rxresu.core.designsystem.R.drawable.ic_ph_plus,
                        onClick = { country = true },
                    )
                }
                RrListGroup {
                    RrSwitchRow(
                        stringResource(CR.string.willing_to_relocate),
                        s.draft.willingToRelocate == Answer.Yes,
                        { on ->
                            edit { it.copy(willingToRelocate = if (on) Answer.Yes else Answer.No) }
                        },
                        enabled = !s.busy,
                    )
                    RrListRow(
                        stringResource(CR.string.requested_salary),
                        subtitle = s.draft.requestedSalary?.let { salaryCaption(it, locale) },
                        onClick = { section = "salary" },
                        trailing = { RrRowCaret() },
                    )
                    RrListRow(
                        stringResource(CR.string.references),
                        subtitle =
                            pluralStringResource(
                                R.plurals.screen_people_count,
                                s.draft.references.orEmpty().size,
                                s.draft.references.orEmpty().size,
                            ),
                        onClick = { section = "references" },
                        trailing = { RrRowCaret() },
                    )
                }
                RrListGroup {
                    NavRow(stringResource(CR.string.address)) { section = "address" }
                    NavRow(stringResource(CR.string.links)) { section = "links" }
                }
                updated?.let {
                    RrText(
                        stringResource(R.string.screen_last_updated) + " " + it,
                        style = RrType.small,
                        color = RrTheme.colors.ink3,
                    )
                }
                RrButton(
                    stringResource(R.string.screen_reload_and_discard),
                    reload,
                    variant = RrButtonVariant.Secondary,
                    enabled = !s.busy,
                )
                RrSectionHeader(stringResource(CR.string.manage_profile))
                RrButton(
                    stringResource(R.string.screen_export_profile),
                    {
                        val json =
                            ApiJson.encodeToString(
                                ProfileData.serializer(),
                                s.record?.data ?: ProfileData(),
                            )
                        context.startActivity(
                            Intent.createChooser(
                                Intent(Intent.ACTION_SEND)
                                    .setType("application/json")
                                    .putExtra(Intent.EXTRA_TEXT, json),
                                null,
                            )
                        )
                    },
                    variant = RrButtonVariant.Secondary,
                    enabled = s.record != null,
                )
                RrButton(
                    stringResource(CR.string.delete_profile),
                    { remove = true },
                    variant = RrButtonVariant.DangerGhost,
                    enabled = s.record != null && !s.busy,
                )
            }
    }
    if (discard)
        RrAlertDialog(
            stringResource(CR.string.discard_changes_302d315bf9),
            stringResource(R.string.screen_unsaved_changes_will_be_lost),
            stringResource(CR.string.discard_changes),
            back,
            { discard = false },
            dismissLabel = stringResource(CR.string.keep_editing),
        )
    if (remove)
        RrAlertDialog(
            stringResource(CR.string.delete_profile_1375b2c60f),
            stringResource(R.string.screen_delete_your_saved_application_profile),
            stringResource(CR.string.hold_to_delete),
            {
                remove = false
                delete()
            },
            { remove = false },
            confirm = RrDialogConfirm.HoldToDelete,
        )
    if (country)
        SearchPicker(
            stringResource(R.string.screen_country),
            Locale.getISOCountries()
                .filter { code ->
                    s.draft.workAuthorization.orEmpty().none { it.countryCode == code }
                }
                .map {
                    it to
                        Locale.Builder()
                            .setRegion(it)
                            .build()
                            .getDisplayCountry(LocalConfiguration.current.locales[0])
                },
            { country = false },
        ) { code ->
            edit {
                it.copy(
                    workAuthorization =
                        it.workAuthorization.orEmpty() +
                            Authorization(
                                countryCode = code,
                                authorized = Answer.KnownUnknown,
                                needsSponsorship = Answer.KnownUnknown,
                            )
                )
            }
            country = false
        }
    val current = section
    if (
        current?.startsWith("authorization:") == true || current?.startsWith("sponsorship:") == true
    ) {
        val index = current.substringAfter(':').toInt()
        SearchPicker(
            stringResource(CR.string.work_authorization_and_sponsorship),
            listOf(Answer.Yes, Answer.No, Answer.KnownUnknown).map { it.name to answerText(it) },
            { section = null },
        ) { value ->
            edit { data ->
                data.copy(
                    workAuthorization =
                        data.workAuthorization.orEmpty().mapIndexed { i, a ->
                            if (i != index) a
                            else if (current.startsWith("authorization:"))
                                a.copy(authorized = Answer.valueOf(value))
                            else a.copy(needsSponsorship = Answer.valueOf(value))
                        }
                )
            }
            section = null
        }
    } else if (current != null) {
        ProfileSection(current, s, edit) { section = null }
    }
}

@Composable
private fun ProfileSection(
    section: String,
    s: ProfileState,
    edit: ((ProfileData) -> ProfileData) -> Unit,
    close: () -> Unit,
) {
    val scroll = rememberScrollState()
    val invalidField = if (s.invalid) invalidProfileField(s.draft) else null
    val reduced = RrTheme.reducedMotion
    val validationError = stringResource(CR.string.check_email_addresses_links_names_countries_and_salary_a_salary_amount_needs_currency_and_pay_period)
    @Composable fun target(path: String) = invalidProfileTarget(path == invalidField, scroll, reduced)
    fun error(path: String): String? = validationError.takeIf { path == invalidField }
    var countryPicker by remember { mutableStateOf(false) }
    var periodPicker by remember { mutableStateOf(false) }
    val periods =
        listOf(
            CreateCareerOfferRequestPeriod.Hour,
            CreateCareerOfferRequestPeriod.Month,
            CreateCareerOfferRequestPeriod.Year,
        )
    val periodLabels =
        listOf(
            stringResource(CR.string.hour),
            stringResource(CR.string.month),
            stringResource(CR.string.year),
        )
    val title =
        when (section) {
            "address" -> stringResource(CR.string.address)
            "links" -> stringResource(CR.string.links)
            "references" -> stringResource(CR.string.references)
            else -> stringResource(CR.string.requested_salary)
        }
    RrBottomSheet(close, title = title, detents = RrSheetDetents.Full) {
        Column(
            Modifier.verticalScroll(scroll).padding(16.dp).imePadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            when (section) {
                "address" -> {
                    val a = s.draft.address ?: Address()
                    RrTextField(
                        a.line1.orEmpty(),
                        { v -> edit { it.copy(address = a.copy(line1 = v)) } },
                        label = stringResource(CR.string.address_line_1),
                    )
                    RrTextField(
                        a.line2.orEmpty(),
                        { v -> edit { it.copy(address = a.copy(line2 = v)) } },
                        label = stringResource(CR.string.address_line_2),
                    )
                    RrTextField(
                        a.city.orEmpty(),
                        { v -> edit { it.copy(address = a.copy(city = v)) } },
                        label = stringResource(CR.string.city),
                    )
                    RrTextField(
                        a.region.orEmpty(),
                        { v -> edit { it.copy(address = a.copy(region = v)) } },
                        label = stringResource(CR.string.state_or_region),
                    )
                    RrTextField(
                        a.postalCode.orEmpty(),
                        { v -> edit { it.copy(address = a.copy(postalCode = v)) } },
                        label = stringResource(CR.string.postal_code),
                    )
                    RrPickerField(
                        a.countryCode.orEmpty(),
                        { countryPicker = true },
                        modifier = target("address:country"),
                        error = error("address:country"),
                        label = stringResource(R.string.screen_country),
                    )
                }
                "links" -> {
                    s.draft.links.orEmpty().forEachIndexed { i, link ->
                        RrTextField(
                            link.label,
                            { v ->
                                edit {
                                    it.copy(
                                        links =
                                            it.links.orEmpty().mapIndexed { n, l ->
                                                if (i == n) l.copy(label = v) else l
                                            }
                                    )
                                }
                            },
                            modifier = target("links:$i:label"),
                            error = error("links:$i:label"),
                            label = stringResource(CR.string.name),
                        )
                        RrTextField(
                            link.url,
                            { v ->
                                edit {
                                    it.copy(
                                        links =
                                            it.links.orEmpty().mapIndexed { n, l ->
                                                if (i == n) l.copy(url = v) else l
                                            }
                                    )
                                }
                            },
                            modifier = target("links:$i:url"),
                            error = error("links:$i:url"),
                            label = stringResource(CR.string.url),
                            ltr = true,
                        )
                        RrButton(
                            stringResource(CR.string.remove),
                            {
                                edit {
                                    it.copy(
                                        links = it.links.orEmpty().filterIndexed { n, _ -> n != i }
                                    )
                                }
                            },
                            variant = RrButtonVariant.DangerGhost,
                        )
                    }
                    RrButton(
                        stringResource(CR.string.add_link),
                        { edit { it.copy(links = it.links.orEmpty() + ProfileLink("", "")) } },
                        variant = RrButtonVariant.Secondary,
                    )
                }
                "references" -> {
                    s.draft.references.orEmpty().forEachIndexed { i, reference ->
                        fun change(update: (ProfileReference) -> ProfileReference) = edit {
                            it.copy(
                                references =
                                    it.references.orEmpty().mapIndexed { n, r ->
                                        if (n == i) update(r) else r
                                    }
                            )
                        }
                        RrTextField(
                            reference.name,
                            { v -> change { it.copy(name = v) } },
                            modifier = target("references:$i:name"),
                            error = error("references:$i:name"),
                            label = stringResource(CR.string.name),
                        )
                        RrTextField(
                            reference.relationship,
                            { v -> change { it.copy(relationship = v) } },
                            label = stringResource(CR.string.relationship),
                        )
                        RrTextField(
                            reference.company,
                            { v -> change { it.copy(company = v) } },
                            label = stringResource(CR.string.company),
                        )
                        RrTextField(
                            emailText(reference.email),
                            { v -> change { it.copy(email = JsonPrimitive(v)) } },
                            modifier = target("references:$i:email"),
                            error = error("references:$i:email"),
                            label = stringResource(CR.string.email),
                            ltr = true,
                        )
                        RrTextField(
                            reference.phone,
                            { v -> change { it.copy(phone = v) } },
                            label = stringResource(CR.string.phone),
                            ltr = true,
                        )
                        RrButton(
                            stringResource(CR.string.remove),
                            {
                                edit {
                                    it.copy(
                                        references =
                                            it.references.orEmpty().filterIndexed { n, _ -> n != i }
                                    )
                                }
                            },
                            variant = RrButtonVariant.DangerGhost,
                        )
                    }
                    RrButton(
                        stringResource(CR.string.add_reference),
                        {
                            edit {
                                it.copy(
                                    references =
                                        it.references.orEmpty() +
                                            ProfileReference("", JsonPrimitive(""), "", "", "")
                                )
                            }
                        },
                        variant = RrButtonVariant.Secondary,
                    )
                }
                "salary" -> {
                    val salary = s.draft.requestedSalary ?: Salary()
                    val locale = LocalConfiguration.current.locales[0]
                    var amount by remember {
                        mutableStateOf(
                            salary.amount
                                ?.let {
                                    java.text.NumberFormat.getNumberInstance(locale).format(it)
                                }
                                .orEmpty()
                        )
                    }
                    RrTextField(
                        amount,
                        { v ->
                            amount = v
                            edit {
                                it.copy(
                                    requestedSalary = salary.copy(amount = parseSalary(v, locale))
                                )
                            }
                        },
                        modifier = target("salary:amount"),
                        error = error("salary:amount"),
                        label = stringResource(R.string.screen_amount),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    )
                    RrTextField(
                        salary.currency.orEmpty(),
                        { v ->
                            edit {
                                it.copy(
                                    requestedSalary =
                                        salary.copy(currency = v.uppercase(Locale.ROOT))
                                )
                            }
                        },
                        modifier = target("salary:currency"),
                        error = error("salary:currency"),
                        label = stringResource(CR.string.currency),
                    )
                    val periodLabel = stringResource(R.string.screen_pay_period)
                    RrPickerField(
                        periodLabels.getOrNull(periods.indexOf(salary.period)).orEmpty(),
                        { periodPicker = true },
                        modifier = target("salary:period"),
                        error = error("salary:period"),
                        label = periodLabel,
                    )
                    RrButton(
                        stringResource(CR.string.remove),
                        {
                            edit { it.copy(requestedSalary = null) }
                            close()
                        },
                        variant = RrButtonVariant.DangerGhost,
                    )
                }
            }
            RrButton(
                stringResource(CR.string.done),
                close,
                Modifier.fillMaxWidth(),
                variant = RrButtonVariant.Secondary,
            )
        }
    }
    if (countryPicker)
        SearchPicker(
            stringResource(R.string.screen_country),
            Locale.getISOCountries().map {
                it to
                    Locale.Builder()
                        .setRegion(it)
                        .build()
                        .getDisplayCountry(LocalConfiguration.current.locales[0])
            },
            { countryPicker = false },
        ) { value ->
            edit { it.copy(address = (it.address ?: Address()).copy(countryCode = value)) }
            countryPicker = false
        }
    if (periodPicker)
        SearchPicker(
            stringResource(R.string.screen_pay_period),
            periods.mapIndexed { i, value -> value.name to periodLabels[i] },
            { periodPicker = false },
        ) { value ->
            edit {
                it.copy(
                    requestedSalary =
                        (it.requestedSalary ?: Salary()).copy(
                            period = CreateCareerOfferRequestPeriod.valueOf(value)
                        )
                )
            }
            periodPicker = false
        }
}

@Composable
internal fun answerText(answer: Answer?): String =
    when (answer) {
        Answer.Yes -> stringResource(CR.string.yes)
        Answer.No -> stringResource(CR.string.no)
        else -> stringResource(CR.string.unknown)
    }

@Composable
private fun salaryCaption(salary: Salary, locale: Locale): String {
    val amount = salary.amount ?: return ""
    val formatted =
        remember(salary, locale) {
            runCatching {
                    java.text.NumberFormat.getCurrencyInstance(locale)
                        .apply {
                            currency = java.util.Currency.getInstance(salary.currency)
                            maximumFractionDigits = if (amount % 1.0 == 0.0) 0 else 2
                        }
                        .format(amount)
                }
                .getOrDefault("${salary.currency.orEmpty()} $amount")
        }
    return when (salary.period) {
        CreateCareerOfferRequestPeriod.Year ->
            stringResource(R.string.screen_salary_per_year, formatted)
        CreateCareerOfferRequestPeriod.Month ->
            stringResource(R.string.screen_salary_per_month, formatted)
        CreateCareerOfferRequestPeriod.Hour ->
            stringResource(R.string.screen_salary_per_hour, formatted)
        else -> formatted
    }
}

/** Scroll the actual invalid control (including its inline error), then focus its editor. */
@Composable
private fun invalidProfileTarget(active: Boolean, scroll: androidx.compose.foundation.ScrollState, reduced: Boolean): Modifier {
    val focus = remember { androidx.compose.ui.focus.FocusRequester() }
    var top by remember { mutableStateOf<Float?>(null) }
    LaunchedEffect(active, top) {
        if (active && top != null) {
            val offset = top!!.toInt().coerceAtLeast(0)
            if (reduced) scroll.scrollTo(offset) else scroll.animateScrollTo(offset, tween(RrMotion.D2))
            focus.requestFocus()
        }
    }
    return Modifier.onGloballyPositioned { top = it.positionInParent().y }
        .focusRequester(focus)
        .semantics { if (active) liveRegion = androidx.compose.ui.semantics.LiveRegionMode.Assertive }
}
