package me.rxresu.core.auth

import android.net.Uri
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

internal class MemoryAuthStorage : AuthStorage {
    val entries = mutableMapOf<String, String>()
    override suspend fun read(key: String) = entries[key]
    override suspend fun write(key: String, value: String?) { if (value == null) entries.remove(key) else entries[key] = value }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ServerAuthServiceTest {
    private fun service(store: AuthStorage, client: OkHttpClient, debug: Boolean, now: () -> Long = { System.currentTimeMillis() / 1000 }) =
        ServerAuthService(store, client, debug, now, org.robolectric.RuntimeEnvironment.getApplication().resources)

    private fun jwt(sub: String, unique: String = "a") = "header." + Base64.getUrlEncoder().withoutPadding()
        .encodeToString("""{"sub":"$sub","jti":"$unique"}""".toByteArray()) + ".signature"
    private fun response(body: String, status: Int = 200) = MockResponse.Builder().code(status).body(body).addHeader("Content-Type", "application/json").build()
    private fun metadata(origin: String) = """{"issuer":"$origin/api/auth","authorization_endpoint":"$origin/authorize","token_endpoint":"$origin/token","registration_endpoint":"$origin/register","revocation_endpoint":"$origin/revoke","authorization_response_iss_parameter_supported":true,"scopes_supported":["offline_access"]}"""
    private fun saved(store: MemoryAuthStorage, origin: String, access: String, expires: Long = 999999) {
        store.entries["session"] = json.encodeToString(SavedSession(origin, "account-a", Tokens(access, "refresh-a", expires)))
        store.entries["client.$origin"] = "client-a"
    }

    @Test fun nativePasswordCapturesRedirectWithoutBrowserOrCallbackRequest() = runBlocking {
        MockWebServer().use { web ->
            web.start()
            val origin = web.url("/").toString().removeSuffix("/")
            var authorize: okhttp3.HttpUrl? = null
            var signedQuery = ""
            val requests = mutableListOf<String>()
            web.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val url = request.url!!
                    requests.add(url.encodedPath)
                    return when (url.encodedPath) {
                        "/.well-known/oauth-authorization-server" -> response(metadata(origin))
                        "/register" -> {
                            val body = Json.parseToJsonElement(request.body!!.utf8()).jsonObject
                            assertEquals("none", body.text("token_endpoint_auth_method"))
                            assertEquals("native", body.text("application_type"))
                            response("""{"client_id":"client-a"}""")
                        }
                        "/authorize" -> {
                            authorize = url
                            assertEquals(origin, url.queryParameter("resource"))
                            assertEquals("S256", url.queryParameter("code_challenge_method"))
                            signedQuery = url.encodedQuery + "&sig=server-signed"
                            val callback = "/api/auth/oauth?$signedQuery"
                            val login = "$origin/auth/login".toHttpUrl().newBuilder().addQueryParameter("callbackURL", callback).build()
                            MockResponse.Builder().code(302).addHeader("Location", login.toString()).build()
                        }
                        "/api/auth/sign-in/email" -> {
                            val body = Json.parseToJsonElement(request.body!!.utf8()).jsonObject
                            assertEquals("alex@example.com", body.text("email"))
                            assertEquals(signedQuery, body.text("oauth_query"))
                            MockResponse.Builder().body("""{"url":"$origin/auth/consent?$signedQuery","redirect":true}""")
                                .addHeader("Set-Cookie", "better-auth.session_token=native; Path=/; HttpOnly").build()
                        }
                        "/api/auth/oauth2/public-client-prelogin" -> response("""{"client_id":"client-a","client_name":"Reactive Resume for Android"}""")
                        "/api/auth/oauth2/consent" -> {
                            assertTrue(request.headers["Cookie"].orEmpty().contains("better-auth.session_token=native"))
                            assertEquals(origin, request.headers["Origin"])
                            val urlToApp = "me.rxresu:/auth/native-callback?code=one-use&state=${authorize!!.queryParameter("state")}&iss=${Uri.encode("$origin/api/auth")}"
                            response(buildJsonObject { put("url", urlToApp); put("redirect", true) }.toString())
                        }
                        "/token" -> {
                            val form = request.body!!.utf8()
                            assertTrue(form.contains("code_verifier="))
                            assertTrue(form.contains("resource="))
                            response("""{"access_token":"${jwt("alex")}","refresh_token":"refresh-a","token_type":"Bearer","expires_in":3600}""")
                        }
                        else -> response("{}", 404)
                    }
                }
            }
            val store = MemoryAuthStorage()
            val auth = service(store, OkHttpClient(), true, { 1000 })
            val result = auth.signInWithPassword(origin, " Alex@Example.com ", "password")
            assertTrue(result.toString(), result is AuthResult.ConsentRequired)
            assertEquals(SessionState.SignedOut, auth.state.value)
            assertEquals(AuthResult.Success, auth.consent((result as AuthResult.ConsentRequired).request, true))
            assertTrue(auth.state.value is SessionState.SignedIn)
            assertEquals(jwt("alex"), auth.accessToken())
            assertEquals(1, requests.count { it == "/register" })
            assertFalse(requests.any { it.contains("native-callback") })
            assertNull(store.entries["pending"])
        }
    }

    @Test fun refreshSingleFlightAndResourceBinding() = runBlocking {
        MockWebServer().use { web ->
            web.start()
            val origin = web.url("/").toString().removeSuffix("/")
            val count = AtomicInteger()
            val entered = CountDownLatch(1)
            val release = CountDownLatch(1)
            web.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse = when (request.url!!.encodedPath) {
                    "/.well-known/oauth-authorization-server" -> response(metadata(origin))
                    "/token" -> {
                        count.incrementAndGet(); entered.countDown()
                        assertTrue(release.await(5, TimeUnit.SECONDS))
                        assertTrue(request.body!!.utf8().contains("resource="))
                        response("""{"access_token":"${jwt("alex", "b")}","refresh_token":"refresh-b","token_type":"Bearer","expires_in":3600}""")
                    }
                    else -> response("{}", 404)
                }
            }
            val store = MemoryAuthStorage()
            val old = jwt("alex")
            saved(store, origin, old)
            val auth = service(store, OkHttpClient(), true, { 1000 })
            auth.restore()
            val results = (1..8).map { async(Dispatchers.IO) { auth.refresh(old) } }
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            assertEquals(fingerprint("refresh-a"), store.entries["refreshing.$origin"])
            release.countDown()
            assertEquals(List(8) { jwt("alex", "b") }, results.awaitAll())
            assertEquals(1, count.get())
            assertNull(store.entries["refreshing.$origin"])
            assertNull(auth.refresh(jwt("other")))
        }
    }

    @Test fun lostAnswerNeverResendsRefreshAndRestoreExpires() = runBlocking {
        MockWebServer().use { web ->
            web.start()
            val origin = web.url("/").toString().removeSuffix("/")
            val calls = AtomicInteger()
            web.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse = when (request.url!!.encodedPath) {
                    "/.well-known/oauth-authorization-server" -> response(metadata(origin))
                    "/token" -> {
                        calls.incrementAndGet()
                        MockResponse.Builder().onResponseStart(mockwebserver3.SocketEffect.CloseSocket()).build()
                    }
                    else -> response("{}", 404)
                }
            }
            val store = MemoryAuthStorage()
            val old = jwt("alex")
            saved(store, origin, old, 1001)
            val auth = service(store, OkHttpClient(), true, { 1000 })
            assertNull(auth.accessToken())
            assertNull(auth.refresh(old))
            assertEquals(1, calls.get())
            assertEquals(SessionState.Expired(origin, "account-a"), auth.state.value)
            val next = service(store, OkHttpClient(), true, { 1000 })
            next.restore()
            assertEquals(auth.state.value, next.state.value)
            // Process death before answer: persisted marker retires an otherwise usable token.
            saved(store, origin, old)
            store.entries["refreshing.$origin"] = fingerprint("refresh-a")
            val killed = service(store, OkHttpClient(), true, { 1000 })
            killed.restore()
            assertNull(killed.accessToken())
            assertTrue(killed.state.value is SessionState.Expired)
            assertEquals(1, calls.get())
        }
    }

    @Test fun callbackStateIssuerAndExpiryAreCheckedBeforeTokenEndpoint() = runBlocking {
        val store = MemoryAuthStorage()
        val p = Pending("https://example.org", "client", "verifier", "state", "https://rxresu.me/auth/native-callback", "https://example.org/api/auth", true, 1000)
        store.entries["pending"] = json.encodeToString(p)
        val auth = service(store, OkHttpClient(), false, { 1001 })
        fun callback(query: String) = Uri.parse("${p.redirect}?$query")
        assertEquals("state_mismatch", (auth.handleRedirect(callback("state=bad&code=c")) as AuthResult.Error).kind)
        assertEquals("issuer_mismatch", (auth.handleRedirect(callback("state=state&iss=bad&code=c")) as AuthResult.Error).kind)
        assertEquals("issuer_mismatch", (auth.handleRedirect(callback("state=state&code=c")) as AuthResult.Error).kind)
        assertNotNull(store.entries["pending"])
        val expired = service(store, OkHttpClient(), false, { 1601 })
        assertEquals("invalid_grant", (expired.handleRedirect(callback("state=state&code=c")) as AuthResult.Error).kind)
    }

    @Test fun serverCheckDistinguishesOldAndUnreachable() = runBlocking {
        MockWebServer().use { web ->
            web.start()
            val origin = web.url("/").toString().removeSuffix("/")
            web.enqueue(response("""{"service":"reactive-resume","version":"6.1.0"}"""))
            web.enqueue(response("{}", 404))
            web.enqueue(response("""{"disableSignups":false}"""))
            val auth = service(MemoryAuthStorage(), OkHttpClient(), true)
            try { auth.checkServer(origin); fail("old server accepted") } catch (e: ServerError) { assertEquals(ServerError.Reason.Outdated, e.reason) }
            web.enqueue(response("""{"service":"other"}"""))
            try { auth.checkServer(origin); fail("wrong service accepted") } catch (e: ServerError) { assertEquals(ServerError.Reason.Unreachable, e.reason) }
        }
    }

    @Test fun serverCheckReportsFlagsAndProviders() = runBlocking {
        MockWebServer().use { web ->
            web.start()
            val origin = web.url("/").toString().removeSuffix("/")
            web.enqueue(response("""{"service":"reactive-resume","version":"6.1.0"}"""))
            web.enqueue(response(metadata(origin)))
            web.enqueue(response("""{"disableSignups":true,"disableEmailAuth":true,"allowGuestLogin":false}"""))
            web.enqueue(response("""{"credential":"Password","passkey":"Passkey","github":"GitHub"}"""))
            val info = service(MemoryAuthStorage(), OkHttpClient(), true).checkServer(origin)
            assertEquals("6.1.0", info.version)
            assertFalse(info.password)
            assertTrue(info.passkey)
            assertTrue(info.signupsDisabled)
            assertEquals(mapOf("github" to "GitHub"), info.providers)
        }
    }

    @Test fun twoStepUsesChallengeCookieAndMapsExpiredStep() = runBlocking {
        MockWebServer().use { web ->
            web.start()
            val origin = web.url("/").toString().removeSuffix("/")
            web.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
                    "/.well-known/oauth-authorization-server" -> response(metadata(origin))
                    "/register" -> response("""{"client_id":"client-a"}""")
                    "/authorize" -> {
                        val query = request.url.encodedQuery + "&sig=signed"
                        val callback = "/api/auth/oauth?$query"
                        val login = "$origin/auth/login".toHttpUrl().newBuilder().addQueryParameter("callbackURL", callback).build()
                        MockResponse.Builder().code(302).addHeader("Location", login.toString()).build()
                    }
                    "/api/auth/sign-in/username" -> MockResponse.Builder().body("""{"twoFactorRedirect":true}""")
                        .addHeader("Set-Cookie", "better-auth.two_factor=challenge; Path=/; HttpOnly").build()
                    "/api/auth/two-factor/verify-totp" -> {
                        assertTrue(request.headers["Cookie"].orEmpty().contains("better-auth.two_factor=challenge"))
                        val body = Json.parseToJsonElement(request.body!!.utf8()).jsonObject
                        assertEquals("123456", body.text("code"))
                        assertTrue(body.text("oauth_query").orEmpty().contains("sig=signed"))
                        response("""{"code":"INVALID_TWO_FACTOR_COOKIE"}""", 401)
                    }
                    else -> response("{}", 404)
                }
            }
            val auth = service(MemoryAuthStorage(), OkHttpClient(), true)
            assertEquals(AuthResult.TwoStepRequired, auth.signInWithPassword(origin, "alex", "password"))
            assertEquals("INVALID_TWO_FACTOR_COOKIE", (auth.verifyTwoStep("123456") as AuthResult.Error).kind)
            assertEquals(SessionState.SignedOut, auth.state.value)
        }
    }

    @Test fun knownOfflineDoesNotSpendRefreshToken() = runBlocking {
        val store = MemoryAuthStorage()
        val old = jwt("alex")
        saved(store, "https://example.org", old, 1001)
        val auth = ServerAuthService(store, OkHttpClient(), false, { 1000 },
            org.robolectric.RuntimeEnvironment.getApplication().resources, offline = { true })
        assertEquals(old, auth.accessToken())
        assertNull(store.entries["refreshing.https://example.org"])
        assertTrue(auth.state.value is SessionState.SignedIn)
    }
}
