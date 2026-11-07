package me.rxresu.core.data

import android.content.Context
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

private val Context.rrPreferences by preferencesDataStore(name="preferences")
enum class ThemePreference { Light, Dark, MatchSystem }
enum class NotificationCategory { InterviewsAndBriefings, FollowUpsAndOfferDeadlines, NewRoles, FeedbackComments }
data class AppPreferences(
    val theme: ThemePreference = ThemePreference.MatchSystem,
    val haptics: Boolean = true,
    /** null follows Android's animator setting; true requests less motion. */
    val reducedMotion: Boolean? = null,
    val lastTab: String = "today",
    val notifications: Set<NotificationCategory> = emptySet(),
)
interface PreferencesRepository {
    val values: Flow<AppPreferences>
    suspend fun setTheme(theme: ThemePreference)
    suspend fun setHaptics(enabled: Boolean)
    suspend fun setReducedMotion(override: Boolean?)
    suspend fun setLastTab(tab: String)
    suspend fun setNotification(category: NotificationCategory, enabled: Boolean)
}
class DataStorePreferencesRepository(context: Context) : PreferencesRepository {
    private val store=context.applicationContext.rrPreferences
    private val theme=stringPreferencesKey("theme")
    private val haptics=booleanPreferencesKey("haptics")
    private val motion=booleanPreferencesKey("reducedMotion")
    private val tab=stringPreferencesKey("lastTab")
    private val notifications=stringSetPreferencesKey("notifications")
    override val values=store.data.map { p -> AppPreferences(
        theme=ThemePreference.entries.firstOrNull { it.name==p[theme] } ?: ThemePreference.MatchSystem,
        haptics=p[haptics] ?: true,reducedMotion=p[motion],lastTab=p[tab] ?: "today",
        notifications=NotificationCategory.entries.filter { it.name in p[notifications].orEmpty() }.toSet(),
    ) }
    override suspend fun setTheme(theme: ThemePreference) { store.edit { it[this.theme]=theme.name } }
    override suspend fun setHaptics(enabled: Boolean) { store.edit { it[haptics]=enabled } }
    override suspend fun setReducedMotion(override: Boolean?) { store.edit { if(override==null) it.remove(motion) else it[motion]=override } }
    override suspend fun setLastTab(tab: String) { require(tab in setOf("today","documents","applications","career")); store.edit { it[this.tab]=tab } }
    override suspend fun setNotification(category: NotificationCategory, enabled: Boolean) { store.edit { it[notifications]=if(enabled) it[notifications].orEmpty()+category.name else it[notifications].orEmpty()-category.name } }
}
class FakePreferencesRepository(initial: AppPreferences = AppPreferences()) : PreferencesRepository {
    override val values=MutableStateFlow(initial)
    private val mutex=Mutex()
    private suspend fun change(update: (AppPreferences)->AppPreferences) = mutex.withLock { values.value=update(values.value) }
    override suspend fun setTheme(theme: ThemePreference)=change { it.copy(theme=theme) }
    override suspend fun setHaptics(enabled: Boolean)=change { it.copy(haptics=enabled) }
    override suspend fun setReducedMotion(override: Boolean?)=change { it.copy(reducedMotion=override) }
    override suspend fun setLastTab(tab: String) { require(tab in setOf("today","documents","applications","career")); change { it.copy(lastTab=tab) } }
    override suspend fun setNotification(category: NotificationCategory, enabled: Boolean)=change { it.copy(notifications=if(enabled) it.notifications+category else it.notifications-category) }
}
