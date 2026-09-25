import type { UIMessage, UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORPCError } from "@orpc/client";

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
	notifyResumePatched: vi.fn(),
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
	resume: { name: "resume.name", id: "resume.id", userId: "resume.user_id", slug: "resume.slug" },
	aiProvider: { label: "ai_provider.label", id: "ai_provider.id" },
}));

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ type: "and", conditions }),
	asc: (value: unknown) => ({ type: "asc", value }),
	count: () => ({ type: "count" }),
	desc: (value: unknown) => ({ type: "desc", value }),
	eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
	gte: (left: unknown, right: unknown) => ({ type: "gte", left, right }),
	inArray: (left: unknown, values: unknown[]) => ({ type: "inArray", left, values }),
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
vi.mock("../ai/credentials", () => ({
	assertAgentEnvironment: vi.fn(),
	getAgentToolApprovalSecret: vi.fn(() => "test-approval-secret"),
}));
vi.mock("../ai-providers/service", () => ({ aiProvidersService: aiProvidersServiceMock }));
vi.mock("../resume/service", () => ({ resumeService: resumeServiceMock }));
vi.mock("../storage/service", () => ({
	getStorageService: vi.fn(() => storageServiceMock),
	inferContentType: vi.fn(),
}));
vi.mock("./resume", () => ({
	buildAgentDraftResumeName: vi.fn(),
	buildUniqueAgentDraftSlug: vi.fn(),
	normalizeAgentResumePatchOperations: vi.fn((_data, operations) => operations),
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
vi.mock("@reactive-resume/schema/resume/default", () => ({ defaultResumeData: {} }));
vi.mock("@reactive-resume/utils/string", () => ({ generateId: () => "test-id" }));
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
	messagesPersistenceMock.insertDraftAssistantMessage.mockResolvedValue({ rowId: "draft-row-1", sequence: 1 });
	messagesPersistenceMock.upsertAssistantUiMessage.mockResolvedValue({ rowId: "draft-row-1" });
	messagesPersistenceMock.deleteDraftIfEmpty.mockResolvedValue(undefined);
	messagesPersistenceMock.withAccumulatedUsageMetadata.mockImplementation((_previous: unknown, next: unknown) => next);
	messagesPersistenceMock.nextMessageSequence.mockResolvedValue(1);
	for (const mock of Object.values(storageServiceMock)) mock.mockReset();
	for (const mock of Object.values(resumeServiceMock)) mock.mockReset();
	for (const mock of Object.values(aiProvidersServiceMock)) mock.mockReset();
});

afterEach(() => vi.useRealTimers());

function buildArchivedThread(overrides: Record<string, unknown> = {}) {
	return {
		id: "thread-1",
		userId: "user-1",
		aiProviderId: "provider-1",
		workingResumeId: "resume-1",
		sourceResumeId: null,
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

function selectWhereOrderByLimitResult(rows: unknown[]) {
	const limit = vi.fn(async () => rows);
	const orderBy = vi.fn(() => ({ limit }));
	const where = vi.fn(() => ({ orderBy }));
	const from = vi.fn(() => ({ where }));
	return { from };
}

describe("agentService.threads.get", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns isReadOnly: true when the thread is archived, even if the resume and provider are present", async () => {
		const archivedThread = buildArchivedThread();

		// First select call is `getThread` (limit), then three select calls for messages/actions/attachments (orderBy).
		const threadSelect = () => {
			const limit = vi.fn(async () => [archivedThread]);
			const where = vi.fn(() => ({ limit }));
			const from = vi.fn(() => ({ where }));
			return { from };
		};
		const emptyListSelect = () => {
			const orderBy = vi.fn(async () => []);
			const where = vi.fn(() => ({ orderBy }));
			const from = vi.fn(() => ({ where }));
			return { from };
		};

		dbMock.select
			.mockImplementationOnce(threadSelect)
			.mockImplementationOnce(emptyListSelect)
			.mockImplementationOnce(emptyListSelect)
			.mockImplementationOnce(emptyListSelect);

		resumeServiceMock.getById.mockResolvedValue({
			id: "resume-1",
			name: "Resume",
			data: {},
			updatedAt: new Date(),
		});

		const { agentService } = await import("./service");

		const result = await agentService.threads.get({ id: "thread-1", userId: "user-1" });

		expect(result.isReadOnly).toBe(true);
		expect(result.thread.status).toBe("archived");
		expect(result.resume).toEqual(expect.objectContaining({ id: "resume-1" }));
	});
});

describe("buildAttachmentModelParts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("converts readable, image, supported binary, and unsupported attachments into model parts", async () => {
		const { buildAttachmentModelParts } = await import("./service");

		const imageBytes = new Uint8Array([1, 2, 3]);
		const pdfBytes = new Uint8Array([4, 5, 6]);
		const parts = buildAttachmentModelParts([
			{ attachment: buildAttachment(), data: new TextEncoder().encode("hello") },
			{
				attachment: buildAttachment({
					id: "image-1",
					filename: "photo.png",
					mediaType: "image/png",
					size: imageBytes.byteLength,
				}),
				data: imageBytes,
			},
			{
				attachment: buildAttachment({
					id: "pdf-1",
					filename: "portfolio.pdf",
					mediaType: "application/pdf",
					size: pdfBytes.byteLength,
				}),
				data: pdfBytes,
			},
			{
				attachment: buildAttachment({
					id: "zip-1",
					filename: "archive.zip",
					mediaType: "application/zip",
					size: 7,
				}),
				data: new Uint8Array([7]),
			},
		]);

		expect(parts).toEqual([
			expect.objectContaining({ type: "text", text: expect.stringContaining("hello") }),
			{ type: "image", image: imageBytes, mediaType: "image/png" },
			{ type: "file", data: pdfBytes, filename: "portfolio.pdf", mediaType: "application/pdf" },
			expect.objectContaining({ type: "text", text: expect.stringContaining("archive.zip") }),
		]);
	});
});

describe("agentService.messages.send", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("strips forged agent attachment UI parts when no attachment IDs are selected", async () => {
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
				parts: [{ type: "text", text: "Use this file" }],
			},
		};
		const insertValues: unknown[] = [];

		dbMock.select
			.mockImplementationOnce(() => selectLimitResult([activeThread]))
			.mockImplementationOnce(() => selectWhereResult([{ total: 1 }]))
			.mockImplementationOnce(() => selectOrderByResult([persistedMessage]));

		dbMock.insert.mockReturnValue({
			values: vi.fn((value) => {
				insertValues.push(value);
				return { returning: vi.fn(async () => [persistedMessage]) };
			}),
		});
		dbMock.update.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) });

		claimActiveAgentRunMock.mockResolvedValue(true);
		aiProvidersServiceMock.getRunnableById.mockResolvedValue({
			id: "provider-1",
			provider: "openai",
			model: "gpt-5",
			apiKey: "secret",
			baseURL: null,
		});
		aiProvidersServiceMock.markUsed.mockResolvedValue(undefined);

		const [{ convertToModelMessages, ToolLoopAgent }, { agentStreamLifecycle }, { streamToEventIterator }] =
			await Promise.all([import("ai"), import("./streams"), import("@orpc/server")]);
		vi.mocked(convertToModelMessages).mockResolvedValue([
			{ role: "user", content: [{ type: "text", text: "Use this file" }] },
		]);
		class MockToolLoopAgent {
			stream = vi.fn(async () => ({ toUIMessageStream: vi.fn(() => new ReadableStream()) }));
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
						url: "agent-attachment:foreign-attachment",
						mediaType: "text/plain",
						filename: "forged.txt",
					},
				],
				// biome-ignore lint/suspicious/noExplicitAny: minimal fixture for unit test
			} as any,
		});

		expect(insertValues).toEqual([
			expect.objectContaining({
				uiMessage: expect.objectContaining({
					parts: [{ type: "text", text: "Use this file" }],
				}),
			}),
		]);
	});

	it("stores snapshotData and applies a valid JSON Patch guarded by the pre-read timestamp", async () => {
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
				parts: [{ type: "text", text: "Add a custom field" }],
			},
		};

		dbMock.select
			.mockImplementationOnce(() => selectLimitResult([activeThread]))
			.mockImplementationOnce(() => selectWhereResult([{ total: 1 }]))
			.mockImplementationOnce(() => selectOrderByResult([persistedMessage]));

		dbMock.insert.mockReturnValue({
			values: vi.fn(() => ({ returning: vi.fn(async () => [persistedMessage]) })),
		});
		dbMock.update.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) });

		claimActiveAgentRunMock.mockResolvedValue(true);
		aiProvidersServiceMock.getRunnableById.mockResolvedValue({
			id: "provider-1",
			provider: "openai",
			model: "gpt-5",
			apiKey: "secret",
			baseURL: null,
		});
		aiProvidersServiceMock.markUsed.mockResolvedValue(undefined);

		const [
			{ convertToModelMessages, ToolLoopAgent },
			{ agentStreamLifecycle },
			{ buildAgentTools },
			{ streamToEventIterator },
		] = await Promise.all([import("ai"), import("./streams"), import("./tools"), import("@orpc/server")]);
		vi.mocked(convertToModelMessages).mockResolvedValue([
			{ role: "user", content: [{ type: "text", text: "Add a custom field" }] },
		]);
		class MockToolLoopAgent {
			stream = vi.fn(async () => ({ toUIMessageStream: vi.fn(() => new ReadableStream()) }));
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
				parts: [{ type: "text", text: "Add a custom field" }],
				// biome-ignore lint/suspicious/noExplicitAny: minimal fixture for unit test
			} as any,
		});

		const beforeData = { basics: { customFields: [] } };
		const beforeUpdatedAt = new Date("2026-05-01T00:00:00.000Z");
		const patchedUpdatedAt = new Date("2026-05-02T00:00:00.000Z");
		const operations = [
			{ op: "add", path: "/basics/customFields/-", value: { id: "field-1", icon: "phosphor", text: "x", link: "" } },
		];
		const insertValues: unknown[] = [];

		const patchedData = { basics: { customFields: [{ id: "field-1" }] } };
		resumeServiceMock.getById.mockResolvedValue({ data: beforeData, updatedAt: beforeUpdatedAt });
		resumeServiceMock.patchInTransaction.mockResolvedValue({
			id: "resume-1",
			updatedAt: patchedUpdatedAt,
			data: patchedData,
		});
		dbMock.insert.mockReturnValue({
			values: vi.fn((value) => {
				insertValues.push(value);
				return {
					returning: vi.fn(async () => [
						{
							id: "action-1",
							...value,
							messageId: null,
							revertedAt: null,
							revertMessage: null,
							createdAt: patchedUpdatedAt,
							updatedAt: patchedUpdatedAt,
						},
					]),
				};
			}),
		});

		const toolConfig = vi.mocked(buildAgentTools).mock.calls.at(-1)?.[0];
		// biome-ignore lint/suspicious/noExplicitAny: captured mocked tool config has intentionally loose handler types
		const result = await (toolConfig as any).handlers.applyResumePatch({ title: "Append field", operations });

		expect(resumeServiceMock.patchInTransaction).toHaveBeenCalledWith(dbMock, {
			id: "resume-1",
			userId: "user-1",
			operations,
			expectedUpdatedAt: beforeUpdatedAt,
		});
		expect(insertValues).toContainEqual(
			expect.objectContaining({
				operations,
				snapshotData: beforeData,
				baseUpdatedAt: beforeUpdatedAt,
				appliedUpdatedAt: patchedUpdatedAt,
			}),
		);
		expect(result).toEqual(
			expect.objectContaining({
				actionId: "action-1",
				resumeId: "resume-1",
				changedPaths: ["/basics/customFields/-"],
				resume: patchedData,
			}),
		);
	});

	it("rethrows a resume version conflict as a recoverable plain tool error", async () => {
		const activeThread = buildActiveThread();
		const persistedMessage = {
			id: "message-1",
			userId: "user-1",
			threadId: "thread-1",
			role: "user",
			status: "completed",
			sequence: 0,
			uiMessage: { id: "ui-message-1", role: "user", parts: [{ type: "text", text: "Edit" }] },
		};

		dbMock.select
			.mockImplementationOnce(() => selectLimitResult([activeThread]))
			.mockImplementationOnce(() => selectWhereResult([{ total: 1 }]))
			.mockImplementationOnce(() => selectOrderByResult([persistedMessage]));
		dbMock.insert.mockReturnValue({
			values: vi.fn(() => ({ returning: vi.fn(async () => [persistedMessage]) })),
		});
		dbMock.update.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) });

		claimActiveAgentRunMock.mockResolvedValue(true);
		aiProvidersServiceMock.getRunnableById.mockResolvedValue({
			id: "provider-1",
			provider: "openai",
			model: "gpt-5",
			apiKey: "secret",
			baseURL: null,
		});
		aiProvidersServiceMock.markUsed.mockResolvedValue(undefined);

		const [
			{ convertToModelMessages, ToolLoopAgent },
			{ agentStreamLifecycle },
			{ buildAgentTools },
			{ streamToEventIterator },
		] = await Promise.all([import("ai"), import("./streams"), import("./tools"), import("@orpc/server")]);
		vi.mocked(convertToModelMessages).mockResolvedValue([{ role: "user", content: [{ type: "text", text: "Edit" }] }]);
		class MockToolLoopAgent {
			stream = vi.fn(async () => ({ toUIMessageStream: vi.fn(() => new ReadableStream()) }));
		}
		vi.mocked(ToolLoopAgent).mockImplementation(MockToolLoopAgent as never);
		vi.mocked(agentStreamLifecycle.create).mockResolvedValue(new ReadableStream());
		vi.mocked(streamToEventIterator).mockReturnValue("iterator" as never);

		const { agentService } = await import("./service");

		await agentService.messages.send({
			threadId: "thread-1",
			userId: "user-1",
			// biome-ignore lint/suspicious/noExplicitAny: minimal fixture for unit test
			message: { id: "ui-message-1", role: "user", parts: [{ type: "text", text: "Edit" }] } as any,
		});

		resumeServiceMock.getById.mockResolvedValue({ data: {}, updatedAt: new Date("2026-05-01T00:00:00.000Z") });
		resumeServiceMock.patchInTransaction.mockRejectedValue(new ORPCError("RESUME_VERSION_CONFLICT"));

		const toolConfig = vi.mocked(buildAgentTools).mock.calls.at(-1)?.[0];
		// biome-ignore lint/suspicious/noExplicitAny: captured mocked tool config has intentionally loose handler types
		const applying = (toolConfig as any).handlers.applyResumePatch({
			title: "Edit",
			operations: [{ op: "replace", path: "/basics/name", value: "Bob" }],
		});

		await expect(applying).rejects.toThrowError("The resume changed while this edit was being prepared");
		await expect(applying).rejects.not.toBeInstanceOf(ORPCError);
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
		storageServiceMock.read.mockResolvedValue({ data: new TextEncoder().encode("hello"), contentType: "text/plain" });

		const [{ convertToModelMessages, ToolLoopAgent }, { agentStreamLifecycle }, { streamToEventIterator }] =
			await Promise.all([import("ai"), import("./streams"), import("@orpc/server")]);
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
				// biome-ignore lint/suspicious/noExplicitAny: minimal fixture for unit test
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
							expect.objectContaining({ type: "text", text: expect.stringContaining("hello") }),
						],
					},
				],
			}),
		);
	});

	it("merges an answered ask-user-question tool result into the existing assistant message", async () => {
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
				parts: [
					{
						type: "tool-ask_user_question",
						toolCallId: "call-1",
						state: "input-available",
						input: {
							question: "How broadly should I rename?",
							choices: ["Only change the main resume header name"],
						},
					},
				],
			},
		};
		const answeredAssistantMessage = {
			...unansweredAssistantMessage,
			uiMessage: {
				...unansweredAssistantMessage.uiMessage,
				parts: [
					{
						type: "tool-ask_user_question",
						toolCallId: "call-1",
						state: "output-available",
						input: {
							question: "How broadly should I rename?",
							choices: ["Only change the main resume header name"],
						},
						output: "Only change the main resume header name",
						callProviderMetadata: { openai: { itemId: "fc_duplicate_item" } },
						resultProviderMetadata: { openai: { itemId: "fc_duplicate_item" } },
					},
				],
			},
		};
		const answeredAssistantModelInput = {
			...answeredAssistantMessage.uiMessage,
			parts: [
				{
					type: "tool-ask_user_question",
					toolCallId: "call-1",
					state: "output-available",
					input: {
						question: "How broadly should I rename?",
						choices: ["Only change the main resume header name"],
					},
					output: "Only change the main resume header name",
				},
			],
		};
		const updateSets: unknown[] = [];

		dbMock.select
			.mockImplementationOnce(() => selectLimitResult([activeThread]))
			.mockImplementationOnce(() => selectOrderByResult([userMessage, unansweredAssistantMessage]))
			.mockImplementationOnce(() => selectOrderByResult([userMessage, answeredAssistantMessage]));

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

		const [{ convertToModelMessages, ToolLoopAgent }, { agentStreamLifecycle }, { streamToEventIterator }] =
			await Promise.all([import("ai"), import("./streams"), import("@orpc/server")]);
		vi.mocked(convertToModelMessages).mockResolvedValue([
			{ role: "user", content: [{ type: "text", text: "Change the name" }] },
			{
				role: "assistant",
				content: [{ type: "tool-call", toolCallId: "call-1", toolName: "ask_user_question", input: {} }],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call-1",
						toolName: "ask_user_question",
						output: "Only change the main resume header name",
					},
				],
			},
		] as never);
		class MockToolLoopAgent {
			stream = vi.fn(async () => ({ toUIMessageStream: vi.fn(() => new ReadableStream()) }));
		}
		vi.mocked(ToolLoopAgent).mockImplementation(MockToolLoopAgent as never);
		vi.mocked(agentStreamLifecycle.create).mockResolvedValue(new ReadableStream());
		vi.mocked(streamToEventIterator).mockReturnValue("iterator" as never);

		const { agentService } = await import("./service");

		await agentService.messages.send({
			threadId: "thread-1",
			userId: "user-1",
			message: {
				id: "ui-assistant-1",
				role: "assistant",
				parts: [
					{
						type: "tool-ask_user_question",
						toolCallId: "call-1",
						state: "output-available",
						input: {
							question: "How broadly should I rename?",
							choices: ["Only change the main resume header name"],
						},
						output: "Only change the main resume header name",
					},
				],
				// biome-ignore lint/suspicious/noExplicitAny: minimal fixture for unit test
			} as any,
		});

		expect(dbMock.insert).not.toHaveBeenCalled();
		expect(updateSets).toContainEqual(
			expect.objectContaining({
				uiMessage: expect.objectContaining({
					parts: [
						expect.objectContaining({
							type: "tool-ask_user_question",
							toolCallId: "call-1",
							state: "output-available",
							output: "Only change the main resume header name",
						}),
					],
				}),
			}),
		);
		expect(convertToModelMessages).toHaveBeenCalledWith([userMessage.uiMessage, answeredAssistantModelInput]);
	});

	// Regression (defect 8): a question continuation streams into the SAME uiMessage id; onFinish
	// must upsert the existing assistant row instead of inserting a duplicate row.
	it("continues the existing assistant row on a question continuation instead of inserting a duplicate", async () => {
		const activeThread = buildActiveThread();
		const userMessage = {
			id: "message-user-1",
			userId: "user-1",
			threadId: "thread-1",
			role: "user",
			status: "completed",
			sequence: 0,
			uiMessage: { id: "ui-user-1", role: "user", parts: [{ type: "text", text: "Change the name" }] },
		};
		const question = { question: "How broadly should I rename?", choices: ["Only the header"] };
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
				parts: [{ type: "tool-ask_user_question", toolCallId: "call-1", state: "input-available", input: question }],
			},
		};
		const answeredAssistantMessage = {
			...unansweredAssistantMessage,
			uiMessage: {
				...unansweredAssistantMessage.uiMessage,
				parts: [
					{
						type: "tool-ask_user_question",
						toolCallId: "call-1",
						state: "output-available",
						input: question,
						output: "Only the header",
					},
				],
			},
		};

		dbMock.select
			.mockImplementationOnce(() => selectLimitResult([activeThread]))
			.mockImplementationOnce(() => selectOrderByResult([userMessage, unansweredAssistantMessage]))
			.mockImplementationOnce(() => selectOrderByResult([userMessage, answeredAssistantMessage]));
		dbMock.update.mockImplementation(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) }));

		claimActiveAgentRunMock.mockResolvedValue(true);
		aiProvidersServiceMock.getRunnableById.mockResolvedValue({
			id: "provider-1",
			provider: "openai",
			model: "gpt-5",
			apiKey: "secret",
			baseURL: null,
		});
		aiProvidersServiceMock.markUsed.mockResolvedValue(undefined);

		const [{ convertToModelMessages, ToolLoopAgent }, { agentStreamLifecycle }, { streamToEventIterator }] =
			await Promise.all([import("ai"), import("./streams"), import("@orpc/server")]);
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
			// biome-ignore lint/suspicious/noExplicitAny: minimal fixture for unit test
			message: answeredAssistantMessage.uiMessage as any,
		});

		const onFinish = uiStreamOptions?.onFinish as (event: Record<string, unknown>) => Promise<void>;
		const continuedMessage = {
			...answeredAssistantMessage.uiMessage,
			parts: [...answeredAssistantMessage.uiMessage.parts, { type: "text", text: "Renamed the header." }],
		};
		await onFinish({ responseMessage: continuedMessage, isAborted: false, isContinuation: true, messages: [] });

		expect(messagesPersistenceMock.insertDraftAssistantMessage).not.toHaveBeenCalled();
		expect(dbMock.insert).not.toHaveBeenCalled();
		expect(messagesPersistenceMock.upsertAssistantUiMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				rowId: "message-assistant-1",
				status: "completed",
				message: expect.objectContaining({ id: "ui-assistant-1" }),
			}),
		);

		// Usage metadata is attached on the finish part only and carries the provider's model id.
		const messageMetadata = uiStreamOptions?.messageMetadata as (options: { part: Record<string, unknown> }) => unknown;
		expect(messageMetadata({ part: { type: "finish", totalUsage: { totalTokens: 42 } } })).toEqual({
			usage: { totalTokens: 42 },
			model: "gpt-5",
		});
		expect(messageMetadata({ part: { type: "text-delta" } })).toBeUndefined();
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

		const [{ convertToModelMessages, ToolLoopAgent }, { agentStreamLifecycle }, { streamToEventIterator }] =
			await Promise.all([import("ai"), import("./streams"), import("@orpc/server")]);
		vi.mocked(convertToModelMessages).mockResolvedValue([{ role: "user", content: [{ type: "text", text: "Retry" }] }]);
		class MockToolLoopAgent {
			stream = vi.fn(async () => ({ toUIMessageStream: vi.fn(() => new ReadableStream()) }));
		}
		vi.mocked(ToolLoopAgent).mockImplementation(MockToolLoopAgent as never);
		vi.mocked(agentStreamLifecycle.create).mockResolvedValue(new ReadableStream());
		vi.mocked(streamToEventIterator).mockReturnValue("iterator" as never);

		const { agentService } = await import("./service");

		await agentService.messages.send({
			threadId: "thread-1",
			userId: "user-1",
			// biome-ignore lint/suspicious/noExplicitAny: minimal fixture for unit test
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
			// biome-ignore lint/suspicious/noExplicitAny: malformed fixture on purpose
			message: { id: "ui-message-1", role: "user", parts: [{ type: "text" }] } as any,
		});

		await expect(sending).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Invalid UI message parts." });
		expect(claimActiveAgentRunMock).not.toHaveBeenCalled();
		expect(dbMock.insert).not.toHaveBeenCalled();
	});

	it("rejects malformed attachment IDs before persisting a message", async () => {
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
			// biome-ignore lint/suspicious/noExplicitAny: minimal fixture for unit test
			message: { id: "ui-message-1", role: "user", parts: [{ type: "text", text: "Use this file" }] } as any,
			attachmentIds: [123],
		});

		await expect(sending).rejects.toBeInstanceOf(ORPCError);
		await expect(sending).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "Attachment IDs must be non-empty strings.",
		});
		expect(dbMock.insert).not.toHaveBeenCalled();
	});

	it("rejects attachments that are missing, foreign, or already linked before persisting a message", async () => {
		dbMock.select
			.mockImplementationOnce(() => selectLimitResult([buildActiveThread()]))
			.mockImplementationOnce(() => selectWhereResult([]));

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
			// biome-ignore lint/suspicious/noExplicitAny: minimal fixture for unit test
			message: { id: "ui-message-1", role: "user", parts: [{ type: "text", text: "Use this file" }] } as any,
			attachmentIds: ["foreign-or-linked-attachment"],
		});

		await expect(sending).rejects.toBeInstanceOf(ORPCError);
		await expect(sending).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "One or more attachments are unavailable or already linked to a message.",
		});
		expect(dbMock.insert).not.toHaveBeenCalled();
	});

	it("throws CONFLICT when the underlying thread is archived", async () => {
		const archivedThread = buildArchivedThread();

		dbMock.select.mockImplementation(() => {
			const limit = vi.fn(async () => [archivedThread]);
			const where = vi.fn(() => ({ limit }));
			const from = vi.fn(() => ({ where }));
			return { from };
		});

		const { agentService } = await import("./service");

		const sending = agentService.messages.send({
			threadId: "thread-1",
			userId: "user-1",
			// biome-ignore lint/suspicious/noExplicitAny: minimal fixture for unit test
			message: { id: "msg-1", role: "user", parts: [{ type: "text", text: "hi" }] } as any,
		});

		await expect(sending).rejects.toBeInstanceOf(ORPCError);
		await expect(sending).rejects.toMatchObject({ code: "CONFLICT", message: "This thread is archived." });

		// Ensure we never tried to claim a run or persist anything for an archived thread.
		expect(aiProvidersServiceMock.getRunnableById).not.toHaveBeenCalled();
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
					.mockImplementationOnce(() => ({ from: () => ({ where: () => lockQuery }) }))
					.mockImplementationOnce(() => {
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
		expect(quotaRead).toHaveBeenCalledTimes(1);
		storageWrite.resolve();
		const settled = await results;
		expect(settled[0]?.status).toBe("fulfilled");
		expect(settled[1]).toMatchObject({ status: "rejected", reason: { code: "BAD_REQUEST" } });
		expect(lockModes).toEqual(["update", "update"]);
		expect(storageServiceMock.write).toHaveBeenCalledTimes(1);
		expect(storageServiceMock.delete).not.toHaveBeenCalled();
	});

	it("requires an owned, active, undeleted thread under the lock", async () => {
		const where = vi.fn(() => ({ for: vi.fn(async () => []) }));
		dbMock.select.mockReturnValue({ from: vi.fn(() => ({ where })) });
		const { agentService } = await import("./service");
		await expect(agentService.attachments.create(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(where).toHaveBeenCalledWith({
			type: "and",
			conditions: [
				{ type: "eq", left: "agent_threads.id", right: input.threadId },
				{ type: "eq", left: "agent_threads.user_id", right: input.userId },
				{ type: "eq", left: "agent_threads.status", right: "active" },
				{ type: "isNull", value: "agent_threads.deleted_at" },
			],
		});
		expect(storageServiceMock.write).not.toHaveBeenCalled();
		expect(dbMock.insert).not.toHaveBeenCalled();
	});

	it("rejects individual attachments above 25 MiB before opening a transaction", async () => {
		const { agentService } = await import("./service");
		await expect(
			agentService.attachments.create({ ...input, data: new Uint8Array(25 * 1024 * 1024 + 1) }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(dbMock.transaction).not.toHaveBeenCalled();
		expect(storageServiceMock.write).not.toHaveBeenCalled();
	});

	it("removes uploaded bytes when metadata insertion fails", async () => {
		dbMock.select
			.mockReturnValueOnce({ from: () => ({ where: () => ({ for: async () => [{ id: input.threadId }] }) }) })
			.mockImplementationOnce(() => selectWhereResult([{ total: 0, totalBytes: 0 }]));
		storageServiceMock.write.mockResolvedValue(undefined);
		storageServiceMock.delete.mockResolvedValue(true);
		dbMock.insert.mockReturnValue({ values: () => ({ returning: () => Promise.reject(new Error("Insert failed")) }) });
		const { agentService } = await import("./service");
		await expect(agentService.attachments.create(input)).rejects.toThrow("Insert failed");
		expect(storageServiceMock.delete).toHaveBeenCalledWith("uploads/user-1/agent/thread-1/test-id-notes.txt");
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
				uiMessage: { id: "ui-message-1", role: "user", parts: [{ type: "text", text: "hi" }] },
			};

			dbMock.select
				// send(): getThread, next sequence, message count, thread messages
				.mockImplementationOnce(() => selectLimitResult([activeThread]))
				.mockImplementationOnce(() => selectWhereResult([{ total: 1 }]))
				.mockImplementationOnce(() => selectOrderByResult([persistedMessage]))
				// stop(): getThread now reports the active run registered by send() (generateId() -> "test-id")
				.mockImplementationOnce(() =>
					selectLimitResult([buildActiveThread({ activeRunId: "test-id", activeStreamId: "test-id" })]),
				);

			dbMock.insert.mockReturnValue({
				values: vi.fn(() => ({ returning: vi.fn(async () => [persistedMessage]) })),
			});
			dbMock.update.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) });

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

			const [{ convertToModelMessages, ToolLoopAgent }, { agentStreamLifecycle }, { streamToEventIterator }] =
				await Promise.all([import("ai"), import("./streams"), import("@orpc/server")]);
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
				// biome-ignore lint/suspicious/noExplicitAny: minimal fixture for unit test
				message: { id: "ui-message-1", role: "user", parts: [{ type: "text", text: "hi" }] } as any,
			});

			expect(capturedSignal).toBeDefined();
			expect(capturedSignal?.aborted).toBe(false);

			if (action === "stop") {
				await agentService.messages.stop({ userId: "user-1", threadId: "thread-1" });
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
			const finalChunk: UIMessageChunk = { type: action === "complete" ? "finish" : "abort" };
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
				responseMessage: { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "Saved answer" }] },
				isAborted: action !== "complete",
			});
			expect(messagesPersistenceMock.upsertAssistantUiMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					status: action === "complete" ? "completed" : "canceled",
					message: expect.objectContaining({
						parts: expect.arrayContaining([
							{ type: "text", text: "Saved answer" },
							...(action === "timeout"
								? [{ type: "text", text: "Time limit reached. Your progress is saved. Ask me to continue." }]
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
		await agentService.messages.stop({ userId: "user-1", threadId: "thread-1" });
		expect(cancellationRedisMock.set).toHaveBeenCalledWith(
			"test:agent-cancellation:remote-run",
			"USER_STOPPED",
			"PX",
			900_000,
		);
		expect(clearActiveAgentRunIfCurrentMock).not.toHaveBeenCalled();
		expect(vi.mocked((await import("./runs")).reapStaleAgentRun)).not.toHaveBeenCalled();
	});

	it("reaps a run whose owner stopped heartbeating", async () => {
		const activeRunStartedAt = new Date(Date.now() - 60_000);
		dbMock.select.mockImplementation(() =>
			selectLimitResult([
				buildActiveThread({ activeRunId: "dead-run", activeStreamId: "stream-1", activeRunStartedAt }),
			]),
		);
		cancellationRedisMock.exists.mockResolvedValue(0);
		vi.mocked((await import("./runs")).reapStaleAgentRun).mockClear();
		const { agentService } = await import("./service");
		await agentService.messages.stop({ userId: "user-1", threadId: "thread-1" });
		expect(vi.mocked((await import("./runs")).reapStaleAgentRun)).toHaveBeenCalledExactlyOnceWith({
			threadId: "thread-1",
			userId: "user-1",
			runId: "dead-run",
			streamId: "stream-1",
		});
	});
});

describe("agentService.threads.archive", () => {
	it.each([null, "run-claimed-during-archive"])("archives before canceling the current run %s", async (activeRunId) => {
		dbMock.select.mockImplementation(() => selectLimitResult([buildActiveThread()]));
		const returning = vi.fn(async () => [{ activeRunId }]);
		const updateWhere = vi.fn(() => ({ returning }));
		const updateSet = vi.fn(() => ({ where: updateWhere }));
		dbMock.update.mockReturnValue({ set: updateSet });
		const { agentService } = await import("./service");

		await agentService.threads.archive({ id: "thread-1", userId: "user-1" });

		expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
		expect(clearActiveAgentRunIfCurrentMock).not.toHaveBeenCalled();
		if (activeRunId) {
			expect(cancellationRedisMock.set).toHaveBeenCalledWith(
				`test:agent-cancellation:${activeRunId}`,
				"USER_ARCHIVED",
				"PX",
				900_000,
			);
			expect(cancellationRedisMock.set).toHaveBeenCalledAfter(returning);
		} else {
			expect(cancellationRedisMock.set).not.toHaveBeenCalled();
		}
	});

	it("reports cancellation failure without releasing the archived run's claim", async () => {
		dbMock.select.mockImplementation(() => selectLimitResult([buildActiveThread()]));
		const returning = vi.fn(async () => [{ activeRunId: "remote-run" }]);
		dbMock.update.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning })) })) });
		cancellationRedisMock.set.mockRejectedValueOnce(new Error("Redis unavailable"));
		const { agentService } = await import("./service");
		await expect(agentService.threads.archive({ id: "thread-1", userId: "user-1" })).rejects.toThrow(
			"Redis unavailable",
		);
		expect(returning).toHaveBeenCalledBefore(cancellationRedisMock.set);
		expect(clearActiveAgentRunIfCurrentMock).not.toHaveBeenCalled();
	});
});

describe("agentService.threads.delete", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("throws NOT_FOUND when the thread does not belong to the user and skips destructive work", async () => {
		dbMock.select.mockImplementation(() => {
			const limit = vi.fn(async () => []);
			const where = vi.fn(() => ({ limit }));
			const from = vi.fn(() => ({ where }));
			return { from };
		});

		const { agentService } = await import("./service");

		const deleting = agentService.threads.delete({ id: "thread-x", userId: "user-y" });

		await expect(deleting).rejects.toBeInstanceOf(ORPCError);
		await expect(deleting).rejects.toMatchObject({ code: "NOT_FOUND" });

		expect(storageServiceMock.delete).not.toHaveBeenCalled();
		expect(dbMock.delete).not.toHaveBeenCalled();
		expect(dbMock.update).not.toHaveBeenCalled();
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

		const updateWhere = vi.fn(() => ({ returning: vi.fn(async () => [{ activeRunId: "delete-run" }]) }));
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

	it("still completes when storage cleanup fails after the thread is soft-deleted", async () => {
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

		const updateWhere = vi.fn(() => ({ returning: vi.fn(async () => [{ activeRunId: "delete-run" }]) }));
		const updateSet = vi.fn(() => ({ where: updateWhere }));
		dbMock.update.mockReturnValue({ set: updateSet });

		storageServiceMock.delete.mockRejectedValue(new Error("storage unavailable"));

		const { agentService } = await import("./service");

		await expect(agentService.threads.delete({ id: "thread-own", userId: "user-own" })).resolves.toBeUndefined();
		expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "deleted" }));
	});
});

describe("agentService.actions.revert", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function buildAction(overrides: Record<string, unknown> = {}) {
		return {
			id: "action-1",
			userId: "user-1",
			threadId: "thread-1",
			messageId: null,
			resumeId: "resume-1",
			kind: "resume_patch",
			status: "applied",
			title: "Tighten summary",
			summary: null,
			operations: [{ op: "replace", path: "/basics/name", value: "Bob" }],
			snapshotData: { basics: { name: "Alice" } },
			baseUpdatedAt: new Date("2026-05-01T00:00:00.000Z"),
			appliedUpdatedAt: new Date("2026-05-02T00:00:00.000Z"),
			revertedAt: null,
			revertMessage: null,
			createdAt: new Date("2026-05-02T00:00:00.000Z"),
			updatedAt: new Date("2026-05-02T00:00:00.000Z"),
			...overrides,
		};
	}

	it("rolls back an applied action by restoring its snapshot and marks later applied actions rolled_back", async () => {
		const action = buildAction();
		const laterAction = buildAction({
			id: "action-2",
			appliedUpdatedAt: new Date("2026-05-03T00:00:00.000Z"),
			createdAt: new Date("2026-05-03T00:00:00.000Z"),
		});
		const updatedAction = { ...action, status: "rolled_back", revertedAt: new Date(), revertMessage: null };

		dbMock.select
			.mockImplementationOnce(() => selectLimitResult([action]))
			.mockImplementationOnce(() => selectWhereOrderByLimitResult([laterAction]));

		const updateReturning = vi.fn(async () => [updatedAction]);
		const updateWhere = vi.fn(() => ({ returning: updateReturning }));
		const updateSet = vi.fn(() => ({ where: updateWhere }));
		dbMock.update.mockReturnValue({ set: updateSet });

		resumeServiceMock.patchInTransaction.mockResolvedValue({
			id: "resume-1",
			updatedAt: new Date("2026-05-03T00:00:00.000Z"),
		});

		const { agentService } = await import("./service");

		const result = await agentService.actions.revert({ id: "action-1", userId: "user-1" });

		expect(resumeServiceMock.patchInTransaction).toHaveBeenCalledWith(dbMock, {
			id: "resume-1",
			userId: "user-1",
			operations: [{ op: "replace", path: "", value: action.snapshotData }],
			expectedUpdatedAt: laterAction.appliedUpdatedAt,
		});
		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "rolled_back",
				revertMessage: "This patch was rolled back when the resume was restored to an earlier state.",
				appliedUpdatedAt: new Date("2026-05-03T00:00:00.000Z"),
			}),
		);
		expect(result.status).toBe("rolled_back");
	});

	it("returns a conflicted action when snapshot restore throws RESUME_VERSION_CONFLICT", async () => {
		const action = buildAction();
		const latestAction = buildAction({
			id: "action-2",
			appliedUpdatedAt: new Date("2026-05-03T00:00:00.000Z"),
		});
		const conflictedAction = {
			...action,
			status: "conflicted",
			revertMessage: "The resume changed after this action was applied.",
		};

		dbMock.select
			.mockImplementationOnce(() => selectLimitResult([action]))
			.mockImplementationOnce(() => selectWhereOrderByLimitResult([latestAction]));

		const updateReturning = vi.fn(async () => [conflictedAction]);
		const updateWhere = vi.fn(() => ({ returning: updateReturning }));
		const updateSet = vi.fn(() => ({ where: updateWhere }));
		dbMock.update.mockReturnValue({ set: updateSet });

		resumeServiceMock.patchInTransaction.mockRejectedValue(new ORPCError("RESUME_VERSION_CONFLICT"));

		const { agentService } = await import("./service");

		const result = await agentService.actions.revert({ id: "action-1", userId: "user-1" });

		expect(resumeServiceMock.patchInTransaction).toHaveBeenCalled();
		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "conflicted",
				revertMessage: "The resume changed after this action was applied.",
			}),
		);
		expect(updateWhere).toHaveBeenCalled();
		expect(updateReturning).toHaveBeenCalled();
		expect(result.status).toBe("conflicted");
		expect(result.revertMessage).toBe("The resume changed after this action was applied.");
	});

	it("returns the existing action unchanged when its status is already rolled_back", async () => {
		const action = buildAction({
			status: "rolled_back",
			revertedAt: new Date("2026-05-03T00:00:00.000Z"),
		});

		dbMock.select.mockImplementation(() => selectLimitResult([action]));

		const { agentService } = await import("./service");

		const result = await agentService.actions.revert({ id: "action-1", userId: "user-1" });

		expect(resumeServiceMock.patch).not.toHaveBeenCalled();
		expect(dbMock.update).not.toHaveBeenCalled();
		expect(result.status).toBe("rolled_back");
		expect(result.id).toBe("action-1");
	});

	it("throws BAD_REQUEST when an applied legacy action has no snapshotData", async () => {
		const action = buildAction({ snapshotData: null });

		dbMock.select.mockImplementation(() => selectLimitResult([action]));

		const { agentService } = await import("./service");

		const reverting = agentService.actions.revert({ id: "action-1", userId: "user-1" });

		await expect(reverting).rejects.toBeInstanceOf(ORPCError);
		await expect(reverting).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(resumeServiceMock.patch).not.toHaveBeenCalled();
	});

	it("throws BAD_REQUEST when the action has no resumeId", async () => {
		const action = buildAction({ resumeId: null });

		dbMock.select.mockImplementation(() => selectLimitResult([action]));

		const { agentService } = await import("./service");

		const reverting = agentService.actions.revert({ id: "action-1", userId: "user-1" });

		await expect(reverting).rejects.toBeInstanceOf(ORPCError);
		await expect(reverting).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(resumeServiceMock.patch).not.toHaveBeenCalled();
	});

	it("throws NOT_FOUND when no matching action is found", async () => {
		dbMock.select.mockImplementation(() => selectLimitResult([]));

		const { agentService } = await import("./service");

		const reverting = agentService.actions.revert({ id: "missing-id", userId: "user-1" });

		await expect(reverting).rejects.toBeInstanceOf(ORPCError);
		await expect(reverting).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(resumeServiceMock.patch).not.toHaveBeenCalled();
	});
});
