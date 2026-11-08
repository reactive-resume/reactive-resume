package me.rxresu

import androidx.compose.ui.test.*
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.toRoute
import kotlinx.coroutines.runBlocking
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.navigation.*
import org.junit.Assert.*
import org.junit.Test

class SourceResumeNavigationTest : ProductionNavigationTest() {
    @Test fun documentMenuCopyForJobPreservesDirtySourceAndBuilderBackAnchor() {
        start(DocumentsTab)
        val sourceId = StoryboardIds.resume
        visit(Builder(sourceId, mode = BuilderMode.Design))
        val draft = runBlocking { repositories.resumes.openDraft(sourceId) }
        runBlocking {
            val source = requireNotNull(draft.state.value.document)
            draft.update(source.copy(data = source.data.copy(basics = source.data.basics.copy(name = "Source retained from builder"))))
        }
        click("More")
        expect(BuilderMore(sourceId))
        ready("Copy for a job…")
        click("Copy for a job…", scroll = true)
        expect(SaveJob(sourceResumeId = sourceId, sourceAccountScope = owner()))
        rule.runOnIdle { assertEquals("composable", requireNotNull(nav.currentDestination).navigatorName) }
        ready("Role")
        rule.onNode(hasSetTextAction() and (hasContentDescription("Role") or hasText("Role"))).performTextReplacement("Source aware designer")
        rule.onNode(hasSetTextAction() and (hasContentDescription("Company") or hasText("Company"))).performTextReplacement("Fictional source navigation")
        val before = runBlocking { repositories.applications.listApplications().size }
        click("Save job")
        awaitRoute<Builder>()
        val copyId = rule.runOnIdle { requireNotNull(nav.currentBackStackEntry).toRoute<Builder>().resumeId }
        assertNotEquals(sourceId, copyId)
        val copy = runBlocking { repositories.resumes.getResume(copyId) }
        assertEquals("Source retained from builder", copy.data.basics.name)
        val application = runBlocking { repositories.applications.getApplication(requireNotNull(copy.applicationId)) }
        assertEquals("Fictional source navigation", application.company)
        assertEquals(copyId, application.resumeId)
        assertEquals(before + 1, runBlocking { repositories.applications.listApplications().size })
        click("Back to documents")
        expect(Builder(sourceId, mode = BuilderMode.Design))
        click("Back to documents")
        expect(DocumentsTab)
    }

    @Test fun documentActionsTailorPushesSaveJobWithSourceAndReturnsToSameLibrary() {
        start(DocumentsTab)
        visit(DocumentActions(StoryboardIds.resume, DocumentKind.Resume))
        ready("Tailor for a job…")
        click("Tailor for a job…")
        expect(SaveJob(sourceResumeId = StoryboardIds.resume, sourceAccountScope = owner()))
        click("Close")
        expect(DocumentsTab)
    }

    private fun owner() = (repositories.authSession.state.value as SessionState.SignedIn).accountScope
}
