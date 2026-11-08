package me.rxresu.core.designsystem

import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
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

    @Test fun postedToastOutlivesItsCallerAndReportsTheSecondAction() = runTest {
        val state = RrToastHostState(backgroundScope)
        var result: RrToastResult? = null
        state.post("Moved to Interview.", actionLabel = "Undo", secondaryActionLabel = "Schedule it") { result = it }
        runCurrent()
        assertEquals("Schedule it", state.current?.secondaryActionLabel)
        assertEquals(8_000L, state.current?.durationMs)
        state.current!!.performSecondaryAction()
        // The result arrives once the toast's d2 exit has run.
        advanceTimeBy(RrMotion.D2 + 1L)
        assertEquals(RrToastResult.SecondaryActionPerformed, result)
    }
    @Test fun operationCoversQueuedUndoAndOutlivesTheCallingScope() = runTest {
        val state = RrToastHostState(backgroundScope)
        var held = false
        var result: RrToastResult? = null
        state.post("Previous action", actionLabel = "Undo")
        val caller = launch {
            state.post("Interview deleted", actionLabel = "Undo", around = { resolve ->
                held = true
                try { resolve() } finally { held = false }
            }) { result = it }
            awaitCancellation()
        }
        runCurrent()
        caller.cancel()
        runCurrent()
        assertTrue(held)
        assertEquals("Previous action", state.current?.message)
        state.current!!.performAction()
        advanceTimeBy(RrMotion.D2 + 1L)
        runCurrent()
        assertTrue(held)
        assertEquals("Interview deleted", state.current?.message)
        state.current!!.performAction()
        advanceTimeBy(RrMotion.D2 + 1L)
        runCurrent()
        assertEquals(RrToastResult.ActionPerformed, result)
        assertFalse(held)
    }

    @Test fun cancellingPostedOperationReleasesItsGuard() = runTest {
        val state = RrToastHostState(backgroundScope)
        var held = false
        val operation = state.post("Interview deleted", actionLabel = "Undo", around = { resolve ->
            held = true
            try { resolve() } finally { held = false }
        })
        runCurrent()
        assertTrue(held)
        operation.cancel()
        runCurrent()
        assertFalse(held)
        assertNull(state.current)
    }

}
