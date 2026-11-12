package me.rxresu.core.auth

import android.app.Activity
import android.content.Context
import android.net.Uri
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Network-free auth for previews. Configure [nextResult] for error, two-step and consent screen fixtures. */
class FakeAuthService(private val context: Context) : AuthService {
    private val mutableState = MutableStateFlow<SessionState>(SessionState.SignedOut)
    private val mutableOrigin = MutableStateFlow("https://rxresu.me")
    override val state: StateFlow<SessionState> = mutableState
    override val origin: StateFlow<String> = mutableOrigin
    var nextResult: AuthResult = AuthResult.Success
    override suspend fun restore() = Unit
    override suspend fun checkServer(input: String): ServerInfo = ServerInfo(toOrigin(input) ?: "https://rxresu.me", "6.1.0", true, true,
        linkedMapOf("apple" to "Apple", "google" to "Google", "github" to "GitHub", "linkedin" to "LinkedIn"), false, false)
    override suspend fun signInWithPassword(server: String, identifier: String, password: String) = finish(server)
    override suspend fun verifyTwoStep(code: String, backup: Boolean) = finish(origin.value)
    override suspend fun register(server: String, name: String, username: String, email: String, password: String) = finish(server)
    override suspend fun forgotPassword(server: String, email: String) = nextResult
    override suspend fun resetPassword(server: String, token: String, newPassword: String) = nextResult
    override suspend fun signInWithProvider(activity: Activity, server: String, provider: String) = finish(server)
    override suspend fun passkey(activity: Activity, server: String) = finish(server)
    override fun openBrowser(activity: Activity, uri: Uri) = Unit
    override suspend fun handleRedirect(uri: Uri) = finish(origin.value)
    override suspend fun loadConsent(uri: Uri) = nextResult
    override suspend fun consent(request: ConsentRequest, accept: Boolean) = if (accept) finish(request.server) else authError("access_denied", resources = context.resources)
    override suspend fun cancelSignIn() = Unit
    override suspend fun expire(rejected: String) = Unit
    override suspend fun accessToken(): String? = null
    override suspend fun refresh(rejected: String): String? = null
    override suspend fun signOut() { mutableState.value = SessionState.SignedOut }
    private fun finish(server: String): AuthResult {
        if (nextResult == AuthResult.Success) {
            mutableOrigin.value = server
            mutableState.value = SessionState.SignedIn(server, "preview:${UUID.randomUUID()}")
        }
        return nextResult
    }
}
