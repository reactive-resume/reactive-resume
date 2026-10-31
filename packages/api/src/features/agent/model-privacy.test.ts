import type { ProposeEditsOutput } from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { ModelMessage, UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { convertToModelMessages, isStepCount, ToolLoopAgent } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createEntry } from "@reactive-resume/resume/entries";
import { applyResumeProposals } from "@reactive-resume/resume/proposals";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { pruneAgentModelContext } from "./context";
import { buildAgentTools } from "./tools";

const fixture = vi.hoisted(() => ({ getById: vi.fn() }));
vi.mock("@reactive-resume/db/client", () => ({ db: {} }));
vi.mock("../resume/service", () => ({ resumeService: { getById: fixture.getById } }));
vi.mock("../cover-letters/service", () => ({ coverLetterService: {} }));
const { documentView, loadDocument, resolveDocumentEdits } = await import("./document");

const hidden = [
	"HIDDEN_SUMMARY",
	"HIDDEN_SUMMARY_TITLE",
	"HIDDEN_SECTION",
	"HIDDEN_BUILTIN_ITEM",
	"HIDDEN_CUSTOM_SECTION",
	"HIDDEN_CUSTOM_ITEM",
];
function resume() {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "VISIBLE_NAME";
	data.summary = { ...data.summary, hidden: true, title: "HIDDEN_SUMMARY_TITLE", content: "<p>HIDDEN_SUMMARY</p>" };
	data.sections.experience.items = [
		{
			...createEntry("experience"),
			id: "visible-job",
			company: "VISIBLE_EMPLOYER",
			description: "<p>VISIBLE_BULLET</p>",
		},
	] as never;
	data.sections.projects = {
		...data.sections.projects,
		hidden: true,
		title: "HIDDEN_SECTION",
		items: [
			{
				...createEntry("projects"),
				id: "hidden-project",
				name: "HIDDEN_SECTION",
				description: "<p>HIDDEN_SECTION</p>",
			},
		],
	} as never;
	data.sections.skills.items = [
		{ ...createEntry("skills"), id: "hidden-skill", hidden: true, name: "HIDDEN_BUILTIN_ITEM" },
		{ ...createEntry("skills"), id: "visible-skill", name: "VISIBLE_SKILL" },
	] as never;
	data.customSections = [
		{
			...data.sections.certifications,
			id: "hidden-custom",
			type: "certifications",
			hidden: true,
			title: "HIDDEN_CUSTOM_SECTION",
			items: [{ ...createEntry("certifications"), id: "hidden-cert", title: "HIDDEN_CUSTOM_SECTION" }],
		},
		{
			...data.sections.certifications,
			id: "visible-custom",
			type: "certifications",
			title: "VISIBLE_CUSTOM",
			items: [
				{ ...createEntry("certifications"), id: "private-item", hidden: true, title: "HIDDEN_CUSTOM_ITEM" },
				{ ...createEntry("certifications"), id: "public-item", title: "VISIBLE_CERT" },
			],
		},
	] as never;
	data.metadata.notes = "PRIVATE_NOTES";
	data.picture.url = "https://fictional.invalid/PRIVATE_PICTURE";
	return data;
}

beforeEach(() => fixture.getById.mockReset());
async function loaded() {
	const data = resume();
	fixture.getById.mockResolvedValue({
		id: "resume",
		name: "Fictional",
		data,
		updatedAt: new Date(1000),
		isLocked: false,
		applicationId: null,
	});
	return { data, document: await loadDocument("owner", { kind: "resume", id: "resume" }) };
}
const headline = {
	title: "Headline",
	changes: [
		{
			kind: "field",
			target: { sectionId: "basics", field: "headline" },
			before: "",
			value: "VISIBLE_HEADLINE",
			why: "Requested headline.",
		},
	],
};

it("excludes hidden content from structured reads without changing owned data or visible entries", async () => {
	const { data, document } = await loaded();
	const before = JSON.stringify(data);
	const view = JSON.stringify(documentView(document));
	for (const marker of hidden) expect(view).not.toContain(marker);
	for (const marker of ["PRIVATE_NOTES", "PRIVATE_PICTURE"]) expect(view).not.toContain(marker);
	for (const marker of ["VISIBLE_NAME", "VISIBLE_EMPLOYER", "VISIBLE_BULLET", "VISIBLE_SKILL", "VISIBLE_CERT"])
		expect(view).toContain(marker);
	expect(view).not.toContain('"cover-letter"');
	expect(JSON.stringify(data)).toBe(before);
	expect(document.resume).toBe(data);
});

it("keeps full UI snapshots while the actual SDK provider sees no hidden data in any step or restored continuation", async () => {
	const { data, document } = await loaded();
	let prepared: ProposeEditsOutput | undefined;
	const captures: string[] = [];
	let step = 0;
	const tools = buildAgentTools({
		document: "resume",
		externalSearch: false,
		signal: new AbortController().signal,
		handlers: {
			readDocument: async () => documentView(document),
			readAttachment: async () => ({}),
			proposeEdits: async (input) => (prepared = resolveDocumentEdits(document, input)),
			searchWeb: async () => {
				throw Error("No search expected");
			},
			readPage: async () => {
				throw Error("No page expected");
			},
		},
	});
	const model = new MockLanguageModelV4({
		doGenerate: async (options) => {
			captures.push(JSON.stringify(options.prompt));
			const current = step++;
			return {
				content:
					current === 0
						? [{ type: "tool-call", toolCallId: "read", toolName: "read_resume", input: "{}" }]
						: current === 1
							? [
									{
										type: "tool-call",
										toolCallId: "prepare",
										toolName: "propose_edits",
										input: JSON.stringify(headline),
									},
								]
							: [{ type: "text", text: "Review the prepared changes." }],
				finishReason: { unified: "stop", raw: "stop" },
				usage: {
					inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: 1, text: 1, reasoning: 0 },
				},
				warnings: [],
			};
		},
	});
	const agent = new ToolLoopAgent({
		model,
		tools,
		stopWhen: isStepCount(4),
		prepareStep: ({ messages }) => ({ messages: pruneAgentModelContext(messages) }),
	});
	const result = await agent.generate({ prompt: "Change my headline." });
	expect(captures).toHaveLength(3);
	expect(captures[1]).toContain("VISIBLE_EMPLOYER");
	expect(captures[2]).toContain("prepare");
	if (!prepared?.edits[0]?.snapshot) throw Error("Expected full structural snapshot");
	for (const marker of hidden) expect(prepared.edits[0].snapshot.before).toContain(marker);
	expect(JSON.stringify(result.steps.flatMap((s) => s.toolResults))).toContain("HIDDEN_BUILTIN_ITEM");
	const view = documentView(document);
	// Historical v5 read results contain raw structure; projection must also protect stored histories.
	const legacyRead = {
		...view,
		data: {
			...view.data,
			structure: {
				basics: data.basics,
				summary: data.summary,
				sections: data.sections,
				customSections: data.customSections,
			},
		},
	};
	const history: UIMessage[] = [
		{ id: "user", role: "user", parts: [{ type: "text", text: "Change my headline." }] },
		{
			id: "assistant",
			role: "assistant",
			parts: [
				{ type: "tool-read_resume", toolCallId: "read", state: "output-available", input: {}, output: legacyRead },
				{
					type: "tool-propose_edits",
					toolCallId: "prepare",
					state: "output-available",
					input: headline,
					output: prepared,
				},
			],
		},
	];
	const stored = JSON.stringify(history);
	for (const mode of ["reopen", "continue"]) {
		const replay =
			mode === "continue"
				? [
						...history,
						{ id: "answer", role: "user", parts: [{ type: "text", text: "VISIBLE_CONTINUATION" }] } as UIMessage,
					]
				: history;
		await agent.generate({ messages: await convertToModelMessages(replay) });
	}
	for (const prompt of captures)
		for (const marker of [...hidden, "PRIVATE_NOTES", "PRIVATE_PICTURE"]) expect(prompt).not.toContain(marker);
	expect(captures.at(-1)).toContain("VISIBLE_CONTINUATION");
	expect(JSON.stringify(history)).toBe(stored);
	expect(data.basics.headline).toBe("");
	expect(data.metadata.notes).toBe("PRIVATE_NOTES");
});

describe("hidden targets cannot disclose current values in review cards", () => {
	it.each([
		{ sectionId: "summary", field: "title", before: "HIDDEN_SUMMARY_TITLE" },
		{ sectionId: "projects", field: "title", before: "HIDDEN_SECTION" },
		{ sectionId: "projects", itemId: "hidden-project", field: "name", before: "HIDDEN_SECTION" },
		{ sectionId: "skills", itemId: "hidden-skill", field: "name", before: "HIDDEN_BUILTIN_ITEM" },
		{ sectionId: "hidden-custom", field: "title", before: "HIDDEN_CUSTOM_SECTION" },
		{ sectionId: "hidden-custom", itemId: "hidden-cert", field: "title", before: "HIDDEN_CUSTOM_SECTION" },
		{ sectionId: "visible-custom", itemId: "private-item", field: "title", before: "HIDDEN_CUSTOM_ITEM" },
	])("rejects $sectionId / $field", async ({ before, ...target }) => {
		const { data, document } = await loaded();
		const original = JSON.stringify(data);
		const out = resolveDocumentEdits(document, {
			title: "Edit hidden record",
			changes: [{ kind: "field", target, before, value: "New value", why: "Requested." }],
		});
		expect(out.edits).toHaveLength(0);
		expect(out.skipped).toHaveLength(1);
		for (const marker of hidden) expect(JSON.stringify(out)).not.toContain(marker);
		expect(JSON.stringify(data)).toBe(original);
	});
});

describe("model-result projection", () => {
	it.each(["json", "text", "malformed"])(
		"projects %s results regardless of budget without changing stored data",
		(envelope) => {
			const value = {
				title: "HIDDEN_TITLE",
				edits: [
					{ id: "review-id", status: "pending", before: "HIDDEN_BEFORE", snapshot: { before: "HIDDEN_SNAPSHOT" } },
				],
				skipped: [{ passageId: "anchor", reason: "This entry belongs in a different section." }],
			};
			const output =
				envelope === "json"
					? { type: "json", value }
					: { type: "text", value: envelope === "text" ? JSON.stringify(value) : "HIDDEN_MALFORMED" };
			const messages = [
				{ role: "tool", content: [{ type: "tool-result", toolName: "propose_edits", toolCallId: "call", output }] },
			] as ModelMessage[];
			const stored = JSON.stringify(messages);
			for (const budget of [1, 1_000_000]) {
				const projected = JSON.stringify(pruneAgentModelContext(messages, budget));
				expect(projected).not.toContain("HIDDEN_");
				if (envelope !== "malformed") {
					expect(projected).toContain("review-id");
					expect(projected).toContain("pending");
					expect(projected).toContain("anchor");
					expect(projected).toContain("This entry belongs in a different section.");
				}
			}
			expect(JSON.stringify(messages)).toBe(stored);
		},
	);
});

it("keeps undisclosed content in stale validation rather than weakening the owned snapshot", async () => {
	const { data, document } = await loaded();
	const output = resolveDocumentEdits(document, headline);
	const edit = output.edits[0];
	if (!edit?.snapshot) throw Error("Missing snapshot");
	data.summary.content = "<p>Changed hidden content after review.</p>";
	const changed = JSON.stringify(data);
	const result = applyResumeProposals(data, [{ ...edit, source: "assistant" }]);
	expect(result.applied).toHaveLength(0);
	expect(result.stale).toHaveLength(1);
	expect(JSON.stringify(data)).toBe(changed);
});

it.each(["error-text", "error-json", "execution-denied"] as const)(
	"preserves %s failures without replacing the last good read",
	(type) => {
		const output =
			type === "execution-denied"
				? { type, reason: "User denied the tool call." }
				: {
						type,
						value:
							type === "error-text"
								? "Invalid input: cover letters go in Documents."
								: { message: "Document is not shared.", data: {} },
					};
		const messages = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "read-good",
						toolName: "read_resume",
						output: { type: "json", value: { name: "Visible", data: { resume: "VISIBLE_GOOD_READ", passages: [] } } },
					},
				],
			},
			{
				role: "tool",
				content: [
					{ type: "tool-result", toolCallId: "read-failed", toolName: "read_resume", output },
					{ type: "tool-result", toolCallId: "edit-failed", toolName: "propose_edits", output },
				],
			},
		] as ModelMessage[];
		const projected = pruneAgentModelContext(messages, 1000000);
		expect(projected[1]).toEqual(messages[1]);
		expect(JSON.stringify(projected)).toContain("VISIBLE_GOOD_READ");
		expect(JSON.stringify(projected)).not.toContain("Prepared changes are shown");
	},
);

it("reports rejected changes without claiming any were prepared", () => {
	const messages = [
		{
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: "reject",
					toolName: "propose_edits",
					output: {
						type: "json",
						value: {
							edits: [],
							skipped: [{ passageId: "change_1", reason: "This entry is hidden. Show it in Write." }],
						},
					},
				},
			],
		},
	] as ModelMessage[];
	const projected = JSON.stringify(pruneAgentModelContext(messages));
	expect(projected).toContain("This entry is hidden. Show it in Write.");
	expect(projected).not.toContain("Prepared changes are shown");
});
