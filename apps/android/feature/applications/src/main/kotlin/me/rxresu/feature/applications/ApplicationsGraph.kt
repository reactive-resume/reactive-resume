package me.rxresu.feature.applications

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
import me.rxresu.core.navigation.ApplicationsTab
import me.rxresu.core.navigation.SaveJob
import me.rxresu.core.navigation.Application
import me.rxresu.core.navigation.MoveApplication
import me.rxresu.core.navigation.InterviewSheet

/** Registers this module's destinations. Placeholder screens until the feature lands. */
fun NavGraphBuilder.applicationsGraph(nav: NavController, motion: RrNavMotion) {
    tabRoot<ApplicationsTab>(motion) { Placeholder("J1") }
    sheet<SaveJob> { Placeholder("J5") }
    screen<Application> { Placeholder("J6") }
    sheet<MoveApplication> { Placeholder("J7") }
    sheet<InterviewSheet> { Placeholder("J8") }
}

@Composable
private fun Placeholder(id: String) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { RrText(id) }
