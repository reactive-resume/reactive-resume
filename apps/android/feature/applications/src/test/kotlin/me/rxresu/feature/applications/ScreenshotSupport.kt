package me.rxresu.feature.applications

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import me.rxresu.core.data.FakeControls
import me.rxresu.core.data.FakeRepositories
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.designsystem.RrToastHostState
import me.rxresu.core.navigation.LocalToasts

/** Storyboard screens use UK formats ("Tue 10 Nov", 24-hour times). */
const val GB_SCREEN = me.rxresu.core.testing.RR_SCREEN_QUALIFIERS

/** Fake repositories plus the app-wide locals screens read. */
fun fakeWrap(repos: RrRepositories = FakeRepositories(FakeControls())): @Composable (@Composable () -> Unit) -> Unit {
    android.provider.Settings.System.putString(androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>().contentResolver, android.provider.Settings.System.TIME_12_24, "24")
    return { content ->
    CompositionLocalProvider(androidx.compose.ui.platform.LocalConfiguration provides android.content.res.Configuration(androidx.compose.ui.platform.LocalConfiguration.current).apply { setLocale(java.util.Locale.UK) }, LocalRepositories provides repos, LocalToasts provides RrToastHostState()) { content() }
}

}

/** Screen-specific storyboard fixtures keep the shared transport and production view models. */
fun applicationStoryboard(insights: Boolean = false, detail: Boolean = false, calendar: Boolean = false, interview: Boolean = false): RrRepositories {
    val controls = FakeControls()
    val base = if (calendar) FakeRepositories(controls, time = me.rxresu.core.data.TimeSource(java.time.Clock.fixed(java.time.Instant.parse("2026-11-10T09:00:00Z"), java.time.ZoneId.of("Europe/Lisbon"))) { java.time.ZoneId.of("Europe/Lisbon") }) else FakeRepositories(controls)
    val original = kotlinx.coroutines.runBlocking { base.applications.listApplications() }
    val lumen = original.first { it.id == me.rxresu.core.data.StoryboardIds.lumen }
    val notes = listOf("Confirm the interview format.", "Prepare a design system example.", "Ask about ownership.").mapIndexed { i, text ->
        me.rxresu.core.network.generated.NoteTimelineEntry(at = "2026-11-06T12:0${i}:00Z", id = "lumen-note-$i", text = text, type = me.rxresu.core.network.generated.AddApplicationInterviewResponseActivityItemNoteType.Note)
    }
    val additionalApplied = if (insights || calendar || detail || interview) emptyList() else kotlinx.coroutines.runBlocking {
        original.filter { it.id in setOf("application-closed-0", "application-closed-1") }.mapIndexed { index, app ->
            val id = base.applications.createApplication(me.rxresu.core.network.generated.CreateApplicationRequest(
                newId = "application-applied-storyboard-$index",
                company = app.company,
                role = app.role,
                location = app.location,
                status = me.rxresu.core.network.generated.ApplicationStage.Applied,
                stageEnteredAt = "2026-10-28",
                resumeId = app.resumeId,
                jobDescription = app.jobDescription,
                source = app.source,
                tags = app.tags,
            ))
            base.applications.getApplication(id)
        }
    }
    val apps = if (insights) {
        (0 until 18).map { i ->
            val stage = when (i) { 1, 3 -> me.rxresu.core.network.generated.ApplicationStage.Interview; 4 -> me.rxresu.core.network.generated.ApplicationStage.Offer; 0, 5, 9, 10 -> me.rxresu.core.network.generated.ApplicationStage.Screening; else -> me.rxresu.core.network.generated.ApplicationStage.Applied }
            val applied = me.rxresu.core.network.generated.StageTimelineEntry(at = "2026-11-01T09:00:00Z", id = "sent-$i", stage = me.rxresu.core.network.generated.ApplicationStage.Applied, type = me.rxresu.core.network.generated.AddApplicationInterviewResponseActivityItemStageType.Stage, canonicalTransition = true)
            lumen.copy(id = "insights-$i", source = if (i < 3) "Referrals" else if (i < 9) "Company sites" else "Job boards", status = stage, appliedAt = applied.at,
                activity = listOf(applied) + if (stage == me.rxresu.core.network.generated.ApplicationStage.Applied) emptyList() else listOf(applied.copy(id = "reply-$i", at = "2026-11-07T09:00:00Z", stage = stage)))
        }
    } else original.map { app ->
        when {
            app.id == me.rxresu.core.data.StoryboardIds.lumen -> app.copy(activity = app.activity.map { if (interview && it is me.rxresu.core.network.generated.Interview) it.copy(location = "meet.lumen.com/design-loop") else it } + notes)
            app.company == "Orbital Health" && app.status != me.rxresu.core.network.generated.ApplicationStage.Closed -> app.copy(status = me.rxresu.core.network.generated.ApplicationStage.Interview, role = "Product designer")
            calendar && app.id == me.rxresu.core.data.StoryboardIds.fieldnote -> app.copy(followUpAt = "2026-11-10T17:00:00Z")
            app.id == me.rxresu.core.data.StoryboardIds.kiln -> app.copy(appliedAt = "2026-11-04T14:20:00Z")
            app.company == "Parcel & Co." && app.status != me.rxresu.core.network.generated.ApplicationStage.Closed -> app.copy(role = "Lead designer")
            else -> app
        }
    }
    // J1 specifies six closed records; the shared fake keeps its other closed scenarios available by ID.
    val storyboardClosedIds = (0..5).map { "application-closed-$it" }.toSet()
    val fixtureApplications = (apps + additionalApplied).filter { it.status != me.rxresu.core.network.generated.ApplicationStage.Closed || it.id in storyboardClosedIds }
    val responses = mutableMapOf<String, kotlinx.serialization.json.JsonElement>("listApplications" to me.rxresu.core.network.ApiJson.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(me.rxresu.core.network.generated.Application.serializer()), fixtureApplications))
    val lanes = kotlinx.coroutines.runBlocking { base.applications.getApplicationLanes() }
    responses["getApplicationLanes"] = me.rxresu.core.network.ApiJson.encodeToJsonElement(me.rxresu.core.network.generated.GetApplicationLanesResponse.serializer(), lanes.copy(lanes = lanes.lanes.map { if (it.category == me.rxresu.core.network.generated.ApplicationStage.Interview) it.copy(label = "Interviewing") else it }))
    if (detail) {
        val saved = kotlinx.coroutines.runBlocking { base.career.listCareerSavedItems(applicationId = lumen.id) }
        val draft = kotlinx.coroutines.runBlocking { base.career.listCareerSavedItems(applicationId = me.rxresu.core.data.StoryboardIds.fieldnote) }.firstOrNull { it.data is me.rxresu.core.network.generated.MessageDraft }
        val edited = saved.map { if (it.data is me.rxresu.core.network.generated.PracticeAttempt) it.copy(createdAt = "2026-11-05T08:12:00Z") else it } + listOfNotNull(draft?.copy(id = "lumen-thank-you", applicationId = lumen.id))
        responses["listCareerSavedItems"] = me.rxresu.core.network.ApiJson.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(me.rxresu.core.network.generated.SavedItem.serializer()), edited)
    }
    controls.responses.value = responses
    val result = base
    if (interview) kotlinx.coroutines.runBlocking {
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        result.preferences.setNotification(me.rxresu.core.data.NotificationCategory.InterviewsAndBriefings, true)
        val entry = apps.first { it.id == lumen.id }.activity.filterIsInstance<me.rxresu.core.network.generated.Interview>().first { it.id == me.rxresu.core.data.StoryboardIds.interview }
        result.preferences.setInterviewReminder(me.rxresu.core.data.InterviewReminder("storyboard-alex", "https://example.invalid",
            me.rxresu.feature.system.interviewReminderDevice(context), lumen.id, entry.id, entry.at, receipt = "storyboard-interview-reminder"), true)
    }
    return result
}
