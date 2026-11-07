package me.rxresu.feature.publiclink

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.navigation.RrNavMotion
import me.rxresu.core.navigation.screen
import me.rxresu.core.navigation.PublicResume
import me.rxresu.core.navigation.AtsChecker

/** Registers this module's destinations. Placeholder screens until the feature lands. */
fun NavGraphBuilder.publicGraph(nav: NavController, motion: RrNavMotion) {
    screen<PublicResume> { Placeholder("P1") }
    screen<AtsChecker> { Placeholder("P2") }
}

@Composable
private fun Placeholder(id: String) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { RrText(id) }
