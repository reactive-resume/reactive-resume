package me.rxresu.core.auth

import android.app.Activity
import android.net.Uri

/** Capabilities reported by /api/health, /api/openapi/flags and /api/openapi/auth/providers. */
data class ServerInfo(
    val origin: String, val version: String, val password: Boolean, val passkey: Boolean,
    val providers: Map<String, String>, val signupsDisabled: Boolean, val guest: Boolean,
)

/** Validated signed request; names are self-reported. UI must display client ID and redirect destination too. */
data class ConsentRequest(
    val server: String, val query: String, val clientId: String, val clientName: String,
    val scopes: List<String>, val redirectUri: String, val canGrantNatively: Boolean,
)

sealed interface AuthResult {
    data object Success : AuthResult
    data object TwoStepRequired : AuthResult
    data class ConsentRequired(val request: ConsentRequest) : AuthResult
    /** Launch this URL with [AuthService.openBrowser]; no cookie or bearer token is passed to the browser. */
    data class BrowserRequired(val uri: Uri) : AuthResult
    data class Error(val kind: String, val message: String) : AuthResult
}

/** Native forms share one short-lived cookie jar; API calls use only OAuth bearer tokens. */
interface AuthService : AuthSession {
    /** Restore encrypted session before routing; idempotent and serialized with session mutations. */
    suspend fun restore()
    /** Check origin policy, service health, OAuth discovery and enabled sign-in methods. Throws [ServerError]. */
    suspend fun checkServer(input: String): ServerInfo
    /** Start a new isolated native sign-in; username and email use different Better Auth endpoints. */
    suspend fun signInWithPassword(server: String, identifier: String, password: String): AuthResult
    /** Finish current native challenge. Backup codes also try uppercase, matching web semantics. */
    suspend fun verifyTwoStep(code: String, backup: Boolean = false): AuthResult
    /** Create an account using Better Auth, then continue PKCE authorization and explicit consent. */
    suspend fun register(server: String, name: String, username: String, email: String, password: String): AuthResult
    /** Request email reset link. Server web reset route remains the fallback when App Links are unavailable. */
    suspend fun forgotPassword(server: String, email: String): AuthResult
    /** Consume a reset token; success requires a fresh sign-in, as on web. */
    suspend fun resetPassword(server: String, token: String, newPassword: String): AuthResult
    /** Open OAuth authorization in Custom Tabs. Current web login offers provider choice, no provider hint. */
    suspend fun signInWithProvider(activity: Activity, server: String, provider: String): AuthResult
    /** Open web passkey sign-in in Custom Tabs, keeping credentials bound to the server's RP origin. */
    suspend fun passkey(activity: Activity, server: String): AuthResult
    /** Launch a validated browser continuation. Call on the main thread. */
    fun openBrowser(activity: Activity, uri: Uri)
    /** Strictly validate callback against pending redirect/state/issuer, then exchange code exactly once. */
    suspend fun handleRedirect(uri: Uri): AuthResult
    /** Load a signed consent App Link on current server. Bearer alone cannot grant cookie-authenticated consent. */
    suspend fun loadConsent(uri: Uri): AuthResult
    /** Explicit Allow/Deny only. Browser-required requests must be completed on web with browser's own session. */
    suspend fun consent(request: ConsentRequest, accept: Boolean): AuthResult
    /** Cancel pending sign-in, clear verifier and in-memory cookies, leaving current account unchanged. */
    suspend fun cancelSignIn()
}
