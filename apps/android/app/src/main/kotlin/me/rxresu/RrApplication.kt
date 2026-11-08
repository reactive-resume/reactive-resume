package me.rxresu

import android.app.Application
import androidx.work.Configuration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import me.rxresu.feature.career.startCareerSync
import me.rxresu.feature.system.startSystemIntegrations
import me.rxresu.core.data.RepositoriesProvider

/** Builds the app graph once per process (no DI framework; see PLAN.md) and gives WorkManager the draft-sync workers. */
class RrApplication : Application(), Configuration.Provider, RepositoriesProvider {
    val graph: AppGraph by lazy { AppGraph(this) }
    override val repositories get() = graph.repositories

    /** Work that lives as long as the process (notification sync scheduling, widgets). */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()
        startSystemIntegrations(this, scope)
        // Career edits saved offline are delivered when the network returns (account-scoped queue).
        startCareerSync(this, scope)
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().apply { graph.repositories.workerFactory?.let(::setWorkerFactory) }.build()
}
