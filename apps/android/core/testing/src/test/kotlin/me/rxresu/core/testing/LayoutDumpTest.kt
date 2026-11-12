package me.rxresu.core.testing

import android.view.View
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.LocalRrDesignTags
import me.rxresu.core.designsystem.R
import me.rxresu.core.designsystem.RrCard
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class LayoutDumpTest : RrScreenshotTest() {
    @get:Rule val rule = createComposeRule()
    @get:Rule val temporary = TemporaryFolder()

    @Test fun measuredGeometryAndMetadataLight() = assertDump(dark = false)
    @Test fun measuredGeometryAndMetadataDark() = assertDump(dark = true)

    @Test fun nativeTextInsideAndroidViewUsesItsPaintedLayout() {
        var view: View? = null
        rule.setContent {
            view = LocalView.current
            Box(Modifier.fillMaxSize().padding(start = 24.dp, top = 47.dp)) {
                androidx.compose.ui.viewinterop.AndroidView(factory = { context ->
                    android.widget.TextView(context).apply {
                        text = "Native notification title"
                        textSize = 16f
                        includeFontPadding = false
                        setPadding(16, 8, 0, 0)
                    }
                })
            }
        }
        val out = temporary.newFile("native.json")
        rule.runOnIdle { requireNotNull(view).writeLayoutDump(out) }
        val element = JSONObject(out.readText()).getJSONArray("elements").single("text", "Native notification title")
        assertEquals(32.0, element.getDouble("x"), 0.5)
        assertEquals(51.0, element.getDouble("y"), 0.5)
        assertEquals("android.widget.TextView", element.getString("nativeView"))
        assertEquals(16.0, element.getJSONObject("style").getDouble("size"), 0.0)
        org.junit.Assert.assertTrue(element.getDouble("w") > 100)
        org.junit.Assert.assertTrue(element.getDouble("h") > 0)
        org.junit.Assert.assertFalse("Native system fonts must not be labelled Figtree", element.getJSONObject("style").has("family"))
    }

    @Test fun unattachedNativeTextUsesNestedLayoutAndScrollCoordinates() {
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        val root = android.widget.FrameLayout(context)
        val container = android.widget.FrameLayout(context)
        val text = android.widget.TextView(context).apply {
            this.text = "Unattached native title"
            textSize = 16f
            includeFontPadding = false
            setPadding(12, 8, 0, 0)
        }
        root.addView(container, android.widget.FrameLayout.LayoutParams(500, 200).apply {
            leftMargin = 40; topMargin = 60
        })
        container.addView(text, android.widget.FrameLayout.LayoutParams(400, 100).apply {
            leftMargin = 20; topMargin = 30
        })
        root.measure(View.MeasureSpec.makeMeasureSpec(780, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(1688, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, 780, 1688)
        container.scrollTo(4, 6)
        text.scrollTo(2, 3)
        val out = temporary.newFile("unattached-native.json")
        root.writeLayoutDump(out)
        val element = JSONObject(out.readText()).getJSONArray("elements").single("text", "Unattached native title")
        val density = context.resources.displayMetrics.density.toDouble()
        assertEquals((40 + 20 - 4 + 12 - 2) / density, element.getDouble("x"), 0.5)
        assertEquals((60 + 30 - 6 + 8 - 3) / density, element.getDouble("y"), 0.5)
        assertEquals(text.layout.height / density, element.getDouble("h"), 0.0)
    }

    @Test @org.robolectric.annotation.Config(sdk = [26])
    fun nativeTextOnApi26DoesNotInventUnavailableTypefaceWeight() {
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        val text = android.widget.TextView(context).apply { this.text = "Native API 26"; textSize = 16f }
        text.measure(View.MeasureSpec.makeMeasureSpec(400, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(100, View.MeasureSpec.EXACTLY))
        text.layout(0, 0, 400, 100)
        val out = temporary.newFile("native-api26.json")
        text.writeLayoutDump(out)
        val element = JSONObject(out.readText()).getJSONArray("elements").single("text", "Native API 26")
        org.junit.Assert.assertFalse(element.getJSONObject("style").has("weight"))
        assertEquals(16.0, element.getJSONObject("style").getDouble("size"), 0.0)
        org.junit.Assert.assertTrue(element.getString("nativeTypeface").isNotEmpty())
    }

    private fun assertDump(dark: Boolean) {
        var view: View? = null
        rule.setContent {
            view = LocalView.current
            CompositionLocalProvider(LocalRrDesignTags provides true) {
                RrTheme(darkTheme = dark) {
                    Box(Modifier.fillMaxSize().padding(start = 24.dp, top = 47.dp, end = 24.dp)) {
                        RrCard(Modifier.height(160.dp), contentPadding = PaddingValues(24.dp)) {
                            RrText("Northwind Labs", style = RrType.rowTitle, color = RrTheme.colors.ink2)
                            RrIcon(R.drawable.ic_ph_plus, "Add", size = 20.dp, tint = RrTheme.colors.ink3)
                            RrIcon(R.drawable.ic_ph_caret_right, null, size = 16.dp, tint = RrTheme.colors.accentText)
                        }
                    }
                }
            }
        }
        val out = temporary.newFile("actual.json")
        rule.runOnIdle { requireNotNull(view).writeLayoutDump(out) }
        val elements = JSONObject(out.readText()).getJSONArray("elements")
        assertEquals("One component, text and two icons; no duplicate BasicText child", 4, elements.length())

        val card = elements.single("component", "Card")
        assertBox(card, 24.0, 47.0, 342.0, 160.0)
        assertEquals(16.0, card.getDouble("radius"), 0.0)
        assertEquals("surface", card.getString("bg"))

        val text = elements.single("text", "Northwind Labs")
        // B2-Section's measured row-title textBox is 114.5 dp wide; glyph widths allow 4 dp.
        assertEquals(114.5, text.getDouble("w"), 4.0)
        assertEquals(48.0, text.getDouble("x"), 1.0)
        assertEquals(71.0, text.getDouble("y"), 1.0)
        assertEquals(24.0, text.getDouble("h"), 1.0)
        val textStyle = text.getJSONObject("style")
        assertEquals("Figtree", textStyle.getString("family"))
        assertEquals(16.0, textStyle.getDouble("size"), 0.0)
        assertEquals(24.0, textStyle.getDouble("lineHeight"), 0.0)
        assertEquals(500, textStyle.getInt("weight"))
        assertEquals("ink-2", textStyle.getString("color"))

        val icon = elements.single("icon", "plus")
        assertBox(icon, 48.0, 105.0, 20.0, 20.0)
        assertEquals("regular", icon.getString("iconWeight"))
        assertEquals("ink-3", icon.getJSONObject("style").getString("color"))

        val decorative = elements.single("icon", "caret-right")
        assertBox(decorative, 48.0, 135.0, 16.0, 16.0)
        assertEquals("accent-text", decorative.getJSONObject("style").getString("color"))
    }

    private fun JSONArray.single(key: String, value: String): JSONObject =
        (0 until length()).map(::getJSONObject).single { it.optString(key) == value }

    private fun assertBox(element: JSONObject, x: Double, y: Double, width: Double, height: Double) {
        for ((key, expected) in listOf("x" to x, "y" to y, "w" to width, "h" to height)) {
            assertEquals("$key in $element", expected, element.getDouble(key), 1.0)
        }
    }
}
