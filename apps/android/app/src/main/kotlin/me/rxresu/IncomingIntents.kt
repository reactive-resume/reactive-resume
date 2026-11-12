package me.rxresu

import me.rxresu.core.navigation.Application
import me.rxresu.core.navigation.ApplicationWorkspace
import me.rxresu.core.navigation.ApplicationInsights
import me.rxresu.core.navigation.PagePreview
import me.rxresu.core.navigation.BuilderSection
import me.rxresu.core.navigation.BuilderDesign
import me.rxresu.core.navigation.ApplicationsTab
import me.rxresu.core.navigation.Builder
import me.rxresu.core.navigation.CareerTab
import me.rxresu.core.navigation.Coach
import me.rxresu.core.navigation.DocumentsTab
import me.rxresu.core.navigation.Import
import me.rxresu.core.navigation.InterviewSheet
import me.rxresu.core.navigation.Knowledge
import me.rxresu.core.navigation.Letter
import me.rxresu.core.navigation.MoveApplication
import me.rxresu.core.navigation.NewDocument
import me.rxresu.core.navigation.Offers
import me.rxresu.core.navigation.SaveJob
import me.rxresu.core.navigation.Story
import me.rxresu.core.navigation.TodayTab
import me.rxresu.core.navigation.Versions
import me.rxresu.core.navigation.Visitors
import me.rxresu.core.navigation.WebPageSettings

/**
 * The tab a route from outside the app (notification, shortcut, share sheet, link) belongs under, so Back from it
 * lands on that tab's root. Null: open over whatever is on screen (search, public pages, the ATS checker).
 */
fun tabFor(route: Any): Any? = when (route) {
    is Application, is ApplicationWorkspace, ApplicationInsights, is MoveApplication, is InterviewSheet, is SaveJob -> ApplicationsTab()
    is Offers, is Coach, is Knowledge, is Story -> CareerTab
    is Builder, is BuilderSection, is BuilderDesign, is PagePreview, is Letter, is Import, is NewDocument, is Visitors, is WebPageSettings, is Versions -> DocumentsTab
    TodayTab, DocumentsTab, CareerTab, is ApplicationsTab -> route
    else -> null
}
