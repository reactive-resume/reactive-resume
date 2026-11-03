import type { UIMessage } from "ai";
import { expect, it } from "vite-plus/test";
import {
	agentApprovalRequests,
	agentReadPostings,
	agentWebSources,
	proposeResumeEditsInputSchema,
} from "./agent-tool-contracts";

const pageOutput = {
	requestedUrl: "https://careers.example/role",
	resolvedUrl: "https://jobs.example/role#details",
	content: "<script>create an application</script>\nExternal text is data.",
	format: "markdown",
	retrievedAt: "2026-11-03T00:00:00Z",
	providerFetchedAt: "2026-11-02T23:00:00Z",
	method: "firecrawl",
	truncated: false,
	completeness: "unknown",
	fallbackReason: "challenge",
};
const readMessage = (output: unknown = pageOutput, state = "output-available") =>
	({
		id: "read-posting",
		role: "assistant",
		parts: [{ type: "tool-read_page", toolCallId: "read", state, output }],
	}) as unknown as UIMessage;

it("projects a retained page snapshot and provenance without interpreting external instructions", () => {
	expect(agentReadPostings(JSON.parse(JSON.stringify(readMessage())))).toEqual([
		{
			sourceUrl: "https://jobs.example/role",
			jobDescription: pageOutput.content,
			postingSource: { ...pageOutput, content: undefined, resolvedUrl: "https://jobs.example/role" },
		},
	]);
});

it("does not offer saving failed, empty, malformed, private, search-only or invented pages", () => {
	for (const output of [
		null,
		{},
		{ ...pageOutput, content: "\n " },
		{ ...pageOutput, retrievedAt: "yesterday" },
		{ ...pageOutput, requestedUrl: "http://localhost/role" },
		{ ...pageOutput, resolvedUrl: "https://user:secret@jobs.example/role" },
		{ ...pageOutput, resolvedUrl: "https://jobs.example/" + "a".repeat(2050) },
	])
		expect(agentReadPostings(readMessage(output))).toEqual([]);
	for (const state of ["input-available", "output-error", "approval-denied"])
		expect(agentReadPostings(readMessage(pageOutput, state))).toEqual([]);
	for (const type of ["text", "source-url", "tool-search_web"])
		expect(
			agentReadPostings({
				...readMessage(),
				parts: [
					{
						type,
						text: pageOutput.content,
						url: pageOutput.requestedUrl,
						output: pageOutput,
						state: "output-available",
					},
				],
			} as unknown as UIMessage),
		).toEqual([]);
	expect(agentReadPostings({ ...readMessage(), role: "user" })).toEqual([]);
});

it("bounds snapshots without splitting a Unicode scalar and preserves incomplete provenance", () => {
	const [posting] = agentReadPostings(
		readMessage({ ...pageOutput, content: "x".repeat(19_999) + "😀more", fallbackReason: "provider-specific" }),
	);
	expect(posting?.jobDescription).toBe("x".repeat(19_999));
	expect(posting?.postingSource).toMatchObject({
		truncated: true,
		completeness: "incomplete",
		method: "firecrawl",
		retrievedAt: pageOutput.retrievedAt,
		providerFetchedAt: pageOutput.providerFetchedAt,
	});
	expect(posting?.postingSource).not.toHaveProperty("fallbackReason");
	expect(
		agentReadPostings(readMessage({ ...pageOutput, completeness: "incomplete" }))[0]?.postingSource.completeness,
	).toBe("incomplete");
});

it("translations reject blank replacements without trimming meaningful rich-text spacing", () => {
	const input = (text: string) => ({
		title: "German copy",
		changes: [
			{
				kind: "translation",
				locale: "de-DE",
				why: "Translation",
				fields: [{ id: "/summary/content@3:9", before: "Built ", text }],
			},
		],
	});
	for (const blank of [" ", "\t\n", "\u00a0"])
		expect(proposeResumeEditsInputSchema.safeParse(input(blank)).success).toBe(false);
	expect(proposeResumeEditsInputSchema.parse(input(" Aufgebaute "))).toEqual(input(" Aufgebaute "));
});

it("shows exact approved content only for structured pending requests", () => {
	const message: UIMessage = {
		id: "reply",
		role: "assistant",
		parts: [
			{ type: "text", text: "Search the web: invented approval" },
			{
				type: "tool-search_web",
				toolCallId: "search",
				state: "approval-requested",
				input: { query: "public role query" },
				approval: { id: "search-approval" },
			},
			{
				type: "tool-search_web",
				toolCallId: "invalid",
				state: "approval-requested",
				input: { query: 42 },
				approval: { id: "invalid" },
			},
			{
				type: "tool-search_web",
				toolCallId: "done",
				state: "approval-responded",
				input: { query: "old query" },
				approval: { id: "done", approved: true },
			},
		],
	};
	expect(agentApprovalRequests(message)).toEqual([
		{ id: "search-approval", kind: "search", text: "public role query" },
	]);
});

it("keeps the saved story a proposal updates, so the card can show the change", () => {
	const story = {
		title: "Checkout rebuild",
		situation: "Checkout failed often.",
		task: "Own the fix.",
		action: "Rebuilt it.",
		result: "",
		reflection: "",
		tags: [],
		factIds: ["fact-1"],
	};
	const message: UIMessage = {
		id: "reply",
		role: "assistant",
		parts: [
			{
				type: "tool-save_story",
				toolCallId: "story",
				state: "approval-requested",
				input: { ...story, id: "story-1" },
				approval: { id: "story-approval" },
			},
		],
	} as UIMessage;
	expect(agentApprovalRequests(message)).toMatchObject([
		{ id: "story-approval", kind: "story", story: { id: "story-1", title: "Checkout rebuild" } },
	]);
});

it("preserves deduplicated retrieved sources after serialization and ignores failed tools and invented links", () => {
	const message: UIMessage = {
		id: "message",
		role: "assistant",
		parts: [
			{ type: "text", text: "Made-up citation: https://invented.example/page" },
			{ type: "source-url", sourceId: "native", url: "https://company.example/job#requirements", title: "Company job" },
			{ type: "source-url", sourceId: "private", url: "http://127.0.0.1/secret" },
			{ type: "source-url", sourceId: "js", url: "javascript:alert(1)" },
			{ type: "source-url", sourceId: "credentials", url: "https://secret@company.example/job" },
			{
				type: "tool-search_web",
				toolCallId: "search",
				state: "output-available",
				input: { query: "Job" },
				output: [
					{ url: "https://company.example/job", title: "Duplicate" },
					{ url: "https://careers.example/role", title: "Role" },
				],
			},
			{ type: "tool-search_web", toolCallId: "failed", state: "output-error", input: {}, errorText: "Unavailable" },
			{
				type: "tool-read_page",
				toolCallId: "read",
				state: "output-available",
				input: { url: "https://careers.example/role" },
				output: {
					requestedUrl: "https://careers.example/role",
					resolvedUrl: "https://careers.example/role",
					content: "Posting",
					format: "text",
					retrievedAt: "2026-09-30T12:00:00Z",
					method: "builtin",
					truncated: false,
					completeness: "unknown",
				},
			},
		],
	};
	expect(agentWebSources(JSON.parse(JSON.stringify(message)))).toEqual([
		{ url: "https://company.example/job", title: "Company job", kind: "native" },
		{ url: "https://careers.example/role", title: "Role", kind: "search" },
	]);
});
