package me.rxresu

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.*
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.toRoute
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import me.rxresu.core.auth.AuthResult
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.data.FakeControls
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.AgentConversation
import kotlinx.serialization.json.*
import me.rxresu.core.navigation.*
import org.junit.Assert.*
import org.junit.Test
import org.robolectric.Shadows.shadowOf

class DocumentNavigationCallbacksTest : ProductionNavigationTest() {
    @Test fun welcomeSignInAndPasswordSubmissionReachTheRealTwoStepDestination() {
        start(Welcome, authResult = AuthResult.TwoStepRequired)
        click("Sign in")
        expect(SignIn())
        rule.waitUntil(timeoutMillis = 5_000) { rule.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().size == 2 }
        rule.onAllNodes(hasSetTextAction()).onFirst().performTextReplacement("storyboard@example.invalid")
        rule.onAllNodes(hasSetTextAction()).onLast().performTextReplacement("fictional-password")
        click("Sign in", scroll = true)
        expect(TwoStep())
    }

    @Test fun welcomePublicPdfToolWorksWithoutSigningIn() {
        start(Welcome)
        click("Check a resume PDF without an account", scroll = true)
        expect(AtsChecker())
    }

    @Test fun builderAssistantAndShareRowsPreserveDocumentIdentity() {
        start(TodayTab)
        val id = StoryboardIds.resume
        val builders = BuilderMode.entries.map { Builder(id, mode = it) } + Builder(id, mode = BuilderMode.Check, check = CheckTab.JobMatch)
        audit(builders.map { edge(it, "Assistant", Assistant(id)) } + listOf(
            edge(Builder(id, mode = BuilderMode.Share), "Other formats", Download(id, DocumentKind.Resume), loaded = "Other formats", scroll = true),
            edge(Builder(id, mode = BuilderMode.Share), "Web page settings", WebPageSettings(id), loaded = "Other formats", scroll = true),
            edge(Builder(id, mode = BuilderMode.Share), "Visitors and feedback", Visitors(id), loaded = "Other formats", scroll = true),
        ))
    }

    @Test fun sectionEntryDescriptionAndDoneFollowActualEditorControls() {
        start(TodayTab)
        val id = StoryboardIds.resume
        val section = BuilderSection(id, "experience")
        val entry = BuilderEntry(id, "experience", "experience-northwind")
        val rich = BuilderRichText(id, "experience", "experience-northwind")
        audit(listOf(
            edge(section, "Northwind Labs", entry, loaded = "Northwind Labs", scroll = true, parents = listOf(Builder(id))),
            edge(entry, "Description", rich, loaded = "Northwind Labs", scroll = true, parents = listOf(Builder(id), section)),
            edge(entry, "See it on the page", PagePreview(id, section = "experience", itemId = "experience-northwind"), loaded = "Northwind Labs", scroll = true, parents = listOf(Builder(id), section)),
            edge(rich, "Done", entry, loaded = "Done", parents = listOf(Builder(id), section, entry)),
        ))
    }

    @Test fun checkSegmentsChangeActualContentAndJobRowOpensItsApplication() {
        start(TodayTab)
        val id = StoryboardIds.lumenResume
        audit(listOf(
            "B9 Job match → B10" to {
                visit(Builder(id, mode = BuilderMode.Check))
                ready("Issues")
                rule.onNode(hasText("Job match") and isSelectable()).performClick().assertIsSelected()
                ready("Lumen · Senior product designer")
            },
            "B10 Issues → B9" to {
                visit(Builder(id, mode = BuilderMode.Check, check = CheckTab.JobMatch))
                ready("Issues")
                rule.onNode(hasText("Issues") and isSelectable()).performClick().assertIsSelected()
            },
            "B10 Change keeps the application picker" to {
                visit(Builder(id, mode = BuilderMode.Check, check = CheckTab.JobMatch))
                ready("Lumen · Senior product designer")
                click("Change", scroll = true)
                ready("Unlink this application")
                expect(Builder(id, mode = BuilderMode.Check, check = CheckTab.JobMatch))
            },
            edge(Builder(id, mode = BuilderMode.Check, check = CheckTab.JobMatch), "Lumen · Senior product designer", me.rxresu.core.navigation.Application(StoryboardIds.lumen), loaded = "Issues", scroll = true),
        ))
    }

    @Test fun letterAssistantUsesTheLetterThreadAndLinkedResume() {
        start(TodayTab)
        visit(Letter(StoryboardIds.lumenLetter))
        val letter = runBlocking { repositories.letters.getCoverLetter(StoryboardIds.lumenLetter) }
        ready(letter.name)
        click("Assistant")
        awaitRoute<Assistant>()
        rule.runOnIdle {
            val route = requireNotNull(nav.currentBackStackEntry).toRoute<Assistant>()
            assertEquals(letter.sourceResumeId, route.resumeId)
            assertFalse(route.threadId.isNullOrBlank())
        }
    }

    @Test fun assistantReviewOpensTheSameDocumentsProposalThread() {
        val controls = FakeControls()
        start(TodayTab, controls)
        val conversation = runBlocking { repositories.assistant.getAgentThread("thread-lumen") }
        val stored = ApiJson.encodeToJsonElement(AgentConversation.serializer(), conversation).jsonObject
        controls.responses.value = mapOf("getAgentThread" to JsonObject(stored + ("messages" to buildJsonArray {
            add(buildJsonObject {
                put("id", "navigation-proposals"); put("role", "assistant")
                put("parts", buildJsonArray { add(buildJsonObject {
                    put("type", "tool-propose_edits"); put("toolCallId", "navigation-tool"); put("state", "output-available")
                    put("output", buildJsonObject { put("edits", buildJsonArray { repeat(3) { index -> add(buildJsonObject {
                        put("id", "navigation-edit-$index"); put("before", "Before"); put("after", "After"); put("status", "pending"); put("location", "Summary")
                        put("target", buildJsonObject { put("sectionId", "summary"); put("field", "content") })
                    }) } }) })
                }) })
            })
        })))
        visit(Builder(StoryboardIds.lumenResume))
        visit(Assistant(StoryboardIds.lumenResume, threadId = "thread-lumen"))
        ready("Review 3 edits")
        click("Review 3 edits", scroll = true)
        expect(AssistantProposals(StoryboardIds.lumenResume, "thread-lumen"))
    }

    @Test fun publicPageButtonLaunchesItsRealUrl() {
        start(TodayTab)
        val profile = runBlocking { repositories.account.observeProfile().first { it.data != null }.data!! }
        val resume = runBlocking { repositories.resumes.getResume(StoryboardIds.resume) }
        val origin = repositories.authSession.origin.value
        visit(WebPageSettings(StoryboardIds.resume))
        ready("Open web page")
        val activity = shadowOf(ApplicationProvider.getApplicationContext<Application>())
        while (activity.nextStartedActivity != null) { /* Discard the test activity's launch intent. */ }
        click("Open web page")
        val opened = requireNotNull(activity.nextStartedActivity)
        assertEquals(Intent.ACTION_VIEW, opened.action)
        assertEquals("${origin.trimEnd('/')}/${Uri.encode(profile.username)}/${Uri.encode(resume.slug)}", opened.dataString)
    }

    @Test fun providerAddAndBothExistingRowsUseCorrectProviderArguments() {
        start(TodayTab)
        audit(listOf(
            edge(SettingsAi, "Add AI provider", AiProviderSheet(), parents = listOf(Settings)),
            edge(SettingsAi, "Work OpenAI", AiProviderSheet("provider-work"), loaded = "Work OpenAI", parents = listOf(Settings)),
            edge(SettingsAi, "Ollama on my Mac", AiProviderSheet("provider-ollama"), loaded = "Work OpenAI", scroll = true, parents = listOf(Settings)),
        ))
    }

    @Test fun documentMenuUnderlyingBackAnchorReturnsToDocumentsAfterDismissal() {
        start(TodayTab)
        visit(DocumentsTab)
        visit(Builder(StoryboardIds.resume))
        click("More")
        expect(BuilderMore(StoryboardIds.resume))
        click("Close")
        expect(Builder(StoryboardIds.resume))
        click("Back to documents")
        expect(DocumentsTab)
    }
}
