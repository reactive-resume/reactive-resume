// Seams between :core:network and :core:auth. :core:auth implements both; :core:network only reads them.
package me.rxresu.core.network

import kotlinx.coroutines.flow.StateFlow

/** The server the app talks to, as an origin such as `https://rxresu.me` (no trailing slash). */
interface ServerOrigin {
    val origin: StateFlow<String>
}

/** Bearer tokens for API calls. */
interface SessionTokens {
    /** The current access token, or null when signed out. */
    suspend fun accessToken(): String?

    /**
     * Called once after a 401 that is about the token (not `NEED_PASSWORD` and the like). Single-flight: concurrent
     * callers share one refresh. Returns the new access token, or null when the session expired.
     */
    suspend fun refresh(rejected: String): String?
}
