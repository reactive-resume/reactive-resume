package me.rxresu.feature.assistant

import kotlinx.serialization.json.*
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.ServerEvent

/** OpenAPI SSE transports strings containing a second, arbitrarily chunked AI SDK SSE stream. */
internal class AssistantStreamDecoder {
    private var pending = ""
    fun accept(event: ServerEvent): List<ServerEvent> {
        check(event.type != "error") { "Assistant stream failed" }
        if (event.type == "done") { check(pending.isBlank()) { "Incomplete assistant frame" }; return listOf(event) }
        val value = ApiJson.parseToJsonElement(event.data)
        if (value is JsonObject) return listOf(event)
        val text = (value as? JsonPrimitive)?.takeIf { it.isString }?.content ?: error("Invalid assistant stream")
        pending += text
        val frames = mutableListOf<ServerEvent>()
        while (true) {
            val boundary = Regex("\r?\n\r?\n").find(pending) ?: break
            val frame = pending.substring(0, boundary.range.first)
            pending = pending.substring(boundary.range.last + 1)
            val data = frame.lineSequence().filter { it.startsWith("data:") }.joinToString("\n") { it.removePrefix("data:").removePrefix(" ") }
            if (data.isNotEmpty()) frames += ServerEvent(null, "message", data)
        }
        return frames
    }
}
