package me.rxresu.core.auth

import android.content.res.Resources
import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import java.util.Base64
import kotlinx.serialization.json.*
import net.openid.appauth.CodeVerifierUtil
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

internal const val SCOPES = "openid profile email offline_access api:read api:write api:delete"
internal val json = Json { ignoreUnknownKeys = true }
internal fun JsonObject.text(key: String) = (get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content
internal fun JsonObject.flag(key: String) = (get(key) as? JsonPrimitive)?.booleanOrNull == true

/** Why the selected server cannot be used. Resolve [messageRes] for localized, safe display copy. */
class ServerError(val reason: Reason) : Exception(reason.name) {
    val messageRes: Int get() = when (reason) {
        Reason.Unreachable -> R.string.auth_server_unreachable
        Reason.Outdated -> R.string.auth_server_outdated
        Reason.Mismatch -> R.string.auth_server_mismatch
    }
    enum class Reason { Unreachable, Outdated, Mismatch }
}

/** Normalize an entered address to its origin, discarding paths; null for malformed addresses. */
fun toOrigin(input: String): String? {
    val value = input.trim()
    if (value.isEmpty() || value.any { it.isWhitespace() || it.isISOControl() } || '\\' in value) return null
    val url = (if (Regex("^[a-z][a-z0-9+.-]*://", RegexOption.IGNORE_CASE).containsMatchIn(value)) value else "https://$value")
        .toHttpUrlOrNull() ?: return null
    if ('.' !in url.host && url.host != "localhost") return null
    return url.newBuilder().username("").password("").encodedPath("/").query(null).fragment(null).build().toString().removeSuffix("/")
}

/** Production requires HTTPS; debug additionally permits the three local development hosts over HTTP. */
fun isAllowedServer(origin: String, debug: Boolean = false): Boolean {
    if (toOrigin(origin) != origin) return false
    val url = origin.toHttpUrlOrNull() ?: return false
    return url.isHttps || (debug && url.scheme == "http" && url.host in setOf("localhost", "127.0.0.1", "10.0.2.2"))
}

internal fun redirectUri(origin: String, debug: Boolean) =
    if (debug && origin.startsWith("http:")) "me.rxresu:/auth/native-callback" else "https://rxresu.me/auth/native-callback"

internal data class Discovery(
    val issuer: String, val authorize: String, val token: String, val register: String,
    val revoke: String?, val requireIss: Boolean,
)

internal fun parseDiscovery(origin: String, body: JsonObject): Discovery {
    val authorize = body.text("authorization_endpoint")?.takeIf { it.isNotBlank() } ?: throw ServerError(ServerError.Reason.Unreachable)
    val token = body.text("token_endpoint")?.takeIf { it.isNotBlank() } ?: throw ServerError(ServerError.Reason.Unreachable)
    val register = body.text("registration_endpoint")?.takeIf { it.isNotBlank() } ?: throw ServerError(ServerError.Reason.Outdated)
    if ((body["scopes_supported"] as? JsonArray)?.any { (it as? JsonPrimitive)?.contentOrNull == "offline_access" } != true)
        throw ServerError(ServerError.Reason.Outdated)
    val issuer = body.text("issuer") ?: throw ServerError(ServerError.Reason.Mismatch)
    val revoke = body.text("revocation_endpoint")
    if (listOfNotNull(issuer, authorize, token, register, revoke).any {
            val u = it.toHttpUrlOrNull()
            u == null || toOrigin(it) != origin || u.username.isNotEmpty() || u.password.isNotEmpty() || u.fragment != null
        }) throw ServerError(ServerError.Reason.Mismatch)
    return Discovery(issuer, authorize, token, register, revoke, body.flag("authorization_response_iss_parameter_supported"))
}

/** Parse an OAuth code response. Repeated and fragment protocol parameters are always rejected. */
fun parseAuthorizationResponse(value: String): Map<String, String> {
    val uri = try { URI(value) } catch (_: Exception) { throw AuthFailure("invalid_grant") }
    val protocol = setOf("code", "state", "iss", "error", "error_description", "error_uri")
    fun pairs(part: String?): List<Pair<String, String>> = part.orEmpty().split('&').filter { it.isNotEmpty() }.map {
        val pair = it.split('=', limit = 2)
        try {
            URLDecoder.decode(pair[0], "UTF-8") to URLDecoder.decode(pair.getOrElse(1) { "" }, "UTF-8")
        } catch (_: Exception) { throw AuthFailure("invalid_grant") }
    }
    if (pairs(uri.rawFragment).any { it.first in protocol }) throw AuthFailure("invalid_grant")
    val result = mutableMapOf<String, String>()
    pairs(uri.rawQuery).forEach { (key, item) ->
        if (key in protocol && result.containsKey(key)) throw AuthFailure("invalid_grant")
        result[key] = item
    }
    return result
}

internal fun challenge(verifier: String) = CodeVerifierUtil.deriveCodeVerifierChallenge(verifier)
internal fun fingerprint(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
internal fun subject(token: String): String = try {
    json.parseToJsonElement(String(Base64.getUrlDecoder().decode(token.split('.')[1]))).jsonObject.text("sub")
        ?.takeIf { it.isNotBlank() } ?: throw AuthFailure("invalid_grant")
} catch (_: Exception) { throw AuthFailure("invalid_grant") }

internal class AuthFailure(val code: String, val status: Int = 0) : Exception(code)

/** Safe, fixed error copy matching web authentication screens. */
fun authError(code: String, status: Int = 0, resources: Resources): AuthResult.Error {
    val message = if (status == 429) R.string.auth_error_rate_limit else when (code) {
        "INVALID_EMAIL_OR_PASSWORD", "INVALID_USERNAME_OR_PASSWORD" -> R.string.auth_error_credentials
        "INVALID_TWO_FACTOR_COOKIE" -> R.string.auth_error_two_step_expired
        "INVALID_TOKEN" -> R.string.auth_error_reset_expired
        "INVALID_OTP", "INVALID_BACKUP_CODE" -> R.string.auth_error_invalid_code
        "access_denied" -> R.string.auth_error_canceled
        "invalid_grant", "state_mismatch", "no_code", "state_not_found", "invalid_callback_request" -> R.string.auth_error_attempt_expired
        "issuer_missing", "issuer_mismatch", "nonce_binding_missing" -> R.string.auth_error_provider_unverified
        "invalid_code" -> R.string.auth_error_provider_rejected
        "oauth_provider_not_found" -> R.string.auth_error_provider_unavailable
        "unable_to_get_user_info" -> R.string.auth_error_provider_profile
        "email_not_found" -> R.string.auth_error_provider_email_missing
        "email_not_verified" -> R.string.auth_error_provider_email_unverified
        "email_does_not_match" -> R.string.auth_error_provider_email_mismatch
        "account_already_linked_to_different_user" -> R.string.auth_error_provider_linked
        "unable_to_link_account" -> R.string.auth_error_provider_link_failed
        "signup_disabled" -> R.string.auth_error_signups_disabled
        "invalid_consent" -> R.string.auth_error_consent_invalid
        "invalid_client", "client_disabled", "unauthorized_client", "invalid_redirect", "unsupported_response_type" -> R.string.auth_error_invalid_client
        else -> R.string.auth_error_unknown
    }
    return AuthResult.Error(code, resources.getString(message))
}
