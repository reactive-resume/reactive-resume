package me.rxresu.feature.auth

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import me.rxresu.core.auth.AuthService
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.navigation.RrNavMotion
import me.rxresu.core.navigation.modal
import me.rxresu.core.navigation.screen
import me.rxresu.core.navigation.sheet
import me.rxresu.core.navigation.Welcome
import me.rxresu.core.navigation.SignIn
import me.rxresu.core.navigation.ForgotPassword
import me.rxresu.core.navigation.ResetPassword
import me.rxresu.core.navigation.TwoStep
import me.rxresu.core.navigation.Consent

/** Registers this module's destinations. Placeholder screens until the feature lands. */
fun NavGraphBuilder.authGraph(nav: NavController, motion: RrNavMotion, auth: AuthService) {
    screen<Welcome> { Placeholder("A1") }
    screen<SignIn> { Placeholder("A2") }
    sheet<ForgotPassword> { Placeholder("A2 forgot") }
    screen<ResetPassword> { Placeholder("A2 reset") }
    screen<TwoStep> { Placeholder("A3") }
    modal<Consent>(motion) { Placeholder("A4") }
}

@Composable
private fun Placeholder(id: String) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { RrText(id) }
