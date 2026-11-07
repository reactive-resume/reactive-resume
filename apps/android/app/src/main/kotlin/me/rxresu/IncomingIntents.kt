package me.rxresu

import android.content.Intent
import me.rxresu.core.navigation.routeForLink

/** The route an incoming intent opens: App Links and public links. Share targets and shortcuts join in :feature:system. */
fun routeFor(intent: Intent?): Any? {
    if (intent?.action != Intent.ACTION_VIEW) return null
    return intent.data?.toString()?.let(::routeForLink)
}
