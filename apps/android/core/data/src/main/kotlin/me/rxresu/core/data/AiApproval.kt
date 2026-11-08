package me.rxresu.core.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.generated.TestAiProviderResponse

/**
 * Binds an AI request to the provider the person was shown before sending (HANDOFF §3: say what is sent and where).
 * The server rejects the request, before anything is sent, when that provider's recipient changed since the
 * disclosure (`packages/api/src/features/ai/destination.ts`). Send it on every AI call, HTTP, SSE, multipart or voice.
 */
fun aiApproval(providerId: String, recipientVersion: String): Map<String, String> =
    mapOf("x-ai-destination" to JsonArray(listOf(JsonPrimitive(providerId), JsonPrimitive(recipientVersion))).toString())

fun aiApproval(provider: TestAiProviderResponse): Map<String, String> = aiApproval(provider.id, provider.recipientVersion)

/** [this] with the approval header for [provider] added. */
fun RequestOptions.approvedFor(provider: TestAiProviderResponse) = copy(headers = headers + aiApproval(provider))
