package me.rxresu.core.designsystem

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class RrShareGeometryTest : RrScreenshotTest() {
    @get:Rule val rule = createComposeRule()

    @Test fun dashedHeroKeepsItsContentInsetAndHasGapsInItsBorder() {
        rule.setContent {
            RrTheme(darkTheme = false) {
                CompositionLocalProvider(LocalRrDesignTags provides true) {
                    RrHeroCard(topMargin = 0.dp, dashed = true) { Box(Modifier.height(24.dp).testTag("hero-content")) }
                }
            }
        }
        val hero = rule.onNode(SemanticsMatcher("hero") { it.config.getOrNull(DesignTagKey)?.component == "HeroCard" }, useUnmergedTree = true)
        val bounds = hero.getUnclippedBoundsInRoot()
        val content = rule.onNodeWithTag("hero-content").getUnclippedBoundsInRoot()
        assertEquals(25.dp, content.top - bounds.top)
        val pixels = hero.captureToImage().toPixelMap()
        val edge = (40 until pixels.width - 40).map { pixels[it, 0] }
        org.junit.Assert.assertTrue(edge.any { it == LightRrColors.surface })
        org.junit.Assert.assertTrue(edge.any { it != LightRrColors.surface })
    }

    @Test fun optionRowKeepsFullTouchAreaAroundItsMeasuredInnerRow() {
        var clicked = 0
        rule.setContent {
            RrTheme {
                CompositionLocalProvider(LocalRrDesignTags provides true) {
                    Box(Modifier.width(390.dp)) { RrOptionRow("PDF", true, { clicked++ }, helper = "Best for applying") }
                }
            }
        }
        val control = rule.onNodeWithText("PDF")
        val touch = control.getUnclippedBoundsInRoot()
        assertEquals(390.dp, touch.right - touch.left)
        val row = rule.onNode(SemanticsMatcher("inner row") { it.config.getOrNull(DesignTagKey)?.component == "ListRow" }, useUnmergedTree = true).getUnclippedBoundsInRoot()
        assertEquals(24.dp, row.left - touch.left)
        assertEquals(342.dp, row.right - row.left)
        control.performClick()
        assertEquals(1, clicked)
    }

    @Test fun iconLongPressKeepsItsSeparateClickAction() {
        var clicked = 0
        var held = 0
        rule.setContent { RrTheme { RrIconButton(R.drawable.ic_ph_list_bullets, "List", { clicked++ }, onLongClick = { held++ }) } }
        val control = rule.onNodeWithContentDescription("List")
        control.performClick()
        control.performSemanticsAction(SemanticsActions.OnLongClick)
        assertEquals(1, clicked)
        assertEquals(1, held)
    }

    @Test fun placeholderNamesTheEditableNodeAndExplicitLabelWins() {
        var typed = ""
        rule.setContent {
            RrTheme {
                Column {
                    RrTextField("", { typed = it }, placeholder = "Own words")
                    RrTextField("", {}, label = "Company", placeholder = "Employer")
                }
            }
        }
        rule.onNodeWithContentDescription("Own words").performTextInput("My answer")
        assertEquals("My answer", typed)
        rule.onNodeWithContentDescription("Company").assertExists()
        rule.onNodeWithContentDescription("Employer").assertDoesNotExist()
    }

    @Test fun pageBandAllocatesItsTwoBorderLines() {
        rule.setContent {
            RrTheme {
                CompositionLocalProvider(LocalRrDesignTags provides true) {
                    RrPageBand { Box(Modifier.height(212.dp).testTag("page")) }
                }
            }
        }
        val band = rule.onNode(SemanticsMatcher("page band") { it.config.getOrNull(DesignTagKey)?.component == "PageBand" }, useUnmergedTree = true).getUnclippedBoundsInRoot()
        val page = rule.onNodeWithTag("page").getUnclippedBoundsInRoot()
        assertEquals(262.dp, band.bottom - band.top)
        assertEquals(25.dp, page.top - band.top)
    }

    @Test fun compactAddressKeepsDefaultMonoInputMetrics() {
        rule.setContent {
            RrTheme {
                CompositionLocalProvider(LocalRrDesignTags provides true) {
                    Column {
                        RrTextField("default", {}, mono = true)
                        RrTextField("slug", {}, mono = true, prefix = "rxresu.me/alex/", prefixGap = 8.dp,
                            textStyle = RrType.mono.copy(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal))
                    }
                }
            }
        }
        fun text(value: String) = rule.onNode(SemanticsMatcher("text $value") { it.config.getOrNull(DesignTagKey)?.text == value }, useUnmergedTree = true)
        val normal = text("default").fetchSemanticsNode().config[DesignTagKey].style!!
        assertEquals(16.sp, normal.fontSize)
        assertEquals(22.sp, normal.lineHeight)
        val compact = text("slug").fetchSemanticsNode().config[DesignTagKey].style!!
        assertEquals(14.sp, compact.fontSize)
        assertEquals(20.sp, compact.lineHeight)
        assertEquals(FontWeight.Normal, compact.fontWeight)
        assertEquals(8.dp, text("slug").getUnclippedBoundsInRoot().left - text("rxresu.me/alex/").getUnclippedBoundsInRoot().right)
    }

    @Test fun trailingGapOverrideDoesNotChangeOtherRows() {
        rule.setContent {
            RrTheme {
                Column {
                    RrListRow("Default", trailing = { Box(Modifier.size(10.dp).testTag("first-default")); Box(Modifier.size(10.dp).testTag("last-default")) })
                    RrListRow("Letterhead", trailingGap = 16.dp, trailing = { Box(Modifier.size(10.dp).testTag("first-letter")); Box(Modifier.size(10.dp).testTag("last-letter")) })
                }
            }
        }
        fun gap(name: String) = rule.onNodeWithTag("last-$name").getUnclippedBoundsInRoot().left - rule.onNodeWithTag("first-$name").getUnclippedBoundsInRoot().right
        assertEquals(6.dp, gap("default"))
        assertEquals(16.dp, gap("letter"))
    }
}
