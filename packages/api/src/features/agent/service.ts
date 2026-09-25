import type { ApplyResumePatchInput } from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { JsonPatchOperation } from "@reactive-resume/resume/patch";
import type { Locale } from "@reactive-resume/utils/locale";
import type { FilePart, ImagePart, ModelMessage, TextPart, UIMessage, UIMessageChunk } from "ai";
import type { getModel } from "../ai/service";
import { ORPCError } from "@orpc/client";
import { streamToEventIterator } from "@orpc/server";
import {
	addToolInputExamplesMiddleware,
	convertToModelMessages,
	isStepCount,
	safeValidateUIMessages,
	smoothStream,
	ToolLoopAgent,
	wrapLanguageModel,
} from "ai";
import { and, asc, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { generateId } from "@reactive-resume/utils/string";
import { assertAgentEnvironment, getAgentToolApprovalSecret } from "../ai/credentials";
import { getAgentModel } from "../ai/service";
import { aiProvidersService } from "../ai-providers/service";
import { resumeService } from "../resume/service";
import { getStorageService, inferContentType } from "../storage/service";
import { monitorRunCancellation, requestRunCancellation } from "./cancellation";
import { pruneAgentModelContext } from "./context";
import { mergeClientToolResponses } from "./messages-merge";
import {
	applyStepToUiMessage,
	deleteDraftIfEmpty,
	insertDraftAssistantMessage,
	nextMessageSequence,
	touchThread,
	upsertAssistantUiMessage,
	withAccumulatedUsageMetadata,
} from "./messages-persistence";
import { repairAgentToolCall } from "./repair";
import { buildAgentDraftResumeName, buildUniqueAgentDraftSlug, normalizeAgentResumePatchOperations } from "./resume";
import { claimActiveAgentRun, clearActiveAgentRunIfCurrent, isStaleAgentRun, reapStaleAgentRun } from "./runs";
import { agentStreamLifecycle } from "./streams";
import { buildAgentInstructions, buildAgentTools } from "./tools";

const MAX_AGENT_STEPS = 30;
const MAX_AGENT_OUTPUT_TOKENS = 8_192;
const MAX_AGENT_MODEL_RETRIES = 2;
const AGENT_STEP_TIMEOUT_MS = 120_000;
// Reserve the final minute of the five-minute request budget for persistence and cleanup.
const AGENT_RUN_TIMEOUT_MS = 240_000;
const AGENT_TIMEOUT_MESSAGE = "Time limit reached. Your progress is saved. Ask me to continue.";
const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_THREAD_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const READABLE_ATTACHMENT_TYPES = new Set(["text/plain", "text/markdown", "application/json"]);
const DIRECT_MODEL_FILE_ATTACHMENT_TYPES = new Set([
	"application/pdf",
	"audio/mpeg",
	"audio/mp3",
	"audio/wav",
	"audio/wave",
	"audio/x-wav",
]);
const AGENT_ATTACHMENT_URL_PREFIX = "agent-attachment:";
const MAX_ATTACHMENT_TEXT_CHARS = 40_000;
const ROLLBACK_CONFLICT_MESSAGE = "The resume changed after this action was applied.";
const ROLLED_BACK_MESSAGE = "This patch was rolled back when the resume was restored to an earlier state.";

const activeRunCleanup = new Map<string, () => void>();
const activeRunTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

// Abort reasons MUST be an AbortError: the AI SDK only treats `err.name === "AbortError"`
// (via isAbortError) as a cancellation. A bare-string reason is treated as a genuine stream
// error whose rejection escapes the background (resumable-stream) pump and takes down the whole
// process with ERR_UNHANDLED_REJECTION. The label is preserved as the DOMException message.
const abortReason = (label: string) => new DOMException(label, "AbortError");

type AgentThreadRecord = typeof schema.agentThread.$inferSelect;
type AgentMessageRecord = typeof schema.agentMessage.$inferSelect;
type AgentActionRecord = typeof schema.agentAction.$inferSelect;
type AgentAttachmentRecord = typeof schema.agentAttachment.$inferSelect;

type CreateThreadInput = {
	userId: string;
	locale: Locale;
	aiProviderId?: string;
	sourceResumeId?: string;
};

type SendMessageInput = {
	userId: string;
	threadId: string;
	message: UIMessage;
	attachmentIds?: unknown;
};

type CreateAttachmentInput = {
	userId: string;
	threadId: string;
	filename: string;
	mediaType: string;
	data: Uint8Array;
};

type AttachmentModelInput = {
	attachment: AgentAttachmentRecord;
	data: Uint8Array;
};

function toThreadSummary(row: AgentThreadRecord & { resumeName?: string | null; providerLabel?: string | null }) {
	return {
		id: row.id,
		title: row.title,
		status: row.status,
		reviewPatches: row.reviewPatches,
		sourceResumeId: row.sourceResumeId,
		workingResumeId: row.workingResumeId,
		aiProviderId: row.aiProviderId,
		resumeName: row.resumeName ?? null,
		providerLabel: row.providerLabel ?? null,
		activeRunId: row.activeRunId,
		lastMessageAt: row.lastMessageAt,
		archivedAt: row.archivedAt,
		deletedAt: row.deletedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function toMessage(row: AgentMessageRecord): UIMessage {
	return row.uiMessage as unknown as UIMessage;
}

function toAction(row: AgentActionRecord) {
	return {
		id: row.id,
		threadId: row.threadId,
		messageId: row.messageId,
		resumeId: row.resumeId,
		kind: row.kind,
		status: row.status,
		title: row.title,
		summary: row.summary,
		operations: row.operations,
		canRollback: row.status === "applied" && row.snapshotData !== null,
		baseUpdatedAt: row.baseUpdatedAt,
		appliedUpdatedAt: row.appliedUpdatedAt,
		revertedAt: row.revertedAt,
		revertMessage: row.revertMessage,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function toAttachment(row: AgentAttachmentRecord) {
	return {
		id: row.id,
		threadId: row.threadId,
		messageId: row.messageId,
		filename: row.filename,
		mediaType: row.mediaType,
		size: row.size,
		createdAt: row.createdAt,
	};
}

function attachmentUiPart(attachment: AgentAttachmentRecord): UIMessage["parts"][number] {
	return {
		type: "file",
		url: `${AGENT_ATTACHMENT_URL_PREFIX}${attachment.id}`,
		mediaType: attachment.mediaType,
		filename: attachment.filename,
	};
}

function withAttachmentUiParts(message: UIMessage, attachments: AgentAttachmentRecord[]): UIMessage {
	return {
		...message,
		parts: [...withoutAgentAttachmentUiParts(message).parts, ...attachments.map(attachmentUiPart)],
	};
}

function withoutAgentAttachmentUiParts(message: UIMessage): UIMessage {
	return {
		...message,
		parts: message.parts.filter((part) => !(part.type === "file" && part.url.startsWith(AGENT_ATTACHMENT_URL_PREFIX))),
	};
}

// Provider output metadata can contain provider-owned item IDs. Keep it in UI history, but do not replay it as model input.
function withoutProviderMetadata(message: UIMessage): UIMessage {
	const cleanMessage = {
		...message,
		parts: message.parts.map((part) => {
			const cleanPart = { ...part } as Record<string, unknown>;
			delete cleanPart.providerMetadata;
			delete cleanPart.callProviderMetadata;
			delete cleanPart.resultProviderMetadata;
			return cleanPart as UIMessage["parts"][number];
		}),
	} as Record<string, unknown> & UIMessage;

	delete cleanMessage.providerMetadata;
	delete cleanMessage.callProviderMetadata;
	delete cleanMessage.resultProviderMetadata;

	return cleanMessage;
}

function toModelInputMessage(message: UIMessage): UIMessage {
	return withoutProviderMetadata(withoutAgentAttachmentUiParts(message));
}

type AgentToolPart = UIMessage["parts"][number] & {
	errorText?: string;
	output?: unknown;
	state?: string;
	toolCallId?: string;
};

function getFirstUnansweredAskUserQuestionToolCallId(message: UIMessage) {
	const part = message.parts.find((part) => {
		const toolPart = part as AgentToolPart;
		return (
			toolPart.type === "tool-ask_user_question" &&
			typeof toolPart.toolCallId === "string" &&
			toolPart.state === "input-available"
		);
	}) as AgentToolPart | undefined;

	return part?.toolCallId;
}

function answerAskUserQuestionToolCall(message: UIMessage, toolCallId: string, answer: string) {
	const { message: merged } = mergeClientToolResponses(message, {
		...message,
		parts: [
			{
				type: "tool-ask_user_question",
				toolCallId,
				state: "output-available",
				input: undefined,
				output: answer,
			} as UIMessage["parts"][number],
		],
	});

	return merged;
}

function attachmentLabel(attachment: AgentAttachmentRecord) {
	return `${attachment.filename} (${attachment.mediaType}, ${attachment.size} bytes, attachmentId: ${attachment.id})`;
}

export function buildAttachmentModelParts(input: AttachmentModelInput[]): Array<TextPart | ImagePart | FilePart> {
	return input.map(({ attachment, data }) => {
		if (READABLE_ATTACHMENT_TYPES.has(attachment.mediaType)) {
			const text = new TextDecoder().decode(data).slice(0, MAX_ATTACHMENT_TEXT_CHARS);
			return {
				type: "text",
				text: `Attachment ${attachmentLabel(attachment)}:\n\n${text}`,
			};
		}

		if (attachment.mediaType.startsWith("image/")) {
			return {
				type: "image",
				image: data,
				mediaType: attachment.mediaType,
			};
		}

		if (DIRECT_MODEL_FILE_ATTACHMENT_TYPES.has(attachment.mediaType)) {
			return {
				type: "file",
				data,
				filename: attachment.filename,
				mediaType: attachment.mediaType,
			};
		}

		return {
			type: "text",
			text: `Attachment ${attachmentLabel(attachment)} is not included directly because this media type is not supported for model file input. Use the read_attachment tool if text extraction is available.`,
		};
	});
}

function uniqueAttachmentIds(ids: unknown) {
	if (ids === undefined) return [];
	if (!Array.isArray(ids)) {
		throw new ORPCError("BAD_REQUEST", { message: "Attachment IDs must be an array." });
	}

	if (ids.length > MAX_ATTACHMENTS_PER_MESSAGE) {
		throw new ORPCError("BAD_REQUEST", { message: "Too many attachments for one message." });
	}

	const unique = new Set<string>();
	for (const id of ids) {
		if (typeof id !== "string" || !id.trim()) {
			throw new ORPCError("BAD_REQUEST", { message: "Attachment IDs must be non-empty strings." });
		}
		unique.add(id.trim());
	}

	if (unique.size !== ids.length) {
		throw new ORPCError("BAD_REQUEST", { message: "Attachment IDs must be unique." });
	}

	return [...unique];
}

async function getUnlinkedMessageAttachments(input: { ids: unknown; threadId: string; userId: string }) {
	const ids = uniqueAttachmentIds(input.ids);
	if (ids.length === 0) return [];

	const attachments = await db
		.select()
		.from(schema.agentAttachment)
		.where(
			and(
				eq(schema.agentAttachment.threadId, input.threadId),
				eq(schema.agentAttachment.userId, input.userId),
				inArray(schema.agentAttachment.id, ids),
				isNull(schema.agentAttachment.messageId),
			),
		);

	if (attachments.length !== ids.length) {
		throw new ORPCError("BAD_REQUEST", {
			message: "One or more attachments are unavailable or already linked to a message.",
		});
	}

	const attachmentsById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
	return ids.map((id) => {
		const attachment = attachmentsById.get(id);
		if (!attachment) {
			throw new ORPCError("BAD_REQUEST", {
				message: "One or more attachments are unavailable or already linked to a message.",
			});
		}

		return attachment;
	});
}

async function linkAttachmentsToMessage(input: {
	attachments: AgentAttachmentRecord[];
	messageId: string;
	threadId: string;
	userId: string;
}) {
	if (input.attachments.length === 0) return;

	const ids = input.attachments.map((attachment) => attachment.id);
	const linked = await db
		.update(schema.agentAttachment)
		.set({ messageId: input.messageId })
		.where(
			and(
				eq(schema.agentAttachment.threadId, input.threadId),
				eq(schema.agentAttachment.userId, input.userId),
				inArray(schema.agentAttachment.id, ids),
				isNull(schema.agentAttachment.messageId),
			),
		)
		.returning({ id: schema.agentAttachment.id });

	if (linked.length !== ids.length) {
		throw new ORPCError("CONFLICT", { message: "One or more attachments were already linked to another message." });
	}
}

function readAttachmentModelInputs(attachments: AgentAttachmentRecord[]): Promise<AttachmentModelInput[]> {
	const storage = getStorageService();
	return Promise.all(
		attachments.map(async (attachment) => {
			const stored = await storage.read(attachment.storageKey);
			if (!stored) {
				throw new ORPCError("BAD_REQUEST", { message: `Attachment ${attachment.filename} could not be read.` });
			}

			return { attachment, data: stored.data };
		}),
	);
}

function attachModelPartsToLatestUserMessage(
	messages: ModelMessage[],
	parts: Array<TextPart | ImagePart | FilePart>,
): ModelMessage[] {
	if (parts.length === 0) return messages;
	const index = messages.findLastIndex((m) => m.role === "user");
	if (index === -1) return messages;
	// biome-ignore lint/style/noNonNullAssertion: index is valid; findLastIndex returned != -1
	const msg = messages[index]!;
	if (msg.role !== "user") return messages; // ponytail: redundant at runtime; keeps TS narrowed to user-message content type
	const content = typeof msg.content === "string" ? [{ type: "text" as const, text: msg.content }] : msg.content;
	return messages.with(index, { ...msg, content: [...content, ...parts] });
}

async function getExistingResumeSlugs(userId: string) {
	const rows = await db
		.select({ slug: schema.resume.slug })
		.from(schema.resume)
		.where(eq(schema.resume.userId, userId));
	return new Set(rows.map((row) => row.slug));
}

async function createWorkingResume(input: CreateThreadInput) {
	if (input.sourceResumeId) {
		const source = await resumeService.getById({ id: input.sourceResumeId, userId: input.userId });
		const existingSlugs = await getExistingResumeSlugs(input.userId);
		const name = buildAgentDraftResumeName(source.name);
		const slug = buildUniqueAgentDraftSlug(source.name, existingSlugs);

		const id = await resumeService.create({
			userId: input.userId,
			name,
			slug,
			tags: [...source.tags],
			locale: input.locale,
			data: structuredClone(source.data),
		});

		return { id, source, title: name };
	}

	const existingSlugs = await getExistingResumeSlugs(input.userId);
	const name = "AI Draft";
	const id = await resumeService.create({
		userId: input.userId,
		name,
		slug: buildUniqueAgentDraftSlug(name, existingSlugs),
		tags: [],
		locale: input.locale,
		data: structuredClone(defaultResumeData),
	});

	return { id, source: null, title: name };
}

async function getThread(input: { id: string; userId: string }) {
	const [thread] = await db
		.select()
		.from(schema.agentThread)
		.where(
			and(
				eq(schema.agentThread.id, input.id),
				eq(schema.agentThread.userId, input.userId),
				isNull(schema.agentThread.deletedAt),
			),
		)
		.limit(1);

	if (!thread) throw new ORPCError("NOT_FOUND");

	return thread;
}

async function persistMessage(input: {
	userId: string;
	threadId: string;
	message: UIMessage;
	status?: string;
	sequence?: number;
}) {
	const sequence = input.sequence ?? (await nextMessageSequence(input.threadId, db));
	const [message] = await db
		.insert(schema.agentMessage)
		.values({
			userId: input.userId,
			threadId: input.threadId,
			role: input.message.role,
			status: input.status ?? "completed",
			sequence,
			uiMessage: input.message as unknown as Record<string, unknown>,
		})
		.returning();

	await touchThread({ threadId: input.threadId, userId: input.userId }, db);

	return message;
}

async function updateAssistantToolResultMessage(input: { userId: string; threadId: string; message: UIMessage }) {
	const existingRows = await listThreadMessages({ threadId: input.threadId, userId: input.userId });
	const existingRow = existingRows.find((row) => row.role === "assistant" && toMessage(row).id === input.message.id);
	if (!existingRow) {
		throw new ORPCError("BAD_REQUEST", { message: "The answered assistant message was not found." });
	}

	const {
		message: mergedMessage,
		mergedCount,
		alreadyResolvedCount,
		pendingContinuationCount,
		conflictingCount,
	} = mergeClientToolResponses(toMessage(existingRow), input.message);

	if (conflictingCount > 0) {
		throw new ORPCError("BAD_REQUEST", { message: "This approval was already answered with a different decision." });
	}
	// A recorded-but-unexecuted approval (pendingContinuationCount) proceeds: a prior continuation
	// attempt failed after persisting the decision, and this retry is the recovery path.
	if (mergedCount === 0 && pendingContinuationCount === 0) {
		if (alreadyResolvedCount > 0) {
			throw new ORPCError("CONFLICT", { message: "This response was already handled." });
		}
		throw new ORPCError("BAD_REQUEST", { message: "No matching unanswered user question was found." });
	}

	await db
		.update(schema.agentMessage)
		.set({
			status: "completed",
			uiMessage: mergedMessage as unknown as Record<string, unknown>,
		})
		.where(
			and(
				eq(schema.agentMessage.id, existingRow.id),
				eq(schema.agentMessage.threadId, input.threadId),
				eq(schema.agentMessage.userId, input.userId),
			),
		);

	await db
		.update(schema.agentThread)
		.set({ lastMessageAt: new Date() })
		.where(and(eq(schema.agentThread.id, input.threadId), eq(schema.agentThread.userId, input.userId)));

	return { message: mergedMessage, rowId: existingRow.id };
}

async function repairLegacyAskUserQuestionAnswers(
	rows: AgentMessageRecord[],
	input: { threadId: string; userId: string },
) {
	const nextRows = [...rows];
	const updates: Promise<unknown>[] = [];

	for (let index = 0; index < nextRows.length - 1; index++) {
		const assistantRow = nextRows[index];
		const answerRow = nextRows[index + 1];

		if (!assistantRow || !answerRow || assistantRow.role !== "assistant" || answerRow.role !== "user") continue;

		const assistantMessage = toMessage(assistantRow);
		const toolCallId = getFirstUnansweredAskUserQuestionToolCallId(assistantMessage);
		const answer = messageText(toMessage(answerRow));
		if (!toolCallId || !answer) continue;

		const mergedMessage = answerAskUserQuestionToolCall(assistantMessage, toolCallId, answer);
		nextRows[index] = {
			...assistantRow,
			uiMessage: mergedMessage as unknown as AgentMessageRecord["uiMessage"],
		};

		updates.push(
			db
				.update(schema.agentMessage)
				.set({
					status: "completed",
					uiMessage: mergedMessage as unknown as Record<string, unknown>,
				})
				.where(
					and(
						eq(schema.agentMessage.id, assistantRow.id),
						eq(schema.agentMessage.threadId, input.threadId),
						eq(schema.agentMessage.userId, input.userId),
					),
				),
		);
	}

	await Promise.all(updates);

	return nextRows;
}

async function cleanupActiveRun(input: {
	threadId: string;
	userId: string;
	runId: string;
	streamId: string;
	primaryError?: unknown;
	// When final persistence failed, keep the run claim: the reaper only examines threads with an
	// active claim, so releasing it here would orphan the "streaming" draft forever. The TTL reap
	// heals the claim and the draft together.
	preserveClaimForReaper?: boolean;
}) {
	activeRunCleanup.get(input.runId)?.();
	activeRunCleanup.delete(input.runId);
	clearTimeout(activeRunTimeouts.get(input.runId));
	activeRunTimeouts.delete(input.runId);

	if (input.preserveClaimForReaper) return;

	try {
		await clearActiveAgentRunIfCurrent(input);
	} catch (error) {
		if (!input.primaryError) throw error;
		console.error("[agent] Failed to clear active run after run error", error);
	}
}

function messageText(message: UIMessage) {
	const textParts: string[] = [];

	for (const part of message.parts) {
		if (part.type === "text") textParts.push(part.text);
	}

	return textParts.join(" ").trim();
}

function buildThreadTitle(message: UIMessage, fallback: string) {
	const text = messageText(message);
	if (!text) return fallback;
	return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function listThreadMessages(input: { threadId: string; userId: string }) {
	return db
		.select()
		.from(schema.agentMessage)
		.where(and(eq(schema.agentMessage.threadId, input.threadId), eq(schema.agentMessage.userId, input.userId)))
		.orderBy(asc(schema.agentMessage.sequence));
}

async function readAttachment(input: { id: string; threadId: string; userId: string }) {
	const [attachment] = await db
		.select()
		.from(schema.agentAttachment)
		.where(
			and(
				eq(schema.agentAttachment.id, input.id),
				eq(schema.agentAttachment.threadId, input.threadId),
				eq(schema.agentAttachment.userId, input.userId),
			),
		)
		.limit(1);

	if (!attachment) throw new Error("ATTACHMENT_NOT_FOUND");

	const stored = await getStorageService().read(attachment.storageKey);
	if (!stored) throw new Error("ATTACHMENT_NOT_FOUND");

	if (!READABLE_ATTACHMENT_TYPES.has(attachment.mediaType)) {
		return {
			id: attachment.id,
			filename: attachment.filename,
			mediaType: attachment.mediaType,
			size: attachment.size,
			content: null,
			note: "This attachment is provided directly to the model when its message is sent. Text extraction is not available through this tool for this media type.",
		};
	}

	return {
		id: attachment.id,
		filename: attachment.filename,
		mediaType: attachment.mediaType,
		size: attachment.size,
		content: new TextDecoder().decode(stored.data).slice(0, MAX_ATTACHMENT_TEXT_CHARS),
	};
}

async function applyResumePatch(input: {
	userId: string;
	threadId: string;
	resumeId: string;
	messageId?: string;
	title: string;
	summary?: string;
	baseUpdatedAt?: string;
	operations: JsonPatchOperation[];
}) {
	const before = await resumeService.getById({ id: input.resumeId, userId: input.userId });

	// Bind the patch to the revision the model actually read (and, under review, the revision the
	// user approved): index-based operations built against an older document could otherwise
	// silently target different items after a concurrent edit. baseUpdatedAt travels inside the
	// signed tool input, so an approval cannot be replayed against a changed resume either.
	if (input.baseUpdatedAt) {
		const baseTime = new Date(input.baseUpdatedAt).getTime();
		// An unparseable value must fail loudly rather than silently skip the revision check.
		if (Number.isNaN(baseTime)) {
			throw new Error(
				`baseUpdatedAt is not a valid timestamp. Pass the updatedAt from the read_resume or apply_resume_patch result verbatim (currently ${before.updatedAt.toISOString()}).`,
			);
		}
		if (baseTime !== before.updatedAt.getTime()) {
			throw new Error(
				`The resume changed after it was read (its updatedAt is now ${before.updatedAt.toISOString()}). Re-read the resume and rebuild the patch against the current document.`,
			);
		}
	}

	const snapshotData = structuredClone(before.data);
	const operations = normalizeAgentResumePatchOperations(before.data, input.operations);

	const { action, patched } = await db
		.transaction(async (tx) => {
			const patched = await resumeService.patchInTransaction(tx, {
				id: input.resumeId,
				userId: input.userId,
				operations,
				expectedUpdatedAt: before.updatedAt,
			});

			const [action] = await tx
				.insert(schema.agentAction)
				.values({
					userId: input.userId,
					threadId: input.threadId,
					resumeId: input.resumeId,
					...(input.messageId ? { messageId: input.messageId } : {}),
					kind: "resume_patch",
					status: "applied",
					title: input.title,
					...(input.summary !== undefined ? { summary: input.summary } : {}),
					operations,
					snapshotData,
					baseUpdatedAt: before.updatedAt,
					appliedUpdatedAt: patched.updatedAt,
				})
				.returning();

			if (!action) throw new Error("AGENT_ACTION_CREATE_FAILED");

			return { action, patched };
		})
		.catch((error: unknown) => {
			// Surface the version conflict as a recoverable tool error, not a run-fatal ORPCError.
			if (error instanceof ORPCError && error.code === "RESUME_VERSION_CONFLICT") {
				throw new Error("The resume changed while this edit was being prepared. Re-read the resume and retry.");
			}
			throw error;
		});

	await resumeService.notifyResumePatched({
		resumeId: patched.id,
		userId: input.userId,
		updatedAt: patched.updatedAt,
	});

	return {
		actionId: action.id,
		resumeId: input.resumeId,
		title: action.title,
		summary: action.summary,
		operations: action.operations,
		appliedUpdatedAt: action.appliedUpdatedAt.toISOString(),
		changedPaths: [...new Set(operations.flatMap((op) => ("from" in op ? [op.path, op.from] : [op.path])))],
		// Full post-patch document: array indexes may have shifted, so the model must base
		// further patches on this instead of an earlier read_resume snapshot.
		resume: patched.data,
	};
}

function createAgent(input: {
	userId: string;
	threadId: string;
	resumeId: string;
	draftRowId?: string;
	requirePatchApproval?: boolean;
	provider: {
		provider: Parameters<typeof getModel>[0]["provider"];
		model: string;
		apiKey: string;
		baseURL?: string;
	};
	model: ReturnType<typeof getModel>;
}) {
	// One greppable JSON line per tool execution.
	const timedToolHandler =
		<A extends unknown[], R>(toolName: string, run: (...args: A) => Promise<R>) =>
		async (...args: A): Promise<R> => {
			const startedAt = Date.now();
			let ok = true;
			try {
				return await run(...args);
			} catch (error) {
				ok = false;
				throw error;
			} finally {
				console.info(
					JSON.stringify({
						evt: "agent.tool",
						threadId: input.threadId,
						tool: toolName,
						ok,
						durationMs: Date.now() - startedAt,
					}),
				);
			}
		};

	const tools = buildAgentTools({
		provider: input.provider,
		options: { requirePatchApproval: !!input.requirePatchApproval },
		handlers: {
			readResume: timedToolHandler("read_resume", async () => {
				const resume = await resumeService.getById({ id: input.resumeId, userId: input.userId });
				return {
					id: resume.id,
					name: resume.name,
					updatedAt: resume.updatedAt.toISOString(),
					patchRoot: "data",
					patchPathExamples: {
						visibleName: "/basics/name",
						standardExperienceDescription: "/sections/experience/items/0/description",
						customSectionDescription: "/customSections/0/items/0/description",
					},
					patchNotes: [
						"apply_resume_patch paths are rooted at the `data` object below.",
						"Do not prefix paths with `/data`.",
						"Built-in sections live under `/sections/<sectionId>`, for example `/sections/experience/items/0/description`.",
						"Custom sections live under `/customSections/<index>`, even when their `type` is `experience`, `education`, or another built-in section type.",
						"The resume file/title `name` metadata is read-only for apply_resume_patch.",
					],
					data: resume.data,
				};
			}),
			readAttachment: timedToolHandler("read_attachment", (attachmentId: string) =>
				readAttachment({ id: attachmentId, threadId: input.threadId, userId: input.userId }),
			),
			applyResumePatch: timedToolHandler(
				"apply_resume_patch",
				({ title, summary, baseUpdatedAt, operations }: ApplyResumePatchInput) =>
					applyResumePatch({
						userId: input.userId,
						threadId: input.threadId,
						resumeId: input.resumeId,
						...(input.draftRowId ? { messageId: input.draftRowId } : {}),
						title,
						...(summary !== undefined ? { summary } : {}),
						...(baseUpdatedAt !== undefined ? { baseUpdatedAt } : {}),
						operations,
					}),
			),
		},
	});

	const instructionsText = buildAgentInstructions({ hasProviderNativeSearch: "web_search" in tools });

	return new ToolLoopAgent({
		// Providers without native inputExamples support get them appended to the tool description.
		model: wrapLanguageModel({ model: input.model, middleware: addToolInputExamplesMiddleware() }),
		// The loop re-sends stable instructions every step; on anthropic, prompt caching pays from step 2.
		instructions:
			input.provider.provider === "anthropic"
				? {
						role: "system",
						content: instructionsText,
						providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
					}
				: instructionsText,
		repairToolCall: repairAgentToolCall,
		stopWhen: isStepCount(MAX_AGENT_STEPS),
		maxOutputTokens: MAX_AGENT_OUTPUT_TOKENS,
		maxRetries: MAX_AGENT_MODEL_RETRIES,
		timeout: { stepMs: AGENT_STEP_TIMEOUT_MS },
		// HMAC-signs approval requests at issuance and verifies them when replayed on the
		// continuation run, so a client cannot forge or alter an approval payload. The agent
		// runtime forwards constructor settings to streamText verbatim; ToolLoopAgentSettings
		// does not type this key yet, hence the spread-cast.
		...({ experimental_toolApprovalSecret: getAgentToolApprovalSecret() } as object),
		// Runs before every loop step, so intra-run growth (N patches → N snapshots) is pruned too.
		prepareStep: ({ messages }) => {
			const pruned = pruneAgentModelContext(messages);
			return pruned === messages ? {} : { messages: pruned };
		},
		tools,
	});
}

const threadSummarySelection = {
	id: schema.agentThread.id,
	userId: schema.agentThread.userId,
	aiProviderId: schema.agentThread.aiProviderId,
	sourceResumeId: schema.agentThread.sourceResumeId,
	workingResumeId: schema.agentThread.workingResumeId,
	title: schema.agentThread.title,
	status: schema.agentThread.status,
	reviewPatches: schema.agentThread.reviewPatches,
	activeRunId: schema.agentThread.activeRunId,
	activeStreamId: schema.agentThread.activeStreamId,
	activeRunStartedAt: schema.agentThread.activeRunStartedAt,
	lastMessageAt: schema.agentThread.lastMessageAt,
	archivedAt: schema.agentThread.archivedAt,
	deletedAt: schema.agentThread.deletedAt,
	createdAt: schema.agentThread.createdAt,
	updatedAt: schema.agentThread.updatedAt,
	resumeName: schema.resume.name,
	providerLabel: schema.aiProvider.label,
};

// ponytail: shared select used at first-look and at race-fallback in getOrCreateForResume
async function findActiveThreadForResume(input: { userId: string; resumeId: string }) {
	const [thread] = await db
		.select(threadSummarySelection)
		.from(schema.agentThread)
		.leftJoin(schema.resume, eq(schema.agentThread.workingResumeId, schema.resume.id))
		.leftJoin(schema.aiProvider, eq(schema.agentThread.aiProviderId, schema.aiProvider.id))
		.where(
			and(
				eq(schema.agentThread.userId, input.userId),
				eq(schema.agentThread.workingResumeId, input.resumeId),
				eq(schema.agentThread.sourceResumeId, input.resumeId),
				eq(schema.agentThread.status, "active"),
				isNull(schema.agentThread.deletedAt),
			),
		)
		.orderBy(desc(schema.agentThread.lastMessageAt))
		.limit(1);
	return thread;
}

export const agentService = {
	threads: {
		list: async (input: { userId: string }) => {
			assertAgentEnvironment();

			const rows = await db
				.select(threadSummarySelection)
				.from(schema.agentThread)
				.leftJoin(schema.resume, eq(schema.agentThread.workingResumeId, schema.resume.id))
				.leftJoin(schema.aiProvider, eq(schema.agentThread.aiProviderId, schema.aiProvider.id))
				.where(and(eq(schema.agentThread.userId, input.userId), isNull(schema.agentThread.deletedAt)))
				.orderBy(desc(schema.agentThread.lastMessageAt));

			return rows.map(toThreadSummary);
		},

		create: async (input: CreateThreadInput) => {
			assertAgentEnvironment();

			const selectedProvider = input.aiProviderId
				? await aiProvidersService.getRunnableById({ id: input.aiProviderId, userId: input.userId })
				: await aiProvidersService.getDefaultRunnable({ userId: input.userId });

			if (!selectedProvider) throw new ORPCError("BAD_REQUEST", { message: "No tested AI provider is available." });

			const working = await createWorkingResume(input);
			const [thread] = await db
				.insert(schema.agentThread)
				.values({
					userId: input.userId,
					aiProviderId: selectedProvider.id,
					sourceResumeId: input.sourceResumeId ?? null,
					workingResumeId: working.id,
					title: "New thread",
				})
				.returning();

			if (!thread) throw new Error("AGENT_THREAD_CREATE_FAILED");

			return toThreadSummary({
				...thread,
				resumeName: working.title,
				providerLabel: selectedProvider.label,
			});
		},

		// In-resume assistant threads edit the open resume directly (working === source === resumeId), so the
		// builder's resume-update subscription applies the agent's patches live. Reuses the latest active thread
		// for that resume rather than accumulating a new thread on every panel open.
		getOrCreateForResume: async (input: { userId: string; resumeId: string; aiProviderId?: string }) => {
			assertAgentEnvironment();

			const existing = await findActiveThreadForResume(input);
			if (existing) return toThreadSummary(existing);

			const selectedProvider = input.aiProviderId
				? await aiProvidersService.getRunnableById({ id: input.aiProviderId, userId: input.userId })
				: await aiProvidersService.getDefaultRunnable({ userId: input.userId });

			if (!selectedProvider) throw new ORPCError("BAD_REQUEST", { message: "No tested AI provider is available." });

			// Confirms the caller owns the resume (throws otherwise) and provides its name for the summary.
			const resume = await resumeService.getById({ id: input.resumeId, userId: input.userId });

			const [thread] = await db
				.insert(schema.agentThread)
				.values({
					userId: input.userId,
					aiProviderId: selectedProvider.id,
					sourceResumeId: input.resumeId,
					workingResumeId: input.resumeId,
					title: "Resume assistant",
				})
				.onConflictDoNothing()
				.returning();

			// A concurrent call won the unique partial index race; return its thread instead.
			if (!thread) {
				const raced = await findActiveThreadForResume(input);
				if (!raced) throw new Error("AGENT_THREAD_CREATE_FAILED");
				return toThreadSummary(raced);
			}

			return toThreadSummary({ ...thread, resumeName: resume.name, providerLabel: selectedProvider.label });
		},

		get: async (input: { id: string; userId: string }) => {
			assertAgentEnvironment();

			const thread = await getThread(input);

			// Heal on open: clear a dead run's claim before reading messages so the client neither
			// resumes a dead stream nor renders a perpetually "streaming" draft.
			if (thread.activeRunId && isStaleAgentRun(thread)) {
				await reapStaleAgentRun({
					threadId: input.id,
					userId: input.userId,
					runId: thread.activeRunId,
					streamId: thread.activeStreamId,
				});
				thread.activeRunId = null;
				thread.activeStreamId = null;
				thread.activeRunStartedAt = null;
			}

			const [messages, actions, attachments, resume] = await Promise.all([
				listThreadMessages({ threadId: input.id, userId: input.userId }),
				db
					.select()
					.from(schema.agentAction)
					.where(and(eq(schema.agentAction.threadId, input.id), eq(schema.agentAction.userId, input.userId)))
					.orderBy(desc(schema.agentAction.createdAt)),
				db
					.select()
					.from(schema.agentAttachment)
					.where(and(eq(schema.agentAttachment.threadId, input.id), eq(schema.agentAttachment.userId, input.userId)))
					.orderBy(asc(schema.agentAttachment.createdAt)),
				thread.workingResumeId
					? resumeService.getById({ id: thread.workingResumeId, userId: input.userId }).catch(() => null)
					: null,
			]);

			return {
				thread: toThreadSummary(thread),
				messages: messages.map(toMessage),
				actions: actions.map(toAction),
				attachments: attachments.map(toAttachment),
				resume,
				isReadOnly:
					thread.status === "archived" ||
					!thread.workingResumeId ||
					!thread.aiProviderId ||
					!resume ||
					!!resume.isLocked,
			};
		},

		update: async (input: { id: string; userId: string; reviewPatches: boolean }) => {
			assertAgentEnvironment();

			const thread = await getThread({ id: input.id, userId: input.userId });
			// Approval behavior is captured when a run's agent is created; toggling mid-run would
			// show "review on" while later patches from the same run still auto-apply.
			if (thread.activeRunId && !isStaleAgentRun(thread)) {
				throw new ORPCError("CONFLICT", { message: "Review settings cannot change while a run is active." });
			}

			const [updated] = await db
				.update(schema.agentThread)
				.set({ reviewPatches: input.reviewPatches })
				.where(and(eq(schema.agentThread.id, input.id), eq(schema.agentThread.userId, input.userId)))
				.returning();

			if (!updated) throw new ORPCError("NOT_FOUND");

			return toThreadSummary(updated);
		},

		archive: async (input: { id: string; userId: string }) => {
			assertAgentEnvironment();

			await getThread({ id: input.id, userId: input.userId });
			const [thread] = await db
				.update(schema.agentThread)
				.set({ status: "archived", archivedAt: new Date() })
				.where(
					and(
						eq(schema.agentThread.id, input.id),
						eq(schema.agentThread.userId, input.userId),
						isNull(schema.agentThread.deletedAt),
					),
				)
				.returning({ activeRunId: schema.agentThread.activeRunId });
			if (!thread) throw new ORPCError("NOT_FOUND");
			if (thread.activeRunId) await requestRunCancellation(thread.activeRunId, "USER_ARCHIVED");
		},

		delete: async (input: { id: string; userId: string }) => {
			assertAgentEnvironment();

			await getThread({ id: input.id, userId: input.userId });

			const [thread] = await db
				.update(schema.agentThread)
				.set({ status: "deleted", deletedAt: new Date() })
				.where(
					and(
						eq(schema.agentThread.id, input.id),
						eq(schema.agentThread.userId, input.userId),
						isNull(schema.agentThread.deletedAt),
					),
				)
				.returning({ activeRunId: schema.agentThread.activeRunId });
			if (!thread) throw new ORPCError("NOT_FOUND");
			try {
				if (thread.activeRunId) await requestRunCancellation(thread.activeRunId, "USER_DELETED");
			} finally {
				await db.delete(schema.agentAttachment).where(eq(schema.agentAttachment.threadId, input.id));
				try {
					await getStorageService().delete(`uploads/${input.userId}/agent/${input.id}`);
				} catch (error) {
					console.error("[agent] Failed to delete thread storage after soft-delete", {
						threadId: input.id,
						userId: input.userId,
						error,
					});
				}
			}
		},
	},

	messages: {
		send: async (input: SendMessageInput) => {
			assertAgentEnvironment();

			const thread = await getThread({ id: input.threadId, userId: input.userId });
			if (thread.status === "archived") {
				throw new ORPCError("CONFLICT", { message: "This thread is archived." });
			}
			if (thread.activeRunId) {
				if (!isStaleAgentRun(thread)) {
					throw new ORPCError("CONFLICT", { message: "This thread already has an active run." });
				}
				// Lazy reap: a dead run's claim heals on the next send instead of CONFLICTing forever.
				await reapStaleAgentRun({
					threadId: input.threadId,
					userId: input.userId,
					runId: thread.activeRunId,
					streamId: thread.activeStreamId,
				});
			}
			if (!thread.workingResumeId || !thread.aiProviderId) {
				throw new ORPCError("BAD_REQUEST", { message: "This thread is read-only." });
			}
			if (input.message.role !== "user" && input.message.role !== "assistant") {
				throw new ORPCError("BAD_REQUEST", { message: "Agent messages must be user messages or tool results." });
			}

			// Deliberately schema-less: provider-echoed tool parts must pass, and replayed history is never re-validated.
			const validated = await safeValidateUIMessages({ messages: [input.message] });
			if (!validated.success) {
				throw new ORPCError("BAD_REQUEST", { message: "Invalid UI message parts." });
			}

			const [runnableProvider, attachments] = await Promise.all([
				aiProvidersService.getRunnableById({
					id: thread.aiProviderId,
					userId: input.userId,
				}),
				getUnlinkedMessageAttachments({
					ids: input.attachmentIds ?? [],
					threadId: input.threadId,
					userId: input.userId,
				}),
			]);
			const runId = generateId();
			const streamId = generateId();
			const controller = new AbortController();

			const claimed = await claimActiveAgentRun({ threadId: input.threadId, userId: input.userId, runId, streamId });
			if (!claimed) {
				throw new ORPCError("CONFLICT", { message: "This thread already has an active run." });
			}

			// Whole-run wall clock. Must abort with an AbortError (see abortReason) — never AbortSignal.timeout().
			activeRunTimeouts.set(
				runId,
				setTimeout(() => controller.abort(abortReason("RUN_TIMEOUT")), AGENT_RUN_TIMEOUT_MS),
			);

			// Row + message the run streams into. A continuation reuses the existing assistant
			// row (same uiMessage id); a fresh turn inserts a "streaming" draft row below.
			let draftRowId: string | undefined;
			let insertedDraft = false;
			const responseMessageId = generateId();
			let draftUiMessage: UIMessage = { id: responseMessageId, role: "assistant", parts: [] };

			try {
				activeRunCleanup.set(runId, await monitorRunCancellation(runId, controller));
				controller.signal.throwIfAborted();
				let attachmentsForModel: AgentAttachmentRecord[] = [];

				if (input.message.role === "assistant") {
					if (attachments.length > 0) {
						throw new ORPCError("BAD_REQUEST", { message: "Tool result messages cannot include attachments." });
					}

					// Merge AFTER the exclusive claim: concurrent approve/deny requests serialize on
					// the claim instead of both persisting, and a merge that is rejected (or any later
					// setup failure) releases the claim via the catch below. A response persisted by a
					// failed earlier attempt re-enters as pendingContinuation and still gets its run.
					const continuation = await updateAssistantToolResultMessage({
						userId: input.userId,
						threadId: input.threadId,
						message: input.message,
					});
					draftRowId = continuation.rowId;
					draftUiMessage = continuation.message;
				} else {
					attachmentsForModel = attachments;
					const sequence = await nextMessageSequence(input.threadId, db);
					const userMessage = withAttachmentUiParts(input.message, attachments);
					const persistedUserMessage = await persistMessage({
						userId: input.userId,
						threadId: input.threadId,
						message: userMessage,
						sequence,
					});
					if (!persistedUserMessage) throw new Error("AGENT_MESSAGE_CREATE_FAILED");
					await linkAttachmentsToMessage({
						attachments,
						messageId: persistedUserMessage.id,
						threadId: input.threadId,
						userId: input.userId,
					});

					const [messageCount] = await db
						.select({ total: count() })
						.from(schema.agentMessage)
						.where(eq(schema.agentMessage.threadId, input.threadId));

					if ((messageCount?.total ?? 0) === 1) {
						await db
							.update(schema.agentThread)
							.set({ title: buildThreadTitle(userMessage, thread.title) })
							.where(and(eq(schema.agentThread.id, input.threadId), eq(schema.agentThread.userId, input.userId)));
					}
				}

				await aiProvidersService.markUsed({ id: runnableProvider.id, userId: input.userId });

				const messageRows = await repairLegacyAskUserQuestionAnswers(
					await listThreadMessages({ threadId: input.threadId, userId: input.userId }),
					{ threadId: input.threadId, userId: input.userId },
				);
				const messages = messageRows.map(toMessage);
				const modelMessages = await convertToModelMessages(messages.map(toModelInputMessage));
				const attachmentModelParts = buildAttachmentModelParts(await readAttachmentModelInputs(attachmentsForModel));

				// Draft row inserted after the replay snapshot (so it is not replayed) and before the
				// stream starts, so a crash mid-run leaves a resumable record instead of nothing.
				if (input.message.role === "user") {
					const draft = await insertDraftAssistantMessage({
						userId: input.userId,
						threadId: input.threadId,
						uiMessageId: responseMessageId,
					});
					draftRowId = draft.rowId;
					insertedDraft = true;
				}

				const agent = createAgent({
					userId: input.userId,
					threadId: input.threadId,
					resumeId: thread.workingResumeId,
					...(draftRowId ? { draftRowId } : {}),
					requirePatchApproval: thread.reviewPatches,
					provider: {
						provider: runnableProvider.provider,
						model: runnableProvider.model,
						apiKey: runnableProvider.apiKey,
						baseURL: runnableProvider.baseURL ?? "",
					},
					model: getAgentModel({
						provider: runnableProvider.provider,
						model: runnableProvider.model,
						apiKey: runnableProvider.apiKey,
						baseURL: runnableProvider.baseURL ?? "",
					}),
				});

				const result = await agent.stream({
					messages: attachModelPartsToLatestUserMessage(modelMessages, attachmentModelParts),
					abortSignal: controller.signal,
					experimental_transform: smoothStream({ chunking: "word" }),
					// Crash-safety: fold each finished step into the draft row so a process death
					// mid-run loses at most the current step, never the whole transcript.
					onStepEnd: async (step) => {
						console.info(
							JSON.stringify({
								evt: "agent.step",
								threadId: input.threadId,
								runId,
								step: step.stepNumber,
								toolNames: step.toolCalls.map((call) => call.toolName),
								usage: step.usage,
								finishReason: step.finishReason,
							}),
						);
						try {
							draftUiMessage = applyStepToUiMessage(draftUiMessage, step);
							const upserted = await upsertAssistantUiMessage({
								userId: input.userId,
								threadId: input.threadId,
								...(draftRowId ? { rowId: draftRowId } : {}),
								message: draftUiMessage,
								status: "streaming",
							});
							draftRowId = upserted.rowId;
						} catch (error) {
							console.error("[agent] Failed to persist step draft", error);
						}
					},
				});

				return streamToEventIterator(
					await agentStreamLifecycle.create(streamId, () =>
						result
							.toUIMessageStream({
								originalMessages: messages,
								generateMessageId: () => responseMessageId,
								sendSources: true,
								// Round-trips inside the persisted uiMessage jsonb — no migration needed.
								messageMetadata: ({ part }) =>
									part.type === "finish" ? { usage: part.totalUsage, model: runnableProvider.model } : undefined,
								onFinish: async ({ responseMessage, isAborted }) => {
									let persistError: unknown;
									try {
										if (controller.signal.reason?.message === "RUN_TIMEOUT") {
											responseMessage = {
												...responseMessage,
												parts: [...responseMessage.parts, { type: "text", text: AGENT_TIMEOUT_MESSAGE }],
											};
										}
										await upsertAssistantUiMessage({
											userId: input.userId,
											threadId: input.threadId,
											...(draftRowId ? { rowId: draftRowId } : {}),
											// A continuation reuses the message; the SDK replaces primitive
											// metadata, so prior-run usage must be summed back in.
											message: withAccumulatedUsageMetadata(draftUiMessage, responseMessage),
											status: isAborted ? "canceled" : "completed",
										});
									} catch (error) {
										persistError = error;
										throw error;
									} finally {
										await cleanupActiveRun({
											threadId: input.threadId,
											userId: input.userId,
											runId,
											streamId,
											primaryError: persistError,
											preserveClaimForReaper: !!persistError,
										});
									}
								},
								onError: (error) => (error instanceof Error ? error.message : "Agent run failed."),
							})
							.pipeThrough(
								new TransformStream<UIMessageChunk, UIMessageChunk>({
									transform(chunk, output) {
										if (chunk.type === "abort" && controller.signal.reason?.message === "RUN_TIMEOUT") {
											const id = `timeout-${runId}`;
											output.enqueue({ type: "text-start", id });
											output.enqueue({ type: "text-delta", id, delta: AGENT_TIMEOUT_MESSAGE });
											output.enqueue({ type: "text-end", id });
										}
										output.enqueue(chunk);
									},
								}),
							),
					),
				);
			} catch (error) {
				if (insertedDraft && draftRowId) {
					await deleteDraftIfEmpty({ rowId: draftRowId, threadId: input.threadId, userId: input.userId }).catch(
						(cleanupError: unknown) => console.error("[agent] Failed to delete empty draft", cleanupError),
					);
				}
				await cleanupActiveRun({
					threadId: input.threadId,
					userId: input.userId,
					runId,
					streamId,
					primaryError: error,
				});
				throw error;
			}
		},

		// Server-authored cancellation: the abort makes onFinish({isAborted: true}) persist exactly
		// what the server generated. The deprecated client `partialMessage` is ignored.
		stop: async (input: { userId: string; threadId: string }) => {
			assertAgentEnvironment();

			const thread = await getThread({ id: input.threadId, userId: input.userId });
			const activeRunId = thread.activeRunId;
			if (!activeRunId) return;
			// Only the owner releases the claim after persisting the terminal transcript.
			await requestRunCancellation(activeRunId, "USER_STOPPED");
		},
		resume: async (input: { userId: string; threadId: string }) => {
			assertAgentEnvironment();
			const thread = await getThread({ id: input.threadId, userId: input.userId });
			return streamToEventIterator(await agentStreamLifecycle.resume(thread.activeStreamId));
		},
	},

	attachments: {
		create: async (input: CreateAttachmentInput) => {
			assertAgentEnvironment();
			if (input.data.byteLength > MAX_ATTACHMENT_BYTES) throw new ORPCError("BAD_REQUEST");

			const mediaType = input.mediaType || inferContentType(input.filename);
			const id = generateId();
			const key = `uploads/${input.userId}/agent/${input.threadId}/${id}-${input.filename}`;
			const storage = getStorageService();
			let storageAttempted = false;
			try {
				return await db.transaction(async (tx) => {
					// Serialize quota checks with uploads and archive/delete's update of this same row.
					const [thread] = await tx
						.select({ id: schema.agentThread.id })
						.from(schema.agentThread)
						.where(
							and(
								eq(schema.agentThread.id, input.threadId),
								eq(schema.agentThread.userId, input.userId),
								eq(schema.agentThread.status, "active"),
								isNull(schema.agentThread.deletedAt),
							),
						)
						.for("update");
					if (!thread) throw new ORPCError("NOT_FOUND");

					const [stats] = await tx
						.select({
							totalBytes: sql<number>`coalesce(sum(${schema.agentAttachment.size}), 0)`,
							total: count(),
						})
						.from(schema.agentAttachment)
						.where(
							and(eq(schema.agentAttachment.threadId, input.threadId), eq(schema.agentAttachment.userId, input.userId)),
						);
					if ((stats?.total ?? 0) >= MAX_ATTACHMENTS_PER_MESSAGE) throw new ORPCError("BAD_REQUEST");
					if (Number(stats?.totalBytes ?? 0) + input.data.byteLength > MAX_THREAD_ATTACHMENT_BYTES) {
						throw new ORPCError("BAD_REQUEST");
					}

					// ponytail: hold the thread lock during storage I/O; reserve quota first if uploads contend.
					storageAttempted = true;
					await storage.write({ key, data: input.data, contentType: mediaType, private: true });
					const [attachment] = await tx
						.insert(schema.agentAttachment)
						.values({
							id,
							userId: input.userId,
							threadId: input.threadId,
							storageKey: key,
							filename: input.filename,
							mediaType,
							size: input.data.byteLength,
						})
						.returning();
					if (!attachment) throw new Error("AGENT_ATTACHMENT_CREATE_FAILED");
					return toAttachment(attachment);
				});
			} catch (error) {
				if (storageAttempted) {
					await storage
						.delete(key)
						.catch((cleanupError: unknown) =>
							console.error("[agent] Failed to clean up rejected attachment", cleanupError),
						);
				}
				throw error;
			}
		},

		delete: async (input: { id: string; userId: string }) => {
			assertAgentEnvironment();

			const [attachment] = await db
				.select()
				.from(schema.agentAttachment)
				.where(and(eq(schema.agentAttachment.id, input.id), eq(schema.agentAttachment.userId, input.userId)))
				.limit(1);

			if (!attachment) return;

			await getStorageService().delete(attachment.storageKey);
			await db
				.delete(schema.agentAttachment)
				.where(and(eq(schema.agentAttachment.id, input.id), eq(schema.agentAttachment.userId, input.userId)));
		},
	},

	actions: {
		revert: async (input: { id: string; userId: string }) => {
			assertAgentEnvironment();

			const [action] = await db
				.select()
				.from(schema.agentAction)
				.where(and(eq(schema.agentAction.id, input.id), eq(schema.agentAction.userId, input.userId)))
				.limit(1);

			if (!action) throw new ORPCError("NOT_FOUND");
			if (action.status !== "applied") return toAction(action);
			if (action.kind !== "resume_patch") {
				throw new ORPCError("BAD_REQUEST", { message: "Only resume patch actions can be rolled back." });
			}
			const resumeId = action.resumeId;
			const snapshotData = action.snapshotData;
			if (!resumeId) throw new ORPCError("BAD_REQUEST", { message: "The edited resume no longer exists." });
			if (!snapshotData) {
				throw new ORPCError("BAD_REQUEST", { message: "This legacy patch does not have a rollback snapshot." });
			}

			const [latestAction] = await db
				.select()
				.from(schema.agentAction)
				.where(
					and(
						eq(schema.agentAction.userId, input.userId),
						eq(schema.agentAction.threadId, action.threadId),
						eq(schema.agentAction.resumeId, resumeId),
						eq(schema.agentAction.kind, "resume_patch"),
						eq(schema.agentAction.status, "applied"),
					),
				)
				.orderBy(desc(schema.agentAction.appliedUpdatedAt))
				.limit(1);

			if (!latestAction) {
				throw new ORPCError("BAD_REQUEST", { message: "This patch is no longer applied." });
			}

			try {
				const { updated, restored } = await db.transaction(async (tx) => {
					const restored = await resumeService.patchInTransaction(tx, {
						id: resumeId,
						userId: input.userId,
						operations: [{ op: "replace", path: "", value: structuredClone(snapshotData) }],
						expectedUpdatedAt: latestAction.appliedUpdatedAt,
					});

					const rolledBackAt = new Date();
					const updatedActions = await tx
						.update(schema.agentAction)
						.set({
							status: "rolled_back",
							revertedAt: rolledBackAt,
							revertMessage: ROLLED_BACK_MESSAGE,
							appliedUpdatedAt: restored.updatedAt,
						})
						.where(
							and(
								eq(schema.agentAction.userId, input.userId),
								eq(schema.agentAction.threadId, action.threadId),
								eq(schema.agentAction.resumeId, resumeId),
								eq(schema.agentAction.kind, "resume_patch"),
								eq(schema.agentAction.status, "applied"),
								gte(schema.agentAction.appliedUpdatedAt, action.appliedUpdatedAt),
							),
						)
						.returning();

					const updated = updatedActions.find((row) => row.id === action.id);
					if (!updated) throw new ORPCError("NOT_FOUND");
					return { updated, restored };
				});

				await resumeService.notifyResumePatched({
					resumeId: restored.id,
					userId: input.userId,
					updatedAt: restored.updatedAt,
				});

				return toAction(updated);
			} catch (error) {
				if (error instanceof ORPCError && error.code === "RESUME_VERSION_CONFLICT") {
					const [updated] = await db
						.update(schema.agentAction)
						.set({ status: "conflicted", revertMessage: ROLLBACK_CONFLICT_MESSAGE })
						.where(and(eq(schema.agentAction.id, input.id), eq(schema.agentAction.userId, input.userId)))
						.returning();

					if (!updated) throw new ORPCError("NOT_FOUND");

					return toAction(updated);
				}

				throw error;
			}
		},
	},
};
