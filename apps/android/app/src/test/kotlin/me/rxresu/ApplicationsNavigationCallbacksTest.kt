package me.rxresu

import androidx.compose.ui.test.*
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.toRoute
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.navigation.*
import me.rxresu.core.navigation.Application as ApplicationRoute
import org.junit.Assert.*
import org.junit.Test

class ApplicationsNavigationCallbacksTest : ProductionNavigationTest() {
    @Test fun applicationViewHeadersPushInsightsAndSaveJob() {
        start(TodayTab)
        audit(listOf(ApplicationsView.List, ApplicationsView.Board, ApplicationsView.Calendar).flatMap { view -> listOf(
            edge(ApplicationsTab(view), "Insights", ApplicationInsights),
            edge(ApplicationsTab(view), "Save a job", SaveJob()),
        ) })
    }

    @Test fun listBoardCalendarSegmentsSelectTheActualRequestedView() {
        start(TodayTab)
        audit(listOf(ApplicationsView.List, ApplicationsView.Board, ApplicationsView.Calendar).flatMap { source ->
            listOf("List", "Board", "Calendar").map { label ->
                "$source segment $label" to {
                    visit(ApplicationsTab(source))
                    rule.onNode(hasText(label) and isSelectable()).performClick().assertIsSelected()
                    rule.runOnIdle { assertTrue(requireNotNull(nav.currentDestination).hasRoute<ApplicationsTab>()) }
                }
            }
        })
    }

    @Test fun listAndBoardRowsOpenTheApplicationThatWasClicked() {
        start(TodayTab)
        val listRows = listOf(
            "Lumen" to StoryboardIds.lumen,
            "Orbital Health" to StoryboardIds.orbital,
            "Parcel & Co." to StoryboardIds.parcel,
            "Fieldnote" to StoryboardIds.fieldnote,
            "Kiln Studio" to StoryboardIds.kiln,
        )
        audit(listRows.map { (company, id) -> edge(ApplicationsTab(), company, ApplicationRoute(id), loaded = "Lumen", scroll = true) } +
            listRows.take(3).map { (company, id) -> "Board owning lane → $company" to {
                val app = runBlocking { repositories.applications.getApplication(id) }
                val lanes = runBlocking { repositories.applications.getApplicationLanes().lanes }.filter { it.retiredAt == null }.sortedBy { it.position }
                val page = lanes.indexOfFirst { it.category == app.status }
                assertEquals("Storyboard category must select one owning lane", 1, lanes.count { it.category == app.status })
                assertTrue("Fixture has no owning lane for $id", page >= 0)
                visit(ApplicationsTab(ApplicationsView.Board))
                val label = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.app.Application>().getString(me.rxresu.core.strings.R.string.page_0_of_1, "${page + 1}", "${lanes.size}")
                rule.onNodeWithContentDescription(label).performClick().assertIsSelected()
                click(company, scroll = true)
                expect(ApplicationRoute(id))
            } })
    }

    @Test fun calendarRowsOpenApplicationFollowUpAndOfferTargets() {
        start(TodayTab)
        runBlocking { repositories.applications.patchApplication(StoryboardIds.fieldnote, me.rxresu.core.network.generated.PatchApplicationRequest(followUpAt = "2026-11-10T17:00:00Z", followUpDateOnly = false)) }
        audit(listOf(
            edge(ApplicationsTab(ApplicationsView.Calendar), "10:00", ApplicationRoute(StoryboardIds.lumen), loaded = "10:00", scroll = true),
            edge(ApplicationsTab(ApplicationsView.Calendar), "17:00", ApplicationWorkspace(StoryboardIds.fieldnote, WorkspaceTab.Messages), loaded = "10:00", scroll = true),
            edge(ApplicationsTab(ApplicationsView.Calendar), "All day", Offers, loaded = "10:00", scroll = true),
            edge(ApplicationRoute(StoryboardIds.lumen), "Stage", MoveApplication(StoryboardIds.lumen), loaded = "Stage", scroll = true),
        ))
    }

    @Test fun saveJobButtonPersistsManualFieldsBeforeOpeningItsApplication() {
        start(TodayTab)
        visit(ApplicationsTab())
        visit(SaveJob())
        ready("Role")
        rule.onNode(hasSetTextAction() and (hasContentDescription("Role") or hasText("Role"))).performTextReplacement("Product designer")
        rule.onNode(hasSetTextAction() and (hasContentDescription("Company") or hasText("Company"))).performTextReplacement("Fictional navigation company")
        click("Save job")
        awaitRoute<ApplicationRoute>()
        val id = rule.runOnIdle { requireNotNull(nav.currentBackStackEntry).toRoute<ApplicationRoute>().id }
        val created = runBlocking { repositories.applications.getApplication(id) }
        assertEquals("Product designer", created.role)
        assertEquals("Fictional navigation company", created.company)
    }

    @Test fun sheetHeaderBackControlsDismissToTheSameApplication() {
        start(TodayTab)
        val app = ApplicationRoute(StoryboardIds.lumen)
        audit(listOf(
            edge(MoveApplication(StoryboardIds.lumen), "Back", app, parents = listOf(app)),
            edge(InterviewSheet(StoryboardIds.lumen, StoryboardIds.interview), "Back", app, parents = listOf(app)),
        ))
    }

    @Test fun boardAndCalendarRootDockLinksUseProductionShellCallbacks() {
        startShell()
        val targets = listOf("Today" to TodayTab, "Documents" to DocumentsTab, "Applications" to ApplicationsTab(), "Career" to CareerTab)
        listOf(ApplicationsView.Board, ApplicationsView.Calendar).forEach { source ->
            targets.forEach { (label, target) ->
                rule.runOnIdle { nav.resetTo(ApplicationsTab(source)) }
                rule.onNode(hasText(source.name) and isSelectable()).assertIsSelected()
                rule.onNode(hasText(label) and isSelectable()).performClick()
                rule.runOnIdle { assertTrue("$source dock $label", requireNotNull(nav.currentDestination).hasRoute(target::class)) }
                rule.onNode(hasText(label) and isSelectable()).assertIsSelected()
                if (label == "Applications") rule.onNode(hasText(source.name) and isSelectable()).assertIsSelected()
            }
        }
    }
}
