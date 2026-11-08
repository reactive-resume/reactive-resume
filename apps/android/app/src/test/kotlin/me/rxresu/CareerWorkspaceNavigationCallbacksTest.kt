package me.rxresu

import androidx.compose.ui.test.*

import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.toRoute
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.navigation.*
import org.junit.Assert.*
import org.junit.Test

class CareerWorkspaceNavigationCallbacksTest : ProductionNavigationTest() {
    @Test fun careerRowsPushTheirActualTools() {
        start(TodayTab)
        audit(listOf(
            edge(CareerTab, "Settings", Settings),
            edge(CareerTab, "Start a conversation", Coach(), loaded = "Start a conversation"),
            edge(CareerTab, "Facts", Knowledge(), loaded = "Start a conversation", scroll = true),
            edge(CareerTab, "Job search", Knowledge(KnowledgeTab.Preferences), loaded = "Start a conversation", scroll = true),
            edge(CareerTab, "Compare offers", Offers, loaded = "Start a conversation", scroll = true),
            edge(CareerTab, "Discovery", ScheduleSheet("schedule-discovery"), loaded = "Start a conversation", scroll = true),
            edge(Knowledge(KnowledgeTab.Preferences), "Where to look", ScheduleSheet("schedule-discovery"), loaded = "Where to look", scroll = true),
            edge(Offers, "Ask the coach", Coach(), loaded = "Ask the coach"),
        ))
    }

    @Test fun careerStoriesUseTheSpecifiedUndrawnListBeforeOpeningTheStory() {
        start(TodayTab)
        visit(CareerTab)
        ready("Start a conversation")
        click("Stories", scroll = true)
        expect(Knowledge(KnowledgeTab.Stories))
        ready("Building the shared system")
        click("Building the shared system", scroll = true)
        expect(Story(StoryboardIds.story))
    }

    @Test fun placesStillOpensTheSearchCountriesEditor() {
        start(TodayTab)
        visit(Knowledge(KnowledgeTab.Preferences))
        ready("Places")
        click("Places", scroll = true)
        ready("Search countries")
        click("Search countries", scroll = true)
        ready("Countries to search")
        rule.onNodeWithText("Countries to search").assertIsDisplayed()
        click("Back")
        expect(Knowledge(KnowledgeTab.Preferences))
        ready("Places")
    }

    @Test fun workspaceLinksRetainApplicationResumeLetterAndStoryIdentity() {
        start(TodayTab)
        val app = StoryboardIds.lumen
        val sent = kotlinx.coroutines.runBlocking { repositories.applications.getApplication(app) }
        audit(listOf(
            edge(ApplicationWorkspace(app, WorkspaceTab.Fit), "Workshop facilitation", Knowledge(), loaded = "Workshop facilitation", scroll = true),
            "W1 Tailor → linked resume assistant" to {
                visit(ApplicationWorkspace(app, WorkspaceTab.Fit))
                ready("Tailor the resume to this job")
                click("Tailor the resume to this job", scroll = true)
                awaitRoute<Assistant>()
                rule.runOnIdle { assertEquals(StoryboardIds.lumenResume, requireNotNull(nav.currentBackStackEntry).toRoute<Assistant>().resumeId) }
            },
            edge(ApplicationWorkspace(app, WorkspaceTab.Apply), "Resume", PagePreview(StoryboardIds.lumenResume, versionId = requireNotNull(sent.sentResumeVersionId)), loaded = "Resume", scroll = true),
            edge(ApplicationWorkspace(app, WorkspaceTab.Apply), "Cover letter", Letter(StoryboardIds.lumenLetter, versionId = requireNotNull(sent.sentCoverLetterVersionId)), loaded = "Resume", scroll = true),
            edge(ApplicationWorkspace(app, WorkspaceTab.Apply), "Follow up", ApplicationWorkspace(app, WorkspaceTab.Messages), loaded = "Resume", scroll = true),
            edge(ApplicationWorkspace(app, WorkspaceTab.Prepare), "Walk me through a design system decision and its trade-offs.", Story(StoryboardIds.story), loaded = "Practice these questions", scroll = true),
            edge(ApplicationWorkspace(app, WorkspaceTab.Prepare), "How do you make accessibility part of the process?", Story(), loaded = "Practice these questions", scroll = true),
            edge(ApplicationWorkspace(app, WorkspaceTab.Prepare), "Practice these questions", ApplicationWorkspace(app, WorkspaceTab.Practise), loaded = "Practice these questions", scroll = true),
        ))
    }
}
