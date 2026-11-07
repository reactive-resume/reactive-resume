package me.rxresu.feature.settings

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.util.Locale
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
class InterfaceLocaleTest {
    private val context get() = ApplicationProvider.getApplicationContext<Context>()
    private val original = Locale.getDefault()
    @After fun cleanup() { InterfaceLocale.save(context, null); Locale.setDefault(original) }

    @Test @Config(sdk = [32])
    fun olderAndroidStoresTheLanguageAndAppliesItToNewContexts() {
        assertSame(context, InterfaceLocale.wrap(context))
        assertTrue(InterfaceLocale.apply(context, "de-DE"))
        assertFalse(InterfaceLocale.apply(context, "de-DE"))
        val wrapped = InterfaceLocale.wrap(context)
        assertEquals(Locale.GERMANY, wrapped.resources.configuration.locales[0])
        assertEquals(Locale.GERMANY, Locale.getDefault())
    }

    @Test @Config(sdk = [36])
    fun android13AndLaterLeaveItToTheSystem() {
        assertFalse(InterfaceLocale.apply(context, "de-DE"))
        assertNull(InterfaceLocale.saved(context))
        assertSame(context, InterfaceLocale.wrap(context))
    }
}
