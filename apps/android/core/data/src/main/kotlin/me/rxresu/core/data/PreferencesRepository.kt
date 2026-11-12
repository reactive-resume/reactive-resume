package me.rxresu.core.data

import android.content.Context
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import me.rxresu.core.network.ApiJson
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

private val Context.rrPreferences by preferencesDataStore(name="preferences")
enum class ThemePreference { Light, Dark, MatchSystem }
enum class NotificationCategory {
    InterviewsAndBriefings, FollowUps, OfferDeadlines, NewRoles, FeedbackComments,
    // Retained for installed preferences and older callers; reads/writes expand to both independent categories.
    FollowUpsAndOfferDeadlines,
}
internal fun migrateNotificationNames(names: Set<String>): Set<String> =
    if (NotificationCategory.FollowUpsAndOfferDeadlines.name in names)
        names - NotificationCategory.FollowUpsAndOfferDeadlines.name + NotificationCategory.FollowUps.name + NotificationCategory.OfferDeadlines.name
    else names

private fun notificationCategories(names: Set<String>): Set<NotificationCategory> =
    NotificationCategory.entries.filter { it.name in migrateNotificationNames(names) }.toSet()
private fun notificationNames(category: NotificationCategory): Set<String> = migrateNotificationNames(setOf(category.name))
/** Device-local intent only; notification copy is fetched from the signed-in account at delivery. */
@Serializable
data class InterviewReminder(
    val owner: String, val origin: String, val device: String,
    val applicationId: String, val entryId: String, val at: String,
    val leadMinutes: Long = 1440, val receipt: String,
) {
    fun sameEvent(other: InterviewReminder) = owner == other.owner && origin == other.origin && device == other.device && applicationId == other.applicationId && entryId == other.entryId
}
data class AppPreferences(
    val theme: ThemePreference = ThemePreference.MatchSystem,
    val haptics: Boolean = true,
    /** null follows Android's animator setting; true requests less motion. */
    val reducedMotion: Boolean? = null,
    val lastTab: String = "today",
    val notifications: Set<NotificationCategory> = emptySet(),
    val interviewReminders: List<InterviewReminder> = emptyList(),
)
interface PreferencesRepository {
    val values: Flow<AppPreferences>
    suspend fun setTheme(theme: ThemePreference)
    suspend fun setHaptics(enabled: Boolean)
    suspend fun setReducedMotion(override: Boolean?)
    suspend fun setLastTab(tab: String)
    suspend fun setNotification(category: NotificationCategory, enabled: Boolean)
    suspend fun setInterviewReminder(reminder: InterviewReminder, enabled: Boolean)
}
class DataStorePreferencesRepository(context: Context) : PreferencesRepository {
    private val store=context.applicationContext.rrPreferences
    private val theme=stringPreferencesKey("theme")
    private val haptics=booleanPreferencesKey("haptics")
    private val motion=booleanPreferencesKey("reducedMotion")
    private val tab=stringPreferencesKey("lastTab")
    private val notifications=stringSetPreferencesKey("notifications")
    private val reminders=stringPreferencesKey("interviewReminders")
    override val values=store.data.map { p -> AppPreferences(
        theme=ThemePreference.entries.firstOrNull { it.name==p[theme] } ?: ThemePreference.MatchSystem,
        haptics=p[haptics] ?: true,reducedMotion=p[motion],lastTab=p[tab] ?: "today",
        notifications=notificationCategories(p[notifications].orEmpty()),
        interviewReminders=p[reminders]?.let { runCatching { ApiJson.decodeFromString<List<InterviewReminder>>(it) }.getOrDefault(emptyList()) }.orEmpty(),
    ) }
    override suspend fun setTheme(theme: ThemePreference) { store.edit { it[this.theme]=theme.name } }
    override suspend fun setHaptics(enabled: Boolean) { store.edit { it[haptics]=enabled } }
    override suspend fun setReducedMotion(override: Boolean?) { store.edit { if(override==null) it.remove(motion) else it[motion]=override } }
    override suspend fun setLastTab(tab: String) { require(tab in setOf("today","documents","applications","career")); store.edit { it[this.tab]=tab } }
    override suspend fun setNotification(category: NotificationCategory, enabled: Boolean) { store.edit { val current=migrateNotificationNames(it[notifications].orEmpty()); it[notifications]=if(enabled) current+notificationNames(category) else current-notificationNames(category) } }
    override suspend fun setInterviewReminder(reminder: InterviewReminder, enabled: Boolean) { store.edit { p ->
        val current=p[reminders]?.let { ApiJson.decodeFromString<List<InterviewReminder>>(it) }.orEmpty().filterNot { it.sameEvent(reminder) }
        p[reminders]=ApiJson.encodeToString(if(enabled) current+reminder else current)
    } }
}
class FakePreferencesRepository(initial: AppPreferences = AppPreferences()) : PreferencesRepository {
    override val values=MutableStateFlow(initial.copy(notifications=notificationCategories(initial.notifications.map { it.name }.toSet())))
    private val mutex=Mutex()
    private suspend fun change(update: (AppPreferences)->AppPreferences) = mutex.withLock { values.value=update(values.value) }
    override suspend fun setTheme(theme: ThemePreference)=change { it.copy(theme=theme) }
    override suspend fun setHaptics(enabled: Boolean)=change { it.copy(haptics=enabled) }
    override suspend fun setReducedMotion(override: Boolean?)=change { it.copy(reducedMotion=override) }
    override suspend fun setLastTab(tab: String) { require(tab in setOf("today","documents","applications","career")); change { it.copy(lastTab=tab) } }
    override suspend fun setNotification(category: NotificationCategory, enabled: Boolean)=change { val names=it.notifications.map { it.name }.toSet(); it.copy(notifications=notificationCategories(if(enabled) names+notificationNames(category) else names-notificationNames(category))) }
    override suspend fun setInterviewReminder(reminder: InterviewReminder, enabled: Boolean)=change { val current=it.interviewReminders.filterNot { old -> old.sameEvent(reminder) }; it.copy(interviewReminders=if(enabled) current+reminder else current) }
}
