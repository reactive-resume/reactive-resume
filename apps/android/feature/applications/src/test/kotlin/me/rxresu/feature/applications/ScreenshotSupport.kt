package me.rxresu.feature.applications

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import me.rxresu.core.data.FakeControls
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.designsystem.RrToastHostState
import me.rxresu.core.navigation.LocalToasts

/** Storyboard screens use UK formats ("Tue 10 Nov", 24-hour times). */
const val GB_SCREEN = me.rxresu.core.testing.RR_SCREEN_QUALIFIERS

/** Fake repositories plus the app-wide locals screens read. */
fun fakeWrap(repos: RrRepositories = FakeRepositories(FakeControls())): @Composable (@Composable () -> Unit) -> Unit = { content ->
    CompositionLocalProvider(LocalRepositories provides repos, LocalToasts provides RrToastHostState()) { content() }
}
