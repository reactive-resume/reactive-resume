import type { ProposeEditsOutput } from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { UIMessage } from "ai";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
import { generateText, stepCountIs, streamText, tool } from "ai";
import { strFromU8, unzipSync, zipSync, strToU8 } from "fflate";
import { Pool } from "pg";
import { z } from "zod";
import { letterDraftSystemPrompt } from "@reactive-resume/ai/prompts";
import { aiDestination } from "@reactive-resume/ai/types";
import { db, withDatabasePool } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { coverLetterTextToHtml } from "@reactive-resume/resume/cover-letter";
import { aiOperationIds } from "@reactive-resume/schema/ai-usage";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { buildAccountZip } from "@reactive-resume/utils/account-zip";
import { loadDocument } from "../agent/document";
import { upsertAssistantUiMessage } from "../agent/messages-persistence";
import { agentRouter } from "../agent/router";
import { aiProvidersService } from "../ai-providers/service";
import { aiRouter as applicationAiRouter } from "../applications/ai";
import { applicationsRouter } from "../applications/router";
import { authRouter } from "../auth/router";
import { authService } from "../auth/service";
import { careerRouter } from "../career/router";
import { coverLettersRouter } from "../cover-letters/router";
import { assertDocumentVersion } from "../documents/ownership";
import { documentsRouter } from "../documents/router";
import { resumeRouter } from "../resume/router";
import { webAccessService } from "../web-access/credentials";
import { aiRouter } from "./router";
import { getModel } from "./service";
import { createAiUsage, readAiUsage, readWeeklyAiUsage } from "./usage";

vi.mock("@reactive-resume/env/server", async (original) => {
	const actual = await original<typeof import("@reactive-resume/env/server")>();
	return {
		env: {
			...actual.env,
			AI_PROVIDER: undefined,
			AI_MODEL: undefined,
			AI_API_KEY: undefined,
			AI_BASE_URL: undefined,
			FLAG_ALLOW_UNSAFE_AI_BASE_URL: true,
		},
	};
});

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("AI request metering through installed SDK, protected routers and PostgreSQL", () => {
	const namespace = `rx207_usage_${randomUUID().replaceAll("-", "")}`;
	const admin = new Pool({ connectionString: databaseUrl });
	let pool: Pool;
	let baseURL: string;
	let user: typeof tables.user.$inferSelect;
	let mode:
		| "score"
		| "score-hold"
		| "prepare"
		| "text"
		| "retry"
		| "tools"
		| "stream"
		| "failure"
		| "hold"
		| "reply"
		| "answer"
		| "writing"
		| "resume"
		| "agent"
		| "letter"
		| "tailoring"
		| "improve"
		| "native-search";
	let failLetter = false;
	let agentChanges: unknown[] = [];
	let agentStep = 0;
	let release = () => {};
	let arrived = () => {};
	let disconnected = () => {};
	let requests: { model: string; path: string }[] = [];
	let requestMessages: unknown[][] = [];
	const server = createServer((req, res) => {
		const onDisconnect = disconnected;
		res.once("close", () => {
			if (!res.writableEnded) onDisconnect();
		});
		let raw = "";
		req.on("data", (chunk) => {
			raw += chunk;
		});
		req.on("end", () => {
			void (async () => {
				const body = JSON.parse(raw) as { model: string; messages?: unknown[]; stream?: boolean; input?: unknown };
				requests.push({ model: body.model, path: req.url ?? "" });
				requestMessages.push(body.messages ?? []);
				arrived();
				if (mode === "native-search") {
					if (req.url === "/v1/firecrawl") {
						res.writeHead(401, { "content-type": "application/json" });
						res.end(JSON.stringify({ success: false, error: "Fictional rejected web key" }));
						return;
					}
					if (!body.stream) {
						res.writeHead(200, { "content-type": "application/json" });
						res.end(
							JSON.stringify({
								id: "source",
								object: "response",
								created_at: 1,
								model: body.model,
								status: "completed",
								output: [
									{
										type: "web_search_call",
										id: "search",
										status: "completed",
										action: { type: "search", query: "Fictional engineer" },
									},
									{
										type: "message",
										id: "source-message",
										role: "assistant",
										status: "completed",
										content: [
											{
												type: "output_text",
												text: "Retrieved fictional role",
												annotations: [
													{
														type: "url_citation",
														url: "https://jobs.example.com/engineer",
														title: "Fictional role",
														start_index: 0,
														end_index: 10,
													},
												],
											},
										],
									},
								],
								usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
							}),
						);
						return;
					}
					const events: unknown[] = [
						{ type: "response.created", response: { id: "chat", created_at: 1, model: body.model } },
					];
					if (!JSON.stringify(body.input).includes("function_call_output")) {
						const args = JSON.stringify({ query: "Fictional engineer" });
						const item = {
							type: "function_call",
							id: "fc-search",
							call_id: "call-search",
							name: "search_web",
							arguments: "",
						};
						events.push(
							{ type: "response.output_item.added", output_index: 0, item },
							{ type: "response.function_call_arguments.delta", item_id: "fc-search", output_index: 0, delta: args },
							{
								type: "response.output_item.done",
								output_index: 0,
								item: { ...item, arguments: args, status: "completed" },
							},
						);
					} else {
						const item = { type: "message", id: "reply" };
						events.push(
							{ type: "response.output_item.added", output_index: 0, item },
							{ type: "response.output_text.delta", item_id: "reply", output_index: 0, delta: "Research complete." },
							{ type: "response.output_item.done", output_index: 0, item },
						);
					}
					events.push({
						type: "response.completed",
						response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
					});
					res.writeHead(200, { "content-type": "text/event-stream" });
					res.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
					return;
				}
				if (mode === "hold" || mode === "score-hold")
					await new Promise<void>((resolve) => {
						release = resolve;
					});
				if (mode === "failure" || (mode === "retry" && requests.length === 1)) {
					res.writeHead(503, { "content-type": "application/json", "retry-after": "0" });
					res.end(JSON.stringify({ error: { message: "Synthetic provider failure" } }));
					return;
				}
				if (
					mode === "agent" ||
					((mode === "tailoring" || mode === "prepare") &&
						body.stream &&
						!JSON.stringify(body.messages).includes("The letter's language"))
				) {
					const step = agentStep++;
					if (step === 2 && mode === "agent")
						await new Promise<void>((resolve) => {
							release = resolve;
						});
					res.writeHead(200, { "content-type": "text/event-stream" });
					const delta =
						step < 2
							? {
									tool_calls: [
										{
											index: 0,
											id: `agent-call-${step}`,
											type: "function",
											function: {
												name: step === 0 ? "read_resume" : "propose_edits",
												arguments: JSON.stringify(
													step === 0
														? {}
														: {
																title: "Fictional rewrite",
																changes: agentChanges,
																...(mode === "tailoring"
																	? { requirements: [{ text: "Build fictional reliable services.", status: "edited" }] }
																	: {}),
															},
												),
											},
										},
									],
								}
							: { content: "Fictional proposal ready." };
					res.write(
						`data: ${JSON.stringify({ id: "agent", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
					);
					res.end(
						`data: ${JSON.stringify({ id: "agent", created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: step < 2 ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
					);
					return;
				}
				if ((mode === "letter" || mode === "prepare") && body.stream) {
					if (failLetter) {
						res.writeHead(503, { "content-type": "application/json" });
						res.end(JSON.stringify({ error: { message: "Synthetic letter failure" } }));
						return;
					}
					res.writeHead(200, { "content-type": "text/event-stream" });
					res.write(
						`data: ${JSON.stringify({ id: "letter", created: 1, model: body.model, choices: [{ index: 0, delta: { content: "done" }, finish_reason: null }] })}\n\n`,
					);
					res.end(
						`data: ${JSON.stringify({ id: "letter", created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
					);
					return;
				}
				if (mode === "stream") {
					res.writeHead(200, { "content-type": "text/event-stream" });
					for (let index = 0; index < 50; index++)
						res.write(
							`data: ${JSON.stringify({ id: "stream", created: 1, model: body.model, choices: [{ index: 0, delta: { content: "x" }, finish_reason: null }] })}\n\n`,
						);
					res.end(
						`data: ${JSON.stringify({ id: "stream", created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
					);
					return;
				}
				const callsTool = mode === "tools" && requests.length === 1;
				const text =
					mode === "score" || mode === "score-hold"
						? JSON.stringify({ score: 73, gaps: ["Evidence not shown"], strengths: ["Fictional services"] })
						: mode === "tailoring"
							? JSON.stringify({ summary: "<p>Generated fictional tailored summary.</p>" })
							: mode === "improve"
								? JSON.stringify({
										text: "Led fictional reliable delivery.",
										why: "Uses a direct verb.",
										addsFacts: false,
									})
								: mode === "resume"
									? JSON.stringify(sampleResumeData)
									: mode === "writing"
										? JSON.stringify({
												summary: "Fictional saved wording review",
												strengths: [],
												suggestions: [],
												jdAlignment: null,
											})
										: mode === "answer" || mode === "prepare"
											? JSON.stringify({ text: "Built a fictional reporting workflow.", factIds: [], note: null })
											: mode === "reply"
												? JSON.stringify({
														title: "Reply",
														asks: [],
														unconfirmed: [],
														reply: "Thank you.",
														changes: [],
														offer: null,
													})
												: "done";
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						id: "fixture",
						created: 1,
						model: body.model,
						choices: [
							{
								index: 0,
								message: callsTool
									? {
											role: "assistant",
											content: null,
											tool_calls: [
												{ id: "read-1", type: "function", function: { name: "read_owned", arguments: "{}" } },
											],
										}
									: { role: "assistant", content: text },
								finish_reason: callsTool ? "tool_calls" : "stop",
							},
						],
					}),
				);
			})();
		});
	});
	const run = (operation: () => Promise<void>) => withDatabasePool(pool, operation);
	const client = (
		permissions: ("read" | "write" | "delete")[] = ["read", "write", "delete"],
		reqHeaders = new Headers(),
	) =>
		createRouterClient(
			{
				ai: aiRouter,
				agent: agentRouter,
				auth: authRouter,
				career: careerRouter,
				letters: coverLettersRouter,
				resume: resumeRouter,
				documents: documentsRouter,
				applicationAi: applicationAiRouter,
				applications: applicationsRouter,
			},
			{
				context: {
					locale: "en-US",
					reqHeaders,
					authentication: { user, method: "apiKey", permissions },
				},
			},
		);
	const reviewFixture = async () => {
		const connection = await provider();
		const api = client();
		const data = structuredClone(sampleResumeData);
		data.summary.content = "<p>Built fictional reliable services.</p>";
		data.metadata.notes = "PRIVATE_FICTIONAL_RESUME_NOTES";
		const resumeId = await api.resume.import({ data });
		const loaded = await loadDocument(user.id, { kind: "resume", id: resumeId });
		const passage = loaded.passages.find((entry) => entry.target.sectionId === "summary");
		if (!passage) throw new Error("Missing fictional passage");
		agentChanges = [
			{
				kind: "text",
				sectionId: "summary",
				passageId: passage.id,
				text: "Built reliable fictional services.",
				why: "Clearer wording",
				evidence: [passage.id],
			},
		];
		const id = await api.applications.create({
			company: "Fictional Cedar",
			role: "Engineer",
			status: "saved",
			resumeId,
			jobDescription: "Build fictional reliable services.",
			notes: "PRIVATE_FICTIONAL_APPLICATION_NOTES",
		});
		return { connection, api, data, resumeId, id };
	};
	it("preserves numeric compatibility, private context exclusion and saved provider/model sources", () =>
		run(async () => {
			const { api, id, data, connection } = await reviewFixture();
			mode = "score";
			const score = await api.applicationAi.matchScore({ id });
			expect(score).toMatchObject({ score: 73, gaps: ["Evidence not shown"], strengths: ["Fictional services"] });
			expect(JSON.stringify(requestMessages)).not.toContain(data.metadata.notes);
			expect(JSON.stringify(requestMessages)).not.toContain("PRIVATE_FICTIONAL_APPLICATION_NOTES");
			const saved = await api.applications.getById({ id });
			expect(saved.aiMetadata).toMatchObject({
				matchScore: { score: 73, gaps: ["Evidence not shown"], strengths: ["Fictional services"] },
				aiUsage: { requests: 1, models: [expect.objectContaining({ providerId: connection.id, model: "main-model" })] },
			});
			await aiProvidersService.delete({ userId: user.id, id: connection.id });
			expect((await api.applications.getById({ id })).aiMetadata).toEqual(saved.aiMetadata);
			expect(JSON.stringify((await api.auth.exportData({})).applications)).toContain(saved.aiMetadata?.aiOperationId);
			expect(requests).toHaveLength(1);
		}));
	it.each(["application", "resume"] as const)(
		"refuses stale numeric results after %s edits during provider transport",
		(owner) =>
			run(async () => {
				const { api, id, resumeId } = await reviewFixture();
				mode = "score-hold";
				const arrival = new Promise<void>((resolve) => {
					arrived = resolve;
				});
				const pending = api.applicationAi.matchScore({ id });
				try {
					await arrival;
					if (owner === "application")
						await api.applications.update({ id, jobDescription: "Changed fictional posting" });
					else {
						const before = await api.resume.getById({ id: resumeId });
						await api.resume.update({
							id: resumeId,
							expectedUpdatedAt: before.updatedAt,
							data: { ...before.data, summary: { ...before.data.summary, content: "<p>Changed factual summary.</p>" } },
						});
					}
					release();
					await expect(pending).rejects.toMatchObject({ code: "CONFLICT" });
					expect((await api.applications.getById({ id })).matchScore).toBeNull();
					expect(requests).toHaveLength(1);
				} finally {
					release();
				}
			}),
	);
	it.each(["active", "forgotten", "excluded", "corrected"] as const)(
		"reviewed Fit evidence respects %s source state",
		(state) =>
			run(async () => {
				const { api, id } = await reviewFixture();
				const fact = await api.career.saveFact({
					applicationId: id,
					text: "Built fictional services for five teams.",
					category: "accomplishment",
					source: { kind: "manual", id: "fictional-evidence", quote: "Built fictional services for five teams." },
				});
				if (!fact) throw new Error("Missing fixture fact");
				await expect(api.applicationAi.proposeEvidence({ id, factId: fact.id })).rejects.toMatchObject({
					code: "NOT_FOUND",
				});
				const workspace = await api.career.workspace({ applicationId: id });
				await api.career.saveWorkspace({
					applicationId: id,
					evidence: { requirement: fact.id },
					expected: { evidence: workspace.evidence },
				});
				mode = "tailoring";
				const result = await api.applicationAi.proposeEvidence({ id, factId: fact.id });
				expect(result.generationStatus).toBe("ready");
				expect(result.conversation?.thread.workingResumeId).toBe(result.resumeId);
				expect((await api.resume.getById({ id: result.resumeId })).data.summary.content).toBe(
					"<p>Built fictional reliable services.</p>",
				);
				expect(JSON.stringify(requestMessages)).toContain(fact.text);
				expect(requests).toHaveLength(3);
				if (state === "forgotten") await api.career.forgetFact({ id: fact.id });
				else if (state === "excluded") await api.career.updateFact({ id: fact.id, status: "excluded" });
				else if (state === "corrected")
					await api.career.updateFact({ id: fact.id, text: "Corrected fictional account of work." });
				const proposed = result.conversation?.messages
					.flatMap((message) => message.parts)
					.find((part) => part.type === "tool-propose_edits") as { output?: ProposeEditsOutput } | undefined;
				const edit = proposed?.output?.edits[0];
				if (!edit) throw new Error("Missing saved Fit proposal");
				const before = await api.resume.getById({ id: result.resumeId });
				const acceptance = api.resume.update({
					id: before.id,
					expectedUpdatedAt: before.updatedAt,
					data: { ...before.data, summary: { ...before.data.summary, content: edit.after } },
					proposalApplications: { [edit.id]: edit.after },
					proposalSafety: "v1",
				});
				if (state === "active") {
					const accepted = await acceptance;
					expect(accepted.data.summary.content).toBe(edit.after);
					expect(accepted.aiUsage?.requests).toBe(3);
					return;
				}
				await expect(acceptance).rejects.toMatchObject({ code: "RESUME_VERSION_CONFLICT" });
				expect((await api.resume.getById({ id: before.id })).data).toEqual(before.data);

				if (state !== "corrected")
					await expect(api.applicationAi.proposeEvidence({ id, factId: fact.id })).rejects.toMatchObject({
						code: "NOT_FOUND",
					});
				const conversation = await api.agent.threads.get({ id: result.conversation?.thread.id ?? "missing" });
				expect(
					conversation.messages.some((message) => message.parts.some((part) => part.type === "tool-propose_edits")),
				).toBe(false);
				expect(requests).toHaveLength(3);
			}),
	);
	it.each([false, true])(
		"prepares all three real draft owners; letter failure=%s retains completed proposals and answers",
		(failure) =>
			run(async () => {
				const { api, id, resumeId, data } = await reviewFixture();
				mode = "prepare";
				failLetter = failure;
				const result = await api.applicationAi.prepare({ id, questions: ["Describe work you led.", "Why this role?"] });
				expect(result.sets[0]?.edits[0]?.status).toBe("pending");
				expect(result.threadId).toEqual(expect.any(String));
				expect(result.answers).toHaveLength(2);
				expect(result.answers.map((answer) => answer.question)).toEqual(["Describe work you led.", "Why this role?"]);
				expect(result.failed).toEqual(failure ? ["letter"] : []);
				expect((await api.resume.getById({ id: resumeId })).data.summary.content).toBe(data.summary.content);
				expect((await api.resume.getById({ id: result.resume.id })).data.summary.content).toBe(data.summary.content);
				expect((await api.career.workspace({ applicationId: id })).answers).toEqual([]);
				if (failure) expect(result.letter).toBeNull();
				else {
					expect(result.letter?.text).toBe("done");
					expect(result.letter?.document.content).toBe("");
					const letter = await api.letters.update({
						id: result.letter?.document.id ?? "missing",
						expectedRevision: result.letter?.document.revision ?? 0,
						content: coverLetterTextToHtml(result.letter?.text ?? ""),
						aiOperationIds: result.letter?.aiOperationIds ?? [],
					});
					expect(letter.aiUsage?.requests).toBe(1);
				}
				const first = result.answers[0];
				if (!first) throw new Error("Missing generated answer");
				await api.career.saveWorkspace({
					applicationId: id,
					answers: [{ id: "approved-question", question: first.question, ...first.answer }],
					expected: { answers: [] },
				});
				expect((await api.career.workspace({ applicationId: id })).answers[0]?.aiOperationIds).toEqual(
					first.answer.aiOperationIds,
				);
				const groups = (await api.ai.usage({})).groups;
				expect(groups).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ action: "tailor-resume", requests: 3, model: "capable-model" }),
						expect.objectContaining({ action: "draft-letter", requests: 1, model: "capable-model" }),
						expect.objectContaining({ action: "answer", requests: 2, model: "main-model" }),
					]),
				);
				expect(requests).toHaveLength(6);
				expect(JSON.stringify(requestMessages.slice(0, 3))).not.toContain("PRIVATE_FICTIONAL_APPLICATION_NOTES");
				expect(JSON.stringify(requestMessages)).not.toContain(data.metadata.notes);
			}),
	);
	it("rejects invalid, declined and read-only Prepare before any copy or model request", () =>
		run(async () => {
			const { api, id } = await reviewFixture();
			await expect(client(["read"]).applicationAi.prepare({ id, questions: [] })).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			await expect(
				client(undefined, new Headers({ "x-ai-destination": "none" })).applicationAi.prepare({ id, questions: [] }),
			).rejects.toMatchObject({ code: "CONFLICT" });
			await expect(api.applicationAi.prepare({ id, questions: Array(6).fill("Question") })).rejects.toMatchObject({
				code: "BAD_REQUEST",
			});
			await expect(api.applicationAi.prepare({ id, questions: ["x".repeat(2001)] })).rejects.toMatchObject({
				code: "BAD_REQUEST",
			});
			expect(requests).toHaveLength(0);
			expect(await api.resume.list({})).toHaveLength(1);
		}));

	it.each(["saved", "applied"] as const)("keeps %s MCP/REST tailoring pending until reviewed", (stage) =>
		run(async () => {
			const connection = await provider();
			const api = client();
			const data = structuredClone(sampleResumeData);
			data.summary.content = "<p>Built fictional reliable services.</p>";
			data.metadata.notes = "Private fictional resume note must stay out.";
			const sourceId = await api.resume.import({ data });
			const loaded = await loadDocument(user.id, { kind: "resume", id: sourceId });
			const passage = loaded.passages.find((entry) => entry.target.sectionId === "summary");
			if (!passage) throw new Error("Missing fictional summary passage");
			agentChanges = [
				{
					kind: "text",
					sectionId: "summary",
					passageId: passage.id,
					text: "Built reliable fictional services.",
					why: "Clearer wording for the posting",
					requirement: "Build fictional reliable services.",
					evidence: [passage.id],
				},
			];
			const [application] = await db
				.insert(tables.application)
				.values({
					userId: user.id,
					company: "Fictional Cedar",
					role: "Engineer",
					status: "saved",
					resumeId: sourceId,
					jobDescription: "Build fictional reliable services.",
					notes: "Private fictional application note must stay out.",
				})
				.returning();
			if (!application) throw new Error("Missing fictional application");
			if (stage === "applied") await api.applications.update({ id: application.id, status: "applied" });
			const before = await api.applications.getById({ id: application.id });
			mode = "tailoring";
			const result = await api.applicationAi.tailorResume({ id: application.id });
			const source = await api.resume.getById({ id: sourceId });
			const copy = await api.resume.getById({ id: result.resumeId });
			expect(source.data.summary.content).toBe(data.summary.content);
			expect(copy.id).not.toBe(sourceId);
			expect(requests.length).toBeGreaterThan(0);
			const link = await pool.query("select resume_id from application where id=$1", [application.id]);
			expect(link.rows[0]?.resume_id).toBe(stage === "saved" ? copy.id : sourceId);
			if (stage === "applied") {
				expect(before.sentResumeVersionId).not.toBeNull();
				expect((await api.applications.getById({ id: application.id })).sentResumeVersionId).toBe(
					before.sentResumeVersionId,
				);
			}
			expect(copy.data.summary.content).toBe(data.summary.content);
			expect(result).toMatchObject({ reviewRequired: true, generationStatus: "ready" });
			expect(result.conversation?.thread.workingResumeId).toBe(copy.id);
			const message = result.conversation?.messages.find((entry) => entry.role === "assistant");
			const output = message?.parts.find((part) => part.type === "tool-propose_edits") as
				| { output?: ProposeEditsOutput }
				| undefined;
			const edit = output?.output?.edits[0];
			if (!edit) throw new Error("Missing canonical tailoring proposal");
			expect(edit.status).toBe("pending");
			expect(output?.output?.tailoredFor).toBe(application.id);
			expect(requests).toHaveLength(3);
			expect(requests.every((request) => request.model === "capable-model")).toBe(true);
			expect(JSON.stringify(requestMessages)).not.toContain(data.metadata.notes);
			expect(JSON.stringify(requestMessages)).not.toContain(application.notes);
			const accepted = await api.resume.update({
				id: copy.id,
				data: { ...copy.data, summary: { ...copy.data.summary, content: edit.after } },
				expectedUpdatedAt: copy.updatedAt,
				proposalApplications: { [edit.id]: true },
				proposalSafety: "v1",
			});
			expect(accepted.data.summary.content).toBe(edit.after);
			expect(accepted.aiOperationIds).toEqual(aiOperationIds(message?.metadata));
			expect(accepted.aiUsage?.requests).toBe(3);
			expect((await api.ai.usage({})).groups).toEqual([
				expect.objectContaining({ action: "tailor-resume", requests: 3, model: "capable-model" }),
			]);
			expect(requests).toHaveLength(3);
			await aiProvidersService.delete({ userId: user.id, id: connection.id });
			const reloaded = await api.resume.getById({ id: copy.id });
			expect(reloaded.aiUsage).toEqual(accepted.aiUsage);
			expect(reloaded.aiOperationIds).toEqual(accepted.aiOperationIds);
		}),
	);

	it("refuses unauthorized, declined and already-cancelled tailoring before creating a copy or sending data", () =>
		run(async () => {
			await provider();
			const api = client();
			const sourceId = await api.resume.import({ data: structuredClone(sampleResumeData) });
			const id = await api.applications.create({
				company: "Fictional Cedar",
				role: "Engineer",
				resumeId: sourceId,
				jobDescription: "Build fictional services.",
			});
			const [foreign] = await db
				.insert(tables.application)
				.values({ userId: "usage-bob", company: "Fictional Birch", role: "Engineer" })
				.returning();
			if (!foreign) throw new Error("Missing fictional application");
			await expect(client(["read"]).applicationAi.tailorResume({ id })).rejects.toMatchObject({ code: "FORBIDDEN" });
			await expect(
				client(undefined, new Headers({ "x-ai-destination": "none" })).applicationAi.tailorResume({ id }),
			).rejects.toMatchObject({ code: "CONFLICT" });
			await expect(api.applicationAi.tailorResume({ id: foreign.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
			const controller = new AbortController();
			controller.abort();
			await expect(api.applicationAi.tailorResume({ id }, { signal: controller.signal })).rejects.toThrow();
			expect(requests).toHaveLength(0);
			expect((await pool.query("select id from resume where user_id=$1", [user.id])).rows).toEqual([{ id: sourceId }]);
			expect(await db.select({ id: tables.agentThread.id }).from(tables.agentThread)).toEqual([]);
			expect((await api.applications.getById({ id })).resumeId).toBe(sourceId);
		}));

	it("returns the accessible unchanged copy and interrupted conversation after a failed canonical tailoring reply", () =>
		run(async () => {
			await provider();
			const api = client();
			const sourceId = await api.resume.import({ data: structuredClone(sampleResumeData) });
			const original = await api.resume.getById({ id: sourceId });
			const id = await api.applications.create({
				company: "Fictional Cedar",
				role: "Engineer",
				resumeId: sourceId,
				jobDescription: "Build fictional services.",
			});
			mode = "failure";
			const result = await api.applicationAi.tailorResume({ id });
			expect(result).toMatchObject({ reviewRequired: true, generationStatus: "interrupted" });
			expect(result.conversation?.interrupted).toHaveLength(1);
			expect(result.conversation?.thread.activeRunId).toBeNull();
			const copy = await api.resume.getById({ id: result.resumeId });
			expect(copy.id).not.toBe(sourceId);
			expect(copy.data).toEqual(original.data);
			expect(copy.aiOperationIds).toEqual([]);
			expect((await api.resume.getById({ id: sourceId })).data).toEqual(original.data);
			expect(requests).toHaveLength(1);
			expect((await api.ai.usage({})).groups).toEqual([
				expect.objectContaining({ action: "tailor-resume", requests: 1 }),
			]);
		}));

	it("cancels actual tailoring transport, keeps its unchanged copy and counts the dispatched request", () =>
		run(async () => {
			await provider();
			const api = client();
			const sourceId = await api.resume.import({ data: structuredClone(sampleResumeData) });
			const original = await api.resume.getById({ id: sourceId });
			const id = await api.applications.create({
				company: "Fictional Cedar",
				role: "Engineer",
				resumeId: sourceId,
				jobDescription: "Build fictional services.",
			});
			mode = "hold";
			const held = new Promise<void>((resolve) => {
				arrived = resolve;
			});
			const closed = new Promise<void>((resolve) => {
				disconnected = resolve;
			});
			const controller = new AbortController();
			const pending = api.applicationAi.tailorResume({ id }, { signal: controller.signal });
			try {
				await held;
				controller.abort();
				await expect(pending).rejects.toThrow();
				await closed;
				const copies = await pool.query("select id from resume where user_id=$1 and id<>$2", [user.id, sourceId]);
				expect(copies.rows).toHaveLength(1);
				const copy = await api.resume.getById({ id: copies.rows[0].id });
				expect(copy.data).toEqual(original.data);
				expect(copy.aiOperationIds).toEqual([]);
				expect(requests).toHaveLength(1);
				expect((await api.ai.usage({})).groups).toEqual([
					expect.objectContaining({ action: "tailor-resume", requests: 1 }),
				]);
			} finally {
				release();
			}
		}));

	it("does not let public assistant callers reclassify usage as tailoring", () =>
		run(async () => {
			await provider();
			const api = client();
			const id = await api.resume.import({ data: structuredClone(sampleResumeData) });
			const thread = await api.agent.threads.start({ resumeId: id });
			mode = "letter";
			const stream = await api.agent.messages.send({
				threadId: thread.id,
				message: {
					id: "fictional-question",
					role: "user",
					parts: [{ type: "text", text: "Read this fictional resume." }],
				},
				usageAction: "tailor-resume",
			} as never);
			for await (const _chunk of stream) {
				/* Consume the actual streamed reply. */
			}
			expect((await api.ai.usage({})).groups).toEqual([expect.objectContaining({ action: "assistant", requests: 1 })]);
		}));

	const provider = async (ownerId = user.id) => {
		const created = await aiProvidersService.create({
			userId: ownerId,
			label: "Fictional connection",
			provider: "openai-compatible",
			model: "main-model",
			fastModel: "fast-model",
			capableModel: "capable-model",
			baseURL,
			apiKey: "synthetic-key-207",
		});
		await pool.query("update ai_providers set enabled=true,test_status='success' where id=$1", [created.id]);
		return aiProvidersService.getRunnableById({ userId: ownerId, id: created.id });
	};
	beforeAll(async () => {
		await admin.query(`create schema ${namespace}`);
		pool = new Pool({
			connectionString: databaseUrl,
			options: `-c search_path=${namespace} -c statement_timeout=10000`,
		});
		const migrations = new URL("../../../../../migrations/", import.meta.url);
		for (const directory of (await readdir(migrations)).filter((name) => /^\d+_/.test(name)).sort())
			await pool.query(
				(await readFile(new URL(`${directory}/migration.sql`, migrations), "utf8")).replaceAll('"public".', ""),
			);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
	}, 30000);
	beforeEach(async () => {
		release();
		arrived = () => {};
		disconnected = () => {};
		requests = [];
		requestMessages = [];
		agentStep = 0;
		agentChanges = [];
		mode = "text";
		failLetter = false;
		await pool.query('truncate "user" cascade');
		await withDatabasePool(pool, async () => {
			const nonce = randomUUID().slice(0, 8);
			const users = await db
				.insert(tables.user)
				.values([
					{
						id: "usage-alice",
						name: "Alice Example",
						email: "alice@example.test",
						username: `${namespace}-${nonce}-alice`,
						displayUsername: `${namespace}-${nonce}-alice`,
						timezone: "Europe/Berlin",
					},
					{
						id: "usage-bob",
						name: "Bob Example",
						email: "bob@example.test",
						username: `${namespace}-${nonce}-bob`,
						displayUsername: `${namespace}-${nonce}-bob`,
						timezone: "UTC",
					},
				])
				.returning();
			const owner = users[0];
			if (!owner) throw new Error("Missing fixture user");
			user = owner;
		});
	});
	afterAll(async () => {
		release();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await pool?.end();
		await admin.query(`drop schema if exists ${namespace} cascade`);
		await admin.end();
	});

	it("counts actual retries with selected model provenance, without request content or credentials", () =>
		run(async () => {
			const connection = await provider();
			const usage = createAiUsage(user.id, "improve", connection);
			mode = "retry";
			const result = await generateText({
				model: getModel({ ...connection, model: "fast-model", usage }),
				prompt: "Private synthetic prompt marker",
				maxRetries: 1,
			});
			expect(result.text).toBe("done");
			expect(requests).toHaveLength(2);
			expect(await readAiUsage(user.id, [usage.operationId, usage.operationId])).toEqual({
				requests: 2,
				models: [
					{ providerId: connection.id, label: connection.label, provider: connection.provider, model: "fast-model" },
				],
			});
			const records = (await pool.query("select * from ai_request")).rows;
			expect(records).toHaveLength(2);
			expect(JSON.stringify(records)).not.toMatch(
				/Private synthetic|synthetic-key|api_key|base_url|recipient_version|tokens|cost/,
			);
		}));

	it("counts each tool-loop dispatch and one streamed request, independent of chunks or repeat reads", () =>
		run(async () => {
			const connection = await provider();
			const usage = createAiUsage(user.id, "assistant", connection);
			mode = "tools";
			let tools = 0;
			await generateText({
				model: getModel({ ...connection, model: "capable-model", usage }),
				prompt: "Read owned fixture",
				maxRetries: 0,
				stopWhen: stepCountIs(3),
				tools: {
					read_owned: tool({
						inputSchema: z.object({}),
						execute: async () => {
							tools++;
							return "owned";
						},
					}),
				},
			});
			expect(tools).toBe(1);
			expect(requests).toHaveLength(2);
			expect((await readAiUsage(user.id, [usage.operationId]))?.requests).toBe(2);
			mode = "stream";
			const streamedUsage = createAiUsage(user.id, "draft-letter", connection);
			const streamed = streamText({
				model: getModel({ ...connection, usage: streamedUsage }),
				prompt: "Stream fixture",
				maxRetries: 0,
			});
			expect(await streamed.text).toBe("x".repeat(50));
			expect(await streamed.text).toBe("x".repeat(50));
			expect(requests).toHaveLength(3);
			expect((await readAiUsage(user.id, [streamedUsage.operationId]))?.requests).toBe(1);
		}));

	it("records failed and cancelled dispatches, but not an already aborted request", () =>
		run(async () => {
			const connection = await provider();
			mode = "failure";
			await expect(
				generateText({
					model: getModel({ ...connection, usage: createAiUsage(user.id, "fit", connection) }),
					prompt: "Failure",
					maxRetries: 0,
				}),
			).rejects.toThrow();
			expect(requests).toHaveLength(1);
			const abort = new AbortController();
			mode = "hold";
			const accepted = new Promise<void>((resolve) => {
				arrived = resolve;
			});
			const pending = generateText({
				model: getModel({ ...connection, usage: createAiUsage(user.id, "fit", connection) }),
				prompt: "Cancellation",
				maxRetries: 0,
				abortSignal: abort.signal,
			});
			await accepted;
			abort.abort();
			await expect(pending).rejects.toThrow();
			release();
			mode = "text";
			await expect(
				generateText({
					model: getModel({ ...connection, usage: createAiUsage(user.id, "fit", connection) }),
					prompt: "Already stopped",
					maxRetries: 0,
					abortSignal: AbortSignal.abort(),
				}),
			).rejects.toThrow();
			expect(requests).toHaveLength(2);
			expect((await client().ai.usage({})).requests).toBe(2);
		}));

	it.each(["disabled", "untested", "foreign", "deleted-account"] as const)(
		"refuses %s before recording or transmitting",
		(kind) =>
			run(async () => {
				const connection = await provider();
				const usage = createAiUsage(kind === "foreign" ? "usage-bob" : user.id, "improve", connection);
				const model = getModel({ ...connection, usage });
				if (kind === "disabled") await pool.query("update ai_providers set enabled=false where id=$1", [connection.id]);
				if (kind === "untested")
					await aiProvidersService.update({ userId: user.id, id: connection.id, model: "replacement" });
				if (kind === "deleted-account") await pool.query('delete from "user" where id=$1', [user.id]);
				await expect(generateText({ model, prompt: "Must not leave", maxRetries: 0 })).rejects.toThrow();
				expect(requests).toEqual([]);
				expect((await pool.query("select * from ai_request")).rows).toEqual([]);
			}),
	);

	it("checks shared document versions at transport and fails closed when meter persistence fails", () =>
		run(async () => {
			const connection = await provider();
			const [resume] = await db
				.insert(tables.resume)
				.values({ userId: user.id, name: "Fictional resume", slug: "fixture", data: sampleResumeData })
				.returning();
			if (!resume) throw new Error("Missing fixture resume");
			const usage = createAiUsage(user.id, "assistant", connection, (reader) =>
				assertDocumentVersion(reader, user.id, { kind: "resume", ...resume }),
			);
			const model = getModel({ ...connection, usage });
			await pool.query("update resume set updated_at=updated_at+interval '1 millisecond' where id=$1", [resume.id]);
			await expect(generateText({ model, prompt: "Stale document", maxRetries: 0 })).rejects.toThrow();
			await pool.query("alter table ai_request add constraint reject_meter_fixture check(false)");
			try {
				await expect(
					generateText({
						model: getModel({ ...connection, usage: createAiUsage(user.id, "improve", connection) }),
						prompt: "Meter unavailable",
						maxRetries: 0,
					}),
				).rejects.toThrow();
			} finally {
				await pool.query("alter table ai_request drop constraint reject_meter_fixture");
			}
			expect(requests).toEqual([]);
			expect((await pool.query("select * from ai_request")).rows).toEqual([]);
		}));

	it.each([
		{ now: "2026-03-29T12:00:00Z", start: "2026-03-22T23:00:00Z", end: "2026-03-29T22:00:00Z", hours: 167 },
		{ now: "2026-10-25T12:00:00Z", start: "2026-10-18T22:00:00Z", end: "2026-10-25T23:00:00Z", hours: 169 },
	])(
		"uses account-local Monday boundaries and isolates accounts across $hours-hour DST weeks",
		({ now, start, end, hours }) =>
			run(async () => {
				const connection = await provider();
				const common = {
					operationId: "boundary",
					action: "improve" as const,
					providerId: connection.id,
					label: connection.label,
					provider: connection.provider,
					model: "fast-model",
				};
				await db.insert(tables.aiRequest).values([
					{ ...common, userId: user.id, createdAt: new Date(new Date(start).getTime() - 1) },
					{ ...common, userId: user.id, createdAt: new Date(start) },
					{
						...common,
						userId: user.id,
						action: "assistant",
						model: "capable-model",
						createdAt: new Date(new Date(end).getTime() - 1),
					},
					{ ...common, userId: user.id, createdAt: new Date(end) },
					{ ...common, userId: "usage-bob", createdAt: new Date(now) },
				]);
				const report = await readWeeklyAiUsage(user.id, new Date(now));
				expect(report).toMatchObject({
					start: new Date(start),
					end: new Date(end),
					timezone: "Europe/Berlin",
					requests: 2,
				});
				expect((report.end.getTime() - report.start.getTime()) / 3_600_000).toBe(hours);
				expect(report.groups).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ action: "improve", model: "fast-model", requests: 1 }),
						expect.objectContaining({ action: "assistant", model: "capable-model", requests: 1 }),
					]),
				);
				expect(report.groups).toHaveLength(2);
				expect((await readAiUsage("usage-bob", [common.operationId]))?.requests).toBe(1);
			}),
	);

	it("authorizes and meters native search when an approved Coach tool runs before the next model step", () =>
		run(async () => {
			const connection = await aiProvidersService.create({
				userId: user.id,
				label: "Fictional direct connection",
				provider: "openai",
				model: "gpt-4.1-mini",
				apiKey: "fictional-direct-key",
			});
			await pool.query("update ai_providers set enabled=true,test_status='success' where id=$1", [connection.id]);
			const [current] = await aiProvidersService.list({ userId: user.id });
			if (!current) throw new Error("Missing direct fixture connection");
			await webAccessService.save(user.id, "firecrawl", "fictional-web-key");
			const failedConnection = await webAccessService.resolve(user.id, true);
			await webAccessService.recordTest(user.id, failedConnection, {
				search: { success: false, error: "auth" },
				read: { success: false, error: "auth" },
			});
			expect(await webAccessService.resolve(user.id)).toBeNull();
			mode = "native-search";
			const original = globalThis.fetch;
			vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
				const request = new Request(input, init);
				const url = new URL(request.url);
				if (url.origin !== "https://api.openai.com" && url.origin !== "https://api.firecrawl.dev")
					return original(input, init);
				return original(url.origin === "https://api.firecrawl.dev" ? `${baseURL}/firecrawl` : `${baseURL}/responses`, {
					method: request.method,
					headers: request.headers,
					body: await request.arrayBuffer(),
					signal: request.signal,
				});
			});
			try {
				const api = client(
					undefined,
					new Headers({ "x-ai-native-search": "1", "x-ai-destination": aiDestination(current) }),
				);
				const thread = await api.agent.threads.start({ scope: "career", aiProviderId: current.id });
				const send = async (message: UIMessage) => {
					const stream = await api.agent.messages.send({
						threadId: thread.id,
						message,
						context: { web: true, memory: true, application: true },
					});
					for await (const chunk of stream) expect(typeof chunk).toBe("string");
					return api.agent.threads.get({ id: thread.id });
				};
				const pending = await send({
					id: "query",
					role: "user",
					parts: [{ type: "text", text: "Find fictional engineer roles" }],
				});
				const approval = pending.messages.find((message) =>
					message.parts.some((part) => part.type === "tool-search_web"),
				);
				if (!approval) throw new Error("Missing exact query approval");
				expect(requests.map((request) => request.path)).toEqual(["/v1/responses"]);
				const answered = structuredClone(approval) as UIMessage;
				for (const part of answered.parts) {
					const tool = part as typeof part & { state?: string; approval?: { id: string; approved?: boolean } };
					if (tool.type === "tool-search_web" && tool.approval) {
						tool.state = "approval-responded";
						tool.approval.approved = true;
					}
				}
				const completed = await send(answered);
				expect(JSON.stringify(completed.messages)).toContain("https://jobs.example.com/engineer");
				expect(requests.map((request) => request.path)).toEqual([
					"/v1/responses",
					"/v1/firecrawl",
					"/v1/responses",
					"/v1/responses",
				]);
				const report = await api.ai.usage({ includeWebSearch: true });
				expect(report.groups).toEqual([expect.objectContaining({ action: "career-chat", requests: 3 })]);
				expect((await webAccessService.status(user.id)).testResult?.search).toEqual({ success: false, error: "auth" });
			} finally {
				vi.unstubAllGlobals();
			}
		}));

	it("aggregates native-search attempts compatibly for old clients and separates opted-in reports without losing account isolation", () =>
		run(async () => {
			const connection = await provider();
			for (const action of ["assistant", "web-search", "web-search"] as const)
				await generateText({
					model: getModel({ ...connection, usage: createAiUsage(user.id, action, connection) }),
					prompt: "Fictional query",
					maxRetries: 0,
				});
			await db.insert(tables.aiRequest).values({
				userId: "usage-bob",
				operationId: "foreign-search",
				action: "web-search",
				providerId: connection.id,
				label: connection.label,
				provider: connection.provider,
				model: connection.model,
			});
			const legacy = await client(["read"]).ai.usage({});
			expect(legacy.requests).toBe(3);
			expect(legacy.groups).toEqual([
				expect.objectContaining({ action: "assistant", requests: 3, providerId: connection.id }),
			]);
			const detailed = await client(["read"]).ai.usage({ includeWebSearch: true });
			expect(detailed.requests).toBe(3);
			expect(detailed.groups).toHaveLength(2);
			expect(detailed.groups).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ action: "assistant", requests: 1 }),
					expect.objectContaining({ action: "web-search", requests: 2 }),
				]),
			);
			const exported = await client(["read"]).auth.exportData({});
			expect(exported.career.aiRequests?.filter((row) => row.action === "web-search")).toHaveLength(2);
			expect(JSON.stringify(exported)).not.toContain("foreign-search");
			await authService.deleteAccount({ userId: user.id });
			expect((await pool.query("select * from ai_request where user_id=$1", [user.id])).rows).toEqual([]);
			expect((await pool.query("select * from ai_request where user_id=$1", ["usage-bob"])).rows).toHaveLength(1);
			expect(requests).toHaveLength(3);
		}));

	it("keeps generated answer provenance through save, older-client edits and submitted snapshots", () =>
		run(async () => {
			const connection = await provider();
			const [application] = await db
				.insert(tables.application)
				.values({ userId: user.id, company: "Fictional Harbor", role: "Engineer" })
				.returning();
			if (!application) throw new Error("Missing fixture application");
			mode = "answer";
			const generated = await client().career.generate({
				applicationId: application.id,
				locale: "en-US",
				task: { task: "answer", question: "What did you build?", answer: "" },
			});
			expect(generated.answer).toMatchObject({ aiOperationIds: [expect.any(String)] });
			const source = generated.answer as NonNullable<typeof generated.answer> & { aiOperationIds: string[] };
			const before = await client().career.workspace({ applicationId: application.id });
			const answer = {
				id: "answer-1",
				question: "What did you build?",
				answer: source.text,
				factIds: source.factIds,
				aiOperationIds: source.aiOperationIds,
			};
			await db.insert(tables.aiRequest).values([
				{
					userId: "usage-bob",
					operationId: "foreign-answer-op",
					action: "answer",
					providerId: connection.id,
					label: connection.label,
					provider: connection.provider,
					model: connection.model,
				},
				{
					userId: user.id,
					operationId: "wrong-action-op",
					action: "improve",
					providerId: connection.id,
					label: connection.label,
					provider: connection.provider,
					model: connection.model,
				},
			]);
			for (const bad of ["foreign-answer-op", "wrong-action-op", "fabricated-op"]) {
				await expect(
					client().career.saveWorkspace({
						applicationId: application.id,
						answers: [{ ...answer, aiOperationIds: [bad] }],
						expected: { answers: before.answers },
					}),
				).rejects.toMatchObject({ code: "BAD_REQUEST" });
				expect((await client().career.workspace({ applicationId: application.id })).answers).toEqual(before.answers);
			}
			const saved = await client().career.saveWorkspace({
				applicationId: application.id,
				answers: [answer],
				expected: { answers: before.answers },
			});
			await client().career.saveWorkspace({
				applicationId: application.id,
				checklist: [0, 2],
				expected: { checklist: saved.checklist },
			});
			const review = {
				applicationId: application.id,
				question: answer.question,
				answer: answer.answer,
				scope: "reusable" as const,
				source: "ai-assisted" as const,
				factIds: [],
				storyIds: [],
				expectedEvidence: [],
				reviewed: true as const,
				noEmployerWording: true,
				aiOperationIds: source.aiOperationIds,
			};
			const library = await client().career.answers.save(review);
			const { aiOperationIds: _ids, ...oldReview } = review;
			const updated = await client().career.answers.save({
				...oldReview,
				id: library.id,
				expectedRevision: library.revision,
				answer: answer.answer + " Reviewed in library.",
			});
			expect(updated.aiOperationIds).toEqual(source.aiOperationIds);
			const [other] = await db
				.insert(tables.application)
				.values({ userId: user.id, company: "Fictional Cedar", role: "Builder" })
				.returning();
			if (!other) throw new Error("Missing second application");
			const reused = await client().career.answers.reuse({
				id: library.id,
				expectedRevision: updated.revision,
				applicationId: other.id,
				answer: updated.answer,
				reviewed: true,
			});
			expect(reused.aiOperationIds).toEqual(source.aiOperationIds);

			const legacy = saved.answers.map(({ id, question, answer, factIds }) => ({ id, question, answer, factIds }));
			const edited = await client().career.saveWorkspace({
				applicationId: application.id,
				answers: legacy.map((row) => ({ ...row, answer: row.answer + " Reviewed." })),
				expected: { answers: legacy },
			});
			expect(edited.answers[0]).toMatchObject({ aiOperationIds: source.aiOperationIds });
			const old = edited.answers.map(({ id, question, answer, factIds }) => ({ id, question, answer, factIds }));
			await client().career.submitApplication({ applicationId: application.id, answers: old, expectedAnswers: old });
			const snapshots = await client().career.savedItems({ applicationId: application.id, kind: "answers" });
			expect(snapshots[0]?.aiUsage).toEqual({
				requests: 1,
				models: [
					{ providerId: connection.id, label: connection.label, provider: connection.provider, model: "main-model" },
				],
			});
			expect(snapshots[0]?.data).toMatchObject({
				kind: "answers",
				answers: [{ aiOperationIds: source.aiOperationIds }],
			});
			const submitted = await client().career.workspace({ applicationId: application.id });
			expect(submitted.submissionReview).toMatchObject({
				checklist: [0, 2],
				answers: true,
				answerVersionId: snapshots[0]?.id,
			});
			const afterLegacyEdit = await client().career.saveWorkspace({
				applicationId: application.id,
				answers: old.map((row) => ({ ...row, answer: row.answer + " Later draft." })),
				expected: { answers: old },
			});
			expect(afterLegacyEdit.answers[0]?.aiOperationIds).toEqual(source.aiOperationIds);
			expect(afterLegacyEdit.submissionReview).toEqual(submitted.submissionReview);
			await expect(
				client().career.saveWorkspace({
					applicationId: application.id,
					checklist: [1],
					expected: { checklist: submitted.checklist },
				}),
			).rejects.toMatchObject({ code: "CONFLICT" });
			expect((await client().career.workspace({ applicationId: application.id })).submissionReview).toEqual(
				submitted.submissionReview,
			);
			expect(requests).toHaveLength(1);
		}));

	it.each(["finish", "stop"] as const)(
		"accepts a real streamed proposal before %s with the same recorded sources in live metadata and storage",
		(ending) =>
			run(async () => {
				const connection = await provider();
				const api = client();
				const data = structuredClone(sampleResumeData);
				data.summary.content = "<p>Original fictional summary.</p>";
				const id = await api.resume.import({ data });
				const loaded = await loadDocument(user.id, { kind: "resume", id });
				const passage = loaded.passages.find((entry) => entry.target.sectionId === "summary");
				if (!passage) throw new Error("Missing fictional summary passage");
				agentChanges = [
					{
						kind: "text",
						sectionId: "summary",
						passageId: passage.id,
						text: "Led fictional delivery work.",
						why: "Clearer wording",
					},
				];
				const thread = await api.agent.threads.start({ resumeId: id });
				mode = "agent";
				const held = new Promise<void>((resolve) => {
					arrived = () => {
						if (requests.length === 3) resolve();
					};
				});
				const stream = await api.agent.messages.send({
					threadId: thread.id,
					message: {
						id: randomUUID(),
						role: "user",
						parts: [{ type: "text", text: "Rewrite the summary for clarity without adding facts." }],
					},
					context: { document: true, posting: false, memory: false },
				});
				const chunks: Record<string, unknown>[] = [];
				const finished = (async () => {
					for await (const frame of stream)
						for (const line of frame.split("\n"))
							if (line.startsWith("data: ") && line !== "data: [DONE]") chunks.push(JSON.parse(line.slice(6)));
				})();
				try {
					await held;
					const sources = aiOperationIds(chunks.find((chunk) => chunk.type === "start")?.messageMetadata);
					expect(sources).toEqual([expect.any(String)]);
					const stored = await api.agent.threads.get({ id: thread.id });
					const message = stored.messages.find((entry) => entry.role === "assistant");
					expect(aiOperationIds(message?.metadata)).toEqual(sources);
					const output = message?.parts.find((part) => part.type === "tool-propose_edits") as
						| { output?: ProposeEditsOutput }
						| undefined;
					const edit = output?.output?.edits[0];
					if (!edit) throw new Error("Missing real streamed proposal");
					const current = await api.resume.getById({ id });
					const accepted = await api.resume.update({
						id,
						expectedUpdatedAt: current.updatedAt,
						data: { ...current.data, summary: { ...current.data.summary, content: edit.after } },
						proposalApplications: { [edit.id]: edit.after },
						proposalSafety: "v1",
					});
					expect(accepted.aiOperationIds).toEqual(sources);
					expect(accepted.aiUsage).toMatchObject({
						requests: 3,
						models: [expect.objectContaining({ providerId: connection.id, model: "capable-model" })],
					});
					if (ending === "stop") await api.agent.messages.stop({ threadId: thread.id });
				} finally {
					release();
					await finished;
				}
				const sources = aiOperationIds(chunks.find((chunk) => chunk.type === "start")?.messageMetadata);
				if (ending === "finish")
					expect(aiOperationIds(chunks.find((chunk) => chunk.type === "finish")?.messageMetadata)).toEqual(sources);
				const stored = await api.agent.threads.get({ id: thread.id });
				const message = stored.messages.find((entry) => entry.role === "assistant");
				expect(aiOperationIds(message?.metadata)).toEqual(sources);
				expect(
					(
						message?.parts.find((part) => part.type === "tool-propose_edits") as
							| { output?: ProposeEditsOutput }
							| undefined
					)?.output?.edits[0]?.status,
				).toBe("accepted");
				expect((await api.resume.getById({ id })).aiOperationIds).toEqual(sources);
				expect(requests).toHaveLength(3);
			}),
	);

	it("uses the canonical letter prompt for MCP/REST cover-letter drafts", () =>
		run(async () => {
			await provider();
			const api = client();
			const data = structuredClone(sampleResumeData);
			data.metadata.page.locale = "en-GB";
			data.metadata.notes = "PRIVATE_FICTIONAL_NOTES_NOT_FOR_DRAFT";
			const sourceId = await api.resume.import({ data });
			const sourceBefore = await api.resume.getById({ id: sourceId });
			const [application] = await db
				.insert(tables.application)
				.values({
					userId: user.id,
					company: "Fictional Cedar",
					role: "Engineer",
					status: "saved",
					resumeId: sourceId,
					jobDescription: "Build fictional reliable services.",
					postingSource: {
						method: "paste",
						format: "text",
						truncated: false,
						completeness: "unknown",
						language: "de-DE",
					},
				})
				.returning();
			if (!application) throw new Error("Missing fictional application");
			mode = "letter";
			const result = await api.applicationAi.draftMessage({ id: application.id, kind: "cover-letter" });
			expect(result.text).toBe("done");
			expect(requests).toHaveLength(1);
			const system = requestMessages[0]?.find((message) => (message as { role?: string }).role === "system") as
				| { content: string }
				| undefined;
			expect(system?.content).toBe(letterDraftSystemPrompt);
			expect(JSON.stringify(requestMessages[0])).toContain("Write in de-DE.");
			expect(JSON.stringify(requestMessages[0])).not.toContain(data.metadata.notes);
			expect(result).toMatchObject({
				reviewRequired: true,
				coverLetterId: expect.any(String),
				aiOperationIds: [expect.any(String)],
				aiUsage: { requests: 1 },
			});
			const letter = await api.letters.getById({ id: result.coverLetterId ?? "missing" });
			expect(letter.content).toBe("");
			expect(letter.aiOperationIds).toEqual([]);
			expect(letter.style.metadata.page.locale).toBe("de-DE");
			await expect(
				client(["read"]).applicationAi.draftMessage({ id: application.id, kind: "cover-letter" }),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
			await expect(
				client(undefined, new Headers({ "x-ai-destination": "none" })).applicationAi.draftMessage({
					id: application.id,
					kind: "cover-letter",
				}),
			).rejects.toMatchObject({ code: "CONFLICT" });
			expect(requests).toHaveLength(1);
			const accepted = await api.letters.update({
				id: letter.id,
				expectedRevision: letter.revision,
				content: coverLetterTextToHtml(result.text),
				aiOperationIds: result.aiOperationIds,
			});
			expect(accepted.content).toBe("<p>done</p>");
			expect(accepted.aiUsage).toEqual(result.aiUsage);
			expect(requests).toHaveLength(1);
			expect((await api.resume.getById({ id: sourceId })).data).toEqual(sourceBefore.data);
		}));

	it("does not create a letter when a canonical application draft fails or the application belongs to another account", () =>
		run(async () => {
			await provider();
			const [owned, foreign] = await db
				.insert(tables.application)
				.values([
					{
						userId: user.id,
						company: "Fictional Cedar",
						role: "Engineer",
						status: "saved" as const,
						jobDescription: "Build fictional reliable services.",
					},
					{
						userId: "usage-bob",
						company: "Other fictional company",
						role: "Engineer",
						status: "saved" as const,
						jobDescription: "PRIVATE_OTHER_APPLICATION",
					},
				])
				.returning();
			if (!owned || !foreign) throw new Error("Missing fictional applications");
			await expect(client().applicationAi.draftMessage({ id: foreign.id, kind: "cover-letter" })).rejects.toMatchObject(
				{ code: "NOT_FOUND" },
			);
			expect(requests).toHaveLength(0);
			mode = "failure";
			await expect(client().applicationAi.draftMessage({ id: owned.id, kind: "cover-letter" })).rejects.toMatchObject({
				code: "BAD_GATEWAY",
			});
			expect(requests).toHaveLength(1);
			expect((await pool.query("select id from cover_letter where user_id=$1", [user.id])).rows).toEqual([]);
		}));

	it("leaves no new letter after an application draft is cancelled in transport", () =>
		run(async () => {
			await provider();
			const [application] = await db
				.insert(tables.application)
				.values({
					userId: user.id,
					company: "Fictional Cedar",
					role: "Engineer",
					status: "saved",
					jobDescription: "Build fictional reliable services.",
				})
				.returning();
			if (!application) throw new Error("Missing fictional application");
			mode = "hold";
			const arrivedAtProvider = new Promise<void>((resolve) => {
				arrived = resolve;
			});
			const controller = new AbortController();
			const pending = client().applicationAi.draftMessage(
				{ id: application.id, kind: "cover-letter" },
				{ signal: controller.signal },
			);
			try {
				await arrivedAtProvider;
				controller.abort();
				await expect(pending).rejects.toThrow();
				expect(requests).toHaveLength(1);
				expect((await client().ai.usage({})).requests).toBe(1);
				expect((await pool.query("select id from cover_letter where user_id=$1", [user.id])).rows).toEqual([]);
			} finally {
				release();
			}
		}));

	it("preserves the legacy follow-up text contract without creating a letter or logging a sent reply", () =>
		run(async () => {
			await provider();
			const [application] = await db
				.insert(tables.application)
				.values({
					userId: user.id,
					company: "Fictional Cedar",
					role: "Engineer",
					status: "saved",
					jobDescription: "Build fictional reliable services.",
				})
				.returning();
			if (!application) throw new Error("Missing fictional application");
			const result = await client().applicationAi.draftMessage({ id: application.id, kind: "follow-up" });
			expect(result).toEqual({ text: "done" });
			expect(requests).toHaveLength(1);
			expect((await pool.query("select id from cover_letter where user_id=$1", [user.id])).rows).toEqual([]);
			expect(
				(await pool.query("select activity from application where id=$1", [application.id])).rows[0]?.activity,
			).toEqual(application.activity);
		}));

	it.each(["resume", "letter"] as const)(
		"%s accepted assistant sources preserve prior lineage, partial decisions and older clients",
		(kind) =>
			run(async () => {
				const connection = await provider();
				const priorUsage = createAiUsage(user.id, "improve", connection);
				await generateText({ model: getModel({ ...connection, usage: priorUsage }), prompt: "Fictional prior source" });
				const foreignConnection = await provider("usage-bob");
				const foreignUsage = createAiUsage("usage-bob", "assistant", foreignConnection);
				await generateText({
					model: getModel({ ...foreignConnection, usage: foreignUsage }),
					prompt: "Fictional other account",
				});
				const usage = createAiUsage(user.id, "assistant", connection);
				await generateText({ model: getModel({ ...connection, usage }), prompt: "Fictional source fixture" });
				const api = client();
				const data = structuredClone(sampleResumeData);
				const first = "<p>Original fictional summary.</p>";
				const second = "<p>Second fictional paragraph.</p>";
				const after = "<p>Led fictional delivery work.</p>";
				const afterSecond = "<p>Built fictional reporting tools.</p>";
				data.summary.content = first + second;
				const id =
					kind === "resume"
						? await api.resume.import({ data, aiOperationIds: [priorUsage.operationId] })
						: (await api.letters.create({ name: "Fictional proposal letter", content: first + second })).id;
				if (kind === "letter") {
					const letter = await api.letters.getById({ id });
					await api.letters.update({
						id,
						content: letter.content,
						aiOperationIds: [priorUsage.operationId],
						expectedRevision: letter.revision,
					});
				}
				const [thread] = await db
					.insert(tables.agentThread)
					.values({
						userId: user.id,
						...(kind === "resume" ? { workingResumeId: id, sourceResumeId: id } : { coverLetterId: id }),
						title: "Fictional proposal source",
					})
					.returning();
				if (!thread) throw new Error("Missing fixture thread");
				await upsertAssistantUiMessage({
					userId: user.id,
					threadId: thread.id,
					status: "completed",
					message: {
						id: "fictional-assistant",
						role: "assistant",
						metadata: {
							aiOperationIds: [usage.operationId, foreignUsage.operationId, priorUsage.operationId, "fabricated-op"],
						},
						parts: [
							{
								type: "tool-propose_edits",
								toolCallId: "fictional-edit-call",
								state: "output-available",
								input: {},
								output: {
									tailoredFor: null,
									edits: [
										{
											id: "fictional-edit",
											status: "pending",
											target: { sectionId: kind === "resume" ? "summary" : "letter", field: "content" },
											location: "Summary",
											before: first,
											after,
											why: "Fictional rewrite",
										},
										{
											id: "second-edit",
											status: "pending",
											target: { sectionId: kind === "resume" ? "summary" : "letter", field: "content" },
											location: "Summary",
											before: second,
											after: afterSecond,
											why: "Fictional second rewrite",
										},
									],
								},
							},
						],
					},
				});
				const save = async (content: string, applications: Record<string, string | boolean>) => {
					if (kind === "resume") {
						const current = await api.resume.getById({ id });
						return api.resume.update({
							id,
							data: { ...current.data, summary: { ...current.data.summary, content } },
							expectedUpdatedAt: current.updatedAt,
							proposalApplications: applications,
							proposalSafety: "v1",
						});
					}
					const current = await api.letters.getById({ id });
					return api.letters.update({
						id,
						content,
						expectedRevision: current.revision,
						proposalApplications: applications,
						proposalSafety: "v1",
					});
				};
				const accepted = await save(after + second, { "fictional-edit": after });
				expect(accepted.aiOperationIds).toEqual([priorUsage.operationId, usage.operationId]);
				expect(accepted.aiUsage).toMatchObject({
					requests: 2,
					models: [expect.objectContaining({ providerId: connection.id, model: connection.model })],
				});
				await save(after + afterSecond, { "second-edit": afterSecond });
				const partial = await save(first + afterSecond, { "fictional-edit": false });
				expect(partial.aiOperationIds).toEqual([priorUsage.operationId, usage.operationId]);
				const undone = await save(first + second, { "second-edit": false });
				expect(undone.aiOperationIds).toEqual([priorUsage.operationId]);
				const redone = await save(after + second, { "fictional-edit": after });
				expect(redone.aiOperationIds).toEqual([priorUsage.operationId, usage.operationId]);
				await api.ai.usage();
				expect(requests).toHaveLength(3);
			}),
	);

	it("returns opt-in Improve sources from actual transport records while preserving the default result contract", () =>
		run(async () => {
			const connection = await provider();
			const api = client();
			mode = "improve";
			const input = { action: "verb" as const, line: "Helped with fictional reliable delivery." };
			const legacy = await api.ai.improve(input);
			expect(legacy).toEqual({
				text: "Led fictional reliable delivery.",
				why: "Uses a direct verb.",
				addsFacts: false,
			});
			const result = await api.ai.improve({ ...input, includeProvenance: true });
			expect(result.aiOperationIds).toEqual([expect.any(String)]);
			expect(result.aiUsage).toEqual({
				requests: 1,
				models: [
					{ providerId: connection.id, label: connection.label, provider: connection.provider, model: "fast-model" },
				],
			});
			expect((await pool.query("select * from resume")).rows).toEqual([]);
			const id = await api.resume.import({ data: sampleResumeData });
			const current = await api.resume.getById({ id });
			const data = { ...current.data, summary: { ...current.data.summary, content: `<p>${result.text}</p>` } };
			const accepted = await api.resume.update({
				id,
				data,
				aiOperationIds: result.aiOperationIds,
				expectedUpdatedAt: current.updatedAt,
			});
			expect(accepted.aiUsage).toEqual(result.aiUsage);
			expect(accepted.data.summary.content).toBe(`<p>${result.text}</p>`);
			expect(requests).toHaveLength(2);
		}));

	it("pairs reviewed resume imports with real request sources through old edits, copies, history, export and deletion", () =>
		run(async () => {
			const connection = await provider();
			const api = client();
			mode = "resume";
			const file = { name: "fictional.pdf", data: Buffer.from("%PDF-fictional").toString("base64") };
			const legacy = await api.ai.parsePdf({ file });
			expect(legacy).not.toHaveProperty("aiOperationIds");
			const bytes = zipSync({
				"word/document.xml": strToU8(
					'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Fictional resume</w:t></w:r></w:p></w:body></w:document>',
				),
			});
			const { aiOperationIds, ...data } = await api.ai.parseDocx({
				file: { name: "fictional.docx", data: Buffer.from(bytes).toString("base64") },
				mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				includeProvenance: true,
			});
			expect(aiOperationIds).toEqual([expect.any(String)]);
			expect((await pool.query("select * from resume")).rows).toEqual([]);
			const id = await api.resume.import({ data, aiOperationIds });
			const imported = await api.resume.getById({ id });
			const expected = {
				requests: 1,
				models: [
					{ providerId: connection.id, label: connection.label, provider: connection.provider, model: "fast-model" },
				],
			};
			expect(imported.aiOperationIds).toEqual(aiOperationIds);
			expect(imported.aiUsage).toEqual(expected);
			expect(imported.data).not.toHaveProperty("aiOperationIds");
			const first = (await api.resume.listVersions({ resumeId: id }))[0];
			if (!first) throw new Error("Missing import version");
			expect((await api.resume.getVersion({ resumeId: id, versionId: first.id })).aiUsage).toEqual(expected);
			const reviewed = { ...data, summary: { ...data.summary, content: "<p>Reviewed import</p>" } };
			const saved = await api.resume.update({
				id,
				data: reviewed,
				expectedUpdatedAt: imported.updatedAt,
				sessionId: "reviewed",
			});
			expect(saved.aiUsage).toEqual(expected);
			await expect(client(["read"]).resume.import({ data, aiOperationIds })).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			for (const [operationId, userId, action] of [
				["foreign-resume", "usage-bob", "import-docx"],
				["wrong-resume", user.id, "provider-test"],
			] as const) {
				await db.insert(tables.aiRequest).values({
					operationId,
					userId,
					action,
					providerId: connection.id,
					label: connection.label,
					provider: connection.provider,
					model: "unrelated-model",
				});
			}
			for (const bad of ["foreign-resume", "wrong-resume", "fabricated-source"]) {
				await expect(api.resume.import({ data, aiOperationIds: [bad] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
				await expect(
					api.resume.update({ id, data, aiOperationIds: [bad], expectedUpdatedAt: saved.updatedAt }),
				).rejects.toMatchObject({ code: "BAD_REQUEST" });
			}
			await expect(api.resume.update({ id, aiOperationIds: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
			expect((await api.resume.getById({ id })).data.summary.content).toBe("<p>Reviewed import</p>");
			const duplicateId = await api.resume.duplicate({ id });
			const copy = await api.documents.copyForJob({ resumeId: id, name: "Fictional job copy" });
			for (const copyId of [duplicateId, copy])
				expect((await api.resume.getById({ id: copyId })).aiUsage).toEqual(expected);
			await api.resume.createVersion({ resumeId: id, name: "Reviewed" });
			const [application] = await db
				.insert(tables.application)
				.values({ userId: user.id, company: "Fictional recipient", role: "Engineer", resumeId: id })
				.returning();
			if (!application) throw new Error("Missing submission application");
			await api.career.submitApplication({
				applicationId: application.id,
				answers: [],
				expectedAnswers: [],
				expectedDocuments: { resumeId: id, coverLetterId: null },
			});
			const sent = (await api.resume.listVersions({ resumeId: id })).find((version) => version.kind === "sent");
			if (!sent) throw new Error("Missing sent version");
			expect((await api.resume.getVersion({ resumeId: id, versionId: sent.id })).aiUsage).toEqual(expected);
			await api.resume.update({ id, isPublic: true });
			const published = await api.resume.getById({ id });
			const publicResult = await api.resume.getBySlug({ username: user.username, slug: published.slug });
			expect(publicResult).not.toHaveProperty("aiOperationIds");
			expect(publicResult).not.toHaveProperty("aiUsage");
			await aiProvidersService.update({ userId: user.id, id: connection.id, label: "Renamed", model: "replacement" });
			await aiProvidersService.delete({ userId: user.id, id: connection.id });
			expect((await api.resume.getById({ id })).aiUsage).toEqual(expected);
			const restored = await api.resume.restoreVersion({ resumeId: id, versionId: first.id, proposalSafety: "v1" });
			expect(restored.aiUsage).toEqual(expected);
			expect(restored.data.summary.content).toBe(data.summary.content);
			const exported = await client(["read"]).auth.exportData({});
			expect(exported.resumes.find((row) => row.id === id)?.aiOperationIds).toEqual(aiOperationIds);
			expect(exported.documentVersions?.resumes.find((row) => row.id === first.id)?.aiOperationIds).toEqual(
				aiOperationIds,
			);
			const archive = unzipSync(buildAccountZip(exported));
			const resumeFile = Object.keys(archive).find(
				(name) => name.startsWith("resumes/") && name.endsWith(`${id}.json`),
			);
			if (!resumeFile || !archive[resumeFile]) throw new Error("Missing resume account archive");
			expect(JSON.parse(strFromU8(archive[resumeFile])).aiOperationIds).toEqual(aiOperationIds);
			await pool.query("update resume_version set ai_operation_ids='{}' where id=$1", [first.id]);
			const legacyRestored = await api.resume.restoreVersion({
				resumeId: id,
				versionId: first.id,
				proposalSafety: "v1",
			});
			expect(legacyRestored.aiOperationIds).toEqual([]);
			expect(legacyRestored.aiUsage).toBeNull();
			const beforeRestore = (await api.resume.listVersions({ resumeId: id })).find(
				(version) => version.kind === "before-restore",
			);
			if (!beforeRestore) throw new Error("Missing before-restore version");
			expect((await api.resume.getVersion({ resumeId: id, versionId: beforeRestore.id })).aiUsage).toEqual(expected);
			const localId = await api.resume.import({ data });
			expect((await api.resume.getById({ id: localId })).aiUsage).toBeNull();
			await authService.deleteAccount({ userId: user.id });
			for (const table of ["resume", "resume_version"])
				expect((await pool.query(`select * from ${table}`)).rows).toEqual([]);
			expect((await pool.query("select * from ai_request where user_id=$1", [user.id])).rows).toEqual([]);
			expect(requests).toHaveLength(2);
		}));

	it("keeps letter draft sources through owned saves, reuse, history, export and deletion without new dispatches", () =>
		run(async () => {
			const connection = await provider();
			const [resume] = await db
				.insert(tables.resume)
				.values({ userId: user.id, name: "Fictional resume", slug: "letter", data: sampleResumeData })
				.returning();
			if (!resume) throw new Error("Missing fixture resume");
			const api = client();
			const letter = await api.letters.create({ name: "Fictional letter", resumeId: resume.id });
			const created = (await api.letters.listVersions({ id: letter.id }))[0];
			if (!created) throw new Error("Missing created version");
			mode = "stream";
			const stream = await api.letters.draft({ id: letter.id, includeProvenance: true });
			const parts = await Array.fromAsync(stream);
			const source = parts.find((part) => typeof part !== "string");
			if (!source || typeof source === "string") throw new Error("Missing draft provenance");
			const text = parts.filter((part) => typeof part === "string").join("");
			expect(text).toBe("x".repeat(50));
			expect(requests).toHaveLength(1);
			const kept = await api.letters.update({
				id: letter.id,
				expectedRevision: letter.revision,
				content: `<p>${text}</p>`,
				aiOperationIds: [source.aiOperationId, source.aiOperationId],
			});
			const expected = {
				requests: 1,
				models: [
					{ providerId: connection.id, label: connection.label, provider: connection.provider, model: "capable-model" },
				],
			};
			expect(kept.aiOperationIds).toEqual([source.aiOperationId]);
			expect(kept.aiUsage).toEqual(expected);
			// An old app edits without the new field: source history is preserved.
			const edited = await api.letters.update({
				id: letter.id,
				expectedRevision: kept.revision,
				content: "<p>Edited draft</p>",
			});
			expect(edited.aiUsage).toEqual(expected);
			for (const [operationId, userId, action] of [
				["foreign-letter", "usage-bob", "draft-letter"],
				["wrong-letter", user.id, "provider-test"],
			] as const) {
				await db.insert(tables.aiRequest).values({
					operationId,
					userId,
					action,
					providerId: connection.id,
					label: connection.label,
					provider: connection.provider,
					model: "foreign-model",
				});
				await expect(
					api.letters.update({
						id: letter.id,
						expectedRevision: edited.revision,
						content: "<p>Refused</p>",
						aiOperationIds: [operationId],
					}),
				).rejects.toMatchObject({ code: "BAD_REQUEST" });
			}
			expect((await api.letters.getById({ id: letter.id })).content).toBe("<p>Edited draft</p>");
			await expect(
				client(["read"]).letters.update({ id: letter.id, expectedRevision: edited.revision, aiOperationIds: [] }),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
			const named = await api.letters.createVersion({ id: letter.id, name: "Kept draft" });
			expect((await client(["read"]).letters.getVersion({ id: letter.id, versionId: named.id })).aiUsage).toEqual(
				expected,
			);
			const reused = await api.letters.create({
				name: "New employer",
				sourceLetterId: letter.id,
				recipientCompany: "Fictional New Co",
			});
			expect(reused).toMatchObject({
				content: edited.content,
				recipientCompany: "Fictional New Co",
				aiOperationIds: [source.aiOperationId],
				aiUsage: expected,
			});
			expect((await api.letters.duplicate({ id: letter.id })).aiUsage).toEqual(expected);
			const portable = await api.letters.export({ id: letter.id });
			expect(portable).not.toHaveProperty("aiOperationIds");
			expect(portable).not.toHaveProperty("aiUsage");
			const imported = await api.letters.import({ document: portable });
			expect(imported.aiOperationIds).toEqual([]);
			const recovered = await api.letters.import({ document: portable, aiOperationIds: [source.aiOperationId] });
			expect(recovered.aiUsage).toEqual(expected);
			await expect(
				api.letters.import({ document: portable, aiOperationIds: ["foreign-letter"] }),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
			await aiProvidersService.delete({ userId: user.id, id: connection.id });
			expect((await client(["read"]).letters.getById({ id: letter.id })).aiUsage).toEqual(expected);
			await pool.query("update cover_letter_version set data=data-'aiOperationIds' where id=$1", [created.id]);
			const restored = await api.letters.restoreVersion({ id: letter.id, versionId: created.id, proposalSafety: "v1" });
			expect(restored.aiOperationIds).toEqual([]);
			expect(restored.aiUsage).toBeNull();
			const history = await api.letters.listVersions({ id: letter.id });
			const before = history.find((version) => version.kind === "before-restore");
			if (!before) throw new Error("Missing before-restore version");
			expect((await api.letters.getVersion({ id: letter.id, versionId: before.id })).aiUsage).toEqual(expected);
			const exportData = await client(["read"]).auth.exportData({});
			expect(JSON.stringify(exportData.coverLetters)).toContain(source.aiOperationId);
			expect(
				exportData.documentVersions?.letters.find((version) => version.id === before.id)?.data.aiOperationIds,
			).toEqual([source.aiOperationId]);
			expect(exportData.career.aiRequests?.some((row) => row.operationId === source.aiOperationId)).toBe(true);
			await authService.deleteAccount({ userId: user.id });
			expect((await pool.query("select * from cover_letter")).rows).toEqual([]);
			expect((await pool.query("select * from cover_letter_version")).rows).toEqual([]);
			expect((await pool.query("select * from ai_request where user_id=$1", [user.id])).rows).toEqual([]);
			expect(requests).toHaveLength(1);
		}));

	it("retains saved-result provenance after connection edits/removal, exports it to old archive clients and deletes account usage", () =>
		run(async () => {
			const connection = await provider();
			const [application] = await db
				.insert(tables.application)
				.values({ userId: user.id, company: "Fictional Harbor", role: "Engineer", status: "applied" })
				.returning();
			if (!application) throw new Error("Missing fixture application");
			mode = "reply";
			const generated = await client().career.generate({
				applicationId: application.id,
				locale: "en-US",
				task: { task: "reply", message: "When are you available?" },
			});
			expect(generated.item?.aiOperationId).toEqual(expect.any(String));
			const saved = await client().career.savedItems({ applicationId: application.id });
			expect(saved[0]?.aiUsage).toEqual({
				requests: 1,
				models: [
					{ providerId: connection.id, label: connection.label, provider: connection.provider, model: "main-model" },
				],
			});
			const [resume] = await db
				.insert(tables.resume)
				.values({
					userId: user.id,
					name: "Fictional writing resume",
					slug: "writing",
					data: sampleResumeData,
				})
				.returning();
			if (!resume) throw new Error("Missing writing fixture resume");
			mode = "writing";
			await client().ai.atsReview({
				resumeId: resume.id,
				extractedText: "Fictional original",
				findings: [],
				passages: [],
			});
			const writing = await client(["read"]).ai.writingReview({ resumeId: resume.id });
			expect(writing?.review.summary).toBe("Fictional saved wording review");
			expect(writing?.aiOperationIds).toEqual([expect.any(String)]);
			expect(writing?.aiUsage).toEqual(saved[0]?.aiUsage);
			await aiProvidersService.update({ userId: user.id, id: connection.id, label: "Renamed", model: "replacement" });
			await aiProvidersService.delete({ userId: user.id, id: connection.id });
			expect((await client().career.savedItems({ applicationId: application.id }))[0]?.aiUsage).toEqual(
				saved[0]?.aiUsage,
			);
			expect((await client(["read"]).ai.writingReview({ resumeId: resume.id }))?.aiUsage).toEqual(writing?.aiUsage);
			expect((await client(["read"]).ai.writingReview({ resumeId: resume.id }))?.aiOperationIds).toEqual(
				writing?.aiOperationIds,
			);
			const report = await client(["read"]).ai.usage({ userId: "usage-bob" } as {});
			expect(report.requests).toBe(2);
			expect(report.groups[0]).toMatchObject({ action: "reply", label: "Fictional connection", model: "main-model" });
			const exported = await client(["read"]).auth.exportData({});
			expect(exported.career.aiRequests).toHaveLength(2);
			expect(exported.career.writingReviews).toHaveLength(1);
			const archive = unzipSync(buildAccountZip(exported));
			const careerFile = archive["career.json"];
			if (!careerFile) throw new Error("Missing career export");
			const career = JSON.parse(strFromU8(careerFile)) as { aiRequests: unknown[]; writingReviews: unknown[] };
			expect(career.aiRequests).toHaveLength(2);
			expect(career.writingReviews).toHaveLength(1);
			expect(JSON.stringify(career.aiRequests)).not.toContain("synthetic-key-207");
			await authService.deleteAccount({ userId: user.id });
			expect((await pool.query("select * from ai_request")).rows).toEqual([]);
			expect((await pool.query("select * from resume_writing_review")).rows).toEqual([]);
			expect(requests).toHaveLength(2);
		}));
});
