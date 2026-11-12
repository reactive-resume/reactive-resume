package me.rxresu

import androidx.compose.ui.test.*
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.toRoute
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import me.rxresu.core.data.FakeControls
import me.rxresu.core.data.FakeMode
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.navigation.*
import me.rxresu.core.navigation.Application as ApplicationRoute
import me.rxresu.core.network.generated.DocumentType
import me.rxresu.core.network.generated.MessageDraft
import org.junit.Assert.*
import org.junit.Test

class DashboardNavigationTest : ProductionNavigationTest() {
    @Test fun todayVisibleControlsKeepTheClickedApplicationContext() {
        start(TodayTab)
        audit(listOf(
            edge(TodayTab, "Search", Search()),
            edge(TodayTab, "Settings", Settings),
            edge(TodayTab, "Open briefing", ApplicationWorkspace(StoryboardIds.lumen, WorkspaceTab.Prepare), loaded = "Open briefing"),
            edge(TodayTab, "Reply to Parcel & Co.", Offers, loaded = "Open briefing", scroll = true),
            edge(TodayTab, "Follow up with Fieldnote", ApplicationWorkspace(StoryboardIds.fieldnote, WorkspaceTab.Messages), loaded = "Open briefing", scroll = true),
            edge(TodayTab, "Calendar", ApplicationsTab(ApplicationsView.Calendar), loaded = "Open briefing", scroll = true),
            edge(TodayTab, "Orbital Health", ApplicationRoute(StoryboardIds.orbital), loaded = "Open briefing", scroll = true),
            edge(TodayTab, "Lumen", ApplicationRoute(StoryboardIds.lumen), loaded = "Open briefing", scroll = true),
        ))
    }

    @Test fun libraryRowsAndActionsUseEachDocumentsIdentity() {
        start(TodayTab)
        val documents = runBlocking { repositories.documents.observe().first { it.data != null }.data!! }
        assertTrue("Fictional library must contain both kinds", documents.any { it.type == DocumentType.Letter } && documents.any { it.type == DocumentType.Resume })
        val trashCount = runBlocking { repositories.documents.listDocuments(trashed = true).size }
        val cases = documents.map { document ->
            val name = "D1 ${document.id} ${document.name}"
            name to {
                visit(DocumentsTab)
                ready("Product designer")
                click(document.name, scroll = true)
                when {
                    document.isLocked -> expect(DocumentActions(document.id, if (document.type == DocumentType.Letter) DocumentKind.Letter else DocumentKind.Resume))
                    document.type == DocumentType.Letter -> expect(Letter(document.id))
                    else -> expect(Builder(document.id))
                }
            }
        } + listOf(
            edge(DocumentsTab, "Search", Search("documents")),
            edge(DocumentsTab, "New", NewDocument()),
            edge(DocumentsTab, "Trash · $trashCount", Trash(), loaded = "Product designer", scroll = true),
        )
        audit(cases)
    }

    @Test fun libraryAnchorsRemainReachableAfterClosingEitherDocumentSheet() {
        start(TodayTab)
        // D2/D3 dumps include the same D1 library rows behind the scrim. Dismiss, then exercise that real anchor.
        val rows = listOf(
            "Product designer" to StoryboardIds.resume,
            "Product designer — Lumen" to StoryboardIds.lumenResume,
            "Design lead" to StoryboardIds.lockedResume,
        )
        val sheets: List<Any> = listOf(DocumentActions(StoryboardIds.resume, DocumentKind.Resume), NewDocument())
        audit(sheets.flatMap { sheet -> rows.map { (label, id) ->
            "$sheet underlying library $label" to {
                visit(DocumentsTab)
                ready("Product designer")
                visit(sheet)
                click("Close")
                expect(DocumentsTab)
                click(label, scroll = true)
                if (id == StoryboardIds.lockedResume) expect(DocumentActions(id, DocumentKind.Resume)) else expect(Builder(id))
            }
        } })
    }

    @Test fun documentActionOpenAndSharePdfUseProductionCallbacks() {
        start(TodayTab)
        audit(listOf(
            edge(DocumentActions(StoryboardIds.resume, DocumentKind.Resume), "Open", Builder(StoryboardIds.resume), loaded = "Open", parents = listOf(DocumentsTab)),
            edge(DocumentActions(StoryboardIds.resume, DocumentKind.Resume), "Share PDF", Download(StoryboardIds.resume, DocumentKind.Resume), loaded = "Open", scroll = true, parents = listOf(DocumentsTab)),
        ))
    }

    @Test fun newDocumentCreatesTheRequestedKindBeforeOpeningItsEditor() {
        start(TodayTab)
        audit(listOf(
            "D3 Resume → created resume template picker" to {
                visit(DocumentsTab)
                visit(NewDocument())
                click("Resume")
                awaitRoute<BuilderDesign>()
                val route = rule.runOnIdle { requireNotNull(nav.currentBackStackEntry).toRoute<BuilderDesign>() }
                assertEquals(DesignPicker.Template, route.picker)
                assertTrue(route.resumeId.isNotBlank())
                assertEquals(route.resumeId, runBlocking { repositories.resumes.getResume(route.resumeId) }.id)
                rule.runOnIdle { assertEquals(route.resumeId, requireNotNull(nav.previousBackStackEntry).toRoute<Builder>().resumeId) }
            },
            "D3 Cover letter → application-owned letter" to {
                visit(DocumentsTab)
                visit(NewDocument())
                click("Cover letter")
                ready("Lumen")
                click("Lumen")
                awaitRoute<Letter>()
                val id = rule.runOnIdle { requireNotNull(nav.currentBackStackEntry).toRoute<Letter>().letterId }
                val letter = runBlocking { repositories.letters.getCoverLetter(id) }
                assertEquals(StoryboardIds.lumen, letter.sourceApplicationId)
            },
            edge(NewDocument(), "Save a job", SaveJob(), parents = listOf(DocumentsTab)),
        ))
    }

    @Test fun searchResultsPreserveResumeLetterAndApplicationIdentity() {
        start(TodayTab)
        val letter = runBlocking { repositories.documents.observe().first { it.data != null }.data!! }
            .first { it.type == DocumentType.Letter && it.id == StoryboardIds.lumenLetter }
        val cases = listOf(
            "D5 application" to {
                visit(Search())
                rule.onNode(hasSetTextAction()).performTextReplacement("Lumen")
                ready("Lumen")
                rule.onNode(hasText("Lumen") and hasText("Senior product designer", substring = true) and hasClickAction()).performScrollTo().performClick()
                expect(ApplicationRoute(StoryboardIds.lumen))
            },
            "D5 resume" to {
                visit(Search())
                rule.onNode(hasSetTextAction()).performTextReplacement("Lumen")
                ready("Product designer — Lumen")
                click("Product designer — Lumen", scroll = true)
                expect(Builder(StoryboardIds.lumenResume))
            },
            "D5 letter" to {
                visit(Search())
                rule.onNode(hasSetTextAction()).performTextReplacement(letter.name)
                ready(letter.name)
                click(letter.name, scroll = true)
                expect(Letter(letter.id))
            },
        )
        audit(cases)
    }

    @Test fun searchSavedMessagesPreserveTheirOwningApplication() {
        start(TodayTab)
        val messages = runBlocking { repositories.career.listCareerSavedItems() }.filter { it.data is MessageDraft && it.applicationId != null }
        assertTrue("Saved-message search fixture required", messages.isNotEmpty())
        audit(messages.map { message ->
            "D5 saved message ${message.id}" to {
                visit(Search())
                rule.onNode(hasSetTextAction()).performTextReplacement(message.title)
                ready(message.title)
                click(message.title, scroll = true)
                expect(ApplicationWorkspace(requireNotNull(message.applicationId), WorkspaceTab.Messages))
            }
        })
    }

    @Test fun firstRunControlsAndDockWorkWithAnActuallyEmptyAccount() {
        val controls = FakeControls().apply {
            set("listDocuments", FakeMode.Empty)
            set("listApplications", FakeMode.Empty)
            val seed = Json.parseToJsonElement(requireNotNull(javaClass.classLoader?.getResourceAsStream("storyboard.json")).bufferedReader().use { it.readText() }).jsonObject
            responses.value = mapOf("getCareerProfile" to JsonObject(seed.getValue("careerProfile").jsonObject + mapOf("targetRoles" to JsonArray(emptyList()), "locations" to JsonArray(emptyList()), "priorities" to JsonPrimitive(""))))
        }
        startShell(controls)
        ready("Import a resume")
        val tabs = listOf("Today" to TodayTab, "Documents" to DocumentsTab, "Applications" to ApplicationsTab(), "Career" to CareerTab)
        tabs.forEach { (label, target) ->
            rule.runOnIdle { nav.resetTo(TodayTab) }
            ready("Import a resume")
            rule.onNode(hasText(label) and isSelectable()).performClick()
            rule.runOnIdle { assertTrue(requireNotNull(nav.currentDestination).hasRoute(target::class)) }
        }
        audit(listOf(
            edge(TodayTab, "Settings", Settings, loaded = "Import a resume"),
            edge(TodayTab, "Import a resume", Import(), loaded = "Import a resume"),
            edge(TodayTab, "Start from a template instead", NewDocument(), loaded = "Import a resume"),
        ))
    }
}
