package me.rxresu.feature.today

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import me.rxresu.core.data.FakeControls
import me.rxresu.core.data.FakeMode
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.designsystem.RrTabBar
import me.rxresu.core.designsystem.rrAppTabs
import me.rxresu.core.strings.R as S
import me.rxresu.core.testing.RrScreenshotTest
import me.rxresu.core.testing.captureScreen
import org.junit.Test

class TodayScreenshotTest : RrScreenshotTest() {
    @Test fun rtl() = captureScreen("T1-Today-rtl", false, wrap = provide(FakeRepositories())) {
        CompositionLocalProvider(androidx.compose.ui.platform.LocalLayoutDirection provides androidx.compose.ui.unit.LayoutDirection.Rtl) { Today(reminders = true) }
    }
    @Test fun todayLight() = today(dark = false)
    @Test fun todayDark() = today(dark = true)
    @Test fun firstRunLight() = firstRun(dark = false)
    @Test fun firstRunDark() = firstRun(dark = true)
    @Test fun offline() = captureScreen("T1-Today-offline", dark = false, wrap = provide(FakeRepositories())) {
        Today(reminders = true) { it.copy(offline = true) }
    }
    @Test fun loadError() = captureScreen("T1-Today-error", dark = false, wrap = provide(FakeRepositories(FakeControls(FakeMode.Error())))) {
        Today(reminders = true)
    }
    @Test fun fontScale() = captureScreen("T1-Today", dark = false, wrap = provide(FakeRepositories()), fontScale = 2f) { Today(reminders = true) }

    private fun today(dark: Boolean) = captureScreen("T1-Today", dark, wrap = provide(FakeRepositories())) { Today(reminders = true) }

    // A new guest account: nothing saved yet, so every checklist row is open.
    private fun firstRun(dark: Boolean) = captureScreen("T2-FirstRun", dark, wrap = provide(FakeRepositories(FakeControls(FakeMode.Empty)))) {
        Today(reminders = false) { it.copy(initials = "AM", firstName = "Alex") }
    }
}

private fun provide(repos: RrRepositories): @Composable (@Composable () -> Unit) -> Unit = { content ->
    CompositionLocalProvider(LocalRepositories provides repos) { content() }
}

/** Today as the app shows it: the view model on fake repositories, above the shell's tab bar. */
@Composable
private fun Today(reminders: Boolean, adjust: (TodayUiState) -> TodayUiState = { it }) {
    val repos = LocalRepositories.current
    val vm = remember { TodayViewModel(repos.today, repos.applications, repos.account).apply { setRemindersEnabled(reminders) } }
    val state by vm.state.collectAsState()
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) { TodayScreen(adjust(state), repos.time.now(), repos.time.timezone(), TodayActions()) }
        RrTabBar(
            rrAppTabs(stringResource(S.string.today), stringResource(S.string.documents), stringResource(S.string.applications), stringResource(S.string.career)),
            selectedIndex = 0,
            onSelect = {},
        )
    }
}
