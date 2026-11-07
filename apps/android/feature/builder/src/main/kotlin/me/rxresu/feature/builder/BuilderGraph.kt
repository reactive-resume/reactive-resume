package me.rxresu.feature.builder

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
import me.rxresu.core.navigation.Builder
import me.rxresu.core.navigation.BuilderEntry
import me.rxresu.core.navigation.BuilderRichText
import me.rxresu.core.navigation.BuilderBasics
import me.rxresu.core.navigation.BuilderMore

/** Registers this module's destinations. Placeholder screens until the feature lands. */
fun NavGraphBuilder.builderGraph(nav: NavController, motion: RrNavMotion) {
    screen<Builder> { Placeholder("B1") }
    sheet<BuilderEntry> { Placeholder("B2") }
    screen<BuilderRichText> { Placeholder("B4") }
    screen<BuilderBasics> { Placeholder("B5") }
    sheet<BuilderMore> { Placeholder("B18") }
}

@Composable
private fun Placeholder(id: String) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { RrText(id) }
