package me.rxresu.core.navigation

import java.net.URI

/** Hosts whose links the app opens: the main app and its alias for public pages. */
val AppLinkHosts = setOf("rxresu.me", "rx.cv")

// First path segments on the app host that are app sections or files, never a username.
private val reservedSegments = setOf(
    "", "auth", "api", "mcp", "uploads", "dashboard", ".well-known", "templates", "agent", "docs", "builder",
    "feedback", "ats-checker", "privacy", "terms", "pricing", "changelog", "assets", "fonts", "logo", "favicon.ico",
    "robots.txt", "sitemap.xml",
)

/**
 * The route a link opens in the app, or null when the app has no screen for it (the caller opens it in a Custom Tab).
 * `/auth/native-callback` is not routed here: `:core:auth` consumes it.
 */
fun routeForLink(link: String, hosts: Set<String> = AppLinkHosts): Any? {
    val uri = runCatching { URI(link) }.getOrNull() ?: return null
    if (uri.scheme != "https" && uri.scheme != "http") return null
    val host = uri.host?.lowercase()?.removePrefix("www.") ?: return null
    if (host !in hosts) return null
    val segments = uri.rawPath.orEmpty().split('/').filter { it.isNotEmpty() }.map { java.net.URLDecoder.decode(it, "UTF-8") }
    val first = segments.firstOrNull() ?: return null
    return when {
        first == "builder" && segments.size >= 2 -> Builder(resumeId = segments[1])
        first == "feedback" && segments.size == 2 -> PublicResume(link)
        first == "ats-checker" && segments.size == 1 -> AtsChecker()
        first in reservedSegments -> null
        segments.size <= 2 -> PublicResume(link)
        else -> null
    }
}

/** The first http(s) URL in shared text (browsers share "Title https://…"), for Save a job. */
fun firstUrlIn(text: String): String? = Regex("""https?://[^\s<>"']+""").find(text)?.value?.trimEnd('.', ',', ')', ']')
