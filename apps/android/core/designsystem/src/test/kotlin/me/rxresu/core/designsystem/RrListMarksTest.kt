package me.rxresu.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class RrListMarksTest : RrScreenshotTest() {
    @get:Rule val rule = createComposeRule()

    @Test fun monogramContentAndStepTypographyKeepTheirBoardMetrics() {
        val numberStyle = RrType.ui.copy(fontFamily = InstrumentSerif, fontSize = 18.sp, lineHeight = 16.sp)
        rule.setContent {
            RrTheme {
                CompositionLocalProvider(LocalRrDesignTags provides true) {
                    Column {
                        RrCompanyTile("Lumen")
                        RrCompanyTile("Lumen", Modifier.testTag("monogram"), content = "LU")
                        RrCompanyTile("1", textStyle = numberStyle)
                    }
                }
            }
        }
        val initial = rule.onNode(SemanticsMatcher("initial metadata") { it.config.getOrNull(DesignTagKey)?.text == "L" }, useUnmergedTree = true).fetchSemanticsNode().config[DesignTagKey]
        assertEquals(Figtree, initial.style!!.fontFamily)
        assertEquals(14.sp, initial.style!!.fontSize)
        assertEquals(16.sp, initial.style!!.lineHeight)
        val monogram = rule.onNodeWithTag("monogram").getUnclippedBoundsInRoot()
        assertEquals(40.dp, (monogram.right - monogram.left))
        assertEquals(40.dp, (monogram.bottom - monogram.top))
        rule.onNodeWithText("LU", useUnmergedTree = true).fetchSemanticsNode()
        val stepNode = rule.onNode(SemanticsMatcher("number metadata") { it.config.getOrNull(DesignTagKey)?.text == "1" }, useUnmergedTree = true)
        val step = stepNode.fetchSemanticsNode().config[DesignTagKey]
        assertEquals(InstrumentSerif, step.style!!.fontFamily)
        assertEquals(18.sp, step.style!!.fontSize)
        assertEquals(16.sp, step.style!!.lineHeight)
        val stepBounds = stepNode.getUnclippedBoundsInRoot()
        assertEquals(16.dp, stepBounds.bottom - stepBounds.top)
    }

    @Test fun lightPaperHasOutsideOutline() = assertPaper(dark = false)
    @Test fun darkPaperHasOutsideOutline() = assertPaper(dark = true)

    private fun assertPaper(dark: Boolean) {
        val colors = if (dark) DarkRrColors else LightRrColors
        rule.setContent {
            RrTheme(darkTheme = dark) {
                CompositionLocalProvider(LocalRrDesignTags provides true) {
                    Box(Modifier.testTag("paper-scene").background(colors.bg).padding(4.dp)) {
                        RrDocumentThumbnail(Modifier.testTag("paper"))
                    }
                }
            }
        }
        val paper = rule.onNodeWithTag("paper")
        assertEquals("#ffffff", paper.fetchSemanticsNode().config[DesignTagKey].bgName)
        val paperBounds = paper.getUnclippedBoundsInRoot()
        assertEquals(36.dp, paperBounds.right - paperBounds.left)
        assertEquals(50.dp, paperBounds.bottom - paperBounds.top)
        val pixels = rule.onNodeWithTag("paper-scene").captureToImage().toPixelMap()
        assertEquals(colors.line2, pixels[6, 40])
        assertEquals(RrFixedColors.paper, pixels[8, 40])
        assertEquals(colors.bg, pixels[4, 40])
        assertEquals(RrFixedColors.thumbHeading, pixels[24, 24])
        assertEquals(RrFixedColors.thumbLine, pixels[24, 41])
    }
}
