package me.rxresu.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import me.rxresu.core.auth.*
import me.rxresu.core.data.*
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.UploadPart
import me.rxresu.core.network.generated.*

internal data class SettingsState(
    val account: AccountProfile? = null,
    val preferences: AppPreferences = AppPreferences(),
    val providers: List<TestAiProviderResponse> = emptyList(),
    val loading: Boolean = true,
    val providersLoading: Boolean = true,
    val providerError: Boolean = false,
    val offline: Boolean = false,
    val error: Boolean = false,
    val busy: Boolean = false,
    val security: AccountSecurityInfo? = null,
    val serverVersion: String? = null,
)

internal class SettingsViewModel(
    private val repositories: RrRepositories,
    private val auth: AuthService,
) : ViewModel() {
    private val mutable =
        MutableStateFlow(SettingsState(security = repositories.account.securityInfo()))
    val state = mutable.asStateFlow()
    private val exportsChannel = Channel<JsonObject>(Channel.BUFFERED)
    val exports = exportsChannel.receiveAsFlow()
    private val saved = MutableSharedFlow<Unit>()
    val accountSaved = saved.asSharedFlow()

    fun exportAccount() = mutate {
        val session = auth.state.value
        if (session !is SessionState.SignedIn) return@mutate
        val accountId = state.value.account?.id ?: return@mutate
        val data = repositories.account.exportAccountData(JsonPrimitive(true))
        if (auth.state.value != session || data.user.id != accountId) return@mutate
        exportsChannel.send(
            ApiJson.encodeToJsonElement(ExportAccountDataResponse.serializer(), data).jsonObject
        )
    }

    fun removePhoto() = mutate {
        repositories.account.updateProfile(
            UpdateProfileRequest(),
            RequestOptions(nullFields = setOf("/image")),
        )
        val profile = repositories.account.getProfile()
        mutable.update { it.copy(account = profile) }
        saved.emit(Unit)
    }

    fun uploadPhoto(bytes: ByteArray, contentType: String) = mutate {
        require(
            bytes.size <= PHOTO_MAX_BYTES &&
                contentType in setOf("image/jpeg", "image/png", "image/webp", "image/gif")
        )
        val file = repositories.account.createFile(UploadPart("file", bytes, "photo", contentType))
        repositories.account.updateProfile(UpdateProfileRequest(image = file.url))
        val profile = repositories.account.getProfile()
        mutable.update { it.copy(account = profile) }
        saved.emit(Unit)
    }

    init {
        viewModelScope.launch {
            repositories.preferences.values.collect { p ->
                mutable.update { it.copy(preferences = p) }
            }
        }
        viewModelScope.launch {
            repositories.account.observeProfile().collect { r ->
                mutable.update {
                    it.copy(
                        account = r.data,
                        loading = r.loading,
                        offline = r.offline,
                        error = r.error != null,
                    )
                }
            }
        }
        viewModelScope.launch {
            try {
                val info = auth.checkServer(auth.origin.value)
                mutable.update { it.copy(serverVersion = info.version) }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                /* Version stays unknown, never a placeholder. */
            }
        }
    }

    fun reloadProviders() {
        viewModelScope.launch {
            mutable.update { it.copy(providersLoading = true, providerError = false) }
            try {
                val providers = repositories.ai.listAiProviders()
                mutable.update { it.copy(providers = providers) }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                mutable.update { it.copy(providerError = true) }
            } finally {
                mutable.update { it.copy(providersLoading = false) }
            }
        }
    }

    fun preference(action: suspend PreferencesRepository.() -> Unit) = mutate {
        repositories.preferences.action()
    }

    fun updateAccount(request: UpdateProfileRequest) = mutate {
        repositories.account.updateProfile(request)
        repositories.account.getProfile().also { profile ->
            mutable.update { it.copy(account = profile) }
            saved.emit(Unit)
        }
    }

    fun signOut(report: suspend (partial: Boolean) -> Unit) {
        if (state.value.busy) return
        mutable.update { it.copy(busy = true) }
        viewModelScope.launch {
            // Session routing removes this ViewModel as soon as credentials retire. Finish cleanup
            // and its toast.
            withContext(NonCancellable) {
                try {
                    repositories.account.signOut()
                } catch (_: Exception) {
                    report(auth.state.value == SessionState.SignedOut)
                } finally {
                    mutable.update { it.copy(busy = false) }
                }
            }
        }
    }

    private fun mutate(action: suspend () -> Unit) {
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
                mutable.update { it.copy(busy = false) }
            }
        }
    }
}

internal const val PHOTO_MAX_BYTES = 10 * 1024 * 1024
