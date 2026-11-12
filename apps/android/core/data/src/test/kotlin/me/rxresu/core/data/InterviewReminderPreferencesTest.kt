package me.rxresu.core.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class InterviewReminderPreferencesTest {
    @Test fun persistedDeviceChoiceSurvivesRepositoryRecreationAndReplacementIsScoped() = runTest {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val first = DataStorePreferencesRepository(context)
        val reminder = InterviewReminder("account", "https://example.invalid", "device", "application", "entry", "2026-11-10T10:00:00Z", receipt = "first")
        val other = reminder.copy(owner = "other-account", receipt = "other")
        first.setInterviewReminder(reminder, true)
        first.setInterviewReminder(other, true)
        first.setNotification(NotificationCategory.FollowUpsAndOfferDeadlines, true)
        val replacement = reminder.copy(at = "2026-11-11T10:00:00Z", receipt = "replacement")
        first.setInterviewReminder(replacement, true)
        val restarted = DataStorePreferencesRepository(context)
        assertEquals(listOf(other, replacement), restarted.values.first().interviewReminders)
        assertEquals(setOf(NotificationCategory.FollowUps, NotificationCategory.OfferDeadlines), restarted.values.first().notifications)
        restarted.setInterviewReminder(replacement, false)
        assertEquals(listOf(other), first.values.first().interviewReminders)
    }
}
