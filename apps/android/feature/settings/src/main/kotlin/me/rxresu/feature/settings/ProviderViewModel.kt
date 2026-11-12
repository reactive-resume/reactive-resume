package me.rxresu.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import me.rxresu.core.data.AiRepository
import me.rxresu.core.network.generated.*

internal data class ProviderState(
    val isNew: Boolean = true,
    val testCount: Int = 0,
    val original: TestAiProviderResponse? = null,
    val provider: CreateAiProviderRequestProvider = CreateAiProviderRequestProvider.Openai,
    val label: String = "",
    val key: String = "",
    val baseURL: String = providerDefaults.getValue(CreateAiProviderRequestProvider.Openai).second,
    val model: String = providerDefaults.getValue(CreateAiProviderRequestProvider.Openai).first,
    val fastModel: String = "",
    val capableModel: String = "",
    val loading: Boolean = false,
    val busy: Boolean = false,
    val error: Boolean = false,
    val problem: String? = null,
    val testStatus: String? = null,
    val testErrorKind: String? = null,
    val finished: Boolean = false,
) {
    val dirty
        get() =
            if (original == null) label.isNotBlank() || key.isNotBlank()
            else
                key.isNotBlank() ||
                    label != original.label ||
                    model != original.model ||
                    baseURL != original.baseURL.orEmpty() ||
                    fastModel != original.fastModel.orEmpty() ||
                    capableModel != original.capableModel.orEmpty() ||
                    provider != original.provider
}

internal class ProviderViewModel(private val ai: AiRepository, private val id: String?) :
    ViewModel() {
    private val mutable = MutableStateFlow(ProviderState(isNew = id == null, loading = id != null))
    val state = mutable.asStateFlow()

    init {
        if (id != null)
            run {
                val item = ai.listAiProviders().first { it.id == id }
                mutable.value =
                    ProviderState(
                        isNew = false,
                        original = item,
                        provider = item.provider,
                        label = item.label,
                        baseURL = item.baseURL.orEmpty(),
                        model = item.model,
                        fastModel = item.fastModel.orEmpty(),
                        capableModel = item.capableModel.orEmpty(),
                        testStatus = item.testStatus,
                        testErrorKind = item.testErrorKind,
                    )
            }
    }

    fun edit(change: (ProviderState) -> ProviderState) {
        if (!state.value.busy && state.value.original?.managed != true)
            mutable.value =
                change(state.value).copy(problem = null, error = false, testStatus = null)
    }

    fun choose(provider: CreateAiProviderRequestProvider) = edit { s ->
        val defaults = providerDefaults.getValue(provider)
        s.copy(provider = provider, model = defaults.first, baseURL = defaults.second, key = "")
    }

    fun save(test: Boolean = false) {
        val s = state.value
        if (s.original?.managed == true || (id != null && s.original == null)) return
        if (!test && s.isNew && s.testStatus != "success") return
        if (!test && !s.dirty) {
            mutable.value = s.copy(finished = true)
            return
        }
        val problem = providerProblem(s)
        if (problem != null) {
            mutable.value = s.copy(problem = problem)
            return
        }
        run {
            val record =
                s.original?.let {
                    ai.updateAiProvider(
                        it.id,
                        UpdateAiProviderRequest(
                            apiKey = s.key.trim().takeIf { it.isNotEmpty() },
                            baseURL = s.baseURL.trim(),
                            label = s.label.trim(),
                            model = s.model.trim(),
                            provider = s.provider,
                            fastModel = s.fastModel.trim(),
                            capableModel = s.capableModel.trim(),
                        ),
                    )
                }
                    ?: ai.createAiProvider(
                        CreateAiProviderRequest(
                            s.key.trim(),
                            s.baseURL.trim().takeIf { it.isNotEmpty() },
                            s.capableModel.trim().takeIf { it.isNotEmpty() },
                            s.fastModel.trim().takeIf { it.isNotEmpty() },
                            s.label.trim(),
                            s.model.trim(),
                            s.provider,
                        )
                    )
            mutable.value = s.copy(original = record, key = "", busy = true)
            if (test) applyTest(ai.testAiProvider(record.id))
            else mutable.update { it.copy(finished = true) }
        }
    }

    fun test() {
        if (state.value.dirty || state.value.original == null) {
            save(test = true)
            return
        }
        run { applyTest(ai.testAiProvider(requireNotNull(state.value.original).id)) }
    }

    private fun applyTest(record: TestAiProviderResponse) {
        mutable.update {
            it.copy(
                original = record,
                testStatus = record.testStatus,
                testErrorKind = record.testErrorKind,
                testCount = it.testCount + 1,
            )
        }
    }

    fun makeDefault() {
        val s = state.value
        if (s.dirty || s.original?.testStatus != "success" || s.original.managed) return
        run {
            val result = ai.setDefaultAiProvider(s.original.id)
            mutable.update { it.copy(original = result) }
        }
    }

    fun delete() {
        if (state.value.original?.managed == true) return
        run {
            state.value.original?.let { ai.deleteAiProvider(it.id) }
            mutable.update { it.copy(finished = true, key = "") }
        }
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
                mutable.update { it.copy(error = true) }
            } finally {
                mutable.update { it.copy(busy = false, loading = false) }
            }
        }
    }
}

internal fun providerProblem(s: ProviderState): String? {
    if (s.label.isBlank()) return "name"
    if (s.baseURL.isNotBlank()) {
        val valid = runCatching {
            java.net.URI(s.baseURL.trim()).let {
                it.scheme in listOf("http", "https") &&
                    !it.host.isNullOrBlank() &&
                    it.rawUserInfo == null
            }
        }
            .getOrDefault(false)
        if (!valid) return "url"
    } else if (
        s.provider in
            listOf(
                CreateAiProviderRequestProvider.Ollama,
                CreateAiProviderRequestProvider.OpenaiCompatible,
            )
    )
        return "url"
    val changedRecipient =
        s.original?.let { it.baseURL.orEmpty() != s.baseURL.trim() || it.provider != s.provider } ==
            true
    if (changedRecipient && s.key.isBlank()) return "recipient"
    if (
        s.key.isBlank() &&
            s.original == null &&
            s.provider != CreateAiProviderRequestProvider.Ollama
    )
        return "key"
    if (s.model.isBlank()) return "model"
    return null
}
