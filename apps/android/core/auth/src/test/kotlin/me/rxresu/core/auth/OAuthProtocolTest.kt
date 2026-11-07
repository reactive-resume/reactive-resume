package me.rxresu.core.auth

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OAuthProtocolTest {
    private fun error(code: String, status: Int = 0) = authError(code, status, org.robolectric.RuntimeEnvironment.getApplication().resources)

    @Test fun origins() {
        assertEquals("https://example.org", toOrigin(" example.org/path?q=1 "))
        assertEquals("https://example.org", toOrigin("https://name:secret@example.org/path"))
        assertNull(toOrigin("example .org"))
        assertNull(toOrigin("ftp://example.org"))
        assertNull(toOrigin("internal"))
        assertTrue(isAllowedServer("https://example.org"))
        assertFalse(isAllowedServer("http://example.org", true))
        assertFalse(isAllowedServer("http://localhost:8080"))
        for (host in listOf("localhost", "127.0.0.1", "10.0.2.2")) assertTrue(isAllowedServer("http://$host:8080", true))
        assertEquals("https://rxresu.me/auth/native-callback", redirectUri("https://example.org", true))
        assertEquals("me.rxresu:/auth/native-callback", redirectUri("http://localhost:8080", true))
    }

    @Test fun pkceRfc7636Vector() {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    }

    @Test fun redirectRejectsAmbiguity() {
        assertEquals("hello world", parseAuthorizationResponse("https://rxresu.me/auth/native-callback?code=hello+world&state=s")["code"])
        for (query in listOf("?code=a&code=b", "?%63ode=a&code=b", "?code=a#iss=bad", "?code=a#%73tate=bad", "?code=%xy")) {
            assertThrows(AuthFailure::class.java) { parseAuthorizationResponse("https://rxresu.me/auth/native-callback$query") }
        }
    }

    @Test fun discoveryValidatesEveryEndpoint() {
        val origin = "https://example.org"
        fun metadata(extra: String = "") = Json.parseToJsonElement("""{"issuer":"$origin/api/auth","authorization_endpoint":"$origin/authorize","token_endpoint":"$origin/token","registration_endpoint":"$origin/register","scopes_supported":["offline_access"]$extra}""").jsonObject
        assertEquals("$origin/token", parseDiscovery(origin, metadata()).token)
        for (field in listOf("issuer", "authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint")) {
            val bad = metadata().toMutableMap().apply { put(field, kotlinx.serialization.json.JsonPrimitive("https://evil.example/endpoint")) }
            assertEquals(ServerError.Reason.Mismatch, assertThrows(ServerError::class.java) { parseDiscovery(origin, kotlinx.serialization.json.JsonObject(bad)) }.reason)
        }
        val old = metadata().toMutableMap().apply { remove("registration_endpoint") }
        assertEquals(ServerError.Reason.Outdated, assertThrows(ServerError::class.java) { parseDiscovery(origin, kotlinx.serialization.json.JsonObject(old)) }.reason)
    }

    @Test fun safeErrorCopy() {
        assertTrue(error("INVALID_EMAIL_OR_PASSWORD").message.startsWith("That email"))
        assertTrue(error("INVALID_OTP").message.startsWith("That code"))
        assertTrue(error("x", 429).message.startsWith("Too many"))
        assertTrue(error("account_already_linked_to_different_user").message.contains("already linked"))
        assertFalse(error("<script>untrusted</script>").message.contains("script"))
    }
}
