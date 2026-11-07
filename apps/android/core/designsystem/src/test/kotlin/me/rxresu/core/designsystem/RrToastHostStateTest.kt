package me.rxresu.core.designsystem

import kotlinx.coroutines.async
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Toast queue and lifetimes on virtual time. */
class RrToastHostStateTest {
    @Test fun plainToastLivesFiveSecondsAndQueuesTheNext() = runTest {
        val state = RrToastHostState()
        val first = async { state.show("Template changed to Onyx") }
        val second = async { state.show("“Lumen letter” moved to Trash", actionLabel = "Undo") }
        runCurrent()
        assertEquals("Template changed to Onyx", state.current?.message)
        assertEquals(5_000L, state.current?.durationMs)

        advanceTimeBy(4_999)
        assertEquals("Template changed to Onyx", state.current?.message)
        advanceTimeBy(2)
        runCurrent()
        assertNull(state.current)

        // The next rises after the d2 exit, with the 8 s life of a toast that has an action.
        advanceTimeBy(RrMotion.D2.toLong())
        runCurrent()
        assertEquals(RrToastResult.Dismissed, first.await())
        assertEquals(8_000L, state.current?.durationMs)
        state.current!!.performAction()
        assertEquals(RrToastResult.ActionPerformed, second.await())
    }

    @Test fun accessibilityTimeoutStretchesTheLife() = runTest {
        val state = RrToastHostState()
        state.timeout = { ms, _ -> ms * 2 }
        val toast = async { state.show("Saved", actionLabel = "Undo") }
        runCurrent()
        assertEquals(16_000L, state.current?.durationMs)
        advanceTimeBy(15_000)
        assertEquals("Saved", state.current?.message)
        advanceTimeBy(1_001)
        assertEquals(RrToastResult.Dismissed, toast.await())
    }
}
