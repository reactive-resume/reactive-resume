import type { ProposeEditsOutput } from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { Proposal } from "@reactive-resume/resume/proposals";
import type { UIMessage } from "ai";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { createEntry } from "@reactive-resume/resume/entries";
import {
	appliedApplications,
	applyProposal,
	applyProposals,
	applyResumeProposals,
	getProposalState,
} from "@reactive-resume/resume/proposals";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

// Real PostgreSQL and the real agent loop; only the model is scripted, and it records what it was sent.
const fixture = vi.hoisted(() => {
	process.env.ENCRYPTION_SECRET ??= "rx72-integration-encryption-secret-0123456789";
	return {
		db: undefined as ReturnType<typeof drizzle> | undefined,
		pool: undefined as Pool | undefined,
		plan: [] as Array<{ tool?: string; input?: unknown; text?: string }>,
		prompts: [] as string[],
	};
});
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
	// Resume writes publish change notifications through the pool.
	getPool: () => fixture.pool,
}));
vi.mock("../ai/service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../ai/service")>();
	const { MockLanguageModelV4 } = await import("ai/test");
	return {
		...actual,
		getAgentModel: () =>
			new MockLanguageModelV4({
				doStream: async (options) => {
					fixture.prompts.push(JSON.stringify(options.prompt));
					const step = fixture.plan.shift();
					const parts = step?.tool
						? [{ type: "tool-call", toolCallId: randomUUID(), toolName: step.tool, input: JSON.stringify(step.input) }]
						: [
								{ type: "text-start", id: "t" },
								{ type: "text-delta", id: "t", delta: step?.text ?? "Done." },
								{ type: "text-end", id: "t" },
							];
					return {
						stream: new ReadableStream({
							start(controller) {
								controller.enqueue({ type: "stream-start", warnings: [] });
								for (const part of parts) controller.enqueue(part as never);
								controller.enqueue({
									type: "finish",
									finishReason: { unified: step?.tool ? "tool-calls" : "stop", raw: "stop" },
									usage: {
										inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
										outputTokens: { total: 1, text: 1, reasoning: 0 },
									},
								} as never);
								controller.close();
							},
						}),
					};
				},
			}),
	};
});

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;
const userId = "alice";
const FACT = "Mentored Project Firefly apprentices during 2024";

describe.skipIf(!databaseUrl)("document assistant review on PostgreSQL", () => {
	const schemaName = `agent_review_${randomUUID().replaceAll("-", "")}`;
	let admin: Pool;
	let pool: Pool;
	let agent: typeof import("./service").agentService;
	let career: typeof import("../career/service").careerService;
	let documents: typeof import("../documents/service").documentsService;
	let resumes: typeof import("../resume/service").resumeService;
	let loadDocument: typeof import("./document").loadDocument;
	let copyId: string;

	beforeAll(async () => {
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		// Several connections: the concurrency case holds a row lock on one while requests wait on others.
		pool = new Pool({ connectionString: databaseUrl, max: 6, options: `-c search_path=${schemaName}` });
		fixture.db = drizzle({ client: pool });
		fixture.pool = pool;
		const migrations = new URL("../../../../../migrations/", import.meta.url);
		const directories = (await readdir(migrations, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
			.map((entry) => entry.name)
			.sort();
		for (const directory of directories) {
			const file = new URL(`${directory}/migration.sql`, migrations);
			if (existsSync(file)) await pool.query((await readFile(file, "utf8")).replaceAll('"public".', ""));
		}

		agent = (await import("./service")).agentService;
		career = (await import("../career/service")).careerService;
		documents = (await import("../documents/service")).documentsService;
		resumes = (await import("../resume/service")).resumeService;
		loadDocument = (await import("./document")).loadDocument;
		const { encryptCredential } = await import("../ai/credentials");

		const data = structuredClone(defaultResumeData);
		data.summary.content = "<p>Built accessible interfaces.</p>";
		const db = fixture.db;
		await db.insert(tables.user).values({
			id: userId,
			name: "Alice Example",
			email: "alice@example.test",
			username: `${schemaName}-alice`,
			displayUsername: `${schemaName}-alice`,
		});
		await db.insert(tables.resume).values({ id: "base", userId, name: "Base", slug: "base", data });
		await db.insert(tables.application).values({
			id: "job-a",
			userId,
			company: "Northwind Fiction",
			role: "Designer",
			resumeId: "base",
			jobDescription: "Accessible design. Mentoring.",
			requirements: ["Accessible design", "Mentoring"],
		});
		await db.insert(tables.aiProvider).values({
			id: "provider",
			userId,
			label: "Scripted",
			provider: "openai",
			model: "fixture",
			...encryptCredential("synthetic-key"),
			testStatus: "success",
			enabled: true,
			isDefault: true,
		});
		await db.insert(tables.careerFact).values({
			id: "fact-firefly",
			userId,
			text: FACT,
			category: "accomplishment",
			source: { kind: "manual", id: "manual-1", quote: FACT },
			sourceKey: "firefly",
		});
		copyId = await documents.copyForJob({ userId, resumeId: "base", applicationId: "job-a" });
	}, 60_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	async function send(threadId: string, context: Record<string, unknown>, message?: UIMessage) {
		const stream = await agent.messages.send({
			userId,
			threadId,
			message: message ?? {
				id: randomUUID(),
				role: "user",
				parts: [{ type: "text", text: "Tailor the resume to the posting." }],
			},
			context: { applicationId: "job-a", ...context },
		});
		for await (const _chunk of stream) {
			// Drain: the run persists as it streams.
		}
		return agent.threads.get({ id: threadId, userId });
	}

	const proposalOf = (messages: UIMessage[]) => {
		for (const message of messages)
			for (const part of message.parts)
				if (part.type === "tool-propose_edits")
					return {
						message,
						part: part as typeof part & { toolCallId: string; output: { edits: Array<Record<string, unknown>> } },
					};
		throw new Error("Expected a proposal.");
	};

	async function propose(threadId: string, extra: Record<string, unknown> = {}) {
		const passage = (await loadDocument(userId, { kind: "resume", id: copyId })).passages[0];
		fixture.plan.push(
			{ tool: "read_resume", input: {} },
			{
				tool: "propose_edits",
				input: {
					title: "Tailor",
					changes: [
						{
							kind: "text",
							sectionId: passage?.target.sectionId,
							passageId: passage?.id,
							text: "Built accessible, tested interfaces.",
							why: "Posting",
							...extra,
						},
					],
				},
			},
			{ text: "Proposed." },
		);
		return proposalOf((await send(threadId, {})).messages);
	}

	it("never sends or shows a Knowledge reply once sharing is off or the fact is forgotten", async () => {
		const { id: threadId } = await agent.threads.start({ userId, resumeId: copyId });
		const passage = (await loadDocument(userId, { kind: "resume", id: copyId })).passages[0];
		fixture.plan.push(
			{ tool: "read_knowledge", input: { query: "" } },
			{
				tool: "propose_edits",
				input: {
					title: "Mentoring",
					changes: [
						{
							kind: "text",
							sectionId: passage?.target.sectionId,
							passageId: passage?.id,
							text: FACT,
							why: "Mentoring",
							factIds: ["fact-firefly"],
						},
					],
				},
			},
			{ text: `I used: ${FACT}` },
		);
		const shared = await send(threadId, { memory: true });
		expect(JSON.stringify(shared.messages)).toContain(FACT);

		// Knowledge left out of the next message: the earlier reply isn't replayed, and no lookup is offered.
		fixture.prompts = [];
		fixture.plan.push({ text: "Fine." });
		await send(threadId, { memory: false });
		expect(fixture.prompts[0]).not.toContain(FACT);
		expect(fixture.prompts[0]).toContain("isn't shared now");

		// Forgotten: hidden from the restored conversation, and not replayed even with Knowledge shared again.
		await career.forgetFact(userId, "fact-firefly");
		const restored = await agent.threads.get({ id: threadId, userId });
		expect(JSON.stringify(restored.messages)).not.toContain(FACT);
		expect(JSON.stringify(restored.messages)).toContain("data-knowledge-withdrawn");
		fixture.prompts = [];
		fixture.plan.push({ text: "Fine." });
		await send(threadId, { memory: true });
		expect(fixture.prompts.join("\n")).not.toContain(FACT);
	});

	it("sends only scoped usable story fields through the canonical Knowledge tool and bounds oversized stories", async () => {
		await knowledgeFact("rx101-story-proof", "I spoke about accessible design at a conference.");
		const story = {
			applicationId: null,
			title: "Shared conference talk",
			situation: "A conference needed a talk.",
			task: "Explain accessible design.",
			action: "I demonstrated accessible interfaces.",
			result: "",
			reflection: "",
			factIds: ["rx101-story-proof"],
			tags: [],
		};
		const saved = await career.saveStory(userId, story);
		await career.saveStory(userId, {
			...story,
			title: "Oversized shared talk",
			situation: "S".repeat(4000),
			task: "T".repeat(4000),
			action: "A".repeat(6000),
			result: "R".repeat(4000),
			reflection: "F".repeat(4000),
		});
		await fixture.db
			?.insert(tables.application)
			.values({ id: "rx101-other-job", userId, company: "Other Fiction", role: "Designer" });
		await career.saveFact(userId, {
			applicationId: "rx101-other-job",
			text: "Private other-job evidence",
			category: "experience",
			source: { kind: "manual", id: "rx101-private", quote: "Private other-job evidence" },
		});
		await career.saveStory(userId, { ...story, applicationId: "rx101-other-job", title: "Private other-job story" });
		const { id: threadId } = await agent.threads.start({ userId, resumeId: copyId });
		fixture.prompts = [];
		fixture.plan.push({ tool: "read_knowledge", input: { query: "" } }, { text: "Reviewed shared talk." });
		const sent = await send(threadId, { memory: true });
		const part = sent.messages
			.flatMap((message) => message.parts)
			.find((part) => part.type === "tool-read_knowledge") as
			| { output: { stories: unknown[]; truncated: boolean } }
			| undefined;
		expect(part?.output.stories).toContainEqual({ id: saved.id, data: { ...story, applicationId: undefined } });
		expect(part?.output.truncated).toBe(true);
		const wire = fixture.prompts.join("\n");
		expect(wire).toContain(story.action);
		expect(wire).not.toContain("Private other-job");
		expect(wire).not.toContain("Oversized shared talk");
		expect(JSON.stringify(part?.output.stories).length).toBeLessThan(16_000);
	});

	it.each(["title", "tag"])(
		"a story %s query includes scoped active backing facts without duplicates or metadata",
		async (field) => {
			const evidence = "I cut release lead time from twelve days to four.";
			const factId = `orchid-proof-${field}`;
			await knowledgeFact(factId, evidence);
			const story = await career.saveStory(userId, {
				applicationId: null,
				title: field === "title" ? "ORCHID leadership" : "Release leadership",
				situation: "Releases took twelve days.",
				task: "Shorten releases.",
				action: "I changed ownership.",
				result: "Four days.",
				reflection: "",
				factIds: [factId],
				tags: field === "tag" ? ["ORCHID"] : [],
			});
			const { id: threadId } = await agent.threads.start({ userId, resumeId: copyId });
			for (const query of ["ORCHID", "release"]) {
				fixture.plan.push({ tool: "read_knowledge", input: { query } }, { text: "Reviewed." });
				const sent = await send(threadId, { memory: true });
				const part = sent.messages
					.flatMap((message) => message.parts)
					.findLast((part) => part.type === "tool-read_knowledge") as unknown as {
					output: {
						facts: Array<{ id: string; text: string }>;
						stories: Array<{ id: string; data: Record<string, unknown> }>;
						truncated: boolean;
					};
				};
				expect(part.output.stories).toContainEqual(expect.objectContaining({ id: story.id }));
				expect(part.output.facts).toContainEqual({ id: factId, text: evidence, category: "accomplishment" });
				expect(new Set(part.output.facts.map((fact) => fact.id)).size).toBe(part.output.facts.length);
				for (const fact of part.output.facts) expect(Object.keys(fact).sort()).toEqual(["category", "id", "text"]);
				for (const entry of part.output.stories) expect(entry.data).not.toHaveProperty("applicationId");
			}
		},
	);

	it("omits a story with truncation when its newly included supporting facts do not fit the story expansion budget", async () => {
		const factIds = Array.from({ length: 6 }, (_, index) => `story-budget-proof-${index}`);
		for (const id of factIds) await knowledgeFact(id, "Evidence " + "x".repeat(1950));
		const story = await career.saveStory(userId, {
			applicationId: null,
			title: "BUDGETFLOW",
			situation: "S".repeat(4000),
			task: "T".repeat(3000),
			action: "A".repeat(3000),
			result: "",
			reflection: "",
			factIds,
			tags: [],
		});
		const { id: threadId } = await agent.threads.start({ userId, resumeId: copyId });
		fixture.plan.push({ tool: "read_knowledge", input: { query: "BUDGETFLOW" } }, { text: "Reviewed." });
		const sent = await send(threadId, { memory: true });
		const part = sent.messages
			.flatMap((message) => message.parts)
			.find((part) => part.type === "tool-read_knowledge") as unknown as {
			output: { facts: unknown[]; stories: Array<{ id: string }>; truncated: boolean };
		};
		expect(part.output.stories.map((entry) => entry.id)).not.toContain(story.id);
		expect(part.output.facts).toEqual([]);
		expect(part.output.truncated).toBe(true);
	});

	it("refuses to continue a paused reply that read Knowledge after the fact was switched off", async () => {
		const fact = await career.saveFact(userId, {
			applicationId: null,
			text: "Ran Project Lantern reviews",
			category: "experience",
			source: { kind: "manual", id: "manual-2", quote: "Ran Project Lantern reviews" },
		});
		if (!fact) throw new Error("Expected a fact.");
		const { id: threadId } = await agent.threads.start({ userId, resumeId: copyId });
		fixture.plan.push(
			{ tool: "read_knowledge", input: { query: "" } },
			{ tool: "ask_user_question", input: { question: "Use Lantern?", choices: ["Yes", "No"] } },
		);
		const paused = await send(threadId, { memory: true });
		await career.updateFact(userId, { id: fact.id, status: "excluded" });

		const reply = paused.messages.at(-1) as UIMessage;
		const answered = {
			...reply,
			parts: reply.parts.map((part) =>
				part.type === "tool-ask_user_question" ? { ...part, state: "output-available", output: "Yes" } : part,
			),
		} as UIMessage;
		await expect(send(threadId, { memory: true }, answered)).rejects.toThrow("Knowledge changed");
	});

	async function knowledgeFact(id: string, text: string) {
		await fixture.db?.insert(tables.careerFact).values({
			id,
			userId,
			text,
			category: "accomplishment",
			source: { kind: "manual", id: `manual-${id}`, quote: text },
			sourceKey: id,
		});
	}

	it("never sends or shows a later reply that repeats Knowledge from history without a lookup", async () => {
		const fact = "Mentored Project Moonflower apprentices during 2025";
		await knowledgeFact("fact-moonflower", fact);
		const { id: threadId } = await agent.threads.start({ userId, resumeId: copyId });
		fixture.plan.push({ tool: "read_knowledge", input: { query: "" } }, { text: "Found something." });
		await send(threadId, { memory: true });
		// The second reply repeats the fact from history; it never looks anything up.
		fixture.plan.push({ text: `From earlier: ${fact}` });
		const derived = await send(threadId, { memory: true });
		expect(JSON.stringify(derived.messages.at(-1))).toContain(fact);

		fixture.prompts = [];
		fixture.plan.push({ text: "Fine." });
		await send(threadId, { memory: false });
		expect(fixture.prompts.join("\n")).not.toContain(fact);

		await career.updateFact(userId, { id: "fact-moonflower", status: "excluded" });
		expect(JSON.stringify((await agent.threads.get({ id: threadId, userId })).messages)).not.toContain(fact);
		await career.forgetFact(userId, "fact-moonflower");
		fixture.prompts = [];
		fixture.plan.push({ text: "Fine." });
		const reopened = await send(threadId, { memory: true });
		expect(fixture.prompts.join("\n")).not.toContain(fact);
		expect(JSON.stringify(reopened.messages)).not.toContain(fact);
	});

	it("refuses to continue a later question that repeats a forgotten fact", async () => {
		const fact = "Led Project Marigold migration";
		await knowledgeFact("fact-marigold", fact);
		const { id: threadId } = await agent.threads.start({ userId, resumeId: copyId });
		fixture.plan.push({ tool: "read_knowledge", input: { query: "" } }, { text: "Noted." });
		await send(threadId, { memory: true });
		fixture.plan.push({
			tool: "ask_user_question",
			input: { question: `Should I mention: ${fact}?`, choices: ["Yes", "No"] },
		});
		const paused = await send(threadId, { memory: true });
		await career.forgetFact(userId, "fact-marigold");

		const reply = paused.messages.at(-1) as UIMessage;
		const answered = {
			...reply,
			parts: reply.parts.map((part) =>
				part.type === "tool-ask_user_question" ? { ...part, state: "output-available", output: "Yes" } : part,
			),
		} as UIMessage;
		fixture.prompts = [];
		await expect(send(threadId, { memory: true }, answered)).rejects.toThrow("Knowledge changed");
		expect(fixture.prompts.join("\n")).not.toContain(fact);
	});

	// What the apps call: the protected resume router, as an already authenticated owner.
	async function router() {
		const { createRouterClient } = await import("@orpc/server");
		const { resumeRouter } = await import("../resume/router");
		return createRouterClient(resumeRouter, {
			context: {
				authentication: { user: { id: userId }, method: "session", permissions: ["read", "write", "delete"] },
				reqHeaders: new Headers(),
				resHeaders: new Headers(),
			} as never,
		});
	}

	async function storedEdit(threadId: string) {
		const { message, part } = proposalOf((await agent.threads.get({ id: threadId, userId })).messages);
		return { message, part, edit: part.output.edits[0] as Proposal };
	}

	/** What an app does on Accept: apply the edit it holds to its own copy of the data. */
	const applied = (data: Awaited<ReturnType<typeof resumes.getById>>["data"], edit: Proposal) => {
		const next = structuredClone(data);
		if (!applyProposal(next, { ...edit, source: "assistant" })) throw new Error("Expected the edit to apply.");
		return next;
	};

	it("refuses an older app's held tailoring for the shared original before writing, and lets a refreshed app edit it", async () => {
		const client = await router();
		const base = await resumes.getById({ userId, id: "base" });
		// Copying moved the job's link to the copy: the base resume has no linked posting now.
		expect(base.applicationId).toBeNull();
		const { id: threadId } = await agent.threads.start({ userId, resumeId: "base" });
		const toolCallId = randomUUID();
		const legacy = {
			id: randomUUID(),
			role: "assistant",
			// A reply from before sets recorded their job: its posting chip was on.
			metadata: { contextScope: "[true,true]" },
			parts: [
				{
					type: "tool-propose_edits",
					toolCallId,
					state: "output-available",
					input: {},
					output: {
						title: "Tailor",
						skipped: [],
						edits: [
							{
								id: "legacy-edit",
								target: { sectionId: "summary", field: "content" },
								location: "Summary",
								before: base.data.summary.content,
								after: "<p>Tailored for Northwind</p>",
								why: "Posting",
								status: "pending",
							},
						],
					},
				},
			],
		} as unknown as UIMessage;
		await fixture.db
			?.insert(tables.agentMessage)
			.values({ userId, threadId, role: "assistant", sequence: 1, status: "completed", uiMessage: legacy as never });

		// An older app holds the original payload and applies it, then saves the usual way.
		const held = (legacy.parts[0] as unknown as { output: { edits: Proposal[] } }).output.edits[0] as Proposal;
		await expect(
			client.update({ id: "base", data: applied(base.data, held), expectedUpdatedAt: base.updatedAt }),
		).rejects.toMatchObject({ code: "RESUME_VERSION_CONFLICT" });
		const refused = await resumes.getById({ userId, id: "base" });
		expect(refused.data).toEqual(base.data);
		// The version moved on: a draft it kept and resends later conflicts too.
		expect(refused.updatedAt.getTime()).toBeGreaterThan(base.updatedAt.getTime());
		await expect(
			client.update({
				id: "base",
				data: applied(base.data, held),
				expectedUpdatedAt: base.updatedAt,
				proposalSafety: "v1",
			}),
		).rejects.toMatchObject({ code: "RESUME_VERSION_CONFLICT" });
		// Every other content write path an older app or agent uses is refused the same way.
		await expect(
			client.patch({ id: "base", operations: [{ op: "replace", path: "/summary/content", value: held.after }] }),
		).rejects.toMatchObject({ code: "RESUME_VERSION_CONFLICT" });
		const version = (await resumes.versions.list({ resumeId: "base", userId }))[0];
		if (version)
			await expect(client.restoreVersion({ resumeId: "base", versionId: version.id })).rejects.toMatchObject({
				code: "RESUME_VERSION_CONFLICT",
			});
		await expect(
			agent.messages.setEditStatus({
				userId,
				threadId,
				messageId: legacy.id,
				toolCallId,
				edits: [{ id: "legacy-edit", status: "accepted" }],
			}),
		).rejects.toThrow("isn't in the document");
		expect((await resumes.getById({ userId, id: "base" })).data).toEqual(base.data);

		// A refreshed app's own edit to the original is accepted.
		const current = await resumes.getById({ userId, id: "base" });
		const manual = structuredClone(current.data);
		manual.summary.content = "<p>Built accessible, tested interfaces.</p>";
		await client.update({ id: "base", data: manual, expectedUpdatedAt: current.updatedAt, proposalSafety: "v1" });
		expect((await resumes.getById({ userId, id: "base" })).data.summary.content).toBe(
			"<p>Built accessible, tested interfaces.</p>",
		);
		// A resume without such edits keeps taking older apps' saves unchanged.
		const copy = await resumes.getById({ userId, id: copyId });
		await client.update({ id: copyId, data: copy.data, expectedUpdatedAt: copy.updatedAt });

		// With the posting shared, new tailoring of the base resume is refused before anything is proposed.
		const passage = (await loadDocument(userId, { kind: "resume", id: "base" })).passages[0];
		fixture.plan.push(
			{
				tool: "propose_edits",
				input: {
					title: "Tailor",
					changes: [
						{
							kind: "text",
							sectionId: passage?.target.sectionId,
							passageId: passage?.id,
							text: "Tailored",
							why: "Posting",
						},
					],
				},
			},
			{ text: "Copy it first." },
		);
		const proposed = await send(threadId, {});
		expect(JSON.stringify(proposed.messages)).toContain("Copy it for this job first");
	});

	it("refuses an older app's ID-only acceptance of wording another device changed, and applies the refreshed wording exactly", async () => {
		const client = await router();
		const { id: threadId } = await agent.threads.start({ userId, resumeId: copyId });
		const { message, part } = await propose(threadId);
		const held = part.output.edits[0] as Proposal;
		const ids = { threadId, messageId: message.id, toolCallId: part.toolCallId };

		// Another device rewords the edit.
		await agent.messages.setEditStatus({
			userId,
			...ids,
			edits: [{ id: held.id, status: "pending", text: "Other device wording", after: held.after }],
		});
		// The older app applies the wording it holds, saves, then records the edit by ID only. Neither lands.
		const before = await resumes.getById({ userId, id: copyId });
		await expect(
			client.update({ id: copyId, data: applied(before.data, held), expectedUpdatedAt: before.updatedAt }),
		).rejects.toMatchObject({ code: "RESUME_VERSION_CONFLICT" });
		await expect(
			agent.messages.setEditStatus({ userId, ...ids, edits: [{ id: held.id, status: "accepted" }] }),
		).rejects.toThrow("isn't in the document");
		expect((await resumes.getById({ userId, id: copyId })).data).toEqual(before.data);
		expect((await storedEdit(threadId)).edit).toMatchObject({
			status: "pending",
			after: "<p>Other device wording</p>",
		});

		// A refreshed app reads the receipts, applies that wording and records it with the save itself.
		const refreshed = await resumes.getById({ userId, id: copyId });
		const { edit } = await storedEdit(threadId);
		await client.update({
			id: copyId,
			data: applied(refreshed.data, edit),
			expectedUpdatedAt: refreshed.updatedAt,
			proposalApplications: appliedApplications([edit]),
			proposalSafety: "v1",
		});
		const saved = await resumes.getById({ userId, id: copyId });
		expect((await storedEdit(threadId)).edit).toMatchObject({
			status: "accepted",
			after: "<p>Other device wording</p>",
		});
		expect(saved.data.summary.content).toContain("<p>Other device wording</p>");
	});

	it("lets the other device's wording win the lock, and writes nothing for an application of the old wording", async () => {
		const client = await router();
		const { id: threadId } = await agent.threads.start({ userId, resumeId: copyId });
		const { message, part } = await propose(threadId);
		const held = part.output.edits[0] as Proposal;
		const ids = { threadId, messageId: message.id, toolCallId: part.toolCallId };
		const before = await resumes.getById({ userId, id: copyId });

		const lock = await pool.connect();
		try {
			await lock.query("BEGIN");
			await lock.query("SELECT id FROM agent_messages WHERE thread_id = $1 ORDER BY id FOR UPDATE", [threadId]);
			const waiting = async (count: number) =>
				vi.waitFor(async () => {
					const { rows } = await admin.query(
						"SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%agent_messages%'",
					);
					expect(rows[0].n).toBe(count);
				});
			const reword = agent.messages.setEditStatus({
				userId,
				...ids,
				edits: [{ id: held.id, status: "pending", text: "Device B final", after: held.after }],
			});
			await waiting(1);
			// This device applied the old wording; its save names it, held until the reword commits.
			const save = client.update({
				id: copyId,
				data: applied(before.data, held),
				expectedUpdatedAt: before.updatedAt,
				proposalApplications: appliedApplications([held]),
				proposalSafety: "v1",
			});
			await waiting(2);
			await lock.query("COMMIT");
			await reword;
			await expect(save).rejects.toMatchObject({ code: "RESUME_VERSION_CONFLICT" });
		} finally {
			lock.release();
		}

		expect((await resumes.getById({ userId, id: copyId })).data).toEqual(before.data);
		expect((await storedEdit(threadId)).edit).toMatchObject({ status: "pending", after: "<p>Device B final</p>" });
		// Once decided, new wording is refused.
		const { edit } = await storedEdit(threadId);
		const current = await resumes.getById({ userId, id: copyId });
		await client.update({
			id: copyId,
			data: applied(current.data, edit),
			expectedUpdatedAt: current.updatedAt,
			proposalApplications: appliedApplications([edit]),
			proposalSafety: "v1",
		});
		await expect(
			agent.messages.setEditStatus({ userId, ...ids, edits: [{ id: held.id, status: "pending", text: "Later" }] }),
		).rejects.toThrow("already decided");
	});

	it("records no acceptance for a save that's a no-op, stale or locked", async () => {
		const client = await router();
		const { id: threadId } = await agent.threads.start({ userId, resumeId: copyId });
		const { part } = await propose(threadId);
		const held = part.output.edits[0] as Proposal;
		const current = await resumes.getById({ userId, id: copyId });
		const decision = { proposalApplications: { [held.id]: true }, proposalSafety: "v1" as const };

		// Claimed as applied, but the save doesn't contain it.
		await expect(
			client.update({ id: copyId, data: current.data, expectedUpdatedAt: current.updatedAt, ...decision }),
		).rejects.toMatchObject({ code: "RESUME_VERSION_CONFLICT" });
		// Applied, but against an older version.
		await expect(
			client.update({
				id: copyId,
				data: applied(current.data, held),
				expectedUpdatedAt: new Date(current.updatedAt.getTime() - 60_000),
				...decision,
			}),
		).rejects.toMatchObject({ code: "RESUME_VERSION_CONFLICT" });
		// Applied, while the resume is locked.
		await client.setLocked({ id: copyId, isLocked: true });
		await expect(
			client.update({
				id: copyId,
				data: applied(current.data, held),
				expectedUpdatedAt: current.updatedAt,
				...decision,
			}),
		).rejects.toMatchObject({ code: "RESUME_LOCKED" });
		await client.setLocked({ id: copyId, isLocked: false });

		expect((await storedEdit(threadId)).edit.status).toBe("pending");
		expect((await resumes.getById({ userId, id: copyId })).data).toEqual(current.data);
	});
	/** A document holding `<p>Anchor</p>` and a stored proposal set over it, as a refreshed app reads it. */
	async function proposalsOn(
		kind: "resume" | "letter",
		edits: Array<Pick<Proposal, "id" | "after">>,
		tailoredFor: string | null = null,
	) {
		const letters = (await import("../cover-letters/service")).coverLetterService;
		let documentId = `doc-${randomUUID()}`;
		if (kind === "resume") {
			const data = structuredClone(defaultResumeData);
			data.summary.content = "<p>Anchor</p>";
			await fixture.db
				?.insert(tables.resume)
				.values({ id: documentId, userId, name: "Anchor", slug: documentId, data });
		} else documentId = (await letters.create({ userId, name: "Anchor", content: "<p>Anchor</p>" })).id;
		const { id: threadId } = await agent.threads.start({
			userId,
			...(kind === "resume" ? { resumeId: documentId } : { coverLetterId: documentId }),
		});
		const proposals: Proposal[] = edits.map((edit) => ({
			...edit,
			target: { sectionId: kind === "resume" ? "summary" : "letter", field: "content" },
			location: "Summary",
			before: "<p>Anchor</p>",
			why: "Clarity",
			status: "pending",
			source: "assistant",
		}));
		const message = {
			id: randomUUID(),
			role: "assistant",
			metadata: { contextScope: "[true,true]" },
			parts: [
				{
					type: "tool-propose_edits",
					toolCallId: "call",
					state: "output-available",
					input: {},
					output: { title: "Clarity", skipped: [], tailoredFor, edits: proposals },
				},
			],
		} as unknown as UIMessage;
		await fixture.db
			?.insert(tables.agentMessage)
			.values({ userId, threadId, role: "assistant", sequence: 1, status: "completed", uiMessage: message as never });
		const client = await router();
		const read = async () =>
			kind === "resume"
				? (await resumes.getById({ userId, id: documentId })).data.summary.content
				: (await letters.getById({ userId, id: documentId })).content;
		// What the app's autosave sends: the field as it now reads, with the decisions made since the last save.
		const save = async (content: string, proposalApplications?: Record<string, boolean | string>) => {
			const decisions = proposalApplications ? { proposalApplications } : {};
			if (kind === "letter") {
				const current = await letters.getById({ userId, id: documentId });
				return letters.update({
					userId,
					id: documentId,
					content,
					expectedRevision: current.revision,
					proposalSafety: "v1",
					...decisions,
				});
			}
			const current = await resumes.getById({ userId, id: documentId });
			const data = structuredClone(current.data);
			data.summary.content = content;
			return client.update({
				id: documentId,
				data,
				expectedUpdatedAt: current.updatedAt,
				proposalSafety: "v1",
				...decisions,
			});
		};
		const statuses = async () =>
			Object.fromEntries(
				proposalOf((await agent.threads.get({ id: threadId, userId })).messages).part.output.edits.map((edit) => [
					edit.id,
					edit.status,
				]),
			);
		const ids = { threadId, messageId: message.id, toolCallId: "call" };
		return { proposals, read, save, statuses, ids };
	}

	/** Accept, as the apps do: the shared composition applies the set to the field the user sees. */
	function accept(proposals: Proposal[], content = "<p>Anchor</p>") {
		let next = content;
		const result = applyProposals(
			proposals,
			() => next,
			(_, value) => {
				next = value;
			},
		);
		expect(result.applied).toHaveLength(proposals.length);
		return { content: next, applications: appliedApplications(result.applied) };
	}

	for (const kind of ["resume", "letter"] as const) {
		it(`${kind}: binds acceptance to the reviewed wording through Accept all, rewrites at the same place and refinement`, async () => {
			// Two additions after one passage, as Accept all composes them.
			const additions = await proposalsOn(kind, [
				{ id: "first", after: "<p>Anchor</p><p>First added</p>" },
				{ id: "second", after: "<p>Anchor</p><p>Second added</p>" },
			]);
			const both = accept(additions.proposals);
			expect(both.content).toBe("<p>Anchor</p><p>First added</p><p>Second added</p>");
			await additions.save(both.content, both.applications);
			expect(await additions.read()).toBe(both.content);
			expect(await additions.statuses()).toEqual({ first: "accepted", second: "accepted" });

			// A rewrite of the passage and an addition after it.
			const mixed = await proposalsOn(kind, [
				{ id: "rewrite", after: "<p>Rewritten anchor</p>" },
				{ id: "addition", after: "<p>Anchor</p><p>Added fact</p>" },
			]);
			const composed = accept(mixed.proposals);
			expect(composed.content).toBe("<p>Rewritten anchor</p><p>Added fact</p>");
			await mixed.save(composed.content, composed.applications);
			expect(await mixed.statuses()).toEqual({ rewrite: "accepted", addition: "accepted" });

			// Refined before the first save went out.
			const refined = await proposalsOn(kind, [{ id: "refine", after: "<p>Accepted wording</p>" }]);
			const accepted = accept(refined.proposals);
			await refined.save("<p>Accepted wording, refined by me</p>", accepted.applications);
			expect(await refined.read()).toBe("<p>Accepted wording, refined by me</p>");
			expect(await refined.statuses()).toEqual({ refine: "accepted" });

			// An older app names no wording: its acceptance still has to be in the document as is.
			const older = await proposalsOn(kind, [
				{ id: "older-first", after: "<p>Anchor</p><p>One</p>" },
				{ id: "older-second", after: "<p>Anchor</p><p>Two</p>" },
			]);
			const held = accept(older.proposals);
			await expect(older.save(held.content, { "older-first": true, "older-second": true })).rejects.toMatchObject({
				code: kind === "resume" ? "RESUME_VERSION_CONFLICT" : "CONFLICT",
			});
			expect(await older.read()).toBe("<p>Anchor</p>");
		});

		it(`${kind}: replays a refined Redo, and refuses wording another device changed, writing nothing`, async () => {
			const history = await proposalsOn(kind, [{ id: "edit", after: "<p>Current wording</p>" }]);
			const [proposal] = history.proposals;
			if (!proposal) throw new Error("Expected a proposal.");
			await expect(history.save(proposal.after, { edit: "snapshot:edit" })).rejects.toMatchObject({
				code: kind === "resume" ? "RESUME_VERSION_CONFLICT" : "CONFLICT",
			});
			expect(await history.read()).toBe("<p>Anchor</p>");
			await history.save(proposal.after, appliedApplications([proposal]));
			await history.save("<p>Manually refined</p>");
			await history.save(proposal.before, { edit: false });
			expect(await history.statuses()).toEqual({ edit: "pending" });
			// Redo restores the refined checkpoint with the decision it recorded.
			await history.save("<p>Manually refined</p>", appliedApplications([proposal]));
			expect(await history.statuses()).toEqual({ edit: "accepted" });
			expect(await history.read()).toBe("<p>Manually refined</p>");

			const stale = await proposalsOn(kind, [{ id: "reworded", after: "<p>Model wording</p>" }]);
			const [held] = stale.proposals;
			if (!held) throw new Error("Expected a proposal.");
			await agent.messages.setEditStatus({
				userId,
				...stale.ids,
				edits: [{ id: held.id, status: "pending", text: "Other device wording", after: held.after }],
			});
			const local = accept([held]);
			await expect(stale.save(local.content, local.applications)).rejects.toMatchObject({
				code: kind === "resume" ? "RESUME_VERSION_CONFLICT" : "CONFLICT",
			});
			expect(await stale.read()).toBe("<p>Anchor</p>");
			expect(await stale.statuses()).toEqual({ reworded: "pending" });
		});
	}

	it("refuses a current app's acceptance of tailoring this resume can't take, writing nothing", async () => {
		// Tailored for the job, on a resume that isn't that job's copy.
		const tailored = await proposalsOn("resume", [{ id: "tailored", after: "<p>Tailored for Northwind</p>" }], "job-a");
		const local = accept(tailored.proposals);
		await expect(tailored.save(local.content, local.applications)).rejects.toMatchObject({
			code: "RESUME_VERSION_CONFLICT",
		});
		expect(await tailored.read()).toBe("<p>Anchor</p>");
		expect(await tailored.statuses()).toEqual({ tailored: "pending" });
	});

	it("finds a retried wording save already there, and still refuses different wording on the old version", async () => {
		const wording = await proposalsOn("resume", [{ id: "words", after: "<p>Model wording</p>" }]);
		const [held] = wording.proposals;
		if (!held) throw new Error("Expected a proposal.");
		const write = { id: held.id, status: "pending" as const, text: "My wording", after: held.after };
		await agent.messages.setEditStatus({ userId, ...wording.ids, edits: [write] });
		// The read back failed, so the app still holds the old wording and sends the same save again.
		await agent.messages.setEditStatus({ userId, ...wording.ids, edits: [write] });
		const stored = () =>
			agent.threads
				.get({ id: wording.ids.threadId, userId })
				.then(({ messages }) => proposalOf(messages).part.output.edits[0]);
		expect(await stored()).toMatchObject({ status: "pending", after: "<p>My wording</p>", edited: true });
		await expect(
			agent.messages.setEditStatus({ userId, ...wording.ids, edits: [{ ...write, text: "Something else" }] }),
		).rejects.toThrow("changed in another tab or device");
		expect(await stored()).toMatchObject({ after: "<p>My wording</p>" });
	});
	/** A structural change (one snapshot) proposed on a fresh resume, stored as the assistant stores it. */
	async function structuralOn(tailoredFor: string | null = null, large = false) {
		const id = `structural-${randomUUID()}`;
		const data = structuredClone(defaultResumeData);
		data.summary.content = "<p>Anchor</p>";
		if (large) data.summary.content = Array.from({ length: 12 }, (_, i) => `<p>Original paragraph ${i}.</p>`).join("");
		data.sections.projects.items = [
			{ ...createEntry("projects"), id: "shown", name: "Shown project" },
			{ ...createEntry("projects"), id: "secret", hidden: true, name: "HIDDEN_PROJECT_MARKER" },
		] as typeof data.sections.projects.items;
		await fixture.db?.insert(tables.resume).values({ id, userId, name: "Structural", slug: id, data });
		const { resolveDocumentEdits } = await import("./document");
		const loaded = await loadDocument(userId, { kind: "resume", id });
		const output = resolveDocumentEdits(loaded, {
			title: "Headline",
			changes: [
				{
					kind: "field",
					target: { sectionId: "basics", field: "headline" },
					before: "",
					value: "Design lead",
					why: "Asked for.",
				},
				...(large
					? loaded.passages
							.filter((passage) => passage.target.sectionId === "summary")
							.map((passage, index) => ({
								kind: "text" as const,
								sectionId: "summary",
								passageId: passage.id,
								text: `Revised paragraph ${index}. ${"Designed accessible interfaces. ".repeat(60)}`,
								why: "Requested rewrite.",
							}))
					: []),
			],
		});
		const edit = output.edits[0];
		if (!edit?.snapshot) throw new Error("Expected a structural change.");
		const { id: threadId } = await agent.threads.start({ userId, resumeId: id });
		const message = {
			id: randomUUID(),
			role: "assistant",
			metadata: { contextScope: "[true,true]" },
			parts: [
				{
					type: "tool-propose_edits",
					toolCallId: "call",
					state: "output-available",
					input: {},
					output: { ...output, tailoredFor },
				},
			],
		} as unknown as UIMessage;
		await fixture.db
			?.insert(tables.agentMessage)
			.values({ userId, threadId, role: "assistant", sequence: 1, status: "completed", uiMessage: message as never });
		const client = await router();
		const read = () => resumes.getById({ userId, id });
		const save = async (next: typeof data, proposalApplications?: Record<string, boolean | string>) => {
			const current = await read();
			return client.update({
				id,
				data: next,
				expectedUpdatedAt: current.updatedAt,
				proposalSafety: "v1",
				...(proposalApplications ? { proposalApplications } : {}),
			});
		};
		const status = async () =>
			proposalOf((await agent.threads.get({ id: threadId, userId })).messages).part.output.edits[0]?.status;
		const accepted = async () => {
			const next = structuredClone((await read()).data);
			expect(applyResumeProposals(next, [{ ...edit, source: "assistant" }]).applied).toHaveLength(1);
			return next;
		};
		return { id, edit: { ...edit, source: "assistant" as const }, read, save, status, accepted, threadId, message };
	}

	it("binds a structural change's receipt to its reviewed version through refinement and Undo/Redo, and holds older apps to the exact snapshot", async () => {
		// Current app: applied, refined before the first save, undone, then redone at the refined checkpoint.
		const current = await structuralOn(null, true);
		expect(current.edit.after.length).toBeGreaterThan(20_000);
		const beforeData = (await current.read()).data;
		const applied = await current.accepted();
		const refined = structuredClone(applied);
		refined.basics.headline = "Design lead, refined by me";
		await expect(current.save(refined, { [current.edit.id]: "snapshot:other-proposal" })).rejects.toMatchObject({
			code: "RESUME_VERSION_CONFLICT",
		});
		expect((await current.read()).data).toEqual(beforeData);
		await current.save(refined, appliedApplications([current.edit]));
		expect(await current.status()).toBe("accepted");
		expect((await current.read()).data.basics.headline).toBe("Design lead, refined by me");
		await current.save(beforeData, { [current.edit.id]: false });
		expect(await current.status()).toBe("pending");
		await current.save(refined, appliedApplications([current.edit]));
		expect(await current.status()).toBe("accepted");

		// Older app (`true`): the saved resume has to be the proposed structure exactly; a no-op or refinement isn't.
		const older = await structuralOn();
		const before = await older.read();
		await expect(older.save(before.data, { [older.edit.id]: true })).rejects.toMatchObject({
			code: "RESUME_VERSION_CONFLICT",
		});
		const exact = await older.accepted();
		const changed = structuredClone(exact);
		changed.basics.headline = "Design lead, refined";
		await expect(older.save(changed, { [older.edit.id]: true })).rejects.toMatchObject({
			code: "RESUME_VERSION_CONFLICT",
		});
		expect((await older.read()).data).toEqual(before.data);
		await older.save(exact, { [older.edit.id]: true });
		expect(await older.status()).toBe("accepted");

		// Prior current clients sent the readable summary; their bounded receipts still work.
		const prior = await structuralOn();
		await prior.save(await prior.accepted(), { [prior.edit.id]: prior.edit.after });
		expect(await prior.status()).toBe("accepted");
	});

	it("refuses rewording, tailoring the resume can't take, and changes to hidden content of a structural change", async () => {
		const reworded = await structuralOn();
		await expect(
			agent.messages.setEditStatus({
				userId,
				threadId: reworded.threadId,
				messageId: reworded.message.id,
				toolCallId: "call",
				edits: [{ id: reworded.edit.id, status: "pending", text: "Other words", after: reworded.edit.after }],
			}),
		).rejects.toThrow("can't be reworded");

		// Tailored for a job, on a resume that isn't that job's copy: refused even naming the reviewed version.
		const tailored = await structuralOn("job-a");
		const before = await tailored.read();
		const next = await tailored.accepted();
		await expect(tailored.save(next, appliedApplications([tailored.edit]))).rejects.toMatchObject({
			code: "RESUME_VERSION_CONFLICT",
		});
		expect((await tailored.read()).data).toEqual(before.data);
		expect(await tailored.status()).toBe("pending");

		// Hiding content after the proposal makes it out of date; an older app's exact claim no longer holds either.
		const hidden = await structuralOn();
		const shown = structuredClone((await hidden.read()).data);
		const project = shown.sections.projects.items.find((item) => item.id === "shown");
		if (!project) throw new Error("Expected the shown project.");
		project.hidden = true;
		await hidden.save(shown);
		expect(getProposalState((await hidden.read()).data, hidden.edit)).toBe("stale");
		const attempt = structuredClone((await hidden.read()).data);
		expect(applyResumeProposals(attempt, [hidden.edit]).applied).toHaveLength(0);
		attempt.basics.headline = "Design lead";
		await expect(hidden.save(attempt, { [hidden.edit.id]: true })).rejects.toMatchObject({
			code: "RESUME_VERSION_CONFLICT",
		});

		// Hidden content can't be targeted at all: the reason reaches the model.
		const { resolveDocumentEdits } = await import("./document");
		const loaded = await loadDocument(userId, { kind: "resume", id: hidden.id });
		const output = resolveDocumentEdits(loaded, {
			title: "Rename",
			changes: [
				{
					kind: "field",
					target: { sectionId: "projects", itemId: "secret", field: "name" },
					before: "HIDDEN_PROJECT_MARKER",
					value: "Renamed",
					why: "Asked for.",
				},
			],
		});
		expect(output.edits).toEqual([]);
		expect(output.skipped).toEqual([
			{ passageId: "change_1", reason: "This entry is hidden. Show it in Write before asking for changes." },
		]);
	});

	it("reviews a tailored structural change and keeps its full snapshot for the apps, never the model, across reopen and continuation", async () => {
		await fixture.db?.insert(tables.application).values({
			id: "job-s",
			userId,
			company: "Orbit Fiction",
			role: "Lead",
			resumeId: "base",
			jobDescription: "Leadership. Certifications.",
			requirements: ["Leadership", "Certifications"],
		});
		const jobCopy = await documents.copyForJob({ userId, resumeId: "base", applicationId: "job-s" });
		const stored = await resumes.getById({ userId, id: jobCopy });
		const data = structuredClone(stored.data);
		data.sections.projects.items = [
			{ ...createEntry("projects"), id: "secret", hidden: true, name: "HIDDEN_PROJECT_MARKER" },
		] as typeof data.sections.projects.items;
		data.sections.awards = { ...data.sections.awards, hidden: true, title: "HIDDEN_SECTION_MARKER" };
		data.metadata.notes = "PRIVATE_NOTES_MARKER";
		await pool.query("UPDATE resume SET data = $1 WHERE id = $2", [data, jobCopy]);
		const markers = ["HIDDEN_PROJECT_MARKER", "HIDDEN_SECTION_MARKER", "PRIVATE_NOTES_MARKER"];

		const { id: threadId } = await agent.threads.start({ userId, resumeId: jobCopy });
		const passage = (await loadDocument(userId, { kind: "resume", id: jobCopy })).passages[0];
		fixture.prompts = [];
		fixture.plan.push(
			{ tool: "read_resume", input: {} },
			{
				tool: "propose_edits",
				input: {
					title: "Lead for Orbit",
					changes: [
						{
							kind: "field",
							target: { sectionId: "basics", field: "headline" },
							before: data.basics.headline,
							value: "Design lead",
							why: "Posting",
							requirement: "Leadership",
							evidence: [passage?.id],
						},
						{
							kind: "entry",
							sectionId: "certifications",
							type: "certifications",
							entryJson: JSON.stringify({
								...createEntry("certifications"),
								title: "Orbit Leadership Award",
								issuer: "Invented Body",
								date: "2031",
							}),
							why: "Posting",
							requirement: "Certifications",
						},
					],
					requirements: [
						{ text: "Leadership", status: "edited" },
						{ text: "Certifications", status: "edited" },
					],
				},
			},
			{ text: "Proposed." },
		);
		const proposed = await send(threadId, { applicationId: "job-s" });
		const { part } = proposalOf(proposed.messages);
		const output = part.output as unknown as ProposeEditsOutput;
		const edit = output.edits[0];
		if (!edit?.snapshot) throw new Error("Expected one structural change.");
		expect(output.edits).toHaveLength(1);
		expect(output.skipped).toEqual([]);
		expect(output).toMatchObject({
			tailoredFor: "job-s",
			requirements: [
				{ text: "Leadership", status: "edited" },
				{ text: "Certifications", status: "edited" },
			],
		});
		expect(edit).toMatchObject({
			requirement: "Leadership; Certifications",
			evidence: [{ kind: "passage", location: passage?.location }],
		});
		// The new entry's figures and names aren't in the resume: flagged for review.
		expect(edit.unsupported).toEqual(expect.arrayContaining([{ kind: "date", text: "2031" }]));

		// The apps receive the full snapshot (Undo needs it), hidden content included.
		const reopened = await agent.threads.get({ id: threadId, userId });
		for (const marker of ["HIDDEN_PROJECT_MARKER", "HIDDEN_SECTION_MARKER"])
			expect(JSON.stringify(reopened.messages)).toContain(marker);
		// A continuation after reopening sends the model neither hidden content nor the snapshot.
		fixture.plan.push({ text: "Continuing." });
		await send(threadId, { applicationId: "job-s" });
		expect(fixture.prompts.length).toBeGreaterThan(2);
		for (const prompt of fixture.prompts) {
			for (const marker of markers) expect(prompt).not.toContain(marker);
			expect(prompt).not.toContain(edit.snapshot.after);
		}

		// Accepted by a current app on the job's copy: refined before the first save, then undone and redone.
		const client = await router();
		const current = await resumes.getById({ userId, id: jobCopy });
		const next = structuredClone(current.data);
		expect(applyResumeProposals(next, [{ ...edit, source: "assistant" }]).applied).toHaveLength(1);
		next.basics.headline = "Design lead (refined)";
		await client.update({
			id: jobCopy,
			data: next,
			expectedUpdatedAt: current.updatedAt,
			proposalSafety: "v1",
			proposalApplications: appliedApplications([edit]),
		});
		const saved = await resumes.getById({ userId, id: jobCopy });
		expect(saved.data.sections.certifications.items.at(-1)).toMatchObject({ title: "Orbit Leadership Award" });
		expect(proposalOf((await agent.threads.get({ id: threadId, userId })).messages).part.output.edits[0]).toMatchObject(
			{ status: "accepted" },
		);
		// Hidden content the model never saw survives the write.
		expect(saved.data.sections.projects.items[0]).toMatchObject({ name: "HIDDEN_PROJECT_MARKER", hidden: true });
	});
});
