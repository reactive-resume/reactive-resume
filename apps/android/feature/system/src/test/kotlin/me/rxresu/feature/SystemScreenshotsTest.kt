package me.rxresu.feature.system

import androidx.compose.runtime.CompositionLocalProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import me.rxresu.core.data.*
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.testing.*
import org.junit.Test

class SystemScreenshotsTest : RrScreenshotTest() {
    private fun content(dark: Boolean) {
        val fakes = FakeRepositories()
        val today = runBlocking { fakes.today.observe().first { !it.loading && it.data != null }.data!! }
        val briefing = SystemTarget("application", StoryboardIds.lumen, WorkspaceTab.Prepare)
        val followup = SystemTarget("application", StoryboardIds.fieldnote, WorkspaceTab.Messages)
        val specs = listOf(
            NotificationSpec("briefing", NotificationCategory.InterviewsAndBriefings, "Briefing ready for Lumen", "Technical interview Tue at 10:00. Your briefing and 4 likely questions are ready.", briefing, listOf(NotificationAction("Open briefing", briefing), NotificationAction("Practice", briefing.copy(tab = WorkspaceTab.Practise)))),
            NotificationSpec("followup", NotificationCategory.FollowUps, "Follow up with Fieldnote", "You applied 10 days ago. A short follow-up is usually fine now.", followup, listOf(NotificationAction("Draft follow-up", followup), NotificationAction("Log follow-up", followup, true))),
            NotificationSpec("roles", NotificationCategory.NewRoles, "4 new roles from your search", "Senior product designer at Kiln Studio and 3 more. Nothing is applied for until you choose.", SystemTarget("today")),
        )
        try { captureScreen("X1-Illustration", dark, safeArea = false, wrap = { c -> CompositionLocalProvider(LocalRepositories provides fakes) { c() } }) { SystemContent(specs, today, fakes.time) } } finally { fakes.close() }
    }
    @Test fun light() = content(false)
    @Test fun dark() = content(true)
}
