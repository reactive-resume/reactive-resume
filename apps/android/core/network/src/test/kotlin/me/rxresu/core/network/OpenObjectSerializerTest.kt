package me.rxresu.core.network

import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import me.rxresu.core.network.generated.AiTailorResumeForApplicationResponseConversationMessagesItemPartsItem as Part
import org.junit.Assert.assertEquals
import org.junit.Test

class OpenObjectSerializerTest {
    @Test fun openObjectKeepsUndeclaredKeysThroughARoundTrip() {
        val wire = """{"type":"text","text":"Make it shorter","state":"done"}"""
        val part = ApiJson.decodeFromString(Part.serializer(), wire)
        assertEquals("text", part.type)
        assertEquals("Make it shorter", part.extraFields["text"]!!.jsonPrimitive.content)
        val back = ApiJson.encodeToJsonElement(Part.serializer(), part).jsonObject
        assertEquals(ApiJson.parseToJsonElement(wire), back)
    }
}
