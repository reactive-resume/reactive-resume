package me.rxresu

import android.app.Application

/** Builds the app graph once per process (no DI framework; see PLAN.md). */
class RrApplication : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
    }
}
