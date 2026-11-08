package me.rxresu.feature.auth

import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.*
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.*
import androidx.navigation.NavDestination.Companion.hasRoute
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import me.rxresu.core.auth.AuthService
import me.rxresu.core.designsystem.*
import me.rxresu.core.navigation.*

fun NavGraphBuilder.authGraph(nav: NavController, motion: RrNavMotion, auth: AuthService) {
    screen<Welcome> {
        AuthRoute(nav, auth) { vm, s ->
            LaunchedEffect(Unit) { vm.cancel() }
            WelcomeScreen(
                s,
                vm::edit,
                { vm.checkServer(true) },
                { nav.navigate(AtsChecker()) },
                { vm.checkServer(true, register = true) },
                { vm.checkServer() },
            )
        }
    }
    screen<SignIn> { entry ->
        AuthRoute(nav, auth) { vm, s ->
            val register = entry.toRoute<SignIn>().register
            val activity = LocalActivity.current
            LaunchedEffect(Unit) { if (s.info == null) vm.checkServer() }
            SignInScreen(
                s,
                register,
                vm::edit,
                { vm.submit(register) },
                { activity?.let { a -> vm.provider(a, it) } },
                { nav.navigate(ForgotPassword) },
                { nav.navigate(SignIn(!register)) },
                {
                    vm.cancel()
                    nav.popBackStack()
                },
            )
        }
    }
    sheet<ForgotPassword> {
        AuthRoute(nav, auth) { vm, s ->
            LaunchedEffect(Unit) { vm.edit { it } }
            ForgotScreen(s, vm::edit, vm::forgot, { nav.popBackStack() })
        }
    }
    screen<ResetPassword> { entry ->
        AuthRoute(nav, auth) { vm, s ->
            ResetScreen(
                s,
                vm::edit,
                { vm.reset(entry.toRoute<ResetPassword>().token) },
                { nav.popBackStack() },
            )
        }
    }
    screen<TwoStep> { entry ->
        AuthRoute(nav, auth) { vm, s ->
            val backup = entry.toRoute<TwoStep>().backup
            BackHandler {
                vm.cancel()
                nav.popBackStack<SignIn>(false)
            }
            TwoStepScreen(
                s,
                backup,
                { code ->
                    vm.edit { it.copy(code = code) }
                    if (!backup && code.length == 6) vm.verify(false)
                },
                { vm.verify(backup) },
                {
                    vm.edit { it.copy(code = "") }
                    nav.navigate(TwoStep(!backup)) { popUpTo<TwoStep> { inclusive = true } }
                },
                {
                    vm.cancel()
                    nav.popBackStack<SignIn>(false)
                },
            )
        }
    }
    modal<Consent>(motion) { entry ->
        AuthRoute(nav, auth) { vm, s ->
            val query = entry.toRoute<Consent>().query
            LaunchedEffect(query) { vm.loadConsent(query) }
            BackHandler {
                vm.cancel()
                nav.popBackStack()
            }
            ConsentScreen(
                s,
                { vm.consent(it) },
                {
                    vm.cancel()
                    nav.popBackStack()
                },
            )
        }
    }
}

@Composable
private fun AuthRoute(
    nav: NavController,
    auth: AuthService,
    content: @Composable (AuthViewModel, AuthUiState) -> Unit,
) {
    val activity = LocalActivity.current
    val vm: AuthViewModel =
        viewModel(viewModelStoreOwner = activity as ViewModelStoreOwner) { AuthViewModel(auth) }
    val state by vm.state.collectAsStateWithLifecycle()
    val haptic = rememberRrHaptics()

    // Only the resumed destination consumes navigation events; sheet-underlying screens remain
    // composed.
    val entry = LocalLifecycleOwner.current
    LaunchedEffect(vm, entry) {
        entry.lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.RESUMED) {
            launch {
                vm.state
                    .map { it.error }
                    .distinctUntilChanged()
                    .collect { if (it != null) haptic(RrHaptic.Error) }
            }
            vm.events.collect { event ->
                when (event) {
                    AuthEvent.SignIn -> nav.navigate(SignIn())
                    AuthEvent.Register -> nav.navigate(SignIn(register = true))
                    AuthEvent.Authenticated -> haptic(RrHaptic.Success)
                    AuthEvent.TwoStep -> nav.navigate(TwoStep())
                    is AuthEvent.Consent -> nav.navigate(Consent(event.query))
                    is AuthEvent.Browser -> activity?.let { auth.openBrowser(it, event.uri) }
                    is AuthEvent.ConsentComplete -> {
                        if (event.granted) {
                            haptic(RrHaptic.Success)
                            nav.resetTo(TodayTab)
                        } else if (
                            nav.currentBackStackEntry?.destination?.hasRoute<Consent>() == true
                        )
                            nav.popBackStack()
                    }
                    AuthEvent.SignInExpired ->
                        nav.navigate(SignIn()) { popUpTo(nav.graph.startDestinationId) }
                    AuthEvent.PasswordReset -> nav.navigate(SignIn()) { popUpTo<Welcome>() }
                }
            }
        }
    }
    content(vm, state)
}
