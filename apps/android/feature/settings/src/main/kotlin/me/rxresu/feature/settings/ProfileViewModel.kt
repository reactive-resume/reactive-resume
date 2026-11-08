package me.rxresu.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import me.rxresu.core.data.AccountRepository
import me.rxresu.core.network.generated.*

internal typealias ProfileData = SaveApplicationProfileRequestData

internal typealias Answer = ExportAccountDataResponseApplicationProfileDataWillingToRelocate

internal typealias Address = ExportAccountDataResponseApplicationProfileDataAddress

internal typealias ProfileLink = ExportAccountDataResponseApplicationProfileDataLinksItem

internal typealias ProfileReference = ExportAccountDataResponseApplicationProfileDataReferencesItem

internal typealias Authorization =
    ExportAccountDataResponseApplicationProfileDataWorkAuthorizationItem

internal typealias Salary = ExportAccountDataResponseApplicationProfileDataRequestedSalary

internal data class ProfileState(
    val record: ApplicationProfile? = null,
    val draft: ProfileData = ProfileData(),
    val loading: Boolean = true,
    val loadFailed: Boolean = false,
    val busy: Boolean = false,
    val error: Boolean = false,
    val invalid: Boolean = false,
    val saved: Boolean = false,
    val reloaded: Boolean = false,
) {
    val dirty
        get() = draft != (record?.data ?: ProfileData())
}

internal class ProfileViewModel(private val account: AccountRepository) : ViewModel() {
    private val mutable = MutableStateFlow(ProfileState())
    val state = mutable.asStateFlow()

    init {
        reload()
    }

    fun edit(change: (ProfileData) -> ProfileData) {
        if (!state.value.busy && !state.value.loading)
            mutable.update { it.copy(draft = change(it.draft), saved = false, invalid = false) }
    }

    fun reload() {
        val reloaded = !state.value.loading
        run {
            val record = account.getApplicationProfile()
            mutable.value =
                ProfileState(
                    record = record,
                    draft = record?.data ?: ProfileData(),
                    loading = false,
                    reloaded = reloaded,
                )
        }
    }

    fun save() {
        if (state.value.loading || state.value.loadFailed) return
        if (!validProfile(state.value.draft)) {
            mutable.update { it.copy(invalid = true) }
            return
        }
        run {
            val s = state.value
            val saved =
                account.saveApplicationProfile(
                    SaveApplicationProfileRequest(s.draft, s.record?.revision)
                )
            mutable.value =
                s.copy(record = saved, draft = saved.data, saved = true, reloaded = false)
        }
    }

    fun delete() = run {
        state.value.record?.let {
            account.deleteApplicationProfile(DeleteApplicationProfileRequest(it.revision))
        }
        mutable.value = ProfileState(loading = false)
    }

    private fun run(action: suspend () -> Unit) {
        if (state.value.busy) return
        mutable.update { it.copy(busy = true, error = false) }
        viewModelScope.launch {
            try {
                action()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                mutable.update { it.copy(error = true, loadFailed = it.loading || it.loadFailed) }
            } finally {
                mutable.update { it.copy(busy = false, loading = false) }
            }
        }
    }
}

/** Early form feedback only; API remains validator and revision owner. */
internal fun validProfile(p: ProfileData): Boolean = invalidProfileField(p) == null

internal fun invalidProfileField(p: ProfileData): String? {
    fun country(v: String?) = v.isNullOrBlank() || v in java.util.Locale.getISOCountries()
    fun url(v: String) = runCatching {
        java.net.URI(v).let { it.scheme in listOf("https", "http") && !it.host.isNullOrBlank() }
    }.getOrDefault(false)
    if (p.givenName.orEmpty().length > 200) return "givenName"
    if (p.familyName.orEmpty().length > 200) return "familyName"
    if (!validEmail(p.email)) return "email"
    p.workAuthorization.orEmpty().forEachIndexed { i, a ->
        if (!country(a.countryCode) || a.countryCode.isBlank()) return "authorization:$i"
    }
    p.requestedSalary?.let { salary -> salary.amount?.let { amount ->
        if (!amount.isFinite() || amount < 0) return "salary:amount"
        if (salary.currency?.matches(Regex("[A-Z]{3}")) != true) return "salary:currency"
        if (salary.period !in listOf(CreateCareerOfferRequestPeriod.Hour, CreateCareerOfferRequestPeriod.Month, CreateCareerOfferRequestPeriod.Year)) return "salary:period"
    } }
    p.references.orEmpty().forEachIndexed { i, reference ->
        if (reference.name.isBlank()) return "references:$i:name"
        if (!validEmail(reference.email)) return "references:$i:email"
    }
    if (!country(p.address?.countryCode)) return "address:country"
    p.links.orEmpty().forEachIndexed { i, link ->
        if (link.label.isBlank()) return "links:$i:label"
        if (!url(link.url)) return "links:$i:url"
    }
    return null
}

internal fun emailText(value: JsonElement?): String =
    (value as? JsonPrimitive)?.contentOrNull.orEmpty()

internal fun validEmail(value: JsonElement?): Boolean =
    value == null ||
        value == JsonNull ||
        (value is JsonPrimitive &&
            value.isString &&
            (value.content.isBlank() ||
                value.content.matches(Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))))

internal fun parseSalary(value: String, locale: java.util.Locale): Double? {
    if (value.isBlank()) return null
    val text = value.trim()
    val position = java.text.ParsePosition(0)
    val parsed = java.text.NumberFormat.getNumberInstance(locale).parse(text, position)
    return if (parsed != null && position.index == text.length) parsed.toDouble() else Double.NaN
}
