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

/** Everything with a process lifetime, built once in [RrApplication]. No DI framework (see PLAN.md). */
class AppGraph(context: Context) {
    val http: OkHttpClient = OkHttpClient()
    val auth: AuthService = ServerAuthService(context, http)

    /** Rendered pages belong to one account: [RrApp] deletes this folder on sign-out. */
    val pagesDir = File(context.cacheDir, "pages")
    val pages: PageRenderer = ServerPageRenderer(auth, auth, http, pagesDir)

    // ponytail: device time zone; switch to the account's time zone once the profile exposes one.
    val repositories: RrRepositories = realRepositories(
        context = context,
        authSession = auth,
        pageRenderer = pages,
        onRejectedRetry = auth::expire,
        http = http,
    )
}
