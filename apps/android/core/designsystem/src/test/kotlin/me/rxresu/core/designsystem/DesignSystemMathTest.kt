package me.rxresu.core.designsystem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.YearMonth

/** Pure geometry and timing behind the sheet, swipe rows, large title, segments, pickers and Working label. */
class DesignSystemMathTest {
    private val detents = floatArrayOf(500f, 920f) // 50% and 92% of a 1000 px window
    private val fling = 1000f

    @Test fun sheetSettlesOnNearestDetent() {
        assertEquals(0, RrSheetMath.settle(height = 600f, velocity = 0f, detents = detents, flingThreshold = fling))
        assertEquals(1, RrSheetMath.settle(height = 800f, velocity = 0f, detents = detents, flingThreshold = fling))
    }

    @Test fun sheetDismissesOnlyPast25PercentBelowLowestDetent() {
        assertEquals(0, RrSheetMath.settle(height = 380f, velocity = 0f, detents = detents, flingThreshold = fling))
        assertEquals(-1, RrSheetMath.settle(height = 370f, velocity = 0f, detents = detents, flingThreshold = fling))
    }

    @Test fun sheetFlingMovesOneDetentAndDismissesFromTheLowest() {
        assertEquals(1, RrSheetMath.settle(height = 520f, velocity = 1500f, detents = detents, flingThreshold = fling))
        assertEquals(0, RrSheetMath.settle(height = 900f, velocity = -1500f, detents = detents, flingThreshold = fling))
        assertEquals(-1, RrSheetMath.settle(height = 500f, velocity = -1500f, detents = detents, flingThreshold = fling))
        assertEquals(1, RrSheetMath.settle(height = 920f, velocity = 1500f, detents = detents, flingThreshold = fling))
    }

    @Test fun sheetSettleDurationScalesWithDistanceWithinD1ToD3() {
        assertEquals(RrMotion.D3, RrSheetMath.settleDurationMs(920f, 920f))
        assertEquals(160, RrSheetMath.settleDurationMs(-460f, 920f))
        assertEquals(RrMotion.D1, RrSheetMath.settleDurationMs(10f, 920f))
    }

    @Test fun sheetScrimStaysFullWhileAFitContentSheetGrowsToItsLoadedContent() {
        // Rising to the first resting height: the scrim follows the sheet.
        assertEquals(0.5f, RrSheetMath.scrimAlpha(height = 150f, lowest = 300f, settled = Float.MAX_VALUE), 0.001f)
        // Content loaded: the detent jumps to 1200 while the sheet still rests at 300. Full, not 300 ÷ 1200.
        assertEquals(1f, RrSheetMath.scrimAlpha(height = 300f, lowest = 1200f, settled = 300f), 0.001f)
        // Dragged below the lowest detent: the scrim thins.
        assertEquals(0.5f, RrSheetMath.scrimAlpha(height = 600f, lowest = 1200f, settled = 1200f), 0.001f)
    }

    @Test fun swipeArmsAt40PercentAndCommitsTowardTheSwipe() {
        assertFalse(RrSwipeMath.armed(-150f, 400f))
        assertTrue(RrSwipeMath.armed(-160f, 400f))
        assertEquals(-400f, RrSwipeMath.settleTarget(-170f, 400f))
        assertEquals(400f, RrSwipeMath.settleTarget(200f, 400f))
        assertEquals(0f, RrSwipeMath.settleTarget(-100f, 400f))
    }

    @Test fun largeTitleCollapsesOverItsDistance() {
        assertEquals(0f, RrLargeTitleState.collapseFraction(0f, 40f))
        assertEquals(0.5f, RrLargeTitleState.collapseFraction(20f, 40f))
        assertEquals(1f, RrLargeTitleState.collapseFraction(400f, 40f))
        val state = RrLargeTitleState(40f)
        state.onScrolled(39f)
        assertFalse(state.collapsed)
        state.onScrolled(40f)
        assertTrue(state.collapsed)
    }

    @Test fun segmentsKeepTheirContentAndShareTheRest() {
        assertEquals(listOf(80, 80, 80), segmentWidths(listOf(40, 60, 50), 240))
        // "Calendar" needs 90 of a 75 share; the others split the remaining 210.
        assertEquals(listOf(70, 70, 90, 70), segmentWidths(listOf(50, 60, 90, 65), 300))
    }

    @Test fun workingLabelStepsEvery2200msAndHoldsTheLast() {
        assertEquals(0, RrWorkingSteps.indexAt(2_199, 3))
        assertEquals(1, RrWorkingSteps.indexAt(2_200, 3))
        assertEquals(2, RrWorkingSteps.indexAt(60_000, 3))
    }

    @Test fun monthGridStartsOnTheLocaleWeekStart() {
        // 1 Nov 2026 is a Sunday: six blanks before it in a Monday-first week, none in a Sunday-first week.
        val monday = RrCalendarMath.monthGrid(YearMonth.of(2026, 11), DayOfWeek.MONDAY)
        assertEquals(6, monday.indexOf(LocalDate.of(2026, 11, 1)))
        assertEquals(0, monday.size % 7)
        val sunday = RrCalendarMath.monthGrid(YearMonth.of(2026, 11), DayOfWeek.SUNDAY)
        assertEquals(0, sunday.indexOf(LocalDate.of(2026, 11, 1)))
        assertEquals(30, sunday.count { it != null })
    }

    @Test fun timeListKeepsAnOffStepSelection() {
        assertEquals(96, RrTimeMath.slots(15, null).size)
        val slots = RrTimeMath.slots(15, LocalTime.of(10, 10))
        assertEquals(97, slots.size)
        assertEquals(LocalTime.of(10, 10), slots[slots.indexOf(LocalTime.of(10, 0)) + 1])
    }

    @Test fun holdToDeleteResumesFromItsFill() {
        assertEquals(1200, RrHoldToDelete.remainingMs(0f))
        assertEquals(600, RrHoldToDelete.remainingMs(0.5f))
    }
}
