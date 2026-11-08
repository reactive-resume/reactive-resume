package me.rxresu.feature.auth

import android.app.Activity
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import me.rxresu.core.auth.*

internal data class AuthUiState(
    val server: String = "https://rxresu.me",
    val ownServer: Boolean = false,
    val info: ServerInfo? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val name: String = "",
    val username: String = "",
    val email: String = "",
    val password: String = "",
    val code: String = "",
    val sent: Boolean = false,
    val consent: ConsentRequest? = null,
    val consentUsername: String? = null,
)

internal sealed interface AuthEvent {
    data object SignIn : AuthEvent

    data object Register : AuthEvent

    data object Authenticated : AuthEvent

    data object TwoStep : AuthEvent

    data class Consent(val query: String) : AuthEvent

    data class Browser(val uri: Uri) : AuthEvent

    data object SignInExpired : AuthEvent

    data object PasswordReset : AuthEvent

    data class ConsentComplete(val granted: Boolean) : AuthEvent
}

/**
 * One activity-scoped flow, so the checked origin survives sheets and two-step navigation. No
 * credentials persisted.
 */
internal class AuthViewModel(private val auth: AuthService) : ViewModel() {
    private val mutable =
        MutableStateFlow(
            AuthUiState(
                server = auth.origin.value,
                ownServer = auth.origin.value != "https://rxresu.me",
            )
        )
    val state = mutable.asStateFlow()
    private val eventsChannel = Channel<AuthEvent>(Channel.BUFFERED)
    val events = eventsChannel.receiveAsFlow()

    fun edit(change: (AuthUiState) -> AuthUiState) {
        if (!mutable.value.busy)
            mutable.value = change(mutable.value).copy(error = null, sent = false)
    }

    fun checkServer(continueToSignIn: Boolean = false, register: Boolean = false) = run {
        try {
            val info = auth.checkServer(state.value.server)
            mutable.value = state.value.copy(server = info.origin, info = info)
            if (continueToSignIn)
                eventsChannel.send(
                    if (register && !info.signupsDisabled) AuthEvent.Register else AuthEvent.SignIn
                )
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            mutable.value = state.value.copy(error = ERROR_SERVER)
        }
    }

    fun submit(register: Boolean) = run {
        val s = state.value
        result(
            if (register)
                auth.register(
                    s.server,
                    s.name.trim(),
                    s.username.trim(),
                    s.email.trim(),
                    s.password,
                )
            else auth.signInWithPassword(s.server, s.email.trim(), s.password)
        )
    }

    fun verify(backup: Boolean) = run {
        val code = state.value.code
        if (if (backup) code.isBlank() else !code.matches(Regex("[0-9]{6}"))) return@run
        val response = auth.verifyTwoStep(code.trim(), backup)
        if (response is AuthResult.Error) mutable.value = state.value.copy(code = "")
        result(response)
    }

    fun provider(activity: Activity, provider: String?) = run {
        result(
            if (provider == null) auth.passkey(activity, state.value.server)
            else auth.signInWithProvider(activity, state.value.server, provider)
        )
    }

    fun forgot() = run {
        when (val r = auth.forgotPassword(state.value.server, state.value.email.trim())) {
            AuthResult.Success -> mutable.value = state.value.copy(sent = true)
            else -> result(r)
        }
    }

    fun reset(token: String) = run {
        when (val r = auth.resetPassword(state.value.server, token, state.value.password)) {
            AuthResult.Success -> {
                clearSecrets()
                eventsChannel.send(AuthEvent.PasswordReset)
            }
            else -> result(r)
        }
    }

    fun loadConsent(query: String) = run {
        if (state.value.consent?.query != query) {
            mutable.value = state.value.copy(consent = null)
            val r =
                auth.loadConsent(
                    Uri.parse("${state.value.server}/auth/consent?${query.removePrefix("?")}")
                )
            if (r is AuthResult.ConsentRequired)
                mutable.value = state.value.copy(consent = r.request)
            else result(r)
        }
    }

    fun consent(accept: Boolean) = run {
        state.value.consent?.let {
            val response = auth.consent(it, accept)
            if (
                response == AuthResult.Success ||
                    (!accept && response is AuthResult.Error && response.kind == "access_denied")
            ) {
                clearSecrets()
                eventsChannel.send(
                    AuthEvent.ConsentComplete(accept && response == AuthResult.Success)
                )
            } else result(response)
        }
    }

    private var operation: Job? = null

    fun cancel() {
        operation?.cancel()
        viewModelScope.launch {
            var failure: String? = null
            try {
                auth.cancelSignIn()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                failure = ERROR_NETWORK
            } finally {
                clearSecrets()
                mutable.value =
                    state.value.copy(
                        consent = null,
                        error = failure,
                        email = "",
                        name = "",
                        username = "",
                        sent = false,
                    )
            }
        }
    }

    private fun clearSecrets() {
        mutable.value = state.value.copy(password = "", code = "")
    }

    private suspend fun result(result: AuthResult) {
        when (result) {
            AuthResult.Success -> {
                clearSecrets()
                eventsChannel.send(AuthEvent.Authenticated)
            }
            AuthResult.TwoStepRequired -> {
                clearSecrets()
                eventsChannel.send(AuthEvent.TwoStep)
            }
            is AuthResult.ConsentRequired -> {
                clearSecrets()
                mutable.value = state.value.copy(consent = result.request)
                eventsChannel.send(AuthEvent.Consent(result.request.query))
            }
            is AuthResult.BrowserRequired -> eventsChannel.send(AuthEvent.Browser(result.uri))
            is AuthResult.Error -> {
                mutable.value = state.value.copy(error = result.message)
                if (result.kind == "INVALID_TWO_FACTOR_COOKIE") {
                    auth.cancelSignIn()
                    clearSecrets()
                    eventsChannel.send(AuthEvent.SignInExpired)
                }
            }
        }
    }

    private fun run(block: suspend () -> Unit) {
        if (state.value.busy) return
        mutable.value = state.value.copy(busy = true, error = null)
        operation =
            viewModelScope.launch {
                try {
                    block()
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    mutable.value = state.value.copy(error = ERROR_NETWORK)
                } finally {
                    mutable.value = state.value.copy(busy = false)
                }
            }
    }

    companion object {
        const val ERROR_SERVER = "Couldn't reach that server. Check the address and try again."
        const val ERROR_NETWORK = "Couldn't sign in. Try again."
    }
}
