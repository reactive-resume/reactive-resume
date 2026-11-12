package me.rxresu.core.page

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Builder calls submit only after successful saves. UI owns scope and cancels it when leaving the document. */
class RenderDebouncer(private val scope: CoroutineScope, private val delayMillis: Long = 350) {
    private var pending: Job? = null
    /** Replace pending render with newest saved revision. Call on the UI thread; renderer owns work serialization. */
    fun submit(render: suspend () -> Unit) {
        pending?.cancel()
        pending = scope.launch { delay(delayMillis); render() }
    }
    /** Cancel pending work when switching documents or closing the builder. */
    fun cancel() { pending?.cancel(); pending = null }
}
