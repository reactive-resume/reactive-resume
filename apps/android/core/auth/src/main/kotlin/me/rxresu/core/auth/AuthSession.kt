// The session contract the rest of the app reads. :core:auth owns the implementation.
package me.rxresu.core.auth

import kotlinx.coroutines.flow.StateFlow
import me.rxresu.core.network.ServerOrigin
import me.rxresu.core.network.SessionTokens

sealed interface SessionState {
    data object Loading : SessionState
    data object SignedOut : SessionState
    /** `accountScope` changes whenever the account behind the tokens changes; account-scoped caches key on it. */
    data class SignedIn(val server: String, val accountScope: String) : SessionState
    /** The refresh token was rejected. Drafts stay; the person signs in again. */
    data class Expired(val server: String, val accountScope: String) : SessionState
}

interface AuthSession : SessionTokens, ServerOrigin {
    val state: StateFlow<SessionState>
    suspend fun signOut()
}
