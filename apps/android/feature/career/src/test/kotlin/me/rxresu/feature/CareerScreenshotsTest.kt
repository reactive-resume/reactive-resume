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
    private var screenshotScale = 1f
    private var rtl = false
    @org.junit.Before fun locale() {
        org.robolectric.RuntimeEnvironment.setQualifiers("+en-rGB")
        android.provider.Settings.System.putString(androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>().contentResolver, android.provider.Settings.System.TIME_12_24, "24")
    }
    private fun capture(id: String, dark: Boolean, fontScale: Float = screenshotScale, content: @Composable (RrRepositories) -> Unit) {
        val fakes = FakeRepositories()
        try { captureScreen(if (rtl) "$id-rtl" else id, dark, fontScale = fontScale, wrap = { c -> CompositionLocalProvider(androidx.compose.ui.platform.LocalLayoutDirection provides if (rtl) androidx.compose.ui.unit.LayoutDirection.Rtl else androidx.compose.ui.unit.LayoutDirection.Ltr, LocalRepositories provides fakes) { c() } }) { content(fakes) } }
        finally { fakes.close() }
    }
    private fun career(dark: Boolean, empty: Boolean = false) {
        val fakes = FakeRepositories(); val data = runBlocking {
            CareerState(loading = false, facts = fakes.career.listCareerFacts(), stories = fakes.career.listCareerStories().let { rows -> List(6) { rows[it % rows.size] } }, threads = fakes.assistant.listAgentThreads().map { it.copy(lastMessageAt = "2026-11-06T18:20:00Z") }, offers = fakes.career.listCareerSavedItems(kind = ListCareerSavedItemsKind.Offer).let { rows -> val offer = rows.first(); listOf(offer.copy(application = offer.application?.copy(company = "Parcel")), offer.copy(id = "meridian-offer", data = (offer.data as Offer).copy(respondBy = "2026-11-20"))) }, schedules = fakes.career.listCareerSchedules(), providers = fakes.ai.listAiProviders(), scheduling = true, initials = "AM", profile = fakes.career.getCareerProfile().copy(targetRoles = listOf("Product design"), locations = listOf("Lisbon or remote")))
        }; fakes.close()
        capture(if (empty) "C1-Career-empty" else "C1-Career", dark) { Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f)) { CareerScreen(if (empty) data.copy(facts = emptyList(), stories = emptyList(), threads = emptyList(), offers = emptyList(), schedules = emptyList()) else data, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}) }
            RrTabBar(rrAppTabs("Today", "Documents", "Applications", "Career"), 3, {})
        } }
    }
    private fun coach(dark: Boolean) = capture("C2-Coach", dark) { fakes ->
        val provider = runBlocking { fakes.ai.listAiProviders().first().copy(model = "gpt-5") }
        CoachScreen(CoachState(loading = false, providers = listOf(provider), selected = provider.id, knowledgeReady = true, pendingFacts = listOf(CoachFact("remember-office", SaveCareerFactRequest(category = SaveCareerFactRequestCategory.Preference, source = SaveCareerFactRequestSource("question", ExportAccountDataResponseCareerFactsItemSourceKind.UserMessage, "At most 2 office days a week"), text = "At most 2 office days a week"))), server = "https://example.invalid", messages = listOf(
            CoachMessage("question", "Which opportunities best match my priorities?", true, used = buildJsonObject { put("preferences", true); put("applications", true) }),
            CoachMessage("reply", "Two of your open roles meet your must-haves:\n\n1. **Lumen**: hybrid in Lisbon, design systems focus. Interview Tuesday.\n2. **Kiln Studio**: remote-friendly, but the posting doesn't state pay. Worth asking before you apply.\n\nParcel & Co. asks for 3 office days, above your limit of 2.", false, parts = listOf(buildJsonObject { put("type", "source-url"); put("url", "https://kiln.studio") }))
        )), {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {})
    }
    private fun facts(dark: Boolean) = capture("C3-Facts", dark) { fakes ->
        val base = runBlocking { fakes.career.listCareerFacts() }
        val facts = listOf(
            base[0].copy(text = "Led the onboarding redesign at Northwind Labs", category = "experience", company = null),
            base[1].copy(text = "Activation rose from 41% to 58% after it", category = "accomplishment", company = null),
            base[2].copy(text = "Took part in the accessibility audit", category = "experience", company = null, source = base[1].source),
            base[3].copy(text = "Design systems used by six teams", category = "skill", company = null),
        )
        KnowledgeScreen(FactsState(loading = false, facts = facts, stories = runBlocking { fakes.career.listCareerStories() }), KnowledgeTab.Facts, {}, "", {}, null, {}, false, {}, "", {}, {}, {}, {}, {}, {}, {}, {}, {})
    }
    private fun story(dark: Boolean) = capture("C4-Story", dark) { fakes ->
        val s = runBlocking { fakes.career.listCareerStories().first() }
        StoryScreen(StoryState(false, SaveCareerStoryRequest(action = "Ran 18 interviews, cut setup from nine steps to four, and paired with engineering on a guided first report.", applicationId = s.applicationId, factIds = s.data.factIds, id = s.id, result = "Activation reached 58% in two quarters; support tickets about setup halved.", situation = "New customers stalled in setup; only 41% reached their first report.", tags = listOf("Leadership", "Measurable impact", "Research"), task = "Improve activation", title = "Rebuilding onboarding at Northwind"), usedFor = "Lumen", briefingUses = 2), {}, {}, {}, {}, {}, {})
    }

    private fun preferences(dark: Boolean, fontScale: Float = screenshotScale) = capture("C5-Preferences", dark, fontScale) { fakes ->
        val p = runBlocking { fakes.career.getCareerProfile() }.copy(targetRoles = listOf("Senior product designer", "design lead"), locations = listOf("Lisbon", "remote in the EU"), minBase = SaveCareerProfileRequestMinBase(65000.0, "EUR", CreateCareerOfferRequestPeriod.Year), priorities = "Gambling, defence")
        PreferencesScreen(PreferencesState(false, p, schedules = runBlocking { fakes.career.listCareerSchedules() }, scheduling = true), {}, {}, {}, {})
    }
    private fun offers(dark: Boolean, count: Int = 2) = capture(when { count > 2 -> "C6-Offers-three"; count == 1 -> "C6-Offers-requirements"; else -> "C6-Offers" }, dark) { fakes ->
        val state = runBlocking {
            val original = fakes.career.listCareerSavedItems(kind = ListCareerSavedItemsKind.Offer).first()
            val offer = original.data as Offer
            val parcel = original.copy(createdAt = "2026-11-07T09:00:00Z", data = offer.copy(base = 72000.0, variablePercent = 10.0, variable = null, equity = null, location = "Hybrid", officeDays = 3, leave = "25 days", startDate = "2026-12-01", respondBy = "2026-11-13"))
            val meridian = original.copy(id = "meridian-offer", applicationId = "meridian", createdAt = "2026-11-06T09:00:00Z", application = original.application?.copy(company = "Meridian"), data = offer.copy(base = 68000.0, variablePercent = null, variable = null, equity = "0.1% · 4 years", location = "Remote", officeDays = 0, leave = "23 days", startDate = "2027-01-04", respondBy = "2026-11-20"))
            OffersState(false, offers = (listOf(parcel, meridian) + if (count > 2) listOf(meridian.copy(id = "third", application = meridian.application?.copy(company = "Third company"))) else emptyList()).take(count), profile = fakes.career.getCareerProfile())
        }
        OffersScreen(state, {}, {}, {}, {}, {})
    }
    private fun schedule(dark: Boolean) = capture("C7-Schedule", dark) { fakes ->
        val state = runBlocking { ScheduleState(false, available = true, providers = fakes.ai.listAiProviders(), profile = fakes.career.getCareerProfile(), email = "alex@morgan.design", emailVerified = true) }
        Box(Modifier.fillMaxSize()) {
            Column {
                RrLargeTitleHeader("Career", rememberRrLargeTitleState())
                RrText("Your coach, and what it knows about you.", Modifier.padding(horizontal = androidx.compose.ui.unit.Dp(24f)), style = RrType.ui, color = RrTheme.colors.ink3)
            }
            ScheduleScreen(state, fakes.time.today(), fakes.time.timezone(), {}, {}, {}, {})
        }
    }
    @Test fun storiesList() = capture("C3-Stories", false) { fakes ->
        val state = runBlocking { FactsState(loading = false, facts = fakes.career.listCareerFacts(), stories = fakes.career.listCareerStories(), briefingUses = storyBriefingUses(fakes.career.listCareerSavedItems(kind = ListCareerSavedItemsKind.Briefing))) }
        KnowledgeScreen(state, KnowledgeTab.Stories, {}, "", {}, null, {}, false, {}, "", {}, {}, {}, {}, {}, {}, {}, {}, {})
    }
    @Test fun offersThree() = offers(false, 3)
    @Test fun offersRequirements() {
        offers(false, 1)
        val layout = java.io.File(System.getProperty("rr.fidelity.dir", "../../build/fidelity"), "C6-Offers-requirements-light.json").readText()
        org.junit.Assert.assertTrue(layout.contains("2 at most"))
        org.junit.Assert.assertTrue(layout.contains("4 weeks notice"))
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
    @Test fun careerFont200() { screenshotScale = 2f; career(false) }
    @Test fun coachFont200() { screenshotScale = 2f; coach(false) }
    @Test fun factsFont200() { screenshotScale = 2f; facts(false) }
    @Test fun storyFont200() { screenshotScale = 2f; story(false) }
    @Test fun offersFont200() { screenshotScale = 2f; offers(false) }
    @Test fun scheduleFont200() { screenshotScale = 2f; schedule(false) }
    @Test fun careerRtl() { rtl = true; career(false) }
    @Test fun coachRtl() { rtl = true; coach(false) }
    @Test fun factsRtl() { rtl = true; facts(false) }
    @Test fun storyRtl() { rtl = true; story(false) }
    @Test fun preferencesRtl() { rtl = true; preferences(false) }
    @Test fun offersRtl() { rtl = true; offers(false) }
    @Test fun scheduleRtl() { rtl = true; schedule(false) }

}
