package me.rxresu.feature.share

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
import me.rxresu.core.navigation.WebPageSettings
import me.rxresu.core.navigation.Visitors
import me.rxresu.core.navigation.BuilderMore
import me.rxresu.core.navigation.Download
import me.rxresu.core.navigation.Versions

/** Registers this module's destinations. Placeholder screens until the feature lands. */
fun NavGraphBuilder.shareGraph(nav: NavController, motion: RrNavMotion) {
    screen<WebPageSettings> { Placeholder("B12") }
    screen<Visitors> { Placeholder("B13") }
    sheet<Download> { Placeholder("B14") }
    sheet<BuilderMore> { Placeholder("B18") }
    screen<Versions> { Placeholder("B15") }
}

@Composable
private fun Placeholder(id: String) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { RrText(id) }
