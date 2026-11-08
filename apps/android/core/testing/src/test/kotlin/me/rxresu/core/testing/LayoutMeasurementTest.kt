package me.rxresu.core.testing

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.view.View
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.test.click
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import kotlinx.coroutines.runBlocking
import me.rxresu.core.designsystem.DesignTag
import me.rxresu.core.designsystem.LocalRrDesignTags
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrPaperPage
import me.rxresu.core.designsystem.RrPickerField
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rrDesignTag
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class LayoutMeasurementTest : RrScreenshotTest() {
    @get:Rule val rule = createComposeRule()
    @get:Rule val temporary = TemporaryFolder()
    private var view: View? = null

    @Test fun rowMeasuresContentAndRetainsMarginTouchTarget() {
        var clicks = 0
        setContent { RrListRow("Account", onClick = { clicks++ }) }
        val target = rule.onNode(hasClickAction())
        val bounds = target.getUnclippedBoundsInRoot()
        assertEquals(0f, bounds.left.value, 1f)
        assertEquals(390f, (bounds.right - bounds.left).value, 1f)
        target.performTouchInput { click(Offset(12f, centerY)) }
        rule.runOnIdle { assertEquals(1, clicks) }
        assertBox(dump().single("component", "ListRow"), 24.0, 0.0, 342.0, 64.0)
    }

    @Test fun wrappingRowTitleMeasuresTwoLinesAndGrowingRow() {
        val title = "Read your resumes, letters and job applications"
        setContent { RrListRow(title, titleMaxLines = 2, divider = true, leading = { Box(Modifier.size(40.dp)) }) }
        val elements = dump()
        assertEquals(48.0, elements.single("text", title).getDouble("h"), 1.0)
        assertBox(elements.single("component", "ListRow"), 24.0, 0.0, 342.0, 73.0)
    }

    @Test fun fieldValuesMeasureEditingAndPickerSlots() {
        setContent {
            Column(Modifier.padding(horizontal = 24.dp)) {
                RrTextField("alex@example.test", {})
                RrTextField("Alex Morgan", {})
                RrPickerField("OpenAI", {})
            }
        }
        val elements = dump()
        assertBox(elements.single("text", "alex@example.test"), 36.0, 11.0, 318.0, 22.0)
        assertBox(elements.single("text", "Alex Morgan"), 36.0, 55.0, 318.0, 22.0)
        assertBox(elements.single("text", "OpenAI"), 36.0, 99.0, 290.0, 22.0)
    }

    @Test fun annotatedRunsUseActualTextLayoutRangesAndColors() {
        val text = "Server address · Change"
        setContent {
            val annotated = buildAnnotatedString {
                append("Server address · ")
                withStyle(SpanStyle(color = RrTheme.colors.accentText)) { append("Change") }
            }
            RrText(annotated, Modifier.padding(start = 24.dp, top = 47.dp), style = RrType.ui, color = RrTheme.colors.ink3)
        }
        val node = rule.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode()
        val layouts = mutableListOf<TextLayoutResult>()
        rule.runOnIdle { assertTrue(requireNotNull(node.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action).invoke(layouts)) }
        val result = layouts.single()
        val range = result.getPathForRange(text.indexOf("Change"), text.length).getBounds()
        val elements = dump()
        assertEquals("Measured parent and annotated run", 2, elements.length())
        val change = elements.single("text", "Change")
        assertBox(change, (node.positionInRoot.x + range.left) / 2.0, (node.positionInRoot.y + range.top) / 2.0, range.width / 2.0, range.height / 2.0)
        assertEquals("accent-text", change.getJSONObject("style").getString("color"))
        assertEquals("ink-3", elements.single("text", text).getJSONObject("style").getString("color"))
        assertTrue("Link has its own offset", change.getDouble("x") > 100.0)
    }

    @Test fun offscreenNodesRetainSizeAndRealScrollTransform() {
        lateinit var scroll: ScrollState
        setContent {
            scroll = rememberScrollState()
            Column(Modifier.height(120.dp).verticalScroll(scroll)) {
                Spacer(Modifier.height(240.dp))
                Box(Modifier.size(80.dp, 48.dp).rrDesignTag(DesignTag(component = "Offscreen")))
            }
        }
        assertBox(dump().single("component", "Offscreen"), 0.0, 240.0, 80.0, 48.0)
        rule.runOnIdle { runBlocking { scroll.scrollTo(120) } }
        assertBox(dump().single("component", "Offscreen"), 0.0, 180.0, 80.0, 48.0)
    }

    @Test fun paperRasterMetadataComesFromDecodedPixels() {
        val source = Bitmap.createBitmap(intArrayOf(0xff123456.toInt(), 0xffabcdef.toInt()), 2, 1, Bitmap.Config.ARGB_8888)
        val encoded = ByteArrayOutputStream().apply { source.compress(Bitmap.CompressFormat.PNG, 100, this) }.toByteArray()
        val decoded = BitmapFactory.decodeByteArray(encoded, 0, encoded.size)
        val rgba = ByteArray(decoded.width * decoded.height * 4)
        for (x in 0 until decoded.width) {
            val pixel = decoded.getPixel(x, 0)
            rgba[x * 4] = (pixel ushr 16).toByte()
            rgba[x * 4 + 1] = (pixel ushr 8).toByte()
            rgba[x * 4 + 2] = pixel.toByte()
            rgba[x * 4 + 3] = (pixel ushr 24).toByte()
        }
        val expectedHash = MessageDigest.getInstance("SHA-256").digest(rgba).joinToString("") { "%02x".format(it) }
        setContent { RrPaperPage(decoded.asImageBitmap(), "Page") }
        val raster = dump().single("component", "Page").getJSONObject("raster")
        assertEquals(decoded.width, raster.getInt("width"))
        assertEquals(decoded.height, raster.getInt("height"))
        assertEquals(expectedHash, raster.getString("rgbaSha256"))
    }

    private fun setContent(content: @Composable () -> Unit) {
        rule.setContent {
            view = LocalView.current
            CompositionLocalProvider(LocalRrDesignTags provides true) {
                RrTheme(darkTheme = false) { Box(Modifier.fillMaxSize()) { content() } }
            }
        }
    }

    private fun dump(): JSONArray {
        val out = temporary.newFile()
        rule.runOnIdle { requireNotNull(view).writeLayoutDump(out) }
        return JSONObject(out.readText()).getJSONArray("elements")
    }

    private fun JSONArray.single(key: String, value: String): JSONObject =
        (0 until length()).map(::getJSONObject).single { it.optString(key) == value }

    private fun assertBox(element: JSONObject, x: Double, y: Double, width: Double, height: Double) {
        for ((key, expected) in listOf("x" to x, "y" to y, "w" to width, "h" to height)) {
            assertEquals("$key in $element", expected, element.getDouble(key), 1.0)
        }
    }
}
