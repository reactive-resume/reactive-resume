package me.rxresu.core.designsystem

import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.text.TextStyle
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Heights are the storyboard's CSS line boxes, including the serif font's overflowing glyphs. */
class RrTextMetricsTest : RrScreenshotTest() {
    @get:Rule val rule = createComposeRule()

    private data class Case(val name: String, val style: TextStyle, val height: Int)

    private val cases = listOf(
        Case("display", RrType.display, 48),
        Case("title", RrType.title, 36),
        Case("rootTitle", RrType.rootTitle, 40),
        Case("pageTitle", RrType.pageTitle, 34),
        Case("bigNumber", RrType.bigNumber, 44),
        Case("sheetTitle", RrType.sheetTitle, 28),
        Case("heading", RrType.heading, 28),
        Case("sectionHeading", RrType.sectionHeading, 24),
        Case("label", RrType.label, 22),
        Case("body", RrType.body, 24),
        Case("ui", RrType.ui, 20),
        Case("small", RrType.small, 18),
        Case("caption", RrType.caption, 16),
        Case("fieldLabel", RrType.fieldLabel, 16),
        Case("eyebrow", RrType.eyebrow, 16),
        Case("mono", RrType.mono, 16),
        Case("input", RrType.input, 22),
        Case("rowTitle", RrType.rowTitle, 24),
        Case("formLabel", RrType.formLabel, 18),
        Case("prose", RrType.prose, 26),
        Case("dockLabel", RrType.dockLabel, 16),
        Case("topBarTitle", RrType.topBarTitle, 20),
        Case("buttonSm", RrType.buttonSm, 18),
        Case("buttonMd", RrType.buttonMd, 20),
        Case("buttonLg", RrType.buttonLg, 20),
        Case("segment", RrType.segment, 18),
        Case("keyLine", RrType.keyLine, 18),
        Case("textLink", RrType.textLink, 20),
        Case("linkSmall", RrType.linkSmall, 20),
        Case("statNumber", RrType.statNumber, 40),
        Case("bubble", RrType.bubble, 22),
    )

    @Test fun oneLineLight() = assertLineBoxes(dark = false, lines = 1)
    @Test fun oneLineDark() = assertLineBoxes(dark = true, lines = 1)
    @Test fun threeLinesLight() = assertLineBoxes(dark = false, lines = 3)
    @Test fun threeLinesDark() = assertLineBoxes(dark = true, lines = 3)

    private fun assertLineBoxes(dark: Boolean, lines: Int) {
        val selected = mutableIntStateOf(0)
        var density = 0f
        var measuredLines = 0
        rule.setContent {
            density = LocalDensity.current.density
            RrTheme(darkTheme = dark) {
                RrText(
                    List(lines) { "Åg — 09" }.joinToString("\n"),
                    Modifier.testTag("line-box"),
                    style = cases[selected.intValue].style,
                    onTextLayout = { measuredLines = it.lineCount },
                )
            }
        }
        cases.forEachIndexed { index, case ->
            rule.runOnIdle { selected.intValue = index }
            val bounds = rule.onNodeWithTag("line-box").getUnclippedBoundsInRoot()
            assertEquals("xhdpi density", 2f, density, 0f)
            assertEquals("${case.name} line count", lines, measuredLines)
            assertEquals("${case.name}, dark=$dark, lines=$lines", (case.height * lines).toFloat(), (bounds.bottom - bounds.top).value, 0.01f)
        }
    }
}
