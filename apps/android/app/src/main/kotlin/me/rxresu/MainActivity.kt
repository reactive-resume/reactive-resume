package me.rxresu

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import me.rxresu.core.auth.SessionState

class MainActivity : ComponentActivity() {
    private val graph get() = (application as RrApplication).graph

    /** Routes from links and other apps, consumed by the NavHost once it exists. */
    private val incoming = Channel<Any>(Channel.BUFFERED)

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        splash.setKeepOnScreenCondition { graph.auth.state.value == SessionState.Loading }
        lifecycleScope.launch { graph.auth.restore() }
        if (savedInstanceState == null) handle(intent)
        setContent { RrApp(graph = graph, incoming = incoming.receiveAsFlow()) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        val data = intent?.data
        if (data != null && data.path == "/auth/native-callback") {
            lifecycleScope.launch { graph.auth.handleRedirect(data) }
            return
        }
        routeFor(intent)?.let { incoming.trySend(it) }
    }
}
