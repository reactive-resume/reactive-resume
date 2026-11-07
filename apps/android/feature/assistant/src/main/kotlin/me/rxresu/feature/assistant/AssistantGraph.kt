package me.rxresu.feature.assistant

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
import me.rxresu.core.navigation.sheet
import me.rxresu.core.navigation.Assistant
import me.rxresu.core.navigation.AssistantProposals

/** Registers this module's destinations. Placeholder screens until the feature lands. */
fun NavGraphBuilder.assistantGraph(nav: NavController, motion: RrNavMotion) {
    sheet<Assistant> { Placeholder("B16") }
    screen<AssistantProposals> { Placeholder("B17") }
}

@Composable
private fun Placeholder(id: String) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { RrText(id) }
