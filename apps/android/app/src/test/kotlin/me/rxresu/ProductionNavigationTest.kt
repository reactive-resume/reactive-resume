package me.rxresu

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import androidx.test.core.app.ApplicationProvider
import java.io.File
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.runBlocking
import me.rxresu.core.auth.AuthResult
import me.rxresu.core.auth.FakeAuthService
import me.rxresu.core.data.FakeControls
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrToastHostState
import me.rxresu.core.navigation.*
import me.rxresu.core.testing.RrScreenshotTest
import me.rxresu.feature.share.BuilderShareMode
import me.rxresu.feature.workspace.WorkspaceTabContent
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.robolectric.annotation.Config

/** Every host registers appDestinations; only repository/auth data is fake. */
@Config(application = Application::class)
abstract class ProductionNavigationTest : RrScreenshotTest() {
    @get:Rule val rule = createComposeRule()
    protected lateinit var nav: NavHostController
    protected lateinit var repositories: RrRepositories
    protected lateinit var auth: FakeAuthService
    protected lateinit var activity: ComponentActivity

    @After fun closeRepositories() { if (::repositories.isInitialized) repositories.close() }

    protected fun start(route: Any, controls: FakeControls = FakeControls(), authResult: AuthResult = AuthResult.Success) {
        android.provider.Settings.System.putString(ApplicationProvider.getApplicationContext<Application>().contentResolver, android.provider.Settings.System.TIME_12_24, "24")
        repositories = FakeRepositories(controls)
        auth = FakeAuthService(ApplicationProvider.getApplicationContext()).apply { nextResult = authResult }
        val toasts = RrToastHostState()
        rule.setContent {
            activity = requireNotNull(LocalActivity.current) as ComponentActivity
            CompositionLocalProvider(
                LocalInspectionMode provides true,
                LocalRepositories provides repositories,
                LocalToasts provides toasts,
                LocalBuilderShareMode provides { id, controller -> BuilderShareMode(id, controller) },
                LocalWorkspaceTab provides { id, tab, controller -> WorkspaceTabContent(id, tab, controller) },
            ) {
                RrTheme(reducedMotion = true) {
                    nav = rememberNavController()
                    NavHost(nav, startDestination = route) { appDestinations(nav, RrNavMotion(true), auth) }
                }
            }
        }
    }

    protected fun startShell(controls: FakeControls = FakeControls()) {
        val context = ApplicationProvider.getApplicationContext<Application>()
        android.provider.Settings.System.putString(context.contentResolver, android.provider.Settings.System.TIME_12_24, "24")
        auth = FakeAuthService(context)
        runBlocking { auth.signInWithPassword("https://example.invalid", "storyboard", "storyboard") }
        repositories = FakeRepositories(controls, authSession = auth)
        rule.setContent {
            activity = requireNotNull(LocalActivity.current) as ComponentActivity
            CompositionLocalProvider(LocalInspectionMode provides true) {
                nav = rememberNavController()
                RrAppContent(auth, repositories, File(context.cacheDir, "navigation-pages"), {}, emptyFlow(), nav)
            }
        }
    }

    protected fun visit(route: Any) {
        rule.runOnIdle { nav.navigate(route) }
        rule.runOnIdle { assertTrue("Route not registered: $route", requireNotNull(nav.currentDestination).hasRoute(route::class)) }
    }

    protected fun dumpUi(): String {
        val roots = rule.onAllNodes(isRoot())
        return roots.fetchSemanticsNodes().indices.joinToString("\n") { roots[it].printToString() }
    }

    protected fun ready(text: String) {
        val matcher = (hasText(text) or hasContentDescription(text)) and !hasSetTextAction()
        try {
            rule.waitUntil(timeoutMillis = 5_000) { rule.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
        } catch (failure: ComposeTimeoutException) {
            throw AssertionError("Missing $text on ${nav.currentDestination}:\n${dumpUi()}", failure)
        }
    }

    protected fun click(label: String, scroll: Boolean = false) {
        val matcher = (hasText(label) or hasContentDescription(label)) and hasClickAction() and !hasSetTextAction()
        if (scroll && rule.onAllNodes(matcher).fetchSemanticsNodes().isEmpty()) {
            rule.onAllNodes(hasScrollToNodeAction()).onFirst().performScrollToNode(matcher)
        } else {
            rule.waitUntil(timeoutMillis = 5_000) { rule.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
        }
        val control = rule.onNode(matcher)
        if (scroll && !control.isDisplayed()) control.performScrollTo()
        control.assertIsDisplayed().assertIsEnabled().performClick()
    }

    protected inline fun <reified T : Any> awaitRoute(): T {
        try {
            rule.waitUntil(timeoutMillis = 5_000) { rule.runOnIdle { nav.currentDestination?.hasRoute<T>() == true } }
        } catch (failure: ComposeTimeoutException) {
            throw AssertionError("Expected ${T::class}, got ${nav.currentDestination}:\n${dumpUi()}", failure)
        }
        return rule.runOnIdle { requireNotNull(nav.currentBackStackEntry).toRoute<T>() }
    }

    protected inline fun <reified T : Any> expect(route: T) {
        assertEquals(route, awaitRoute<T>())
    }

    protected inline fun <reified T : Any> edge(
        source: Any,
        control: String,
        target: T,
        loaded: String? = null,
        scroll: Boolean = false,
        parents: List<Any> = emptyList(),
    ): Pair<String, () -> Unit> = "$source via $control → $target" to {
        parents.forEach(::visit)
        visit(source)
        loaded?.let(::ready)
        click(control, scroll)
        expect(target)
    }

    protected fun audit(cases: List<Pair<String, () -> Unit>>) {
        val failures = mutableListOf<String>()
        cases.forEach { (name, action) ->
            try { action() } catch (failure: AssertionError) { failures += "$name: ${failure.message}" }
            finally { rule.runOnIdle { nav.resetTo(TodayTab) } }
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }
}
