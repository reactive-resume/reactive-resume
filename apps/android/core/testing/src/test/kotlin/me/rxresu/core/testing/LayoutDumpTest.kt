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
