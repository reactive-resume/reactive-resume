package me.rxresu.feature.assistant

import androidx.compose.runtime.CompositionLocalProvider
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import me.rxresu.core.network.generated.*
import me.rxresu.core.data.*
import me.rxresu.core.testing.*
import org.junit.Test

class AssistantScreensTest : RrScreenshotTest() {
    private fun capture(proposals: Boolean, dark: Boolean, variant: String = "", font: Float = 1f) {
        val repositories = FakeRepositories()
        try {
            val provider = runBlocking { repositories.ai.listAiProviders().first() }
            val edits = listOf(
                Proposal("one", "reply", "tool", "experience", "description", location = "Experience › Northwind Labs › line 2", before = "Built the design system now used by six product teams; cut interface defects by a third.", after = "Built and scaled a design system adopted by six product teams; cut interface defects by a third.", why = "Lumen asks for design systems at scale; this says you scaled one.", evidence = listOf("Knowledge: design system fact")),
                Proposal("two", "reply", "tool", "summary", "content", location = "Summary", before = "…for business software.", after = "…for business software. I lead accessibility audits and turn research into shipped, measurable changes.", newDetail = true, unsupported = listOf("accessibility audits")),
                Proposal("three", "reply", "tool", "skills", "description", location = "Skills", before = "", after = "", decision = Decision.Accepted),
            )
            val state = AssistantState(loading = false, failed = variant == "Failure", input = if (variant == "Failure") "Please keep these words" else "", streaming = variant == "Streaming", providers = listOf(provider), providerId = provider.id, documentName = "Product designer", locked = variant == "Locked",
                postingLabel = "Lumen posting", facts = mapOf("one" to "Fact one", "two" to "Fact two", "three" to "Fact three"),
                content = ConversationContent(requirements = listOf("design systems at scale" to "matched", "accessibility" to "check"), messages = listOf(SendAgentMessageRequestMessage("user", parts = listOf(part("text", buildJsonObject { put("text", "Tailor this to the Lumen posting") })), role = AiTailorResumeForApplicationResponseConversationMessagesItemRole.User), SendAgentMessageRequestMessage("reply", parts = listOf(part("text", buildJsonObject { put("text", "Three edits lean this resume toward Lumen\'s focus on design systems and accessibility. One needs a fact from you first.") })), role = AiTailorResumeForApplicationResponseConversationMessagesItemRole.Assistant)), reply = "Three edits lean this resume toward Lumen's focus on design systems and accessibility. One needs a fact from you first.", proposals = edits, trace = listOf("Read the posting", "matched your facts", "measured page fit"), question = Question("Did you lead the accessibility audit at Northwind Labs?", listOf("Yes, I led it", "I took part in it", "No"))))
            captureScreen((if (proposals) "B17-Proposals" else "B16-Assistant") + if (variant.isEmpty()) "" else "-$variant", dark, fontScale = font,
                wrap = { content -> CompositionLocalProvider(LocalRepositories provides repositories) { content() } }) {
                if (proposals) ProposalsScreen(state, {}, { _, _, _ -> }, {}) else AssistantScreen(state, {}, {}, {}, {}, { _, _ -> }, {})
            }
        } finally { repositories.close() }
    }
    @Test fun assistantLight() = capture(false, false)
    @Test fun assistantDark() = capture(false, true)
    @Test fun proposalsLight() = capture(true, false)
    @Test fun proposalsDark() = capture(true, true)
    @Test fun failureKeepsWords() = capture(false, false, "Failure")
    @Test fun streaming() = capture(false, false, "Streaming")
    @Test fun locked() = capture(false, true, "Locked")
    @Test fun largeProposals() = capture(true, false, font = 2f)
}
