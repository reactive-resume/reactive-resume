package me.rxresu.feature.today

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.navigation.RrNavMotion
import me.rxresu.core.navigation.tabRoot
import me.rxresu.core.navigation.TodayTab

/** Registers this module's destinations. Placeholder screens until the feature lands. */
fun NavGraphBuilder.todayGraph(nav: NavController, motion: RrNavMotion) {
    tabRoot<TodayTab>(motion) { Placeholder("T1") }
}

@Composable
private fun Placeholder(id: String) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { RrText(id) }
