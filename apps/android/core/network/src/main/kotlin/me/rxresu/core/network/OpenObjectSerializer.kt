package me.rxresu.core.network

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * Serializer for generated classes of open JSON objects: the declared fields go through [base], every other key is kept
 * in the class's `extraFields` and written back unchanged, so saving a resume or replaying a message never drops data.
 */
open class OpenObjectSerializer<T : Any>(
    private val base: KSerializer<T>,
    private val extraOf: (T) -> JsonObject,
    private val withExtra: (T, JsonObject) -> T,
) : KSerializer<T> {
    override val descriptor: SerialDescriptor = base.descriptor
    private val known by lazy { (0 until descriptor.elementsCount).map(descriptor::getElementName).toSet() }

    override fun deserialize(decoder: Decoder): T {
        val input = decoder as JsonDecoder
        val raw = input.decodeJsonElement().jsonObject
        val value = input.json.decodeFromJsonElement(base, raw)
        val extra = raw.filterKeys { it !in known }
        return if (extra.isEmpty()) value else withExtra(value, JsonObject(extra))
    }

    override fun serialize(encoder: Encoder, value: T) {
        val output = encoder as JsonEncoder
        val declared = output.json.encodeToJsonElement(base, value).jsonObject
        output.encodeJsonElement(JsonObject(extraOf(value) + declared))
    }
}
