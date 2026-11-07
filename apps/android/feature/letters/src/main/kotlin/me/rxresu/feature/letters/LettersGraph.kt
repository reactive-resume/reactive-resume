package me.rxresu.feature.letters

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
import me.rxresu.core.navigation.Letter

/** Registers this module's destinations. Placeholder screens until the feature lands. */
fun NavGraphBuilder.lettersGraph(nav: NavController, motion: RrNavMotion) {
    screen<Letter> { Placeholder("L1") }
}

@Composable
private fun Placeholder(id: String) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { RrText(id) }
