package me.rxresu.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.network.generated.*

internal data class DeveloperState(
    val section: String = "",
    val loading: Boolean = true,
    val busy: Boolean = false,
    val error: Boolean = false,
    val web: GetWebAccessStatusResponse? = null,
    val provider: SaveWebAccessKeyRequestProvider = SaveWebAccessKeyRequestProvider.Firecrawl,
    val key: String = "",
    val test: CreateWebAccessTestResponse? = null,
    val memory: SaveCareerProfileRequestMemoryMode? = null,
    val usage: GetWeeklyAiUsageResponse? = null,
    val keys: List<ListApiKeysResponseApiKeysItem> = emptyList(),
    val applications: List<ListConnectedApplicationsResponseConnectionsItem> = emptyList(),
)

internal class DeveloperViewModel(private val repositories: RrRepositories) : ViewModel() {
    private val mutable = MutableStateFlow(DeveloperState())
    val state = mutable.asStateFlow()
    private var operation: Job? = null
    private var generation = 0

    fun load(section: String) {
        operation?.cancel()
        generation++
        mutable.value = DeveloperState(section = section)
        run {
            when (section) {
                "web" -> {
                    val status = repositories.ai.getWebAccessStatus()
                    mutable.update {
                        it.copy(
                            web = status,
                            provider = status.provider ?: SaveWebAccessKeyRequestProvider.Firecrawl,
                            test = status.testResult,
                        )
                    }
                }
                "memory" -> {
                    val profile = repositories.career.getCareerProfile()
                    mutable.update { it.copy(memory = profile.memoryMode) }
                }
                "usage" -> {
                    val usage = repositories.ai.getWeeklyAiUsage(true)
                    mutable.update { it.copy(usage = usage) }
                }
                "keys" -> {
                    val keys = repositories.account.listApiKeys().apiKeys
                    mutable.update { it.copy(keys = keys) }
                }
                "applications" -> {
                    val applications = repositories.account.listConnectedApplications().connections
                    mutable.update { it.copy(applications = applications) }
                }
            }
        }
    }

    fun key(value: String) {
        if (!state.value.busy) mutable.update { it.copy(key = value, test = null) }
    }

    fun provider(value: SaveWebAccessKeyRequestProvider) {
        if (!state.value.busy) mutable.update { it.copy(provider = value, key = "", test = null) }
    }

    fun saveWeb() {
        val s = state.value
        if (s.web?.canSave != true || s.web.managed || s.key.isBlank()) return
        run {
            repositories.ai.saveWebAccessKey(SaveWebAccessKeyRequest(s.key.trim(), s.provider))
            val web = repositories.ai.getWebAccessStatus()
            mutable.update { it.copy(web = web, key = "", test = null) }
        }
    }

    fun testWeb() = run {
        val result = repositories.ai.testWebAccessConnection()
        mutable.update { it.copy(test = result) }
    }

    fun removeWeb() {
        if (state.value.web?.managed != false || state.value.web?.canSave != true) return
        run {
            repositories.ai.deleteWebAccessKey()
            val web = repositories.ai.getWebAccessStatus()
            mutable.update { it.copy(web = web, key = "", test = null) }
        }
    }

    fun memory(mode: SaveCareerProfileRequestMemoryMode) = run {
        val profile =
            repositories.career.saveCareerProfile(SaveCareerProfileRequest(memoryMode = mode))
        mutable.update { it.copy(memory = profile.memoryMode) }
    }

    fun disconnect(id: String) = run {
        repositories.account.deleteConnectedApplication(id)
        val applications = repositories.account.listConnectedApplications().connections
        mutable.update { it.copy(applications = applications) }
    }

    private fun run(action: suspend () -> Unit) {
        if (state.value.busy) return
        mutable.update { it.copy(busy = true, error = false) }
        val epoch = generation
        operation = viewModelScope.launch {
            try {
                action()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                if (epoch == generation) mutable.update { it.copy(error = true) }
            } finally {
                if (epoch == generation) mutable.update { it.copy(busy = false, loading = false) }
            }
        }
    }
}
