package me.rxresu.feature.career

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import me.rxresu.core.data.*
import me.rxresu.core.designsystem.*
import me.rxresu.core.navigation.KnowledgeTab
import me.rxresu.core.network.generated.*
import me.rxresu.core.testing.*
import org.junit.Test

class CareerScreenshotsTest : RrScreenshotTest() {
    private fun capture(id: String, dark: Boolean, fontScale: Float = 1f, content: @Composable (RrRepositories) -> Unit) {
        val fakes = FakeRepositories()
        try { captureScreen(id, dark, fontScale = fontScale, wrap = { c -> CompositionLocalProvider(LocalRepositories provides fakes) { c() } }) { content(fakes) } }
        finally { fakes.close() }
    }
    private fun career(dark: Boolean, empty: Boolean = false) {
        val fakes = FakeRepositories(); val data = runBlocking {
            CareerState(loading = false, facts = fakes.career.listCareerFacts(), stories = fakes.career.listCareerStories(), threads = fakes.assistant.listAgentThreads(), offers = fakes.career.listCareerSavedItems(kind = ListCareerSavedItemsKind.Offer), schedules = fakes.career.listCareerSchedules(), providers = fakes.ai.listAiProviders(), scheduling = true, initials = "AM")
        }; fakes.close()
        capture(if (empty) "C1-Career-empty" else "C1-Career", dark) { Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f)) { CareerScreen(if (empty) data.copy(facts = emptyList(), stories = emptyList(), threads = emptyList(), offers = emptyList(), schedules = emptyList()) else data, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}) }
            RrTabBar(rrAppTabs("Today", "Documents", "Applications", "Career"), 3, {})
        } }
    }
    private fun coach(dark: Boolean) = capture("C2-Coach", dark) { fakes ->
        val provider = runBlocking { fakes.ai.listAiProviders().first() }
        CoachScreen(CoachState(loading = false, providers = listOf(provider), selected = provider.id, knowledgeReady = true, pendingFacts = listOf(CoachFact("remember-office", SaveCareerFactRequest(category = SaveCareerFactRequestCategory.Preference, source = SaveCareerFactRequestSource("question", ExportAccountDataResponseCareerFactsItemSourceKind.UserMessage, "At most 2 office days a week"), text = "At most 2 office days a week"))), server = "https://example.invalid", messages = listOf(
            CoachMessage("question", "Which opportunities best match my priorities?", true, used = buildJsonObject { put("preferences", true); put("applications", true) }),
            CoachMessage("reply", "Two of your open roles meet your must-haves:\n\n1. Lumen: hybrid in Lisbon, design systems focus. Interview Tuesday.\n\n2. Kiln Studio: remote-friendly, but the posting doesn't state pay. Worth asking before you apply.\nParcel & Co. asks for 3 office days, above your limit of 2.", false)
        )), {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {})
    }
    private fun facts(dark: Boolean) = capture("C3-Facts", dark) { fakes ->
        val facts = runBlocking { fakes.career.listCareerFacts() }.take(4)
        KnowledgeScreen(FactsState(loading = false, facts = facts), KnowledgeTab.Facts, {}, "", {}, null, {}, false, {}, "", {}, {}, {}, {}, {}, {}, {}, {}, {})
    }
    private fun story(dark: Boolean) = capture("C4-Story", dark) { fakes ->
        val s = runBlocking { fakes.career.listCareerStories().first() }
        StoryScreen(StoryState(false, SaveCareerStoryRequest(s.data.action, s.applicationId, s.data.factIds, s.id, s.data.reflection, s.data.result, s.data.situation, s.data.tags, s.data.task, s.data.title)), {}, {}, {}, {}, {}, {})
    }
    private fun preferences(dark: Boolean, fontScale: Float = 1f) = capture("C5-Preferences", dark, fontScale) { fakes ->
        val p = runBlocking { fakes.career.getCareerProfile() }
        PreferencesScreen(PreferencesState(false, p), {}, {}, {}, {})
    }
    private fun offers(dark: Boolean) = capture("C6-Offers", dark) { fakes ->
        val state = runBlocking { OffersState(false, offers = fakes.career.listCareerSavedItems(kind = ListCareerSavedItemsKind.Offer), profile = fakes.career.getCareerProfile()) }
        OffersScreen(state, {}, {}, {}, {}, {})
    }
    private fun schedule(dark: Boolean) = capture("C7-Schedule", dark) { fakes ->
        val state = runBlocking { ScheduleState(false, available = true, providers = fakes.ai.listAiProviders(), profile = fakes.career.getCareerProfile(), email = "alex@morgan.design", emailVerified = true) }
        ScheduleScreen(state, fakes.time.today(), fakes.time.timezone(), {}, {}, {}, {})
    }
    @Test fun careerLight() = career(false)
    @Test fun careerDark() = career(true)
    @Test fun careerEmpty() = career(false, true)
    @Test fun coachLight() = coach(false)
    @Test fun coachDark() = coach(true)
    @Test fun factsLight() = facts(false)
    @Test fun factsDark() = facts(true)
    @Test fun storyLight() = story(false)
    @Test fun storyDark() = story(true)
    @Test fun preferencesLight() = preferences(false)
    @Test fun preferencesDark() = preferences(true)
    @Test fun preferencesFont200() = preferences(false, 2f)
    @Test fun offersLight() = offers(false)
    @Test fun offersDark() = offers(true)
    @Test fun scheduleLight() = schedule(false)
    @Test fun scheduleDark() = schedule(true)
}
