package me.rxresu.feature.share

import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.LayoutDirection
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.network.generated.GetResumeDailyStatisticsResponseItem
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class VisitorChartTest : RrScreenshotTest() {
    @get:Rule val compose = createComposeRule()

    @Test fun scrubbingAndAccessibleValues() = chart(LayoutDirection.Ltr, 2)
    @Test fun rtlScrubbingAndAccessibleValues() = chart(LayoutDirection.Rtl, 0)

    private fun chart(direction: LayoutDirection, afterSwipe: Int) {
        var selected by mutableStateOf<Int?>(null)
        val days = (1..3).map { GetResumeDailyStatisticsResponseItem("2026-11-0$it", 0.0, it.toDouble()) }
        compose.setContent {
            CompositionLocalProvider(LocalInspectionMode provides true, LocalLayoutDirection provides direction) {
                RrTheme { VisitorChart(days, selected) { selected = it } }
            }
        }
        val chart = compose.onNodeWithContentDescription("Daily views", substring = true)
        val next = chart.fetchSemanticsNode().config[SemanticsActions.CustomActions].first { it.label == "Next day" }
        compose.runOnIdle { next.action() }
        compose.runOnIdle { assertEquals(0, selected) }
        chart.assertContentDescriptionContains("2026-11-01", substring = true)
        val advance = chart.fetchSemanticsNode().config[SemanticsActions.CustomActions].first { it.label == "Next day" }
        compose.runOnIdle { advance.action() }
        compose.runOnIdle { assertEquals(1, selected) }
        chart.assertContentDescriptionContains("2026-11-02", substring = true)
        chart.performTouchInput { swipeRight() }
        compose.runOnIdle { assertEquals(afterSwipe, selected) }
        chart.assertContentDescriptionContains("2026-11-0${afterSwipe + 1}", substring = true)
    }
}
