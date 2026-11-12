package me.rxresu.core.data

import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class NotificationPreferencesTest {
    @Test fun legacyFlagMigratesWithoutDroppingUnknownStoredCategories() {
        val migrated = migrateNotificationNames(setOf("FollowUpsAndOfferDeadlines", "NewRoles", "FutureCategory"))
        assertEquals(setOf("FollowUps", "OfferDeadlines", "NewRoles", "FutureCategory"), migrated)
        assertEquals(migrated, migrateNotificationNames(migrated))
        assertEquals(emptySet<String>(), migrateNotificationNames(emptySet()))
    }

    @Test fun migratedSwitchesRemainIndependentAndLegacyCallerCanSetBoth() = runTest {
        val repository = FakePreferencesRepository(AppPreferences(notifications = setOf(NotificationCategory.FollowUpsAndOfferDeadlines)))
        assertEquals(setOf(NotificationCategory.FollowUps, NotificationCategory.OfferDeadlines), repository.values.value.notifications)
        repository.setNotification(NotificationCategory.FollowUps, false)
        assertEquals(setOf(NotificationCategory.OfferDeadlines), repository.values.value.notifications)
        repository.setNotification(NotificationCategory.FollowUps, true)
        repository.setNotification(NotificationCategory.OfferDeadlines, false)
        assertEquals(setOf(NotificationCategory.FollowUps), repository.values.value.notifications)
        repository.setNotification(NotificationCategory.FollowUpsAndOfferDeadlines, false)
        assertTrue(repository.values.value.notifications.isEmpty())
    }
}
