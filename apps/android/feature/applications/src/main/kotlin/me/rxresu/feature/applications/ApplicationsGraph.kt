package me.rxresu.feature.applications

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.toRoute
import me.rxresu.core.navigation.Application
import me.rxresu.core.navigation.ApplicationsTab
import me.rxresu.core.navigation.InterviewSheet
import me.rxresu.core.navigation.MoveApplication
import me.rxresu.core.navigation.RrNavMotion
import me.rxresu.core.navigation.SaveJob
import me.rxresu.core.navigation.screen
import me.rxresu.core.navigation.sheet
import me.rxresu.core.navigation.tabRoot

/** Registers J1–J8: the Applications tab root, Save a job, the Application screen and its sheets. */
fun NavGraphBuilder.applicationsGraph(nav: NavController, motion: RrNavMotion) {
    tabRoot<ApplicationsTab>(motion) { entry -> ApplicationsRoute(entry.toRoute<ApplicationsTab>().view, nav) }
    sheet<SaveJob> { entry -> SaveJobRoute(entry.toRoute<SaveJob>().url, nav) }
    screen<Application> { entry -> val r = entry.toRoute<Application>(); ApplicationRoute(r.id, r.tab, nav) }
    sheet<MoveApplication> { entry -> MoveRoute(entry.toRoute<MoveApplication>().id, nav) }
    sheet<InterviewSheet> { entry -> val r = entry.toRoute<InterviewSheet>(); InterviewRoute(r.applicationId, r.interviewId, nav) }
}
