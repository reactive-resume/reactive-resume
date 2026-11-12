package me.rxresu

import android.content.Context
import me.rxresu.core.auth.AuthService
import me.rxresu.core.auth.ServerAuthService
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.data.realRepositories
import me.rxresu.core.page.PageRenderer
import me.rxresu.core.page.ServerPageRenderer
import okhttp3.OkHttpClient
import java.io.File
import java.time.ZoneId
import me.rxresu.core.data.TimeSource

/** Everything with a process lifetime, built once in [RrApplication]. No DI framework (see PLAN.md). */
class AppGraph(context: Context) {
    val http: OkHttpClient = OkHttpClient()
    val auth: AuthService = ServerAuthService(context, http)

    /** Rendered pages belong to one account: [RrApp] deletes this folder on sign-out. */
    val pagesDir = File(context.cacheDir, "pages")
    val pages: PageRenderer = ServerPageRenderer(auth, auth, http, pagesDir)

    /** The signed-in account's timezone (Settings › Preferences), set by [RrApp] from the profile; null until known. */
    @Volatile var accountZone: ZoneId? = null

    val time = TimeSource(timezone = { accountZone ?: ZoneId.systemDefault() })

    val repositories: RrRepositories = realRepositories(
        context = context,
        authSession = auth,
        pageRenderer = pages,
        onRejectedRetry = auth::expire,
        time = time,
        http = http,
    )
}
