package me.rxresu.feature.assistant

import kotlinx.serialization.json.*
import me.rxresu.core.network.ServerEvent
import org.junit.Assert.*
import org.junit.Test

class ProposalsTest {
    private fun proposal(before: String = "<p>Before</p>", after: String = "<p>After</p>") = Proposal("one", "reply", "tool", "summary", "content", location = "Summary", before = before, after = after)
    @Test fun diffKeepsUnchangedRuns() {
        val runs = editRuns("Built the system for six teams.", "Built and scaled the system for six teams.")
        assertEquals("Built ", runs.first().text)
        assertTrue(runs.any { it is me.rxresu.core.designsystem.RrEditRun.Added && it.text == "and scaled " })
    }
    @Test fun attachmentReaderKeepsBytes() { val bytes = byteArrayOf(1, 2, 3); assertArrayEquals(bytes, readAttachment(bytes.inputStream())) }
    @Test fun oversizedAttachmentStopsAtLimit() {
        val input = object : java.io.InputStream() {
            override fun read() = 1
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int { bytes.fill(1, offset, offset + length); return length }
        }
        assertTrue(runCatching { readAttachment(input) }.isFailure)
    }
    @Test fun exactAnchorOnly() { assertEquals("<p>After</p>", replacePassage("<p>Before</p>", proposal())); assertNull(replacePassage("<p>Changed</p>", proposal())) }
    @Test fun duplicateAnchorCannotChooseForPerson() { assertNull(replacePassage("<p>Before</p><p>Before</p>", proposal())) }
    @Test fun emptyAnchorOnlyFillsEmptyField() { assertEquals("new", replacePassage("", proposal("", "new"))); assertNull(replacePassage("mine", proposal("", "new"))) }
    @Test fun preservesSurroundingMarkup() { assertEquals("<ul><li>keep</li><p>After</p></ul>", replacePassage("<ul><li>keep</li><p>Before</p></ul>", proposal())) }
    @Test fun bulkSkipsNewDetailsAndSnapshots() { val ordinary = proposal(); assertEquals(listOf(ordinary), bulkEligible(listOf(ordinary, ordinary.copy(id = "new", newDetail = true), ordinary.copy(id = "unsupported", unsupported = listOf("new claim")), ordinary.copy(id = "snapshot", snapshot = true)))) }
    @Test fun snapshotCannotBeAppliedAsText() { assertNull(replacePassage("<p>Before</p>", proposal().copy(snapshot = true))) }
    @Test fun streamJoinsDeltasAndFinishes() {
        var state = reduceEvent(ConversationContent(), ServerEvent(null, "message", "{\"type\":\"start\",\"messageId\":\"reply\"}"))
        state = reduceEvent(state, ServerEvent(null, "message", "{\"type\":\"text-delta\",\"delta\":\"One \"}"))
        state = reduceEvent(state, ServerEvent(null, "message", "{\"type\":\"text-delta\",\"delta\":\"two\"}"))
        state = reduceEvent(state, ServerEvent(null, "message", "[DONE]"))
        assertEquals("One two", state.reply); assertTrue(state.done); assertEquals("reply", state.messageId)
    }
    @Test fun resumeStartDoesNotAppendReplayedReplyTwice() {
        val resumed = reduceEvent(ConversationContent(messageId = "reply", reply = "partial"), ServerEvent(null, "message", "{\"type\":\"start\",\"messageId\":\"reply\"}"))
        assertEquals("", resumed.reply)
    }
    @Test fun streamErrorIsNotSuccess() { val state = reduceEvent(ConversationContent(reply = "partial"), ServerEvent(null, "message", "{\"type\":\"error\"}")); assertTrue(state.failed); assertEquals("partial", state.reply) }
    @Test fun hiddenSummaryCannotBeApplied() {
        val json = buildJsonObject { put("summary", buildJsonObject { put("content", "<p>Before</p>"); put("hidden", true) }) }
        assertNull(applyResume(json, proposal()))
    }
    @Test fun summaryEditKeepsUnrelatedData() {
        val json = buildJsonObject { put("summary", buildJsonObject { put("content", "<p>Before</p>"); put("hidden", false) }); put("other", "kept") }
        val after = applyResume(json, proposal())!!; assertEquals("kept", after["other"]!!.jsonPrimitive.content); assertEquals("<p>After</p>", after["summary"]!!.jsonObject["content"]!!.jsonPrimitive.content)
    }
    @Test fun wordingEscapesHtmlAndKeepsBlock() { assertEquals("<p class=\"intro\">&lt;new&gt; &amp; true</p>", reviewedWording("<p class=\"intro\">old</p>", "<new> & true")) }
    @Test fun nestedSseFramesCanSplitAtEveryByteBoundary() {
        val text = "data: {\"type\":\"start\",\"messageId\":\"reply\"}\r\n\r\ndata: {\"type\":\"text-delta\",\"delta\":\"Hello\"}\n\ndata: [DONE]\n\n"
        val decoder = AssistantStreamDecoder(); var state = ConversationContent()
        text.forEach { char -> decoder.accept(ServerEvent(null, "message", JsonPrimitive(char.toString()).toString())).forEach { state = reduceEvent(state, it) } }
        assertEquals("Hello", state.reply); assertTrue(state.done)
    }
    @Test fun outerErrorCannotMasqueradeAsSuccessfulDone() { assertTrue(runCatching { AssistantStreamDecoder().accept(ServerEvent(null, "error", "{}")) }.isFailure) }
    @Test fun truncatedInnerFrameFailsWhenTransportFinishes() {
        val decoder = AssistantStreamDecoder(); decoder.accept(ServerEvent(null, "message", JsonPrimitive("data: {").toString()))
        assertTrue(runCatching { decoder.accept(ServerEvent(null, "done", "null")) }.isFailure)
    }
    @Test fun resumedContinuationKeepsAnsweredQuestionAndEarlierParts() {
        val message = me.rxresu.core.network.generated.SendAgentMessageRequestMessage("reply", parts = listOf(
            part("step-start", buildJsonObject {}), part("text", buildJsonObject { put("text", "Before question") }),
            part("tool-ask_user_question", buildJsonObject { put("state", "output-available"); put("toolCallId", "question"); put("output", "Answer") }),
            part("step-start", buildJsonObject {}), part("text", buildJsonObject { put("text", "Partial") })), role = me.rxresu.core.network.generated.AiTailorResumeForApplicationResponseConversationMessagesItemRole.Assistant)
        val current = conversationContent(listOf(message)); val next = reduceEvent(current, ServerEvent(null, "message", "{\"type\":\"start\",\"messageId\":\"reply\"}"))
        assertEquals("Before question", next.reply); assertEquals(3, next.messages.single().parts.size)
    }
    @Test fun reviewedAdditionKeepsAnchorAndOuterList() { assertEquals("<p>Anchor</p><ul><li><p>My words</p></li></ul>", reviewedWording("<p>Anchor</p><ul><li><p>Old</p></li></ul>", "My  words", "<p>Anchor</p>")) }
    @Test fun structuralProposalChangesOnlyReviewedContentAndLayout() {
        val data = buildJsonObject { put("basics", buildJsonObject { put("name", "Person") }); put("summary", buildJsonObject { put("content", "Before") }); put("sections", buildJsonObject {}); put("customSections", JsonArray(emptyList())); put("metadata", buildJsonObject { put("layout", buildJsonObject { put("pages", JsonArray(emptyList())) }); put("page", buildJsonObject { put("locale", "en-US") }); put("notes", "private"); put("future", "kept") }); put("picture", "keep-picture") }
        val before = JsonObject(data.filterKeys { it in setOf("basics", "summary", "sections", "customSections") } + ("layout" to data["metadata"]!!.jsonObject.getValue("layout")))
        val after = JsonObject(before + ("summary" to buildJsonObject { put("content", "After") }))
        val change = proposal().copy(snapshot = true, section = "resume", field = "data", structure = buildJsonObject { put("before", before.toString()); put("after", after.toString()) })
        val result = applyResume(data, change)!!; assertEquals(data["picture"], result["picture"]); assertEquals(data["metadata"], result["metadata"]); assertEquals("After", result["summary"]!!.jsonObject["content"]!!.jsonPrimitive.content)
        assertNull(applyResume(result, change))
        assertNull(applyResume(data, change.copy(structure = buildJsonObject { put("before", JsonObject(before + ("locale" to JsonPrimitive("de-DE"))).toString()); put("after", after.toString()) })))
    }
    @Test fun finishMetadataKeepsOperationProvenanceAndContext() {
        var content = reduceEvent(ConversationContent(), ServerEvent(null, "message", "{\"type\":\"start\",\"messageId\":\"reply\",\"messageMetadata\":{\"contextScope\":\"[true,true]\"}}"))
        content = reduceEvent(content, ServerEvent(null, "message", "{\"type\":\"finish\",\"messageMetadata\":{\"aiOperationIds\":[\"operation\"]}}"))
        val metadata = content.messages.single().metadata!!.jsonObject
        assertEquals("[true,true]", metadata.text("contextScope")); assertEquals(listOf("operation"), metadata.strings("aiOperationIds")); assertTrue(content.done)
    }
}
