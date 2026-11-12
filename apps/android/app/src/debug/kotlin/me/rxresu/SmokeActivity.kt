package me.rxresu

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.lifecycleScope
import java.io.File
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.launch
import me.rxresu.core.auth.FakeAuthService
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.RrRepositories

/** Debug-only device calibration with fictional storyboard data and real system insets. */
class SmokeActivity : ComponentActivity() {
    private var repositories: RrRepositories? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val auth = FakeAuthService(this)
        lifecycleScope.launch {
            auth.signInWithPassword("https://example.invalid", "storyboard", "storyboard")
            val data = FakeRepositories(authSession = auth)
            repositories = data
            setContent {
                RrAppContent(auth, data, File(cacheDir, "fictional-smoke-pages"), {}, emptyFlow())
            }
        }
    }

    override fun onDestroy() {
        repositories?.close()
        super.onDestroy()
    }
}
