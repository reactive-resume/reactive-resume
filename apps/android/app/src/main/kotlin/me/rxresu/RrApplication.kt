package me.rxresu

import android.app.Application
import androidx.work.Configuration
import me.rxresu.core.data.RepositoriesProvider

/** Builds the app graph once per process (no DI framework; see PLAN.md) and gives WorkManager the draft-sync workers. */
class RrApplication : Application(), Configuration.Provider, RepositoriesProvider {
    val graph: AppGraph by lazy { AppGraph(this) }
    override val repositories get() = graph.repositories

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().apply { graph.repositories.workerFactory?.let(::setWorkerFactory) }.build()
}
