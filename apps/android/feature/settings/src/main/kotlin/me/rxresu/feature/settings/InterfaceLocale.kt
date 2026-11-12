package me.rxresu.feature.settings

import android.app.Activity
import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.LocaleList
import androidx.core.content.edit
import java.util.Locale

/**
 * The interface language (S3). Android 13+ keeps a per-app language in [LocaleManager]. Android 8–12 (API 26–32) has
 * none, so the choice is stored here and applied to each activity's context:
 *
 * ```kotlin
 * override fun attachBaseContext(newBase: Context) = super.attachBaseContext(InterfaceLocale.wrap(newBase))
 * ```
 */
object InterfaceLocale {
    private const val FILE = "interface_locale"
    private const val KEY = "language_tag"

    private fun preferences(context: Context) = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** The stored BCP 47 tag ("de-DE"), or null to follow the system. */
    fun saved(context: Context): String? = preferences(context).getString(KEY, null)

    /** Stores [tag] (null follows the system). Committed synchronously so a recreated activity reads it. */
    fun save(context: Context, tag: String?) {
        preferences(context).edit(commit = true) { if (tag == null) remove(KEY) else putString(KEY, tag) }
    }

    /** [base] with the stored language on API 26–32; unchanged on 33+ or when nothing is stored. */
    fun wrap(base: Context): Context {
        if (Build.VERSION.SDK_INT >= 33) return base
        val tag = saved(base) ?: return base
        val locale = Locale.forLanguageTag(tag)
        // Formatters that read the default locale (numbers, money) follow the interface language too.
        Locale.setDefault(locale)
        val configuration = Configuration(base.resources.configuration).apply { setLocales(LocaleList(locale)) }
        return base.createConfigurationContext(configuration)
    }

    /**
     * Applies [tag] as the interface language. Returns true when the activity has to be recreated to show it (API
     * 26–32 with a different stored tag); 33+ hands it to the system, which recreates the activity itself.
     */
    fun apply(context: Context, tag: String): Boolean {
        if (Build.VERSION.SDK_INT >= 33) {
            val manager = context.getSystemService(LocaleManager::class.java)
            if (manager.applicationLocales.toLanguageTags() != tag) manager.applicationLocales = LocaleList.forLanguageTags(tag)
            return false
        }
        if (saved(context) == tag) return false
        save(context, tag)
        return true
    }
}

/** Recreates [activity] after [InterfaceLocale.apply] stored a new language on API 26–32. */
internal fun Activity.applyInterfaceLocale(tag: String) { if (InterfaceLocale.apply(this, tag)) recreate() }
