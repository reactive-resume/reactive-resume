package me.rxresu.core.auth

import android.app.Activity
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.res.Resources
import android.net.Uri
import android.net.ConnectivityManager
import androidx.browser.customtabs.CustomTabsIntent
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import net.openid.appauth.CodeVerifierUtil
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.FormBody
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

@Serializable
internal class Tokens(val access: String, val refresh: String? = null, val expiresAt: Long) {
    override fun toString() = "Tokens(redacted)"
}

@Serializable
internal class SavedSession(val server: String, val scope: String, val tokens: Tokens? = null)

@Serializable
internal class Pending(
    val server: String, val client: String, val verifier: String, val state: String,
    val redirect: String, val issuer: String, val requireIss: Boolean, val started: Long,
) {
    override fun toString() = "Pending(redacted)"
}

internal class MemoryCookies : CookieJar {
    private val values = mutableListOf<Cookie>()
    @Synchronized override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        cookies.forEach { next ->
            values.removeAll { it.name == next.name && it.domain == next.domain && it.path == next.path }
            values.add(next)
        }
    }
    @Synchronized override fun loadForRequest(url: HttpUrl): List<Cookie> {
        values.removeAll { it.expiresAt <= System.currentTimeMillis() }
        return values.filter { it.matches(url) }
    }
    @Synchronized fun clear() = values.clear()
}

/**
 * Own one instance in AppGraph. Call restore at startup; route all callback intents to handleRedirect.
 * Transport settings are reused; interceptors and HTTP disk cache are removed to keep credentials private.
 * No generated API client or browser cookie is involved in native forms.
 * Expiry never deletes drafts; sign-out cleanup belongs to the account-scoped data owner observing state.
 */
class ServerAuthService internal constructor(
    private val storage: AuthStorage,
    client: OkHttpClient,
    private val debug: Boolean,
    private val now: () -> Long = { System.currentTimeMillis() / 1000 },
    private val resources: Resources,
    private val offline: () -> Boolean = { false },
) : AuthService {
    /** Production constructor; debug HTTP permission is derived from the installed application's debuggable flag. */
    constructor(context: Context, client: OkHttpClient = OkHttpClient()) : this(
        EncryptedAuthStorage(context), client, context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0,
        resources = context.resources,
        offline = { context.getSystemService(ConnectivityManager::class.java)?.activeNetwork == null },
    )

    private val cookies = MemoryCookies()
    private val http = client.newBuilder().apply { interceptors().clear(); networkInterceptors().clear() }
        .cache(null).cookieJar(cookies).followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false)
        // Retries are off (an OAuth request must never replay), so never reuse a connection the server may have
        // closed: Node drops idle keep-alive connections after 5 s.
        .connectionPool(okhttp3.ConnectionPool(4, 2, TimeUnit.SECONDS)).authenticator(okhttp3.Authenticator.NONE).callTimeout(20, TimeUnit.SECONDS).build()
    /** Token and revoke calls: OAuth endpoints never see the sign-in form's session cookies. */
    private val tokenHttp by lazy { http.newBuilder().cookieJar(okhttp3.CookieJar.NO_COOKIES).build() }
    private val transition = Mutex()
    private val forms = Mutex()
    private val generation = AtomicLong()
    private val discoveries = mutableMapOf<String, Discovery>()
    private val mutableState = MutableStateFlow<SessionState>(SessionState.Loading)
    private val mutableOrigin = MutableStateFlow("https://rxresu.me")
    override val state: StateFlow<SessionState> = mutableState
    override val origin: StateFlow<String> = mutableOrigin
    private var restored = false
    private var session: SavedSession? = null
    private var pending: Pending? = null
    private var nativeQuery: String? = null
    private val issuedAccess = linkedSetOf<String>()

    override suspend fun restore() = transition.withLock { restoreLocked() }

    private suspend fun restoreLocked() {
        if (restored) return
        try {
            storage.read("server")?.takeIf { isAllowedServer(it, debug) }?.let { mutableOrigin.value = it }
            val saved = storage.read("session")?.let { json.decodeFromString<SavedSession>(it) }
            if (saved != null && isAllowedServer(saved.server, debug)) {
                mutableOrigin.value = saved.server
                session = saved
                if (saved.tokens == null || storage.read("refreshing.${saved.server}") != null) expireLocked()
                else {
                    rememberAccess(saved.tokens.access)
                    mutableState.value = SessionState.SignedIn(saved.server, saved.scope)
                }
            } else mutableState.value = SessionState.SignedOut
            pending = storage.read("pending")?.let { json.decodeFromString<Pending>(it) }
                ?.takeIf { isAllowedServer(it.server, debug) && it.started + 600 > now() }
        } catch (error: CancellationException) { throw error
        } catch (_: Exception) {
            session = null
            mutableState.value = SessionState.SignedOut
        }
        restored = true
    }

    override suspend fun checkServer(input: String): ServerInfo = withContext(Dispatchers.IO) {
        val server = toOrigin(input)?.takeIf { isAllowedServer(it, debug) }
            ?: throw ServerError(ServerError.Reason.Unreachable)
        try {
            val health = get("$server/api/health")
            if (health.text("service") != "reactive-resume") throw ServerError(ServerError.Reason.Unreachable)
            discover(server)
            val flags = get("$server/api/openapi/flags")
            val providers = get("$server/api/openapi/auth/providers").mapValues { (_, value) -> value.jsonPrimitive.content }
            ServerInfo(server, health.text("version").orEmpty(), "credential" in providers && !flags.flag("disableEmailAuth"),
                "passkey" in providers, providers.filterKeys { it !in setOf("credential", "passkey") },
                flags.flag("disableSignups"), flags.flag("allowGuestLogin"))
        } catch (error: ServerError) { throw error
        } catch (error: CancellationException) { throw error
        } catch (_: Exception) { throw ServerError(ServerError.Reason.Unreachable) }
    }

    private suspend fun discover(server: String): Discovery {
        synchronized(discoveries) { discoveries[server] }?.let { return it }
        val metadata = try { get("$server/.well-known/oauth-authorization-server") } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            val old = try { get("$server/api/openapi/flags"); true } catch (error: CancellationException) { throw error } catch (_: Exception) { false }
            throw ServerError(if (old) ServerError.Reason.Outdated else ServerError.Reason.Unreachable)
        }
        return parseDiscovery(server, metadata).also { synchronized(discoveries) { discoveries[server] = it } }
    }

    private suspend fun begin(serverInput: String, browser: Boolean): String {
        restore()
        val server = toOrigin(serverInput)?.takeIf { isAllowedServer(it, debug) } ?: throw ServerError(ServerError.Reason.Unreachable)
        val epoch = generation.incrementAndGet()
        cookies.clear()
        nativeQuery = null
        val d = discover(server)
        val key = "client.$server"
        val clientId = storage.read(key) ?: post(d.register, buildJsonObject {
            put("client_name", "Reactive Resume for Android")
            put("redirect_uris", JsonArray(listOf(JsonPrimitive(redirectUri(server, debug)))))
            put("token_endpoint_auth_method", "none")
            put("grant_types", JsonArray(listOf(JsonPrimitive("authorization_code"), JsonPrimitive("refresh_token"))))
            put("response_types", JsonArray(listOf(JsonPrimitive("code"))))
            put("application_type", "native")
            put("scope", SCOPES)
        }).text("client_id")?.takeIf { it.isNotBlank() }?.also { storage.write(key, it) } ?: throw AuthFailure("invalid_client")
        val p = Pending(server, clientId, CodeVerifierUtil.generateRandomCodeVerifier(), UUID.randomUUID().toString(),
            redirectUri(server, debug), d.issuer, d.requireIss, now())
        transition.withLock {
            if (epoch != generation.get()) throw AuthFailure("access_denied")
            pending = p
            storage.write("pending", if (browser) json.encodeToString(p) else null)
        }
        return d.authorize.toHttpUrl().newBuilder()
            .addQueryParameter("client_id", p.client).addQueryParameter("redirect_uri", p.redirect)
            .addQueryParameter("response_type", "code").addQueryParameter("scope", SCOPES)
            .addQueryParameter("resource", server).addQueryParameter("state", p.state)
            .addQueryParameter("code_challenge", challenge(p.verifier)).addQueryParameter("code_challenge_method", "S256")
            .addQueryParameter("ui_locales", java.util.Locale.getDefault().toLanguageTag()).build().toString()
    }

    override suspend fun signInWithPassword(server: String, identifier: String, password: String): AuthResult = forms.withLock { result {
        val initial = startNative(server)
        if (initial !is AuthResult.Error || nativeQuery == null) return@result initial
        val value = identifier.trim().lowercase(java.util.Locale.ROOT)
        val email = '@' in value
        val response = post("${pending!!.server}/api/auth/sign-in/${if (email) "email" else "username"}", buildJsonObject {
            put(if (email) "email" else "username", value); put("password", password); put("oauth_query", nativeQuery)
        })
        afterForm(response)
    } }

    override suspend fun register(server: String, name: String, username: String, email: String, password: String): AuthResult = forms.withLock { result {
        val initial = startNative(server)
        if (initial !is AuthResult.Error || nativeQuery == null) return@result initial
        val created = post("${pending!!.server}/api/auth/sign-up/email", buildJsonObject {
            put("name", name); put("username", username); put("email", email.trim().lowercase(java.util.Locale.ROOT))
            put("password", password); put("oauth_query", nativeQuery)
        })
        // As on the web: a new account without a redirect continues the authorization it was created for.
        if (created.text("url") != null || created.flag("twoFactorRedirect")) afterForm(created)
        else afterForm(post("${pending!!.server}/api/auth/oauth2/continue", buildJsonObject { put("created", true); put("oauth_query", nativeQuery) }))
    } }

    override suspend fun verifyTwoStep(code: String, backup: Boolean): AuthResult = forms.withLock { result {
        val p = pending ?: throw AuthFailure("INVALID_TWO_FACTOR_COOKIE")
        suspend fun verify(value: String) = post("${p.server}/api/auth/two-factor/${if (backup) "verify-backup-code" else "verify-totp"}", buildJsonObject {
            put("code", value); put("trustDevice", false); nativeQuery?.let { put("oauth_query", it) }
        })
        val response = try { verify(code.trim()) } catch (error: AuthFailure) {
            if (!backup || error.code != "INVALID_BACKUP_CODE" || code == code.uppercase(java.util.Locale.ROOT)) throw error
            verify(code.trim().uppercase(java.util.Locale.ROOT))
        }
        afterForm(response)
    } }

    /**
     * Starts the in-process authorize request. A cached client the server no longer knows (database reset, self-hosted
     * reinstall) answers `invalid_client`: forget it, register again and retry once.
     */
    private suspend fun startNative(server: String): AuthResult = try {
        follow(begin(server, false))
    } catch (error: AuthFailure) {
        if (error.code != "invalid_client") throw error
        toOrigin(server)?.let { storage.write("client.$it", null) }
        follow(begin(server, false))
    }

    private suspend fun afterForm(response: JsonObject): AuthResult {
        if (response.flag("twoFactorRedirect")) return AuthResult.TwoStepRequired
        val p = pending ?: throw AuthFailure("invalid_grant")
        return follow(response.text("url") ?: "${p.server}/api/auth/oauth?${nativeQuery ?: throw AuthFailure("invalid_grant")}")
    }

    /** Follow only the chosen origin; capture callback without ever requesting rxresu.me with its code. */
    private suspend fun follow(start: String): AuthResult {
        val p = pending ?: throw AuthFailure("invalid_grant")
        var next = start
        repeat(12) {
            if (next.substringBefore('?').substringBefore('#') == p.redirect) return exchange(Uri.parse(next), p)
            val url = p.server.toHttpUrl().resolve(next) ?: throw AuthFailure("invalid_redirect")
            if (toOrigin(url.toString()) != p.server) throw AuthFailure("issuer_mismatch")
            if (url.encodedPath == "/auth/consent") return AuthResult.ConsentRequired(consentRequest(p.server, url.encodedQuery.orEmpty(), true))
            if (url.encodedPath in setOf("/auth/login", "/auth/register")) {
                val callback = url.queryParameter("callbackURL")?.let { p.server.toHttpUrl().resolve(it) }
                if (callback?.encodedPath != "/api/auth/oauth" || toOrigin(callback.toString()) != p.server) throw AuthFailure("invalid_grant")
                nativeQuery = callback.encodedQuery ?: throw AuthFailure("invalid_grant")
                return error("native_credentials_required")
            }
            if (url.encodedPath == "/auth/error") throw AuthFailure(url.queryParameter("error") ?: "unknown")
            val response = execute(Request.Builder().url(url).header("Accept", "application/json").get().build())
            response.use {
                val location = it.header("Location")
                if (it.code in 300..399 && location != null) {
                    next = if (location.startsWith("me.rxresu:")) location else url.resolve(location)?.toString() ?: throw AuthFailure("invalid_redirect")
                } else {
                    val body = readJson(it)
                    next = body.text("url") ?: throw AuthFailure("invalid_grant")
                }
            }
        }
        throw AuthFailure("invalid_grant")
    }

    override suspend fun forgotPassword(server: String, email: String): AuthResult = result {
        val target = allowed(server)
        post("$target/api/auth/request-password-reset", buildJsonObject {
            put("email", email.trim()); put("redirectTo", "$target/auth/reset-password")
        })
        AuthResult.Success
    }

    override suspend fun resetPassword(server: String, token: String, newPassword: String): AuthResult = result {
        post("${allowed(server)}/api/auth/reset-password", buildJsonObject { put("token", token); put("newPassword", newPassword) })
        AuthResult.Success
    }

    override suspend fun signInWithProvider(activity: Activity, server: String, provider: String): AuthResult = forms.withLock { result {
        val info = checkServer(server)
        if (provider !in info.providers && provider != "passkey") throw AuthFailure("oauth_provider_not_found")
        if (provider == "passkey" && !info.passkey) throw AuthFailure("oauth_provider_not_found")
        val uri = Uri.parse(begin(info.origin, true))
        withContext(Dispatchers.Main) { openBrowser(activity, uri) }
        AuthResult.BrowserRequired(uri)
    } }

    override suspend fun passkey(activity: Activity, server: String) = signInWithProvider(activity, server, "passkey")

    override fun openBrowser(activity: Activity, uri: Uri) {
        require(isAllowedServer(toOrigin(uri.toString()).orEmpty(), debug))
        CustomTabsIntent.Builder().build().launchUrl(activity, uri)
    }

    override suspend fun handleRedirect(uri: Uri): AuthResult = forms.withLock { result {
        restore()
        exchange(uri, pending ?: throw AuthFailure("invalid_grant"))
    } }

    private suspend fun exchange(uri: Uri, p: Pending): AuthResult {
        if (uri.toString().substringBefore('?').substringBefore('#') != p.redirect) throw AuthFailure("invalid_redirect")
        val params = parseAuthorizationResponse(uri.toString())
        if (params["state"] != p.state) throw AuthFailure("state_mismatch")
        if ((p.requireIss || params.containsKey("iss")) && params["iss"] != p.issuer) throw AuthFailure("issuer_mismatch")
        if (p.started + 600 <= now()) throw AuthFailure("invalid_grant")
        val epoch = generation.get()
        transition.withLock {
            if (pending !== p) throw AuthFailure("invalid_grant")
            pending = null
            storage.write("pending", null)
        }
        params["error"]?.let { throw AuthFailure(it) }
        val code = params["code"]?.takeIf { it.isNotBlank() } ?: throw AuthFailure("invalid_grant")
        val d = discover(p.server)
        val next = token(d.token, FormBody.Builder().add("grant_type", "authorization_code").add("client_id", p.client)
            .add("code", code).add("redirect_uri", p.redirect).add("code_verifier", p.verifier).add("resource", p.server).build())
        transition.withLock {
            if (epoch != generation.get()) { revoke(p.server, next.refresh); throw AuthFailure("access_denied") }
            val scope = json.encodeToString(listOf(p.server, subject(next.access)))
            val saved = SavedSession(p.server, scope, next)
            storage.write("session", json.encodeToString(saved))
            storage.write("server", p.server)
            storage.write("refreshing.${p.server}", null)
            session = saved
            issuedAccess.clear()
            rememberAccess(next.access)
            mutableOrigin.value = p.server
            mutableState.value = SessionState.SignedIn(p.server, scope)
            cookies.clear()
            nativeQuery = null
        }
        return AuthResult.Success
    }

    override suspend fun loadConsent(uri: Uri): AuthResult = forms.withLock { result {
        restore()
        val server = mutableOrigin.value
        if (toOrigin(uri.toString()) != server || uri.path != "/auth/consent") throw AuthFailure("invalid_consent")
        // A native OAuth bearer is not a Better Auth browser session. Never exchange it for a cookie implicitly.
        AuthResult.ConsentRequired(consentRequest(server, uri.encodedQuery.orEmpty(), false))
    } }

    private suspend fun consentRequest(server: String, query: String, native: Boolean): ConsentRequest {
        val parsed = parseAuthorizationResponse("$server/auth/consent?$query")
        val url = "$server/auth/consent?$query".toHttpUrl()
        // Better Auth's signed query repeats `ba_param` (the list of signed keys); every OAuth parameter must appear once.
        if (url.queryParameterNames.any { it != "ba_param" && url.queryParameterValues(it).size != 1 }) throw AuthFailure("invalid_consent")
        val clientId = parsed["client_id"] ?: throw AuthFailure("invalid_consent")
        if (parsed["sig"].isNullOrBlank()) throw AuthFailure("invalid_consent")
        val client = post("$server/api/auth/oauth2/public-client-prelogin", buildJsonObject { put("client_id", clientId); put("oauth_query", query) })
        val redirect = parsed["redirect_uri"] ?: throw AuthFailure("invalid_consent")
        if (native) {
            val p = pending ?: throw AuthFailure("invalid_grant")
            if (clientId != p.client || redirect != p.redirect || parsed["state"] != p.state) throw AuthFailure("invalid_consent")
        }
        return ConsentRequest(server, query, clientId, client.text("client_name") ?: clientId,
            parsed["scope"].orEmpty().split(' ').filter { it.isNotBlank() }, redirect, native)
    }

    override suspend fun consent(request: ConsentRequest, accept: Boolean): AuthResult = forms.withLock { result {
        if (!request.canGrantNatively || pending == null || request.server != pending?.server)
            return@result AuthResult.BrowserRequired(Uri.parse("${allowed(request.server)}/auth/consent?${request.query}"))
        val verified = consentRequest(request.server, request.query, true)
        val response = post("${verified.server}/api/auth/oauth2/consent", buildJsonObject { put("accept", accept); put("oauth_query", verified.query) })
        follow(response.text("url") ?: throw AuthFailure("invalid_consent"))
    } }

    override suspend fun cancelSignIn() {
        generation.incrementAndGet()
        transition.withLock { pending = null; nativeQuery = null; cookies.clear(); storage.write("pending", null) }
    }

    override suspend fun accessToken(): String? {
        restore()
        val epoch = generation.get()
        return transition.withLock {
            if (epoch != generation.get()) return@withLock null
            val tokens = session?.tokens ?: return@withLock null
            if (tokens.expiresAt - 60 > now()) tokens.access else refreshLocked(tokens.access, epoch)
        }.takeIf { epoch == generation.get() }
    }

    override suspend fun refresh(rejected: String): String? {
        restore()
        val epoch = generation.get()
        return transition.withLock {
            if (epoch != generation.get()) null else refreshLocked(rejected, epoch)
        }.takeIf { epoch == generation.get() }
    }

    private suspend fun refreshLocked(rejected: String, epoch: Long): String? {
        val saved = session ?: return null
        val old = saved.tokens ?: return null
        if (rejected !in issuedAccess) return null
        if (old.access != rejected) return old.access
        val refresh = old.refresh ?: run { expireLocked(); return null }
        if (offline()) return old.access
        // Discovery failure happens before spending the refresh; retaining it is safe.
        val d = try { discover(saved.server) } catch (error: CancellationException) { throw error } catch (_: Exception) { return old.access }
        val client = storage.read("client.${saved.server}") ?: run { expireLocked(); return null }
        storage.write("refreshing.${saved.server}", fingerprint(refresh))
        session = SavedSession(saved.server, saved.scope, Tokens(old.access, null, old.expiresAt))
        try {
            val next = token(d.token, FormBody.Builder().add("grant_type", "refresh_token").add("client_id", client)
                .add("refresh_token", refresh).add("resource", saved.server).build())
            if (subject(next.access) != subject(old.access) || epoch != generation.get()) {
                revoke(saved.server, next.refresh)
                expireLocked()
                return null
            }
            val updated = SavedSession(saved.server, saved.scope, next)
            storage.write("session", json.encodeToString(updated))
            storage.write("refreshing.${saved.server}", null)
            session = updated
            rememberAccess(next.access)
            return next.access
        } catch (error: Exception) {
            withContext(NonCancellable) {
                try { if (error is AuthFailure && error.code == "invalid_client") storage.write("client.${saved.server}", null) }
                finally { expireLocked() }
            }
            if (error is CancellationException) throw error
            return null
        }
    }

    override suspend fun expire(rejected: String) {
        restore()
        transition.withLock { if (session?.tokens?.access == rejected) expireLocked() }
    }

    private suspend fun expireLocked() {
        val saved = session ?: return
        session = SavedSession(saved.server, saved.scope)
        issuedAccess.clear()
        mutableState.value = SessionState.Expired(saved.server, saved.scope)
        // Keep a tombstone with account scope so expiry preserves drafts across restarts.
        storage.write("session", json.encodeToString(session!!))
        storage.write("refreshing.${saved.server}", null)
    }

    override suspend fun signOut() {
        generation.incrementAndGet()
        withContext(NonCancellable) { transition.withLock {
            restoreLocked()
            val old = session
            try { revoke(old?.server ?: mutableOrigin.value, old?.tokens?.refresh) }
            finally {
                // A failed delete must not restore credentials on next launch.
                try {
                    old?.let { storage.write("refreshing.${it.server}", "signed-out") }
                    storage.write("session", null)
                    storage.write("pending", null)
                } finally {
                    session = null; pending = null; nativeQuery = null; cookies.clear(); issuedAccess.clear()
                    mutableState.value = SessionState.SignedOut
                }
            }
        } }
    }

    private fun rememberAccess(access: String) {
        issuedAccess.add(access)
        if (issuedAccess.size > 16) issuedAccess.remove(issuedAccess.first())
    }

    private suspend fun revoke(server: String, refresh: String?) {
        if (refresh == null) return
        try {
            val endpoint = discover(server).revoke ?: return
            val client = storage.read("client.$server") ?: return
            val request = Request.Builder().url(endpoint).post(FormBody.Builder().add("token", refresh)
                .add("token_type_hint", "refresh_token").add("client_id", client).build()).build()
            withContext(Dispatchers.IO) { tokenHttp.newBuilder().callTimeout(5, TimeUnit.SECONDS).build().newCall(request).execute().close() }
        } catch (error: CancellationException) { throw error } catch (_: Exception) { /* Local sign-out always completes. */ }
    }

    private suspend fun token(endpoint: String, form: FormBody): Tokens = withContext(Dispatchers.IO) {
        val response = try {
            tokenHttp.newCall(Request.Builder().url(endpoint).header("Accept", "application/json").post(form).build()).execute().use { readJson(it) }
        } catch (error: AuthFailure) {
            if (error.code == "invalid_client") storage.write("client.${toOrigin(endpoint)}", null)
            throw error
        }
        val access = response.text("access_token")?.takeIf { it.isNotBlank() } ?: throw AuthFailure("invalid_grant")
        if (response.text("token_type")?.equals("Bearer", true) != true) throw AuthFailure("invalid_grant")
        val expires = response["expires_in"]?.jsonPrimitive?.longOrNull?.takeIf { it > 0 && it <= 31536000 } ?: throw AuthFailure("invalid_grant")
        Tokens(access, response.text("refresh_token")?.takeIf { it.isNotBlank() }, now() + expires)
    }

    private fun allowed(input: String) = toOrigin(input)?.takeIf { isAllowedServer(it, debug) } ?: throw ServerError(ServerError.Reason.Unreachable)
    private suspend fun get(url: String) = withContext(Dispatchers.IO) { execute(Request.Builder().url(url).get().header("Accept", "application/json").build()).use { readJson(it) } }
    private suspend fun post(url: String, body: JsonObject) = withContext(Dispatchers.IO) { execute(Request.Builder().url(url)
        .header("Origin", toOrigin(url)!!).header("Accept", "application/json")
        .post(body.toString().toRequestBody("application/json".toMediaType())).build()).use { readJson(it) } }
    private suspend fun execute(request: Request) = withContext(Dispatchers.IO) { http.newCall(request).execute() }
    private fun readJson(response: okhttp3.Response): JsonObject {
        val body = try { json.parseToJsonElement(response.body.string()).jsonObject } catch (_: Exception) { throw AuthFailure("unknown", response.code) }
        if (!response.isSuccessful) throw AuthFailure(body.text("code") ?: body.text("error") ?: "unknown", response.code)
        return body
    }
    private suspend fun result(block: suspend () -> AuthResult): AuthResult = try { withContext(Dispatchers.IO) { block() } }
    catch (error: CancellationException) { throw error }
    catch (error: AuthFailure) { debugLog(error); error(error.code, error.status) }
    catch (error: ServerError) { AuthResult.Error(error.reason.name.lowercase(), resources.getString(error.messageRes)) }
    catch (error: IOException) { debugLog(error); error("network") }
    catch (error: Exception) { debugLog(error); error("unknown") }

    /** Debug builds only: the failure's type and code (never request bodies, cookies or tokens). */
    private fun debugLog(error: Exception) {
        if (debug) android.util.Log.w("RrAuth", "${error.javaClass.simpleName}: ${(error as? AuthFailure)?.let { "${it.code} ${it.status}" } ?: error.message}")
    }

    private fun error(code: String, status: Int = 0) = authError(code, status, resources)
}
