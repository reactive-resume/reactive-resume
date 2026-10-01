import type { UIMessage, UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamToEventIterator } from "@orpc/server";

const dbMock = {
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
	transaction: vi.fn(async <T>(callback: (tx: typeof dbMock) => Promise<T>) => callback(dbMock)),
};

const clearActiveAgentRunIfCurrentMock = vi.fn();
const claimActiveAgentRunMock = vi.fn();
const cancellationRedisMock = {
	get: vi.fn(async () => null),
	set: vi.fn(async () => "OK"),
	exists: vi.fn(async () => 1),
};
const messagesPersistenceMock = {
	applyStepToUiMessage: vi.fn((message: unknown) => message),
	insertDraftAssistantMessage: vi.fn(),
	upsertAssistantUiMessage: vi.fn(),
	deleteDraftIfEmpty: vi.fn(),
	nextMessageSequence: vi.fn(async () => 1),
	touchThread: vi.fn(),
	withAccumulatedUsageMetadata: vi.fn((_previous: unknown, next: unknown) => next),
	proposedEditsOf: vi.fn(() => []),
	findUserMessageRow: vi.fn(async () => null),
	withEditStatuses: vi.fn((message: unknown) => message),
};
const storageServiceMock = {
	delete: vi.fn(),
	write: vi.fn(),
	read: vi.fn(),
};

const resumeServiceMock = {
	getById: vi.fn(),
	patch: vi.fn(),
	patchInTransaction: vi.fn(),
};

const aiProvidersServiceMock = {
	getRunnableById: vi.fn(),
	getDefaultRunnable: vi.fn(),
	markUsed: vi.fn(),
};

vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("@reactive-resume/db/redis", () => ({
	getRedis: () => cancellationRedisMock,
	redisKey: (...parts: string[]) => ["test", ...parts].join(":"),
}));
vi.mock("@reactive-resume/db/schema", () => ({
	agentThread: {
		id: "agent_threads.id",
		userId: "agent_threads.user_id",
		deletedAt: "agent_threads.deleted_at",
		archivedAt: "agent_threads.archived_at",
		status: "agent_threads.status",
		reviewPatches: "agent_threads.review_patches",
		activeRunId: "agent_threads.active_run_id",
		activeStreamId: "agent_threads.active_stream_id",
		activeRunStartedAt: "agent_threads.active_run_started_at",
		aiProviderId: "agent_threads.ai_provider_id",
		workingResumeId: "agent_threads.working_resume_id",
		sourceResumeId: "agent_threads.source_resume_id",
		coverLetterId: "agent_threads.cover_letter_id",
		editsProposed: "agent_threads.edits_proposed",
		editsAccepted: "agent_threads.edits_accepted",
		title: "agent_threads.title",
		lastMessageAt: "agent_threads.last_message_at",
		createdAt: "agent_threads.created_at",
		updatedAt: "agent_threads.updated_at",
	},
	agentMessage: {
		id: "agent_messages.id",
		threadId: "agent_messages.thread_id",
		userId: "agent_messages.user_id",
		role: "agent_messages.role",
		status: "agent_messages.status",
		sequence: "agent_messages.sequence",
		uiMessage: "agent_messages.ui_message",
	},
	agentAction: {
		id: "agent_actions.id",
		threadId: "agent_actions.thread_id",
		userId: "agent_actions.user_id",
		resumeId: "agent_actions.resume_id",
		kind: "agent_actions.kind",
		status: "agent_actions.status",
		appliedUpdatedAt: "agent_actions.applied_updated_at",
		createdAt: "agent_actions.created_at",
	},
	agentAttachment: {
		id: "agent_attachments.id",
		threadId: "agent_attachments.thread_id",
		userId: "agent_attachments.user_id",
		messageId: "agent_attachments.message_id",
		storageKey: "agent_attachments.storage_key",
		filename: "agent_attachments.filename",
		mediaType: "agent_attachments.media_type",
		size: "agent_attachments.size",
		createdAt: "agent_attachments.created_at",
	},
	resume: {
		name: "resume.name",
		id: "resume.id",
		userId: "resume.user_id",
		slug: "resume.slug",
	},
	coverLetter: { name: "cover_letter.name", id: "cover_letter.id" },
	aiProvider: { label: "ai_provider.label", id: "ai_provider.id" },
}));

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ type: "and", conditions }),
	asc: (value: unknown) => ({ type: "asc", value }),
	count: () => ({ type: "count" }),
	desc: (value: unknown) => ({ type: "desc", value }),
	eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
	gte: (left: unknown, right: unknown) => ({ type: "gte", left, right }),
	inArray: (left: unknown, values: unknown[]) => ({
		type: "inArray",
		left,
		values,
	}),
	isNull: (value: unknown) => ({ type: "isNull", value }),
	max: (value: unknown) => ({ type: "max", value }),
	sql: () => ({ type: "sql" }),
}));

// Spread-actual: pure helpers (isStepCount, safeValidateUIMessages, pruneMessages, ...) stay real;
// only the scripted seams are mocked.
vi.mock("ai", async (importOriginal) => ({
	...(await importOriginal<typeof import("ai")>()),
	convertToModelMessages: vi.fn(),
	ToolLoopAgent: vi.fn(),
}));

// Minimal V4 model stub: the real wrapLanguageModel/addToolInputExamplesMiddleware run against it.
vi.mock("../ai/service", () => ({
	getAgentModel: vi.fn(() => ({
		specificationVersion: "v4",
		provider: "mock",
		modelId: "mock-model",
		supportedUrls: {},
		doGenerate: vi.fn(),
		doStream: vi.fn(),
	})),
}));
vi.mock("../ai/credentials", () => ({ assertAgentEnvironment: vi.fn() }));
vi.mock("../ai-providers/service", () => ({
	aiProvidersService: aiProvidersServiceMock,
}));
vi.mock("../web-access/credentials", () => ({
	webAccessService: { resolve: vi.fn(async () => null) },
}));
vi.mock("../web-access/service", () => ({
	searchWeb: vi.fn(),
	readPage: vi.fn(),
}));
vi.mock("../resume/service", () => ({ resumeService: resumeServiceMock }));
vi.mock("../cover-letters/service", () => ({
	coverLetterService: { getById: vi.fn() },
}));
const documentMock = {
	loadDocument: vi.fn(),
	findPosting: vi.fn(),
	documentView: vi.fn(),
	resolveEdits: vi.fn(),
};
vi.mock("./document", async (importOriginal) => ({
	// documentOf stays real: it only reads the thread's columns.
	documentOf: (await importOriginal<typeof import("./document")>()).documentOf,
	...documentMock,
}));
vi.mock("../storage/service", () => ({
	getStorageService: vi.fn(() => storageServiceMock),
	inferContentType: vi.fn(),
}));
vi.mock("./runs", () => ({
	claimActiveAgentRun: claimActiveAgentRunMock,
	clearActiveAgentRunIfCurrent: clearActiveAgentRunIfCurrentMock,
	isStaleAgentRun: vi.fn(() => false),
	reapStaleAgentRun: vi.fn(),
}));
vi.mock("./messages-persistence", () => messagesPersistenceMock);
vi.mock("./streams", () => ({
	agentStreamLifecycle: { create: vi.fn(), resume: vi.fn() },
}));
vi.mock("./tools", () => ({
	buildAgentInstructions: vi.fn(),
	buildAgentTools: vi.fn(() => ({})),
}));
vi.mock("@reactive-resume/schema/resume/default", () => ({
	defaultResumeData: {},
}));
vi.mock("@reactive-resume/utils/string", () => ({
	generateId: () => "test-id",
}));
vi.mock("@orpc/server", () => ({ streamToEventIterator: vi.fn() }));

beforeEach(() => {
	cancellationRedisMock.get.mockReset().mockResolvedValue(null);
	cancellationRedisMock.set.mockReset().mockResolvedValue("OK");
	cancellationRedisMock.exists.mockReset().mockResolvedValue(1);
	for (const mock of Object.values(dbMock)) mock.mockReset();
	dbMock.transaction.mockImplementation(async <T>(callback: (tx: typeof dbMock) => Promise<T>) => callback(dbMock));
	clearActiveAgentRunIfCurrentMock.mockReset();
	claimActiveAgentRunMock.mockReset();
	for (const mock of Object.values(messagesPersistenceMock)) mock.mockReset();
	messagesPersistenceMock.applyStepToUiMessage.mockImplementation((message: unknown) => message);
	messagesPersistenceMock.insertDraftAssistantMessage.mockResolvedValue({
		rowId: "draft-row-1",
		sequence: 1,
	});
	messagesPersistenceMock.upsertAssistantUiMessage.mockResolvedValue({
		rowId: "draft-row-1",
	});
	messagesPersistenceMock.deleteDraftIfEmpty.mockResolvedValue(undefined);
	messagesPersistenceMock.withAccumulatedUsageMetadata.mockImplementation((_previous: unknown, next: unknown) => next);
	messagesPersistenceMock.nextMessageSequence.mockResolvedValue(1);
	messagesPersistenceMock.findUserMessageRow.mockResolvedValue(null);
	for (const mock of Object.values(storageServiceMock)) mock.mockReset();
	for (const mock of Object.values(resumeServiceMock)) mock.mockReset();
	for (const mock of Object.values(aiProvidersServiceMock)) mock.mockReset();
	for (const mock of Object.values(documentMock)) mock.mockReset();
	documentMock.loadDocument.mockResolvedValue({
		kind: "resume",
		name: "Resume",
		locked: false,
		applicationId: null,
	});
	documentMock.findPosting.mockResolvedValue(null);
});

afterEach(() => vi.useRealTimers());

function buildArchivedThread(overrides: Record<string, unknown> = {}) {
	return {
		id: "thread-1",
		userId: "user-1",
		aiProviderId: "provider-1",
		workingResumeId: "resume-1",
		sourceResumeId: null,
		coverLetterId: null,
		editsProposed: 0,
		editsAccepted: 0,
		title: "Archived thread",
		status: "archived",
		reviewPatches: false,
		activeRunId: null,
		activeStreamId: null,
		activeRunStartedAt: null,
		lastMessageAt: new Date("2026-05-01T00:00:00.000Z"),
		archivedAt: new Date("2026-05-02T00:00:00.000Z"),
		deletedAt: null,
		createdAt: new Date("2026-04-01T00:00:00.000Z"),
		updatedAt: new Date("2026-05-02T00:00:00.000Z"),
		...overrides,
	};
}

function buildActiveThread(overrides: Record<string, unknown> = {}) {
	return buildArchivedThread({
		status: "active",
		title: "Active thread",
		activeRunId: null,
		activeStreamId: null,
		archivedAt: null,
		...overrides,
	});
}

function buildAttachment(overrides: Record<string, unknown> = {}) {
	return {
		id: "attachment-1",
		userId: "user-1",
		threadId: "thread-1",
		messageId: null,
		storageKey: "uploads/user-1/agent/thread-1/attachment-1-note.txt",
		filename: "note.txt",
		mediaType: "text/plain",
		size: 5,
		createdAt: new Date("2026-05-01T00:00:00.000Z"),
		...overrides,
	};
}

function selectLimitResult(rows: unknown[]) {
	const limit = vi.fn(async () => rows);
	const where = vi.fn(() => ({ limit }));
	const from = vi.fn(() => ({ where }));
	return { from };
}

function selectWhereResult(rows: unknown[]) {
	const where = vi.fn(async () => rows);
	const from = vi.fn(() => ({ where }));
	return { from };
}

function selectOrderByResult(rows: unknown[]) {
	const orderBy = vi.fn(async () => rows);
	const where = vi.fn(() => ({ orderBy }));
	const from = vi.fn(() => ({ where }));
	return { from };
}

describe("agentService.messages.send", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("leaves the document and the posting out when their context chips are removed", async () => {
		const persistedMessage = {
			id: "message-1",
			userId: "user-1",
			threadId: "thread-1",
			role: "user",
			status: "completed",
			sequence: 0,
			uiMessage: {
				id: "ui-message-1",
				role: "user",
				parts: [{ type: "text", text: "Hi" }],
			},
		};
		dbMock.insert.mockReturnValue({
			values: vi.fn(() => ({
				returning: vi.fn(async () => [persistedMessage]),
			})),
		});
		dbMock.update.mockReturnValue({
			set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
		});
		claimActiveAgentRunMock.mockResolvedValue(true);
		aiProvidersServiceMock.getRunnableById.mockResolvedValue({
			id: "provider-1",
			provider: "openai-compatible",
			model: "stub",
			apiKey: "secret",
			baseURL: "http://127.0.0.1:1/v1",
		});

		const [{ convertToModelMessages, ToolLoopAgent }, { agentStreamLifecycle }] = await Promise.all([
			import("ai"),
			import("./streams"),
		]);
		vi.mocked(convertToModelMessages).mockResolvedValue([{ role: "user", content: [{ type: "text", text: "Hi" }] }]);
		class MockToolLoopAgent {
			stream = vi.fn(async () => ({
				toUIMessageStream: vi.fn(() => new ReadableStream()),
			}));
		}
		vi.mocked(ToolLoopAgent).mockImplementation(MockToolLoopAgent as never);
		vi.mocked(agentStreamLifecycle.create).mockResolvedValue(new ReadableStream());
		vi.mocked(streamToEventIterator).mockReturnValue("iterator" as never);

		const { agentService } = await import("./service");
		const send = async (context?: { document: boolean; posting: boolean }) => {
			const privateHistory = {
				...persistedMessage,
				id: "old-message",
				role: "assistant",
				uiMessage: {
					id: "old-ui-message",
					role: "assistant",
					parts: [
						{ type: "text", text: "Your email is private-marker@example.test" },
						{
							type: "tool-read_resume",
							toolCallId: "read-1",
							state: "output-available",
							input: {},
							output: { data: { email: "private-marker@example.test" } },
						},
					],
				},
			};
			dbMock.select
				.mockImplementationOnce(() => selectLimitResult([buildActiveThread()]))
				.mockImplementationOnce(() => selectWhereResult([{ total: 1 }]))
				.mockImplementationOnce(() => selectOrderByResult([privateHistory, persistedMessage]));
			await agentService.messages.send({
				threadId: "thread-1",
				userId: "user-1",
				message: {
					id: "ui-message-1",
					role: "user",
					parts: [{ type: "text", text: "Hi" }],
					// oxlint-disable-next-line typescript/no-explicit-any -- minimal fixture for unit test
				} as any,
				...(context ? { context } : {}),
			});
		};

		const { buildAgentInstructions, buildAgentTools } = await import("./tools");

		await send();
		expect(JSON.stringify(vi.mocked(convertToModelMessages).mock.calls.at(-1)?.[0])).toContain(
			"private-marker@example.test",
		);
		expect(vi.mocked(buildAgentTools).mock.calls[0]?.[0]).toMatchObject({
			document: "resume",
		});
		expect(vi.mocked(buildAgentInstructions).mock.calls[0]?.[0]).toMatchObject({
			document: { kind: "resume" },
		});
		expect(documentMock.findPosting).toHaveBeenCalledTimes(1);

		await send({ document: false, posting: false });
		expect(vi.mocked(convertToModelMessages).mock.calls.at(-1)?.[0]).toEqual([persistedMessage.uiMessage]);
		expect(vi.mocked(buildAgentTools).mock.calls[1]?.[0]).toMatchObject({
			document: null,
		});
		expect(vi.mocked(buildAgentInstructions).mock.calls[1]?.[0]).toMatchObject({
			document: null,
			posting: null,
		});
		expect(documentMock.findPosting).toHaveBeenCalledTimes(1);
	});

	it("persists canonical attachment UI parts, links selected attachments, and appends server-read model parts", async () => {
		const activeThread = buildActiveThread();
		const attachment = buildAttachment({
			filename: "canonical.txt",
			mediaType: "text/plain",
			size: 5,
		});
		const persistedMessage = {
			id: "message-1",
			userId: "user-1",
			threadId: "thread-1",
			role: "user",
			status: "completed",
			sequence: 0,
			uiMessage: {
				id: "ui-message-1",
				role: "user",
				parts: [
					{ type: "text", text: "Use this file" },
					{
						type: "file",
						url: "agent-attachment:attachment-1",
						mediaType: "text/plain",
						filename: "canonical.txt",
					},
				],
			},
		};
		const insertValues: unknown[] = [];
		const updateSets: unknown[] = [];

		dbMock.select
			.mockImplementationOnce(() => selectLimitResult([activeThread]))
			.mockImplementationOnce(() => selectWhereResult([attachment]))
			.mockImplementationOnce(() => selectWhereResult([{ total: 1 }]))
			.mockImplementationOnce(() => selectOrderByResult([persistedMessage]));

		dbMock.insert.mockReturnValue({
			values: vi.fn((value) => {
				insertValues.push(value);
				return { returning: vi.fn(async () => [persistedMessage]) };
			}),
		});
		dbMock.update.mockImplementation(() => ({
			set: vi.fn((value) => {
				updateSets.push(value);
				return {
					where: vi.fn(() => ({
						returning: vi.fn(async () => [{ id: "attachment-1" }]),
					})),
				};
			}),
		}));

		claimActiveAgentRunMock.mockResolvedValue(true);
		aiProvidersServiceMock.getRunnableById.mockResolvedValue({
			id: "provider-1",
			provider: "openai",
			model: "gpt-5",
			apiKey: "secret",
			baseURL: null,
		});
		aiProvidersServiceMock.markUsed.mockResolvedValue(undefined);
		storageServiceMock.read.mockResolvedValue({
			data: new TextEncoder().encode("hello"),
			contentType: "text/plain",
		});

		const [{ convertToModelMessages, ToolLoopAgent }, { agentStreamLifecycle }] = await Promise.all([
			import("ai"),
			import("./streams"),
		]);
		const streamMock = vi.fn(async () => ({
			toUIMessageStream: vi.fn(() => new ReadableStream()),
		}));
		vi.mocked(convertToModelMessages).mockResolvedValue([
			{ role: "user", content: [{ type: "text", text: "Use this file" }] },
		]);
		class MockToolLoopAgent {
			stream = streamMock;
		}
		vi.mocked(ToolLoopAgent).mockImplementation(MockToolLoopAgent as never);
		vi.mocked(agentStreamLifecycle.create).mockResolvedValue(new ReadableStream());
		vi.mocked(streamToEventIterator).mockReturnValue("iterator" as never);

		const { agentService } = await import("./service");

		await agentService.messages.send({
			threadId: "thread-1",
			userId: "user-1",
			message: {
				id: "ui-message-1",
				role: "user",
				parts: [
					{ type: "text", text: "Use this file" },
					{
						type: "file",
						url: "agent-attachment:attachment-1",
						mediaType: "application/octet-stream",
						filename: "forged-name.bin",
					},
				],
				// oxlint-disable-next-line typescript/no-explicit-any -- minimal fixture for unit test
			} as any,
			attachmentIds: ["attachment-1"],
		});

		expect(insertValues).toEqual([
			expect.objectContaining({
				uiMessage: expect.objectContaining({
					parts: [
						{ type: "text", text: "Use this file" },
						{
							type: "file",
							url: "agent-attachment:attachment-1",
							mediaType: "text/plain",
							filename: "canonical.txt",
						},
					],
				}),
			}),
		]);
		expect(updateSets).toContainEqual({ messageId: "message-1" });
		expect(streamMock).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "Use this file" },
							expect.objectContaining({
								type: "text",
								text: expect.stringContaining("hello"),
							}),
						],
					},
				],
			}),
		);
	});

	// Regression (defect 8): a question continuation streams into the SAME uiMessage id; onFinish
	// must upsert the existing assistant row instead of inserting a duplicate row.
	it.each([
		{ provider: "openai", model: "gpt-5" },
		{ provider: "gemini", model: "gemini-3.8-flash" },
	])("continues one row and replays portable web evidence with correct $provider metadata", async (provider) => {
		const activeThread = buildActiveThread();
		const userMessage = {
			id: "message-user-1",
			userId: "user-1",
			threadId: "thread-1",
			role: "user",
			status: "completed",
			sequence: 0,
			uiMessage: {
				id: "ui-user-1",
				role: "user",
				parts: [{ type: "text", text: "Change the name" }],
			},
		};
		const question = {
			question: "How broadly should I rename?",
			choices: ["Only the header"],
		};
		const unansweredAssistantMessage = {
			id: "message-assistant-1",
			userId: "user-1",
			threadId: "thread-1",
			role: "assistant",
			status: "completed",
			sequence: 1,
			uiMessage: {
				id: "ui-assistant-1",
				role: "assistant",
				metadata: { provider: "gemini", model: "gemini-3.8-flash" },
				parts: [
					{
						type: "tool-ask_user_question",
						toolCallId: "call-1",
						state: "input-available",
						input: question,
						...(provider.provider === "gemini"
							? {
									callProviderMetadata: {
										google: { thoughtSignature: "opaque-signature" },
									},
								}
							: {}),
					},
				],
			},
		};
		const answeredAssistantModelInput = {
			...unansweredAssistantMessage.uiMessage,
			metadata: { provider: "gemini", model: "gemini-3.8-flash" },
			parts: [
				{
					type: "tool-ask_user_question",
					toolCallId: "call-1",
					state: "output-available",
					input: question,
					output: "Only the header",
					...(provider.provider === "gemini"
						? {
								callProviderMetadata: {
									google: { thoughtSignature: "opaque-signature" },
								},
							}
						: {}),
				},
			],
		};
		const answeredAssistantMessage = {
			...unansweredAssistantMessage,
			uiMessage: {
				...answeredAssistantModelInput,
				parts: answeredAssistantModelInput.parts.map((part) => ({
					...part,
					callProviderMetadata: { openai: { itemId: "fc_duplicate_item" } },
					...(provider.provider === "gemini"
						? {
								callProviderMetadata: {
									openai: { itemId: "fc_duplicate_item" },
									google: { thoughtSignature: "opaque-signature" },
								},
							}
						: {}),
					resultProviderMetadata: { openai: { itemId: "fc_duplicate_item" } },
				})),
			},
		};
		const earlierNative = {
			...unansweredAssistantMessage,
			id: "native-history",
			sequence: 0.5,
			uiMessage: {
				id: "native-history",
				role: "assistant",
				parts: [
					{
						type: "tool-web_search",
						toolCallId: "native",
						state: "output-available",
						input: {},
						output: { encryptedContent: "provider-owned-payload" },
						callProviderMetadata: { openai: { itemId: "ws_old" } },
					},
					{
						type: "source-url",
						sourceId: "source",
						url: "https://company.example/job",
						title: "Role",
					},
				],
			},
		};
		const updateSets: unknown[] = [];

		dbMock.select
			.mockImplementationOnce(() => selectLimitResult([activeThread]))
			.mockImplementationOnce(() => selectOrderByResult([userMessage, earlierNative, unansweredAssistantMessage]))
			.mockImplementationOnce(() => selectOrderByResult([userMessage, earlierNative, answeredAssistantMessage]));
		dbMock.update.mockImplementation(() => ({
			set: vi.fn((value) => {
				updateSets.push(value);
				return { where: vi.fn(async () => undefined) };
			}),
		}));

		claimActiveAgentRunMock.mockResolvedValue(true);
		aiProvidersServiceMock.getRunnableById.mockResolvedValue({
			id: "provider-1",
			...provider,
			apiKey: "secret",
			baseURL: null,
		});
		aiProvidersServiceMock.markUsed.mockResolvedValue(undefined);

		const [{ convertToModelMessages, ToolLoopAgent }, { agentStreamLifecycle }] = await Promise.all([
			import("ai"),
			import("./streams"),
		]);
		vi.mocked(convertToModelMessages).mockResolvedValue([
			{ role: "user", content: [{ type: "text", text: "Change the name" }] },
		]);

		let uiStreamOptions: Record<string, unknown> | undefined;
		class MockToolLoopAgent {
			stream = vi.fn(async () => ({
				toUIMessageStream: vi.fn((options: Record<string, unknown>) => {
					uiStreamOptions = options;
					return new ReadableStream();
				}),
			}));
		}
		vi.mocked(ToolLoopAgent).mockImplementation(MockToolLoopAgent as never);
		vi.mocked(agentStreamLifecycle.create).mockImplementation((_streamId, makeStream) => {
			(makeStream as () => unknown)();
			return Promise.resolve(new ReadableStream());
		});
		vi.mocked(streamToEventIterator).mockReturnValue("iterator" as never);

		const { agentService } = await import("./service");

		await agentService.messages.send({
			threadId: "thread-1",
			userId: "user-1",
			// oxlint-disable-next-line typescript/no-explicit-any -- minimal fixture for unit test
			message: answeredAssistantModelInput as any,
		});

		expect(updateSets).toContainEqual(expect.objectContaining({ uiMessage: answeredAssistantModelInput }));
		expect(convertToModelMessages).toHaveBeenCalledWith([
			userMessage.uiMessage,
			expect.objectContaining({
				parts: expect.arrayContaining([
					expect.objectContaining({
						type: "text",
						text: expect.stringContaining("https://company.example/job"),
					}),
					{
						type: "source-url",
						sourceId: "source",
						url: "https://company.example/job",
						title: "Role",
					},
				]),
			}),
			answeredAssistantModelInput,
		]);
		const replayed = vi.mocked(convertToModelMessages).mock.calls.at(-1)?.[0];
		expect(JSON.stringify(replayed)).not.toContain("provider-owned-payload");
		expect(JSON.stringify(replayed)).not.toContain("ws_old");

		const onFinish = uiStreamOptions?.onFinish as (event: Record<string, unknown>) => Promise<void>;
		const continuedMessage = {
			...answeredAssistantMessage.uiMessage,
			parts: [...answeredAssistantMessage.uiMessage.parts, { type: "text", text: "Renamed the header." }],
		};
		await onFinish({
			responseMessage: continuedMessage,
			isAborted: false,
			isContinuation: true,
			messages: [],
		});

		expect(messagesPersistenceMock.insertDraftAssistantMessage).not.toHaveBeenCalled();
		expect(dbMock.insert).not.toHaveBeenCalled();
		expect(messagesPersistenceMock.upsertAssistantUiMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				rowId: "message-assistant-1",
				status: "completed",
				message: expect.objectContaining({ id: "ui-assistant-1" }),
			}),
		);
	});

	it("repairs legacy user-answer messages that followed an unresolved ask-user-question tool call", async () => {
		const activeThread = buildActiveThread();
		const firstUserMessage = {
			id: "message-user-1",
			userId: "user-1",
			threadId: "thread-1",
			role: "user",
			status: "completed",
			sequence: 0,
			uiMessage: {
				id: "ui-user-1",
				role: "user",
				parts: [{ type: "text", text: "Change the name" }],
			},
		};
		const unresolvedAssistantMessage = {
			id: "message-assistant-1",
			userId: "user-1",
			threadId: "thread-1",
			role: "assistant",
			status: "completed",
			sequence: 1,
			uiMessage: {
				id: "ui-assistant-1",
				role: "assistant",
				parts: [
					{
						type: "tool-ask_user_question",
						toolCallId: "call-legacy",
						state: "input-available",
						input: {
							question: "How broadly should I rename?",
							choices: ["Only change the main resume header name"],
						},
					},
				],
			},
		};
		const legacyAnswerMessage = {
			id: "message-user-2",
			userId: "user-1",
			threadId: "thread-1",
			role: "user",
			status: "completed",
			sequence: 2,
			uiMessage: {
				id: "ui-user-2",
				role: "user",
				parts: [{ type: "text", text: "Only change the main resume header name" }],
			},
		};
		const retryMessage = {
			id: "message-user-3",
			userId: "user-1",
			threadId: "thread-1",
			role: "user",
			status: "completed",
			sequence: 3,
			uiMessage: {
				id: "ui-user-3",
				role: "user",
				parts: [{ type: "text", text: "Retry" }],
			},
		};
		const updateSets: unknown[] = [];

		dbMock.select
			.mockImplementationOnce(() => selectLimitResult([activeThread]))
			.mockImplementationOnce(() => selectWhereResult([{ total: 4 }]))
			.mockImplementationOnce(() =>
				selectOrderByResult([firstUserMessage, unresolvedAssistantMessage, legacyAnswerMessage, retryMessage]),
			);

		dbMock.insert.mockReturnValue({
			values: vi.fn(() => ({ returning: vi.fn(async () => [retryMessage]) })),
		});
		dbMock.update.mockImplementation(() => ({
			set: vi.fn((value) => {
				updateSets.push(value);
				return { where: vi.fn(async () => undefined) };
			}),
		}));

		claimActiveAgentRunMock.mockResolvedValue(true);
		aiProvidersServiceMock.getRunnableById.mockResolvedValue({
			id: "provider-1",
			provider: "openai",
			model: "gpt-5",
			apiKey: "secret",
			baseURL: null,
		});
		aiProvidersServiceMock.markUsed.mockResolvedValue(undefined);

		const [{ convertToModelMessages, ToolLoopAgent }, { agentStreamLifecycle }] = await Promise.all([
			import("ai"),
			import("./streams"),
		]);
		vi.mocked(convertToModelMessages).mockResolvedValue([{ role: "user", content: [{ type: "text", text: "Retry" }] }]);
		class MockToolLoopAgent {
			stream = vi.fn(async () => ({
				toUIMessageStream: vi.fn(() => new ReadableStream()),
			}));
		}
		vi.mocked(ToolLoopAgent).mockImplementation(MockToolLoopAgent as never);
		vi.mocked(agentStreamLifecycle.create).mockResolvedValue(new ReadableStream());
		vi.mocked(streamToEventIterator).mockReturnValue("iterator" as never);

		const { agentService } = await import("./service");

		await agentService.messages.send({
			threadId: "thread-1",
			userId: "user-1",
			// oxlint-disable-next-line typescript/no-explicit-any -- minimal fixture for unit test
			message: retryMessage.uiMessage as any,
		});

		expect(updateSets).toContainEqual(
			expect.objectContaining({
				uiMessage: expect.objectContaining({
					parts: [
						expect.objectContaining({
							type: "tool-ask_user_question",
							toolCallId: "call-legacy",
							state: "output-available",
							output: "Only change the main resume header name",
						}),
					],
				}),
			}),
		);
		expect(convertToModelMessages).toHaveBeenCalledWith([
			firstUserMessage.uiMessage,
			expect.objectContaining({
				parts: [
					expect.objectContaining({
						toolCallId: "call-legacy",
						state: "output-available",
						output: "Only change the main resume header name",
					}),
				],
			}),
			legacyAnswerMessage.uiMessage,
			retryMessage.uiMessage,
		]);
	});

	it("rejects malformed UI message parts before claiming a run", async () => {
		dbMock.select.mockImplementationOnce(() => selectLimitResult([buildActiveThread()]));
		aiProvidersServiceMock.getRunnableById.mockResolvedValue({
			id: "provider-1",
			provider: "openai",
			model: "gpt-5",
			apiKey: "secret",
			baseURL: null,
		});

		const { agentService } = await import("./service");

		const sending = agentService.messages.send({
			threadId: "thread-1",
			userId: "user-1",
			message: {
				id: "ui-message-1",
				role: "user",
				parts: [{ type: "text" }],
				// oxlint-disable-next-line typescript/no-explicit-any -- malformed fixture on purpose
			} as any,
		});

		await expect(sending).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "Invalid UI message parts.",
		});
		expect(claimActiveAgentRunMock).not.toHaveBeenCalled();
		expect(dbMock.insert).not.toHaveBeenCalled();
	});
});

describe("agentService.attachments.create", () => {
	const input = {
		userId: "user-1",
		threadId: "thread-1",
		filename: "notes.txt",
		mediaType: "text/plain",
		data: new Uint8Array([1]),
	};

	it.each([
		{ total: 4, totalBytes: 90 * 1024 * 1024, uploadBytes: 6 * 1024 * 1024 },
		{ total: 9, totalBytes: 0, uploadBytes: 1 },
	])("serializes competing uploads before checking quota %o", async (initial) => {
		let total = initial.total;
		let totalBytes = initial.totalBytes;
		let lock = Promise.resolve();
		const quotaRead = vi.fn();
		const lockModes: string[] = [];
		// Each transaction gets a distinct builder; only FOR UPDATE acquires this simulated row lock.
		// Removing the lock (or moving quota reads before it) lets both uploads through and fails the test.
		dbMock.transaction.mockImplementation(async (callback) => {
			let release = () => {};
			const rows = [{ id: input.threadId }];
			const lockQuery = Object.assign(Promise.resolve(rows), {
				for: async (mode: string) => {
					lockModes.push(mode);
					const previous = lock;
					const next = Promise.withResolvers<void>();
					lock = next.promise;
					release = next.resolve;
					await previous;
					return rows;
				},
			});
			const tx = {
				select: vi
					.fn()
					.mockImplementationOnce(() => ({
						from: () => ({ where: () => lockQuery }),
					}))
					.mockImplementation(() => {
						quotaRead();
						return selectWhereResult([{ total, totalBytes: String(totalBytes) }]);
					}),
				insert: vi.fn(() => ({
					values: (value: { size: number }) => ({
						returning: () => {
							total++;
							totalBytes += value.size;
							return Promise.resolve([{ ...value, createdAt: new Date() }]);
						},
					}),
				})),
			};
			try {
				return await callback(tx as never);
			} finally {
				release();
			}
		});
		const storageWrite = Promise.withResolvers<void>();
		storageServiceMock.write.mockReturnValue(storageWrite.promise);
		const { agentService } = await import("./service");
		const upload = { ...input, data: new Uint8Array(initial.uploadBytes) };
		const results = Promise.allSettled([
			agentService.attachments.create(upload),
			agentService.attachments.create(upload),
		]);
		await vi.waitFor(() => expect(storageServiceMock.write).toHaveBeenCalledTimes(1));
		// The first upload's two quota reads (unsent count, thread bytes); the second waits on the lock.
		expect(quotaRead).toHaveBeenCalledTimes(2);
		storageWrite.resolve();
		const settled = await results;
		expect(settled[0]?.status).toBe("fulfilled");
		expect(settled[1]).toMatchObject({
			status: "rejected",
			reason: { code: "BAD_REQUEST" },
		});
		expect(lockModes).toEqual(["update", "update"]);
		expect(storageServiceMock.write).toHaveBeenCalledTimes(1);
		expect(storageServiceMock.delete).not.toHaveBeenCalled();
	});

	it("counts only unsent attachments toward the per-message limit", async () => {
		// Ten files already went out with earlier messages; none is waiting to be sent.
		const rows = Array.from({ length: 10 }, (_, index) => ({
			"agent_attachments.thread_id": input.threadId,
			"agent_attachments.user_id": input.userId,
			"agent_attachments.message_id": `message-${index}`,
		}));
		type Condition = {
			type: string;
			conditions?: Condition[];
			left?: string;
			right?: unknown;
			value?: string;
		};
		// Evaluates the mocked drizzle conditions, so each count follows the query's own filter.
		const matches = (row: Record<string, unknown>, condition: Condition): boolean =>
			condition.type === "and"
				? (condition.conditions ?? []).every((part) => matches(row, part))
				: condition.type === "isNull"
					? row[condition.value ?? ""] == null
					: row[condition.left ?? ""] === condition.right;
		dbMock.select
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({ for: async () => [{ id: input.threadId }] }),
				}),
			})
			.mockImplementation((columns: Record<string, { type: string }>) => ({
				from: () => ({
					where: (condition: Condition) => {
						const count = rows.filter((row) => matches(row, condition)).length;
						return Promise.resolve([
							Object.fromEntries(Object.entries(columns).map(([key, { type }]) => [key, type === "count" ? count : 0])),
						]);
					},
				}),
			}));
		dbMock.insert.mockReturnValue({
			values: (value: object) => ({
				returning: async () => [{ ...value, createdAt: new Date() }],
			}),
		});
		const { agentService } = await import("./service");

		await expect(agentService.attachments.create(input)).resolves.toMatchObject({ filename: input.filename });
	});
});

describe("agentService.messages.stop", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// Regression: stop() must abort the run with an AbortError. A bare-string abort reason is not
	// recognized by the AI SDK as a cancellation, so its rejection escapes the background stream
	// pump and crashes the whole process with ERR_UNHANDLED_REJECTION.
	it.each(["complete", "stop", "timeout"])(
		"streams and persists output after %s, then releases the run",
		async (action) => {
			vi.useFakeTimers();
			const activeThread = buildActiveThread();
			const persistedMessage = {
				id: "message-1",
				userId: "user-1",
				threadId: "thread-1",
				role: "user",
				status: "completed",
				sequence: 0,
				uiMessage: {
					id: "ui-message-1",
					role: "user",
					parts: [{ type: "text", text: "hi" }],
				},
			};

			dbMock.select
				// send(): getThread, next sequence, message count, thread messages
				.mockImplementationOnce(() => selectLimitResult([activeThread]))
				.mockImplementationOnce(() => selectWhereResult([{ total: 1 }]))
				.mockImplementationOnce(() => selectOrderByResult([persistedMessage]))
				// stop(): getThread now reports the active run registered by send() (generateId() -> "test-id")
				.mockImplementationOnce(() =>
					selectLimitResult([
						buildActiveThread({
							activeRunId: "test-id",
							activeStreamId: "test-id",
						}),
					]),
				);

			dbMock.insert.mockReturnValue({
				values: vi.fn(() => ({
					returning: vi.fn(async () => [persistedMessage]),
				})),
			});
			dbMock.update.mockReturnValue({
				set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
			});

			claimActiveAgentRunMock.mockResolvedValue(true);
			clearActiveAgentRunIfCurrentMock.mockResolvedValue(undefined);
			aiProvidersServiceMock.getRunnableById.mockResolvedValue({
				id: "provider-1",
				provider: "openai",
				model: "gpt-5",
				apiKey: "secret",
				baseURL: null,
			});
			aiProvidersServiceMock.markUsed.mockResolvedValue(undefined);

			const [{ convertToModelMessages, ToolLoopAgent }, { agentStreamLifecycle }] = await Promise.all([
				import("ai"),
				import("./streams"),
			]);
			vi.mocked(convertToModelMessages).mockResolvedValue([{ role: "user", content: [{ type: "text", text: "hi" }] }]);

			let capturedSignal: AbortSignal | undefined;
			let onFinish: ((event: { responseMessage: UIMessage; isAborted: boolean }) => Promise<void>) | undefined;
			let source: ReadableStreamDefaultController<UIMessageChunk> | undefined;
			let streamDone: Promise<void> | undefined;
			const chunks: UIMessageChunk[] = [];
			const originalChunks: UIMessageChunk[] = [
				{ type: "start", messageId: "assistant-1" },
				{ type: "text-start", id: "answer" },
				{ type: "text-delta", id: "answer", delta: "Saved answer" },
				{ type: "text-end", id: "answer" },
			];
			class MockToolLoopAgent {
				stream = vi.fn(({ abortSignal }: { abortSignal: AbortSignal }) => {
					capturedSignal = abortSignal;
					return {
						toUIMessageStream: vi.fn((options: { onFinish: typeof onFinish }) => {
							onFinish = options.onFinish;
							return new ReadableStream<UIMessageChunk>({
								start(controller) {
									source = controller;
									for (const chunk of originalChunks) controller.enqueue(chunk);
								},
							});
						}),
					};
				});
			}
			vi.mocked(ToolLoopAgent).mockImplementation(MockToolLoopAgent as never);
			vi.mocked(agentStreamLifecycle.create).mockImplementation((_id, makeStream) => {
				const reader = makeStream().getReader();
				streamDone = (async () => {
					while (true) {
						const { value, done } = await reader.read();
						if (done) return;
						chunks.push(value);
					}
				})();
				return Promise.resolve(new ReadableStream<string>());
			});
			vi.mocked(streamToEventIterator).mockReturnValue("iterator" as never);

			const { agentService } = await import("./service");

			await agentService.messages.send({
				threadId: "thread-1",
				userId: "user-1",
				message: {
					id: "ui-message-1",
					role: "user",
					parts: [{ type: "text", text: "hi" }],
					// oxlint-disable-next-line typescript/no-explicit-any -- minimal fixture for unit test
				} as any,
			});

			expect(capturedSignal).toBeDefined();
			expect(capturedSignal?.aborted).toBe(false);

			if (action === "stop") {
				await agentService.messages.stop({
					userId: "user-1",
					threadId: "thread-1",
				});
			} else if (action === "timeout") {
				await vi.advanceTimersByTimeAsync(239_999);
				expect(capturedSignal?.aborted).toBe(false);
				await vi.advanceTimersByTimeAsync(1);
			}

			expect(capturedSignal?.aborted).toBe(action !== "complete");
			if (action !== "complete") {
				const reason = capturedSignal?.reason as Error;
				expect(reason).toBeInstanceOf(Error);
				expect(reason.name).toBe("AbortError");
				expect(reason.message).toBe(action === "stop" ? "USER_STOPPED" : "RUN_TIMEOUT");
			}
			const finalChunk: UIMessageChunk = {
				type: action === "complete" ? "finish" : "abort",
			};
			source?.enqueue(finalChunk);
			source?.close();
			await streamDone;
			expect(chunks).toEqual([
				...originalChunks,
				...(action === "timeout"
					? [
							{ type: "text-start", id: "timeout-test-id" },
							{
								type: "text-delta",
								id: "timeout-test-id",
								delta: "Time limit reached. Your progress is saved. Ask me to continue.",
							},
							{ type: "text-end", id: "timeout-test-id" },
						]
					: []),
				finalChunk,
			]);
			expect(clearActiveAgentRunIfCurrentMock).not.toHaveBeenCalled();
			expect(onFinish).toBeDefined();
			await onFinish?.({
				responseMessage: {
					id: "assistant-1",
					role: "assistant",
					parts: [{ type: "text", text: "Saved answer" }],
				},
				isAborted: action !== "complete",
			});
			expect(messagesPersistenceMock.upsertAssistantUiMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					status: action === "complete" ? "completed" : "canceled",
					message: expect.objectContaining({
						parts: expect.arrayContaining([
							{ type: "text", text: "Saved answer" },
							...(action === "timeout"
								? [
										{
											type: "text",
											text: "Time limit reached. Your progress is saved. Ask me to continue.",
										},
									]
								: []),
						]),
					}),
				}),
			);
			expect(clearActiveAgentRunIfCurrentMock).toHaveBeenCalledAfter(messagesPersistenceMock.upsertAssistantUiMessage);
		},
	);

	it("signals a remote run without releasing its database claim", async () => {
		dbMock.select.mockImplementation(() => selectLimitResult([buildActiveThread({ activeRunId: "remote-run" })]));
		vi.mocked((await import("./runs")).reapStaleAgentRun).mockClear();
		const { agentService } = await import("./service");
		await agentService.messages.stop({
			userId: "user-1",
			threadId: "thread-1",
		});
		expect(cancellationRedisMock.set).toHaveBeenCalledWith(
			"test:agent-cancellation:remote-run",
			"USER_STOPPED",
			"PX",
			900_000,
		);
		expect(clearActiveAgentRunIfCurrentMock).not.toHaveBeenCalled();
		expect(vi.mocked((await import("./runs")).reapStaleAgentRun)).not.toHaveBeenCalled();
	});
});

describe("agentService.threads.delete", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("proceeds with cleanup when the thread is owned by the user", async () => {
		const ownedThread = buildArchivedThread({
			id: "thread-own",
			userId: "user-own",
			status: "active",
			activeRunId: null,
			activeStreamId: null,
			archivedAt: null,
		});

		dbMock.select.mockImplementation(() => {
			const limit = vi.fn(async () => [ownedThread]);
			const where = vi.fn(() => ({ limit }));
			const from = vi.fn(() => ({ where }));
			return { from };
		});

		const deleteWhere = vi.fn(async () => undefined);
		dbMock.delete.mockReturnValue({ where: deleteWhere });

		const updateWhere = vi.fn(() => ({
			returning: vi.fn(async () => [{ activeRunId: "delete-run" }]),
		}));
		const updateSet = vi.fn(() => ({ where: updateWhere }));
		dbMock.update.mockReturnValue({ set: updateSet });

		storageServiceMock.delete.mockResolvedValue(undefined);

		const { agentService } = await import("./service");

		await agentService.threads.delete({ id: "thread-own", userId: "user-own" });

		expect(cancellationRedisMock.set).toHaveBeenCalledWith(
			"test:agent-cancellation:delete-run",
			"USER_DELETED",
			"PX",
			900_000,
		);
		expect(cancellationRedisMock.set).toHaveBeenCalledAfter(updateSet);
		expect(clearActiveAgentRunIfCurrentMock).not.toHaveBeenCalled();
		expect(dbMock.delete).toHaveBeenCalledBefore(storageServiceMock.delete as never);
		expect(updateSet).toHaveBeenCalledBefore(storageServiceMock.delete as never);
		expect(storageServiceMock.delete).toHaveBeenCalledWith("uploads/user-own/agent/thread-own");
		expect(dbMock.delete).toHaveBeenCalled();
		expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "deleted" }));
	});
});
