import type { UIMessage } from "ai";
import { describe, expect, it } from "vite-plus/test";
import {
	applyStepToUiMessage,
	proposedEditsOf,
	upsertAssistantUiMessage,
	withEditWording,
	supersededEdits,
} from "./messages-persistence";

function emptyMessage(): UIMessage {
	return { id: "ui-1", role: "assistant", parts: [] };
}

describe("applyStepToUiMessage", () => {
	it("folds text, reasoning, and paired tool call/result content into UI parts", () => {
		const folded = applyStepToUiMessage(emptyMessage(), {
			content: [
				{ type: "reasoning", text: "thinking" },
				{ type: "tool-call", toolCallId: "call-1", toolName: "apply_resume_patch", input: { title: "Edit" } },
				{
					type: "tool-result",
					toolCallId: "call-1",
					toolName: "apply_resume_patch",
					output: { actionId: "action-1" },
				},
				{ type: "text", text: "Done." },
			],
		});

		expect(folded.parts).toEqual([
			{ type: "step-start" },
			{ type: "reasoning", text: "thinking" },
			{
				type: "tool-apply_resume_patch",
				toolCallId: "call-1",
				state: "output-available",
				input: { title: "Edit" },
				output: { actionId: "action-1" },
			},
			{ type: "text", text: "Done." },
		]);
	});

	it("appends to existing parts instead of replacing them", () => {
		const first = applyStepToUiMessage(emptyMessage(), { content: [{ type: "text", text: "one" }] });
		const second = applyStepToUiMessage(first, { content: [{ type: "text", text: "two" }] });

		expect(second.parts.map((part) => part.type)).toEqual(["step-start", "text", "step-start", "text"]);
	});

	it("keeps native sources and Google function signatures in a crash-recovery draft", () => {
		const folded = applyStepToUiMessage(emptyMessage(), {
			content: [
				{ type: "source", sourceType: "url", id: "src", url: "https://company.example/job", title: "Role" },
				{
					type: "tool-call",
					toolCallId: "read",
					toolName: "read_resume",
					input: {},
					providerMetadata: { google: { thoughtSignature: "opaque-signature" } },
				},
				{ type: "tool-result", toolCallId: "read", toolName: "read_resume", output: { text: "Resume" } },
			],
		});
		expect(folded.parts).toContainEqual({
			type: "source-url",
			sourceId: "src",
			url: "https://company.example/job",
			title: "Role",
		});
		expect(folded.parts).toContainEqual(
			expect.objectContaining({
				type: "tool-read_resume",
				state: "output-available",
				callProviderMetadata: { google: { thoughtSignature: "opaque-signature" } },
			}),
		);
	});
});

type ScriptedDb = {
	updates: unknown[];
};

// Minimal scripted stand-in for the drizzle client: each update() consumes the next scripted
// returning() result. No vi.mock — the database is an injected value.
function scriptedDatabase(updateResults: Array<Array<{ id: string }>>): ScriptedDb & Record<string, unknown> {
	const state: ScriptedDb = { updates: [] };
	let updateCall = 0;

	const database: ScriptedDb & Record<string, unknown> = {
		updates: state.updates,
		transaction: (run: (tx: unknown) => unknown) => run(database),
		update: () => ({
			set: (value: unknown) => {
				state.updates.push(value);
				return {
					where: () => {
						const result = updateResults[updateCall] ?? [];
						updateCall += 1;
						return Object.assign(Promise.resolve(undefined), {
							returning: async () => result,
						});
					},
				};
			},
		}),
	};
	return database;
}

describe("proposed edit statuses", () => {
	const proposing = (statuses: string[]): UIMessage =>
		({
			id: "ui-1",
			role: "assistant",
			parts: [
				{ type: "text", text: "Three edits." },
				{
					type: "tool-propose_edits",
					toolCallId: "call-1",
					state: "output-available",
					input: {},
					output: {
						title: "Tailor",
						edits: statuses.map((status, index) => ({ id: `e${index}`, status })),
						skipped: [],
					},
				},
			],
		}) as never;

	it("keeps what the user did while a run rewrites its message", async () => {
		const database = scriptedDatabase([[{ id: "row-1" }]]);
		database.transaction = async (callback: (tx: unknown) => unknown) => callback(database);
		database.select = () => ({
			from: () => ({
				where: () => {
					const query = {
						orderBy: () => query,
						for: async () => [{ id: "row-1", uiMessage: proposing(["accepted", "rejected"]) }],
					};
					return query;
				},
			}),
		});

		await upsertAssistantUiMessage(
			{
				userId: "user-1",
				threadId: "thread-1",
				rowId: "row-1",
				message: proposing(["pending", "pending"]),
				status: "completed",
			},
			database as never,
		);

		const written = database.updates[0] as { uiMessage: UIMessage };
		expect(proposedEditsOf(written.uiMessage).map((edit) => edit.status)).toEqual(["accepted", "rejected"]);
	});

	it("stores the user's wording as escaped text and keeps it while a run rewrites its message", async () => {
		const original = proposing(["pending"]);
		const edit = proposedEditsOf(original)[0] as Record<string, unknown>;
		Object.assign(edit, {
			before: "<p>Old</p>",
			after: "<p>Led Kubernetes</p>",
			unsupported: [{ kind: "skill", text: "Kubernetes" }],
		});

		const rewritten = withEditWording(original, "call-1", "e0", "Led <i>design</i>");
		expect(proposedEditsOf(rewritten)[0]).toMatchObject({
			after: "<p>Led &lt;i&gt;design&lt;/i&gt;</p>",
			unsupported: [],
			edited: true,
			status: "pending",
		});

		const database = scriptedDatabase([[{ id: "row-1" }]]);
		database.transaction = async (callback: (tx: unknown) => unknown) => callback(database);
		database.select = () => ({
			from: () => ({
				where: () => {
					const query = { orderBy: () => query, for: async () => [{ id: "row-1", uiMessage: rewritten }] };
					return query;
				},
			}),
		});
		await upsertAssistantUiMessage(
			{ userId: "user-1", threadId: "thread-1", rowId: "row-1", message: original, status: "completed" },
			database as never,
		);
		const written = database.updates[0] as { uiMessage: UIMessage };
		expect(proposedEditsOf(written.uiMessage)[0]?.after).toBe("<p>Led &lt;i&gt;design&lt;/i&gt;</p>");
	});
});

describe("supersededEdits", () => {
	const target = { sectionId: "experience", itemId: "northwind", field: "description" };
	const edit = (id: string, before: string, after: string, extra: Record<string, unknown> = {}) => ({
		id,
		target,
		location: "Experience · Northwind Labs · bullet 1",
		before,
		after,
		why: "Why",
		status: "pending" as "pending" | "accepted" | "rejected",
		...extra,
	});
	const message = (edits: ReturnType<typeof edit>[]): UIMessage => ({
		id: "earlier",
		role: "assistant",
		parts: [
			{
				type: "tool-propose_edits",
				toolCallId: "call-1",
				state: "output-available",
				input: {},
				output: { title: "Add the audit", edits, skipped: [] },
			} as UIMessage["parts"][number],
		],
	});
	const bullet = "<p>Improved checkout-flow accessibility.</p>";
	// The earlier addition anchors on the bullet with its list item's end; the refinement rewrites the same bullet.
	const addition = edit("add", `${bullet}</li>`, `${bullet}</li><li><p>Led an accessibility audit last year.</p></li>`);
	const refinement = edit("refine", bullet, "<p>Led a WCAG 2.2 AA audit in 2025; the team fixed 60 issues.</p>");

	it("names an earlier undecided edit of the same passage", () => {
		expect(supersededEdits(message([addition]), [refinement], () => false)).toEqual(["add"]);
	});

	it("keeps decided edits, edits the document already holds, other passages and structural changes", () => {
		const other = edit("other", "<p>Shipped the onboarding flow.</p>", "<p>Shipped onboarding.</p>");
		const accepted = { ...addition, id: "accepted", status: "accepted" as const };
		const structural = edit("structural", bullet, bullet, { snapshot: { before: "{}", after: "{}" } });
		const earlier = message([other, accepted, structural, addition]);
		expect(supersededEdits(earlier, [refinement], (candidate) => candidate.id === "add")).toEqual([]);
	});
});
