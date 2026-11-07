package me.rxresu

import android.content.Context
import me.rxresu.core.auth.AuthService
import me.rxresu.core.auth.ServerAuthService
import me.rxresu.core.page.PageRenderer
import me.rxresu.core.page.ServerPageRenderer
import okhttp3.OkHttpClient
import java.io.File

/** Everything with a process lifetime, built once in [RrApplication]. No DI framework (see PLAN.md). */
class AppGraph(context: Context) {
    val http: OkHttpClient = OkHttpClient()
    val auth: AuthService = ServerAuthService(context, http)
    val pages: PageRenderer = ServerPageRenderer(auth, auth, http, File(context.cacheDir, "pages"))
}
