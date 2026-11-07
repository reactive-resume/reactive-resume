package me.rxresu.feature.career

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
import me.rxresu.core.navigation.tabRoot
import me.rxresu.core.navigation.CareerTab
import me.rxresu.core.navigation.Coach
import me.rxresu.core.navigation.Knowledge
import me.rxresu.core.navigation.Story
import me.rxresu.core.navigation.Offers
import me.rxresu.core.navigation.ScheduleSheet

/** Registers this module's destinations. Placeholder screens until the feature lands. */
fun NavGraphBuilder.careerGraph(nav: NavController, motion: RrNavMotion) {
    tabRoot<CareerTab>(motion) { Placeholder("C1") }
    screen<Coach> { Placeholder("C2") }
    screen<Knowledge> { Placeholder("C3") }
    screen<Story> { Placeholder("C4") }
    screen<Offers> { Placeholder("C6") }
    sheet<ScheduleSheet> { Placeholder("C7") }
}

@Composable
private fun Placeholder(id: String) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { RrText(id) }
