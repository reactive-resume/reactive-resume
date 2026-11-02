import type { getModel } from "../ai/service";
import type { WebAccessConnection } from "../web-access/contracts";
import type { AssistantDocument } from "./document";
import type { EditUpdate } from "./messages-persistence";
import type {
	ProposeEditsInput,
	ProposeEditsOutput,
	ProposeResumeEditsInput,
} from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { DbOrTx } from "@reactive-resume/db/client";
import type { WorkspaceTab } from "@reactive-resume/schema/career";
import type { FilePart, ImagePart, ModelMessage, TextPart, UIMessage, UIMessageChunk } from "ai";
import { ORPCError } from "@orpc/client";
import { streamToEventIterator } from "@orpc/server";
import {
	addToolInputExamplesMiddleware,
	APICallError,
	convertToModelMessages,
	isStepCount,
	RetryError,
	safeValidateUIMessages,
	smoothStream,
	ToolLoopAgent,
	wrapLanguageModel,
} from "ai";
import { and, asc, count, desc, eq, getColumns, gt, inArray, isNull, sql } from "drizzle-orm";
import { agentWebSources } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { canApplyTo, withEditedText } from "@reactive-resume/resume/proposals";
import { generateId } from "@reactive-resume/utils/string";
import { aiProvidersService } from "../ai-providers/service";
import { assertAgentEnvironment } from "../ai/credentials";
import { extractDocxTextFromBytes, getAgentModel } from "../ai/service";
import { assertApplicationVersion } from "../applications/service";
import { careerService, requireCareerApplication } from "../career/service";
import { buildCareerTools, buildCareerInstructions } from "../career/tools";
import { coverLetterService } from "../cover-letters/service";
import { assertDocumentVersion } from "../documents/ownership";
import { resumeService } from "../resume/service";
import { getStorageService, inferContentType } from "../storage/service";
import { webAccessService } from "../web-access/credentials";
import { searchScope } from "../web-access/regions";
import { readPage, searchWeb } from "../web-access/service";
import { isRunAlive, monitorRunCancellation, requestRunCancellation } from "./cancellation";
import { knowledgeWithdrawals, pruneAgentModelContext, readsKnowledge, withdrawKnowledgeReply } from "./context";
import {
	documentOf,
	documentView,
	findPosting,
	loadDocument,
	resolveDocumentEdits,
	withUsableTailoring,
} from "./document";
import { mergeClientToolResponses } from "./messages-merge";
import {
	applyStepToUiMessage,
	deleteDraftIfEmpty,
	findUserMessageRow,
	insertDraftAssistantMessage,
	nextMessageSequence,
	lockThreadMessages,
	withEditWording,
	proposedEditsOf,
	touchThread,
	upsertAssistantUiMessage,
	withAccumulatedUsageMetadata,
	withEditStatuses,
	supersededEdits,
} from "./messages-persistence";
import { acceptedEditAllowed, documentReader } from "./proposal-applications";
import { repairAgentToolCall } from "./repair";
import { replyErrorMessage } from "./reply-errors";
import { claimActiveAgentRun, clearActiveAgentRunIfCurrent, isStaleAgentRun, reapStaleAgentRun } from "./runs";
import { agentStreamLifecycle } from "./streams";
import { buildAgentInstructions, buildAgentTools } from "./tools";

const MAX_AGENT_STEPS = 30;
const MAX_AGENT_OUTPUT_TOKENS = 8_192;
const AGENT_STEP_TIMEOUT_MS = 120_000;
// Reserve the final minute of the five-minute request budget for persistence and cleanup.
const AGENT_RUN_TIMEOUT_MS = 240_000;
const AGENT_TIMEOUT_MESSAGE = "Time limit reached. Your progress is saved. Ask me to continue.";
const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_THREAD_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const MAX_ACCOUNT_ATTACHMENT_BYTES = 1024 * 1024 * 1024;
const READABLE_ATTACHMENT_TYPES = new Set(["text/plain", "text/markdown", "application/json"]);
const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Word files read as text, as resume import reads them; a browser may send one without its type. */
const isDocxAttachment = (attachment: Pick<AgentAttachmentRecord, "mediaType" | "filename">) =>
	attachment.mediaType === DOCX_MEDIA_TYPE ||
	(attachment.mediaType === "application/octet-stream" && /\.docx$/i.test(attachment.filename));

/** An attachment's text when the server can read it: text files as they are, Word files through their XML. */
function attachmentText(
	attachment: AgentAttachmentRecord,
	data: Uint8Array,
): { text: string } | { unreadable: true } | null {
	if (READABLE_ATTACHMENT_TYPES.has(attachment.mediaType))
		return { text: new TextDecoder().decode(data).slice(0, MAX_ATTACHMENT_TEXT_CHARS) };
	if (!isDocxAttachment(attachment)) return null;
	try {
		return { text: extractDocxTextFromBytes(data).slice(0, MAX_ATTACHMENT_TEXT_CHARS) };
	} catch {
		return { unreadable: true };
	}
}
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

const activeRunCleanup = new Map<string, () => void>();
const activeRunTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

// Abort reasons MUST be an AbortError: the AI SDK only treats `err.name === "AbortError"`
// (via isAbortError) as a cancellation. A bare-string reason is treated as a genuine stream
// error whose rejection escapes the background (resumable-stream) pump and takes down the whole
// process with ERR_UNHANDLED_REJECTION. The label is preserved as the DOMException message.
const abortReason = (label: string) => new DOMException(label, "AbortError");

type AgentThreadRecord = typeof schema.agentThread.$inferSelect;
type AgentMessageRecord = typeof schema.agentMessage.$inferSelect;
type AgentAttachmentRecord = typeof schema.agentAttachment.$inferSelect;

type StartThreadInput = {
	scope?: "document" | "application" | "career" | undefined;
	applicationId?: string | undefined;
	userId: string;
	/** The document the conversation is about: a resume or a letter. */
	resumeId?: string | undefined;
	coverLetterId?: string | undefined;
	aiProviderId?: string | undefined;
};

/** What a message shares with the model: the open document and the posting it's for. Both on by default. */
type MessageContext = {
	application?: boolean | undefined;
	memory?: boolean | undefined;
	web?: boolean | undefined;
	tab?: WorkspaceTab | undefined;
	offerIds?: string[] | undefined;
	document?: boolean | undefined;
	posting?: boolean | undefined;
	applicationId?: string | undefined;
};

type SendMessageInput = {
	userId: string;
	deviceTimeZone?: string | undefined;
	threadId: string;
	message: UIMessage;
	attachmentIds?: string[] | undefined;
	context?: MessageContext | undefined;
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

type ThreadSummaryRow = AgentThreadRecord & {
	resumeName?: string | null;
	coverLetterName?: string | null;
	providerLabel?: string | null;
};

function toThreadSummary(row: ThreadSummaryRow) {
	return {
		id: row.id,
		title: row.title,
		status: row.status,
		scope: (row.scope ?? "document") as "document" | "application" | "career",
		applicationId: row.applicationId ?? null,
		sourceResumeId: row.sourceResumeId,
		workingResumeId: row.workingResumeId,
		coverLetterId: row.coverLetterId,
		aiProviderId: row.aiProviderId,
		resumeName: row.resumeName ?? null,
		coverLetterName: row.coverLetterName ?? null,
		providerLabel: row.providerLabel ?? null,
		editsProposed: row.editsProposed,
		editsAccepted: row.editsAccepted,
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

function toAttachment(row: AgentAttachmentRecord) {
	return {
		id: row.id,
		threadId: row.threadId,
		messageId: row.messageId,
		filename: row.filename,
		mediaType: row.mediaType,
		size: row.size,
		storagePath: row.storageKey,
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

/**
 * Drops file parts the model mustn't see as sent: attachment references (the server adds what it read) and, from
 * user messages, any other URL, which the AI SDK would download on the server for every turn.
 */
function withoutAgentAttachmentUiParts(message: UIMessage): UIMessage {
	return {
		...message,
		parts: message.parts.filter(
			(part) =>
				!(
					part.type === "file" &&
					(part.url.startsWith(AGENT_ATTACHMENT_URL_PREFIX) ||
						(message.role === "user" && !part.url.startsWith("data:")))
				),
		),
	};
}

// Provider output metadata can contain provider-owned item IDs. Keep it in UI history, but do not replay it as model input.
function withoutProviderMetadata(message: UIMessage, provider: { provider: string; model: string }): UIMessage {
	const metadata = message.metadata as { provider?: string; model?: string } | undefined;
	const preserveGoogleSignature =
		provider.provider === "gemini" && metadata?.provider === "gemini" && metadata.model === provider.model;
	const cleanMessage = {
		...message,
		parts: message.parts.map((part) => {
			const cleanPart = { ...part } as Record<string, unknown>;
			for (const key of ["providerMetadata", "callProviderMetadata", "resultProviderMetadata"]) {
				const value = cleanPart[key] as { google?: { thoughtSignature?: unknown } } | undefined;
				if (preserveGoogleSignature && typeof value?.google?.thoughtSignature === "string") {
					cleanPart[key] = {
						google: { thoughtSignature: value.google.thoughtSignature },
					};
				} else delete cleanPart[key];
			}
			return cleanPart as UIMessage["parts"][number];
		}),
	} as Record<string, unknown> & UIMessage;

	delete cleanMessage.providerMetadata;
	delete cleanMessage.callProviderMetadata;
	delete cleanMessage.resultProviderMetadata;

	return cleanMessage;
}

/**
 * Older conversations applied edits directly with a tool this assistant no longer has; the model sees what they did
 * as text, since some providers reject calls to tools they aren't given.
 */
function withoutLegacyPatchParts(message: UIMessage): UIMessage {
	if (!message.parts.some((part) => part.type === "tool-apply_resume_patch")) return message;
	return {
		...message,
		parts: message.parts.map((part) => {
			if (part.type !== "tool-apply_resume_patch") return part;
			const title = (part as { input?: { title?: unknown } }).input?.title;
			return {
				type: "text",
				text: `(Earlier, an edit was applied directly: ${typeof title === "string" ? title : "resume edit"}.)`,
			};
		}),
	};
}

function toModelInputMessage(
	message: UIMessage,
	provider: { provider: string; model: string },
	externalSearch: boolean,
): UIMessage {
	const sources = agentWebSources(message)
		.map((source) => `${source.title}: ${source.url}`)
		.join("\n");
	// Native calls are provider-owned (including Anthropic encrypted results). Replay portable evidence
	// instead, so changing models or the selected web connection cannot send an incompatible native call.
	const portable = {
		...message,
		parts: message.parts.map((part) => {
			if (
				part.type !== "tool-web_search" &&
				part.type !== "tool-google_search" &&
				!(part.type === "tool-search_web" && !externalSearch)
			)
				return part;
			const state = (part as AgentToolPart).state;
			return {
				type: "text" as const,
				text: `Earlier web search ${state === "output-available" ? "completed" : "did not complete"}.${sources ? ` Retrieved sources:\n${sources}` : ""}`,
			};
		}),
	};
	return withoutLegacyPatchParts(withoutProviderMetadata(withoutAgentAttachmentUiParts(portable), provider));
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

function buildAttachmentModelParts(input: AttachmentModelInput[]): Array<TextPart | ImagePart | FilePart> {
	return input.map(({ attachment, data }) => {
		const read = attachmentText(attachment, data);
		if (read && "text" in read)
			return {
				type: "text",
				text: `Attachment ${attachmentLabel(attachment)}:\n\n${read.text}`,
			};
		if (read)
			return {
				type: "text",
				text: `Attachment ${attachmentLabel(attachment)} couldn't be read: the Word file is damaged or has no text. Tell the user and ask them to paste its text.`,
			};

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

async function getUnlinkedMessageAttachments({ ids, ...input }: { ids: string[]; threadId: string; userId: string }) {
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
			message: "One or more attachments are unavailable or already sent. Attach the files again.",
		});
	}

	const attachmentsById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
	return ids.map((id) => {
		const attachment = attachmentsById.get(id);
		if (!attachment) {
			throw new ORPCError("BAD_REQUEST", {
				message: "One or more attachments are unavailable or already sent. Attach the files again.",
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
		throw new ORPCError("CONFLICT", {
			message: "One or more attachments were already sent with another message. Attach the files again.",
		});
	}
}

function readAttachmentModelInputs(attachments: AgentAttachmentRecord[]): Promise<AttachmentModelInput[]> {
	const storage = getStorageService();
	return Promise.all(
		attachments.map(async (attachment) => {
			const stored = await storage.read(attachment.storageKey);
			if (!stored) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Couldn't read ${attachment.filename}. Attach it again.`,
				});
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
	// oxlint-disable-next-line typescript/no-non-null-assertion -- index is valid; findLastIndex returned != -1
	const msg = messages[index]!;
	if (msg.role !== "user") return messages; // ponytail: redundant at runtime; keeps TS narrowed to user-message content type
	const content = typeof msg.content === "string" ? [{ type: "text" as const, text: msg.content }] : msg.content;
	return messages.with(index, { ...msg, content: [...content, ...parts] });
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

function updateAssistantToolResultMessage(input: {
	userId: string;
	threadId: string;
	message: UIMessage;
	contextScope?: string | undefined;
}) {
	return db.transaction(async (tx) => {
		const existingRows = await lockThreadMessages(tx, input);
		const existingRow = existingRows.find((row) => row.role === "assistant" && toMessage(row).id === input.message.id);
		if (!existingRow) {
			throw new ORPCError("BAD_REQUEST", {
				message: "The answered assistant message was not found.",
			});
		}
		// Lock order is by ID; continuation eligibility follows the conversation's chronological order.
		const latest = existingRows.toSorted((a, b) => a.sequence - b.sequence).at(-1);
		if (latest?.id !== existingRow.id) {
			throw new ORPCError("CONFLICT", {
				message: "This question is no longer the latest reply. Send a new message instead.",
			});
		}
		const stored = toMessage(existingRow);
		if (
			input.contextScope &&
			(stored.metadata as { contextScope?: string } | undefined)?.contextScope !== input.contextScope
		)
			throw new ORPCError("BAD_REQUEST", {
				message: "Send a new message after removing context. Previous tool approvals cannot be continued.",
			});

		const {
			message: mergedMessage,
			mergedCount,
			alreadyResolvedCount,
			resolvedQuestionCount,
			idempotentQuestionCount,
			pendingContinuationCount,
			conflictingCount,
		} = mergeClientToolResponses(stored, input.message);

		if (conflictingCount > 0) {
			throw new ORPCError("BAD_REQUEST", {
				message: "This approval was already answered with a different decision.",
			});
		}
		// A recorded-but-unexecuted approval (pendingContinuationCount) proceeds: a prior continuation
		// attempt failed after persisting the decision, and this retry is the recovery path. Identical
		// question answers recover only while their continuation row is non-terminal.
		const sameAnswerRecovery =
			existingRow.status !== "completed" &&
			resolvedQuestionCount > 0 &&
			idempotentQuestionCount === resolvedQuestionCount;
		if (mergedCount === 0 && pendingContinuationCount === 0 && !sameAnswerRecovery) {
			if (alreadyResolvedCount > 0) {
				throw new ORPCError("CONFLICT", {
					message: "This response was already handled.",
				});
			}
			throw new ORPCError("BAD_REQUEST", {
				message: "No matching unanswered user question was found.",
			});
		}

		await tx
			.update(schema.agentMessage)
			.set({
				status: "streaming",
				uiMessage: mergedMessage as unknown as Record<string, unknown>,
			})
			.where(
				and(
					eq(schema.agentMessage.id, existingRow.id),
					eq(schema.agentMessage.threadId, input.threadId),
					eq(schema.agentMessage.userId, input.userId),
				),
			);

		await tx
			.update(schema.agentThread)
			.set({ lastMessageAt: new Date() })
			.where(and(eq(schema.agentThread.id, input.threadId), eq(schema.agentThread.userId, input.userId)));

		return { message: mergedMessage, rowId: existingRow.id };
	});
}

async function repairLegacyAskUserQuestionAnswers(
	rows: AgentMessageRecord[],
	input: { threadId: string; userId: string },
) {
	const nextRows = [...rows];

	for (let index = 0; index < nextRows.length - 1; index++) {
		const assistantRow = nextRows[index];
		const answerRow = nextRows[index + 1];
		if (!assistantRow || !answerRow || assistantRow.role !== "assistant" || answerRow.role !== "user") continue;
		const answer = messageText(toMessage(answerRow));
		if (!answer || !getFirstUnansweredAskUserQuestionToolCallId(toMessage(assistantRow))) continue;
		await db.transaction(async (tx) => {
			const locked = await lockThreadMessages(tx, input);
			const current = locked.find((row) => row.id === assistantRow.id);
			if (!current) return;
			const toolCallId = getFirstUnansweredAskUserQuestionToolCallId(toMessage(current));
			if (!toolCallId) {
				nextRows[index] = current;
				return;
			}
			const message = answerAskUserQuestionToolCall(toMessage(current), toolCallId, answer);
			await tx
				.update(schema.agentMessage)
				.set({ status: "completed", uiMessage: message as unknown as Record<string, unknown> })
				.where(and(eq(schema.agentMessage.id, current.id), eq(schema.agentMessage.userId, input.userId)));
			nextRows[index] = { ...current, uiMessage: message as unknown as AgentMessageRecord["uiMessage"] };
		});
	}

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

/**
 * Compares links the way people write them: a fragment or the punctuation ending a sentence
 * ("read https://example.com/job.") doesn't make it a different page. Host case is normalized by URL.
 */
function sourceKey(value: string): string | null {
	try {
		if (value.length > 2048) return null;
		const url = new URL(value.trim().replace(/[.,;:!?'"*)\]]+$/, ""));
		url.hash = "";
		return url.toString();
	} catch {
		return null;
	}
}

function messageText(message: UIMessage) {
	const textParts: string[] = [];

	for (const part of message.parts) {
		if (part.type === "text") textParts.push(part.text);
	}

	return textParts.join(" ").trim();
}

/** The first message names the conversation: up to 57 characters, or 44 in the career coach's list. */
function buildThreadTitle(message: UIMessage, fallback: string, max = 60) {
	const text = messageText(message);
	if (!text) return fallback;
	return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/**
 * Messages written before Knowledge last changed (a fact forgotten, corrected or switched off) are no longer sent:
 * they may repeat what was withdrawn. The coach always reads Knowledge; a document conversation only from its first
 * Knowledge search, so its earlier messages stay. `send` replays the rest; `get` names the withheld ones.
 */
async function withheldMessageRows(thread: { scope: string }, rows: AgentMessageRecord[], userId: string) {
	const since =
		thread.scope === "document" ? rows.find((row) => readsKnowledge(toMessage(row)))?.createdAt : new Date(0);
	if (!since) return { cutoffAt: null, rows: [] as AgentMessageRecord[] };
	const cutoffAt = await careerService.memoryCutoff(userId);
	return {
		cutoffAt,
		rows: cutoffAt ? rows.filter((row) => row.createdAt >= since && row.createdAt <= cutoffAt) : [],
	};
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

	const read = attachmentText(attachment, stored.data);
	// A failed read shows as failed, not as "Read the attachment" followed by "I can't read it".
	if (read && !("text" in read)) throw new Error("This Word file is damaged or has no text.");
	if (!read) {
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
		content: read.text,
	};
}

type AgentPosting = NonNullable<Awaited<ReturnType<typeof findPosting>>>;

/** The application a resume was made for: null for a base resume other jobs can share. */
async function resumeMadeFor(userId: string, resumeId: string) {
	const [row] = await db
		.select({ applicationId: schema.resume.applicationId })
		.from(schema.resume)
		.where(and(eq(schema.resume.id, resumeId), eq(schema.resume.userId, userId)));
	return row?.applicationId ?? null;
}

/** Switched-on Knowledge facts visible to the job (or shared ones without one): never another application's. */
async function knowledgeFacts(userId: string, applicationId: string | null, query?: string) {
	const facts = await careerService.facts({ userId, applicationId, query });
	return facts.filter((fact) => fact.status === "active");
}

/** Places the model's edits on the document and counts them toward the conversation's outcome. */
async function proposeEdits(input: {
	userId: string;
	threadId: string;
	document: AssistantDocument;
	edits: ProposeEditsInput | ProposeResumeEditsInput;
	posting: AgentPosting | null;
	knowledge: boolean;
}): Promise<ProposeEditsOutput> {
	const loaded = await loadDocument(input.userId, input.document);
	const facts = input.knowledge ? await knowledgeFacts(input.userId, input.posting?.applicationId ?? null) : [];
	const output = resolveDocumentEdits(loaded, input.edits, {
		facts: new Map(facts.map((fact) => [fact.id, fact.text])),
		posting: input.posting,
	});
	if (output.edits.length > 0) {
		await db
			.update(schema.agentThread)
			.set({
				editsProposed: sql`${schema.agentThread.editsProposed} + ${output.edits.length}`,
			})
			.where(and(eq(schema.agentThread.id, input.threadId), eq(schema.agentThread.userId, input.userId)));
		const supersedes = await supersedeEarlierEdits(input, output.edits, loaded);
		if (supersedes.length > 0) return { ...output, supersedes };
	}
	return output;
}

function instructionsFor(text: string, provider: Parameters<typeof getModel>[0]["provider"]) {
	return provider === "anthropic"
		? {
				role: "system" as const,
				content: text,
				providerOptions: { anthropic: { cacheControl: { type: "ephemeral" as const } } },
			}
		: text;
}

/**
 * A refinement replaces the conversation's earlier undecided suggestion for the same passage. The new result names
 * them and the apps show them as replaced, so the user isn't asked to clean up after the reply. Nothing is written
 * here: an earlier edit counts as replaced only once the result that replaces it is saved with its reply.
 */
async function supersedeEarlierEdits(
	input: { userId: string; threadId: string },
	edits: ProposeEditsOutput["edits"],
	document: Awaited<ReturnType<typeof loadDocument>>,
) {
	const held = (edit: ProposeEditsOutput["edits"][number]) => {
		const value = document.read(edit.target);
		return value !== undefined && canApplyTo(value, { before: edit.after });
	};
	const rows = await listThreadMessages(input);
	return rows.flatMap((row) => supersededEdits(toMessage(row), edits, held));
}

function createAgent(input: {
	/** Runs immediately before every SDK call and returns fresh instructions after re-projecting shared inputs. */
	authorize: () => Promise<string | undefined>;
	deviceTimeZone?: string | undefined;
	career?: {
		context: Awaited<ReturnType<typeof careerService.context>>;
		shareApplication: boolean;
		shareMemory: boolean;
		web: boolean;
		tab: WorkspaceTab | undefined;
		offers: Awaited<ReturnType<typeof careerService.savedItems>>;
		/** This application's saved work and typed answers, when the user shares the application. */
		items: Awaited<ReturnType<typeof careerService.savedItems>>;
		answers: { question: string; answer: string }[];
		sourceMessageId: string | undefined;
	};
	/** Pages the model may read: links the user wrote or sources found earlier; search results join them. */
	allowedSources: Iterable<string>;
	userId: string;
	threadId: string;
	/** Null when the message leaves the document out. */
	document: (AssistantDocument & { name: string }) | null;
	posting: AgentPosting | null;
	/** The open resume is the copy made for the posting's application, so tailoring can edit it. */
	jobCopy: boolean;
	/** The user shared their switched-on Knowledge facts with this message. */
	knowledge: boolean;
	provider: {
		provider: Parameters<typeof getModel>[0]["provider"];
		model: string;
		apiKey: string;
		baseURL?: string;
	};
	model: ReturnType<typeof getModel>;
	connection: WebAccessConnection | null;
	/** Whether web search is available: through the connection, or the server's SearXNG without one. */
	search: boolean;
	signal: AbortSignal;
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

	const { document } = input;
	const allowedSources = new Map<string, string>();
	const allow = (url: string | null | undefined) => {
		const key = url ? sourceKey(url) : null;
		if (key) allowedSources.set(key, key);
	};
	for (const url of input.allowedSources) allow(url);
	if (input.career?.shareApplication) {
		const application = input.career.context.application;
		allow(application?.sourceUrl);
		const interview = input.career.context.interview;
		if (interview?.type === "interview")
			for (const participant of interview.participants ?? []) allow(participant.profileUrl);
	}
	const tools = buildAgentTools({
		document: document?.kind ?? null,
		// The career coach searches only when the user switched Web research on for this message.
		externalSearch: input.search && (!input.career || input.career.web),
		signal: input.signal,
		handlers: {
			searchWeb: timedToolHandler("search_web", async (query: string, signal: AbortSignal) => {
				// General research searches the user's countries but keeps the query as written.
				const { regions } = await searchScope(input.userId, input.deviceTimeZone);
				const result = await searchWeb(query, {
					connection: input.connection,
					userId: input.userId,
					signal,
					regions,
				});
				for (const resultSource of result) allow(resultSource.url);
				return result;
			}),
			readPage: timedToolHandler("read_page", async (url: string, signal: AbortSignal) => {
				// Text the model reads (pages, attachments, postings) can ask it to put data in a URL; an allowlist keeps
				// every request to a page the user or a search chose.
				const key = sourceKey(url);
				const approvedUrl = key ? allowedSources.get(key) : undefined;
				if (!approvedUrl) throw new Error("Read only retrieved URLs or public links supplied by the user.");
				const { html: _html, ...page } = await readPage(approvedUrl, {
					connection: input.connection,
					userId: input.userId,
					signal,
				});
				allow(page.resolvedUrl ?? page.requestedUrl);
				return page;
			}),
			readDocument: timedToolHandler("read_document", async () => {
				if (!document) throw new Error("The document isn't shared with this message.");
				return documentView(await loadDocument(input.userId, document));
			}),
			readAttachment: timedToolHandler("read_attachment", (attachmentId: string) =>
				readAttachment({
					id: attachmentId,
					threadId: input.threadId,
					userId: input.userId,
				}),
			),
			proposeEdits: timedToolHandler("propose_edits", (edits: ProposeEditsInput | ProposeResumeEditsInput) => {
				if (!document) throw new Error("The document isn't shared with this message.");
				return proposeEdits({
					userId: input.userId,
					threadId: input.threadId,
					document,
					edits,
					posting: input.posting,
					knowledge: input.knowledge,
				});
			}),
			readKnowledge: input.knowledge
				? timedToolHandler("read_knowledge", async (query: string) => {
						const scope = { userId: input.userId, applicationId: input.posting?.applicationId ?? null };
						const facts = await knowledgeFacts(scope.userId, scope.applicationId, query);
						const context = await careerService.context(scope);
						const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
						const matches = context.stories.filter(
							(story) =>
								!terms.length || terms.some((term) => JSON.stringify(story.data).toLocaleLowerCase().includes(term)),
						);
						const projectFact = ({ id, text, category }: (typeof context.facts)[number]) => ({ id, text, category });
						const available = new Map(context.facts.map((fact) => [fact.id, projectFact(fact)]));
						const selected = new Map(
							facts.slice(0, 30).flatMap((fact) => {
								const active = available.get(fact.id);
								return active ? [[active.id, active] as const] : [];
							}),
						);
						const stories: Array<{ id: string; data: Omit<(typeof matches)[number]["data"], "applicationId"> }> = [];
						// Story additions and newly needed proof share 16k; direct fact hits retain their existing 30-item cap.
						let remaining = 16_000;
						let truncated = facts.length > 30;
						for (const {
							id,
							data: { applicationId: _applicationId, ...data },
						} of matches) {
							const story = { id, data };
							const backing = data.factIds.flatMap((factId) => available.get(factId) ?? []);
							const missing = backing.filter((fact) => !selected.has(fact.id));
							const size = JSON.stringify(story).length + JSON.stringify(missing).length;
							if (backing.length !== data.factIds.length || size > remaining) {
								truncated = true;
								continue;
							}
							remaining -= size;
							stories.push(story);
							for (const fact of missing) selected.set(fact.id, fact);
						}
						// Source and application/account metadata stay private.
						return {
							facts: [...selected.values()],
							stories,
							truncated,
						};
					})
				: undefined,
		},
	});

	if (input.career) Object.assign(tools, buildCareerTools({ userId: input.userId, ...input.career }));
	const instructionsText = input.career
		? buildCareerInstructions(input.career)
		: buildAgentInstructions({
				document: document ? { kind: document.kind, name: document.name } : null,
				posting: input.posting ? { ...input.posting, jobCopy: input.jobCopy } : null,
				knowledge: input.knowledge,
				searchTool: "search_web" in tools ? "search_web" : null,
				canReadPage: "read_page" in tools,
			});

	return new ToolLoopAgent({
		// The SDK's default logs the whole error, with the provider's response body (which can echo request data). One
		// line names the failure instead: its class and HTTP status, never its text or body.
		onError: ({ error }) => {
			const cause = RetryError.isInstance(error) ? error.lastError : error;
			console.error(
				JSON.stringify({
					evt: "agent.error",
					threadId: input.threadId,
					name: cause instanceof Error ? cause.name : typeof cause,
					statusCode: APICallError.isInstance(cause) ? cause.statusCode : undefined,
				}),
			);
		},
		toolApproval: { search_web: "user-approval", save_story: "user-approval" },
		experimental_toolApprovalSecret: env.AUTH_SECRET,
		// Providers without native inputExamples support get them appended to the tool description.
		model: wrapLanguageModel({
			model: input.model,
			middleware: addToolInputExamplesMiddleware(),
		}),
		// The loop re-sends stable instructions every step; on anthropic, prompt caching pays from step 2.
		// prepareStep may replace them with a fresh projection at the authorization boundary.
		instructions: instructionsFor(instructionsText, input.provider.provider),
		repairToolCall: repairAgentToolCall,
		stopWhen: isStepCount(MAX_AGENT_STEPS),
		maxOutputTokens: MAX_AGENT_OUTPUT_TOKENS,
		maxRetries: 0,
		timeout: { stepMs: AGENT_STEP_TIMEOUT_MS },
		// Runs before every loop step, so an older document snapshot never outlives a newer read.
		prepareStep: async ({ messages }) => {
			const pruned = pruneAgentModelContext(messages);
			const fresh = await input.authorize();
			input.signal.throwIfAborted();
			return {
				...(pruned === messages ? {} : { messages: pruned }),
				...(fresh ? { instructions: instructionsFor(fresh, input.provider.provider) } : {}),
			};
		},
		tools,
	});
}

const threadSummarySelection = {
	...getColumns(schema.agentThread),
	resumeName: schema.resume.name,
	coverLetterName: schema.coverLetter.name,
	providerLabel: schema.aiProvider.label,
};

/** A document's name, locked state and whether the user owns it, or null when it's gone. */
async function describeDocument(userId: string, document: AssistantDocument | null) {
	if (!document) return null;
	try {
		if (document.kind === "resume") {
			const resume = await resumeService.getById({ id: document.id, userId });
			return { ...document, name: resume.name, locked: resume.isLocked };
		}
		const letter = await coverLetterService.getById({
			id: document.id,
			userId,
		});
		return { ...document, name: letter.name, locked: letter.isLocked };
	} catch {
		return null;
	}
}

export const agentService = {
	threads: {
		/** Every conversation, newest first, with its document and outcome, for past conversations. */
		list: async (input: { userId: string }) => {
			assertAgentEnvironment();

			const rows = await db
				.select(threadSummarySelection)
				.from(schema.agentThread)
				.leftJoin(schema.resume, eq(schema.agentThread.workingResumeId, schema.resume.id))
				.leftJoin(schema.coverLetter, eq(schema.agentThread.coverLetterId, schema.coverLetter.id))
				.leftJoin(schema.aiProvider, eq(schema.agentThread.aiProviderId, schema.aiProvider.id))
				.where(and(eq(schema.agentThread.userId, input.userId), isNull(schema.agentThread.deletedAt)))
				.orderBy(desc(schema.agentThread.lastMessageAt));

			return rows.map(toThreadSummary);
		},

		/** A new conversation about one document, which the assistant reads and proposes edits to. */
		start: async (input: StartThreadInput) => {
			assertAgentEnvironment();

			const document: AssistantDocument | null = input.coverLetterId
				? { kind: "letter", id: input.coverLetterId }
				: input.resumeId
					? { kind: "resume", id: input.resumeId }
					: null;
			// The router's input refine already pairs the scope with exactly one document or application.
			const scope = input.scope ?? "document";
			if (scope !== "document") await requireCareerApplication(input);

			// Confirms the caller owns the document (throws otherwise) and names it for the summary.
			const described = !document
				? null
				: document.kind === "resume"
					? await resumeService.getById({
							id: document.id,
							userId: input.userId,
						})
					: await coverLetterService.getById({
							id: document.id,
							userId: input.userId,
						});

			const provider = input.aiProviderId
				? await aiProvidersService.getRunnableById({
						id: input.aiProviderId,
						userId: input.userId,
					})
				: await aiProvidersService.getDefaultRunnable({ userId: input.userId });
			if (!provider)
				throw new ORPCError("BAD_REQUEST", {
					message: "Test and turn on an AI provider in Settings → AI & developer first.",
				});

			const [thread] = await db
				.insert(schema.agentThread)
				.values({
					userId: input.userId,
					aiProviderId: provider.id,
					scope,
					applicationId: input.applicationId ?? null,
					...(!document
						? {}
						: document.kind === "resume"
							? { sourceResumeId: document.id, workingResumeId: document.id }
							: { coverLetterId: document.id }),
					title: "New conversation",
				})
				.returning();
			if (!thread) throw new Error("AGENT_THREAD_CREATE_FAILED");

			return toThreadSummary({
				...thread,
				...(!described || !document
					? {}
					: document.kind === "resume"
						? { resumeName: described.name }
						: { coverLetterName: described.name }),
				providerLabel: provider.label,
			});
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

			const [rows, attachments, document] = await Promise.all([
				listThreadMessages({ threadId: input.id, userId: input.userId }),
				db
					.select()
					.from(schema.agentAttachment)
					.where(and(eq(schema.agentAttachment.threadId, input.id), eq(schema.agentAttachment.userId, input.userId)))
					.orderBy(asc(schema.agentAttachment.createdAt)),
				describeDocument(input.userId, documentOf(thread)),
			]);

			const withheld = await withheldMessageRows(thread, rows, input.userId);
			// Rows saved before messages carried an id can't be named, only left out.
			const ids = (list: AgentMessageRecord[]) =>
				list.flatMap((row) => (typeof toMessage(row).id === "string" ? [toMessage(row).id] : []));
			// A reply that read Knowledge is hidden once a fact it may repeat changed, was switched off or was forgotten.
			const cutoff = thread.scope === "document" ? withheld.cutoffAt : null;
			const withdrawn = knowledgeWithdrawals(
				rows.map((row) => ({ message: toMessage(row), createdAt: row.createdAt })),
				cutoff,
			);
			// Edits this resume can't accept reach no app as something to apply, older apps included.
			const madeFor =
				thread.workingResumeId && !thread.coverLetterId
					? await resumeMadeFor(input.userId, thread.workingResumeId)
					: undefined;
			return {
				thread: toThreadSummary(thread),
				messages: rows.map((row) => {
					const message = toMessage(row);
					if (withdrawn.has(message.id)) return withdrawKnowledgeReply(message);
					return madeFor === undefined ? message : withUsableTailoring(message, madeFor);
				}),
				attachments: attachments.map(toAttachment),
				document,
				isReadOnly: !thread.aiProviderId || (thread.scope === "document" ? !document || document.locked : false),
				history: { cutoffAt: withheld.cutoffAt, withheld: ids(withheld.rows) },
				// Replies that ended early (stopped, timed out, failed or cut off by a restart), as their rows record it.
				interrupted: ids(rows.filter((row) => row.role === "assistant" && row.status === "canceled")),
			};
		},

		/** Switches the model a conversation uses ("Switch model"). */
		update: async (input: {
			id: string;
			userId: string;
			aiProviderId?: string | undefined;
			title?: string | undefined;
		}) => {
			assertAgentEnvironment();

			await getThread({ id: input.id, userId: input.userId });
			// Renaming needs no working connection; switching models checks the new one.
			const provider = input.aiProviderId
				? await aiProvidersService.getRunnableById({ id: input.aiProviderId, userId: input.userId })
				: null;

			const [updated] = await db
				.update(schema.agentThread)
				.set({ ...(provider ? { aiProviderId: provider.id } : {}), ...(input.title ? { title: input.title } : {}) })
				.where(and(eq(schema.agentThread.id, input.id), eq(schema.agentThread.userId, input.userId)))
				.returning();
			if (!updated) throw new ORPCError("NOT_FOUND");

			const [current] = updated.aiProviderId
				? await db
						.select({ label: schema.aiProvider.label })
						.from(schema.aiProvider)
						.where(eq(schema.aiProvider.id, updated.aiProviderId))
				: [];
			return toThreadSummary({ ...updated, providerLabel: provider?.label ?? current?.label ?? null });
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
				// Deleting a conversation deletes what was said in it; the thread row stays only as a tombstone.
				await db
					.delete(schema.agentMessage)
					.where(and(eq(schema.agentMessage.threadId, input.id), eq(schema.agentMessage.userId, input.userId)));
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

			const thread = await getThread({
				id: input.threadId,
				userId: input.userId,
			});
			if (thread.status === "archived") {
				throw new ORPCError("CONFLICT", {
					message: "This conversation is archived. Start a new conversation to continue.",
				});
			}
			if (thread.activeRunId) {
				if (!isStaleAgentRun(thread)) {
					throw new ORPCError("CONFLICT", {
						message: "This conversation is still replying. Wait for it to finish, or stop it.",
					});
				}
				// Lazy reap: a dead run's claim heals on the next send instead of CONFLICTing forever.
				await reapStaleAgentRun({
					threadId: input.threadId,
					userId: input.userId,
					runId: thread.activeRunId,
					streamId: thread.activeStreamId,
				});
			}
			const document = documentOf(thread);
			const isCareer = thread.scope === "career" || thread.scope === "application";
			const documentMemoryVersion =
				!isCareer && document && input.context?.memory === true
					? await careerService.memoryVersion(input.userId)
					: null;
			if (isCareer) {
				await requireCareerApplication({ userId: input.userId, applicationId: thread.applicationId });
			}
			if ((!document && !isCareer) || !thread.aiProviderId) {
				throw new ORPCError("BAD_REQUEST", {
					message: "This conversation is read-only. Start a new conversation to continue.",
				});
			}
			if (input.message.role !== "user" && input.message.role !== "assistant") {
				throw new ORPCError("BAD_REQUEST", {
					message: "Agent messages must be user messages or tool results.",
				});
			}
			// Leaving the document or posting out applies to the entire provider context, including document-derived prose
			// and tool results. The career coach's chips only choose what this message adds: earlier messages in the chat
			// still go, and its privacy line says so.
			const freshContext = !isCareer && (input.context?.document === false || input.context?.posting === false);
			const contextScope = JSON.stringify([input.context?.document !== false, input.context?.posting !== false]);

			// Deliberately schema-less: provider-echoed tool parts must pass, and replayed history is never re-validated.
			const validated = await safeValidateUIMessages({
				messages: [input.message],
			});
			if (!validated.success) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Invalid UI message parts.",
				});
			}
			// Files reach the model only as uploaded attachments: a URL here would make the server download it.
			if (
				input.message.role === "user" &&
				input.message.parts.some((part) => part.type === "file" && !part.url.startsWith(AGENT_ATTACHMENT_URL_PREFIX))
			)
				throw new ORPCError("BAD_REQUEST", { message: "Attach files by uploading them." });

			const loaded = document ? await loadDocument(input.userId, document) : null;
			if (loaded?.locked)
				throw new ORPCError("BAD_REQUEST", {
					message: "Unlock the document to change it.",
				});
			const posting =
				input.context?.posting === false || !document || !loaded
					? null
					: await findPosting(input.userId, document.id, loaded, input.context?.applicationId);

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

			const claimed = await claimActiveAgentRun({
				threadId: input.threadId,
				userId: input.userId,
				runId,
				streamId,
			});
			if (!claimed) {
				throw new ORPCError("CONFLICT", {
					message: "This conversation is still replying. Wait for it to finish, or stop it.",
				});
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
			let draftUiMessage: UIMessage = {
				id: responseMessageId,
				role: "assistant",
				parts: [],
				metadata: { contextScope, contextMessageId: input.message.id },
			};

			try {
				activeRunCleanup.set(runId, await monitorRunCancellation(runId, controller));
				controller.signal.throwIfAborted();
				let attachmentsForModel: AgentAttachmentRecord[] = [];
				let sourceMessageId: string | undefined;

				if (input.message.role === "assistant") {
					if (attachments.length > 0) {
						throw new ORPCError("BAD_REQUEST", {
							message: "Tool result messages cannot include attachments.",
						});
					}

					// Merge AFTER the exclusive claim: concurrent approve/deny requests serialize on
					// the claim instead of both persisting, and a merge that is rejected (or any later
					// setup failure) releases the claim via the catch below. A response persisted by a
					// failed earlier attempt re-enters as pendingContinuation and still gets its run.
					const continuation = await updateAssistantToolResultMessage({
						userId: input.userId,
						threadId: input.threadId,
						message: input.message,
						contextScope: freshContext ? contextScope : undefined,
					});
					draftRowId = continuation.rowId;
					draftUiMessage = continuation.message;
				} else {
					attachmentsForModel = attachments;
					const userMessage = withAttachmentUiParts(input.message, attachments);
					// Retrying a reply that failed sends the same message again; it's saved once.
					const retried = await findUserMessageRow({
						userId: input.userId,
						threadId: input.threadId,
						uiMessageId: input.message.id,
					});
					const persistedUserMessage =
						retried ??
						(await persistMessage({
							userId: input.userId,
							threadId: input.threadId,
							message: userMessage,
							sequence: await nextMessageSequence(input.threadId, db),
						}));
					if (!persistedUserMessage) throw new Error("AGENT_MESSAGE_CREATE_FAILED");
					// "Try again" after a reply stopped before it said anything: the empty attempt is replaced, not kept
					// above the new one. A stopped reply with content stays; it is continued, not retried.
					if (retried) {
						const [asked] = await db
							.select({ sequence: schema.agentMessage.sequence })
							.from(schema.agentMessage)
							.where(eq(schema.agentMessage.id, retried.id));
						if (asked)
							await db
								.delete(schema.agentMessage)
								.where(
									and(
										eq(schema.agentMessage.threadId, input.threadId),
										eq(schema.agentMessage.userId, input.userId),
										eq(schema.agentMessage.role, "assistant"),
										eq(schema.agentMessage.status, "canceled"),
										gt(schema.agentMessage.sequence, asked.sequence),
										sql`jsonb_array_length(${schema.agentMessage.uiMessage}->'parts') = 0`,
									),
								);
					}
					sourceMessageId = persistedUserMessage.id;
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
							.set({ title: buildThreadTitle(userMessage, thread.title, isCareer ? 47 : 60) })
							.where(and(eq(schema.agentThread.id, input.threadId), eq(schema.agentThread.userId, input.userId)));
					}
				}

				await aiProvidersService.markUsed({
					id: runnableProvider.id,
					userId: input.userId,
				});

				// Career conversations share the selected Knowledge context; document lookups remain opt-in below.
				const careerContext = isCareer
					? await careerService.context({ userId: input.userId, applicationId: thread.applicationId })
					: null;
				const messageRows = await repairLegacyAskUserQuestionAnswers(
					await listThreadMessages({
						threadId: input.threadId,
						userId: input.userId,
					}),
					{ threadId: input.threadId, userId: input.userId },
				);
				const messages = messageRows.map(toMessage);
				const withheld = new Set(
					(await withheldMessageRows(thread, messageRows, input.userId)).rows.map((row) => row.id),
				);
				const contextMessageId = (draftUiMessage.metadata as { contextMessageId?: string } | undefined)
					?.contextMessageId;
				const contextMessage = messages.find((message) => message.role === "user" && message.id === contextMessageId);
				if (freshContext && input.message.role === "assistant" && !contextMessage)
					throw new ORPCError("BAD_REQUEST", { message: "Send a new message to continue with the selected context." });
				const replay = freshContext
					? input.message.role === "assistant" && contextMessage
						? [contextMessage, draftUiMessage]
						: [withAttachmentUiParts(input.message, attachmentsForModel)]
					: // History from before a fact changed is left out, but never the message being answered (a retry
						// keeps its first createdAt).
						messageRows.filter((row) => !withheld.has(row.id) || row.id === sourceMessageId).map(toMessage);
				// Opt-in for document conversations: older clients never send it, and their disclosure doesn't mention it.
				const knowledge = !isCareer && Boolean(document) && input.context?.memory === true;
				// Document conversations reuse the career memory cutoff. Every reply from the first Knowledge lookup on is never
				// sent again once a fact changed after it began, nor when this message leaves Knowledge out: its words, questions
				// and proposals may repeat those facts. A paused reply in that range can only continue under the same conditions.
				const knowledgeCutoff =
					!isCareer && messages.some(readsKnowledge) ? await careerService.memoryCutoff(input.userId) : null;
				const withdrawals = isCareer
					? new Set<string>()
					: knowledgeWithdrawals(
							messageRows.map((row) => ({ message: toMessage(row), createdAt: row.createdAt })),
							knowledgeCutoff,
							knowledge,
						);
				const withdrawn = (message: UIMessage) => withdrawals.has(message.id);
				if (input.message.role === "assistant" && withdrawn(draftUiMessage))
					throw new ORPCError("BAD_REQUEST", {
						message: "Knowledge changed or isn't shared with this message. Send a new message to continue.",
					});
				const connection = await webAccessService.resolve(input.userId);
				const search = webAccessService.canSearch(connection !== null);
				const modelMessages = await convertToModelMessages(
					replay.map((message) =>
						toModelInputMessage(
							withdrawn(message) ? withdrawKnowledgeReply(message, true) : message,
							runnableProvider,
							search,
						),
					),
				);
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

				if (careerContext && careerContext.memoryVersion !== (await careerService.memoryVersion(input.userId)))
					throw new ORPCError("CONFLICT", { message: "Career memory changed. Try again." });
				// Re-project the categories this message newly shares at the provider boundary. A deletion or edit
				// after the request began must not leave old text in instructions that are about to be sent.
				const projectCareerInstructions = async (reader: DbOrTx) => {
					if (!careerContext) return undefined;
					const shareApplication = input.context?.application !== false;
					const applicationId = careerContext.application?.id;
					const [items, answers] =
						shareApplication && applicationId
							? await Promise.all([
									careerService.savedItems({ userId: input.userId, applicationId }, reader, careerContext),
									careerService.workspaceAnswers(input.userId, applicationId, reader),
								])
							: [[], []];
					const offers = input.context?.offerIds?.length
						? (await careerService.savedItems({ userId: input.userId, kind: "offer" }, reader)).filter((offer) =>
								input.context?.offerIds?.includes(offer.id),
							)
						: [];
					return buildCareerInstructions({
						context: careerContext,
						shareApplication,
						shareMemory: input.context?.memory !== false,
						tab: input.context?.tab,
						items,
						answers,
						offers,
					});
				};
				const agent = createAgent({
					authorize: async () => {
						controller.signal.throwIfAborted();
						let freshInstructions: string | undefined;
						await aiProvidersService.authorize({ userId: input.userId, id: runnableProvider.id }, async (tx) => {
							const [currentThread] = await tx
								.select({ id: schema.agentThread.id, providerId: schema.agentThread.aiProviderId })
								.from(schema.agentThread)
								.where(
									and(
										eq(schema.agentThread.id, input.threadId),
										eq(schema.agentThread.userId, input.userId),
										isNull(schema.agentThread.deletedAt),
									),
								)
								.for("share");
							if (!currentThread || currentThread.providerId !== runnableProvider.id)
								throw new ORPCError("CONFLICT", {
									message: "This conversation changed. Open it again before sending.",
								});
							if (document && loaded && input.context?.document !== false)
								await assertDocumentVersion(tx, input.userId, { ...document, updatedAt: loaded.updatedAt });
							if (loaded?.sourceResume && input.context?.document !== false)
								await assertDocumentVersion(tx, input.userId, { kind: "resume", ...loaded.sourceResume });
							if (posting)
								await assertApplicationVersion(tx, input.userId, {
									id: posting.applicationId,
									updatedAt: posting.updatedAt,
								});
							if (documentMemoryVersion !== null)
								await careerService.assertMemoryVersion(
									input.userId,
									documentMemoryVersion,
									undefined,
									undefined,
									undefined,
									tx,
								);
							if (careerContext)
								await careerService.assertMemoryVersion(
									input.userId,
									careerContext.memoryVersion,
									{
										applicationId: thread.applicationId,
										...(input.context?.application !== false
											? {
													...(careerContext.application ? { application: careerContext.application } : {}),
													documents: [careerContext.resume, careerContext.letter].filter(
														(entry): entry is NonNullable<typeof entry> => entry !== null,
													),
												}
											: {}),
										...(input.context?.memory !== false
											? {
													sources: {
														facts: careerContext.facts,
														stories: careerContext.stories,
														profile: careerContext.profile,
													},
												}
											: {}),
									},
									undefined,
									undefined,
									tx,
								);
							freshInstructions = await projectCareerInstructions(tx);
						});
						controller.signal.throwIfAborted();
						return freshInstructions;
					},
					deviceTimeZone: input.deviceTimeZone,
					userId: input.userId,
					threadId: input.threadId,
					document:
						input.context?.document === false || !document || !loaded ? null : { ...document, name: loaded.name },
					...(careerContext && isCareer
						? await (async () => {
								const shareApplication = input.context?.application !== false;
								const items =
									shareApplication && careerContext.application
										? await careerService.savedItems({
												userId: input.userId,
												applicationId: careerContext.application.id,
											})
										: [];
								const answers =
									shareApplication && careerContext.application
										? await careerService.workspaceAnswers(input.userId, careerContext.application.id)
										: [];
								return {
									career: {
										context: careerContext,
										shareApplication,
										shareMemory: input.context?.memory !== false,
										web: input.context?.web === true,
										tab: input.context?.tab,
										offers: input.context?.offerIds?.length
											? (await careerService.savedItems({ userId: input.userId, kind: "offer" })).filter((offer) =>
													input.context?.offerIds?.includes(offer.id),
												)
											: [],
										items,
										answers,
										sourceMessageId,
									},
								};
							})()
						: {}),
					allowedSources: [
						...replay.flatMap((message) => agentWebSources(message).map((source) => source.url)),
						...[...replay, input.message]
							.filter((message) => message.role === "user")
							.flatMap((message) => messageText(message).match(/https?:\/\/[^\s<>")]+/g) ?? []),
					],
					posting,
					jobCopy: loaded?.kind !== "resume" || !posting || loaded.applicationId === posting.applicationId,
					knowledge,
					connection,
					search,
					signal: controller.signal,
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
							draftUiMessage = {
								...draftUiMessage,
								metadata: {
									...(draftUiMessage.metadata as Record<string, unknown> | undefined),
									provider: runnableProvider.provider,
									model: runnableProvider.model,
								},
							};
							const upserted = await upsertAssistantUiMessage({
								userId: input.userId,
								threadId: input.threadId,
								...(draftRowId ? { rowId: draftRowId } : {}),
								message: draftUiMessage,
								status: "streaming",
							});
							draftRowId = upserted.rowId;
						} catch (error) {
							console.error("[agent] Failed to persist step draft", {
								name: error instanceof Error ? error.name : "Error",
							});
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
									part.type === "finish"
										? {
												usage: part.totalUsage,
												model: runnableProvider.model,
												provider: runnableProvider.provider,
												contextScope,
												contextMessageId,
											}
										: undefined,
								onFinish: async ({ responseMessage: completedMessage, isAborted, outcome }) => {
									let responseMessage = completedMessage;
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
											status: isAborted || outcome.status !== "completed" ? "canceled" : "completed",
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
								// The agent's onError has logged it; the reply carries only the app's wording.
								onError: (error) => replyErrorMessage(error),
							})
							.pipeThrough(
								new TransformStream<UIMessageChunk, UIMessageChunk>({
									transform(chunk, output) {
										if (chunk.type === "abort" && controller.signal.reason?.message === "RUN_TIMEOUT") {
											const id = `timeout-${runId}`;
											output.enqueue({ type: "text-start", id });
											output.enqueue({
												type: "text-delta",
												id,
												delta: AGENT_TIMEOUT_MESSAGE,
											});
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
					await deleteDraftIfEmpty({
						rowId: draftRowId,
						threadId: input.threadId,
						userId: input.userId,
					}).catch((cleanupError: unknown) => console.error("[agent] Failed to delete empty draft", cleanupError));
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

			const thread = await getThread({
				id: input.threadId,
				userId: input.userId,
			});
			const activeRunId = thread.activeRunId;
			if (!activeRunId) return;
			// A live owner releases the claim after persisting the terminal transcript.
			await requestRunCancellation(activeRunId, "USER_STOPPED");
			// A dead owner never will, so heal the thread now instead of waiting for the TTL reaper.
			if (!(await isRunAlive(activeRunId, thread.activeRunStartedAt))) {
				await reapStaleAgentRun({
					threadId: input.threadId,
					userId: input.userId,
					runId: activeRunId,
					streamId: thread.activeStreamId,
				});
			}
		},
		resume: async (input: { userId: string; threadId: string }) => {
			assertAgentEnvironment();
			const thread = await getThread({
				id: input.threadId,
				userId: input.userId,
			});
			return streamToEventIterator(await agentStreamLifecycle.resume(thread.activeStreamId));
		},

		/**
		 * Records what the user did with proposed edits (accepted, rejected, or pending again after an undo) in the
		 * message that proposed them, and recounts the conversation's accepted edits.
		 */
		setEditStatus: async (input: {
			userId: string;
			threadId: string;
			messageId: string;
			toolCallId: string;
			edits: Array<EditUpdate & { id: string }>;
		}) => {
			assertAgentEnvironment();
			const owner = await getThread({ id: input.threadId, userId: input.userId });
			const updates = new Map(input.edits.map(({ id, ...update }) => [id, update]));

			// Messages lock in ID order, then the thread (the order every message writer uses), so a wording save, a
			// status and a document save recording decisions serialize instead of overwriting each other.
			return db.transaction(async (tx) => {
				const rows = await lockThreadMessages(tx, input);
				const row = rows.find((candidate) => toMessage(candidate).id === input.messageId);
				if (!row) throw new ORPCError("NOT_FOUND");

				const current = toMessage(row);
				const document = documentOf(owner);
				const reader = document ? await documentReader(tx, input.userId, document) : null;
				let message = current;
				const statuses = new Map<string, "pending" | "accepted" | "rejected">();
				for (const part of current.parts) {
					const output = (part as { toolCallId?: string; output?: ProposeEditsOutput }).output;
					if (part.type !== "tool-propose_edits" || (part as { toolCallId?: string }).toolCallId !== input.toolCallId)
						continue;
					for (const edit of output?.edits ?? []) {
						const update = updates.get(edit.id);
						if (!update) continue;
						// A structural change applies its stored snapshot: new wording would describe something else.
						if (update.text !== undefined && edit.snapshot)
							throw new ORPCError("CONFLICT", {
								message: "This change can't be reworded. Accept it and adjust it in Write, or reject it.",
							});
						// The client names the new text it reviewed; another tab or device may have reworded it since. A retry of
						// wording whose earlier save went through (only the read back failed) finds it already there.
						if (update.after !== undefined && update.after !== edit.after) {
							const saved =
								!!update.text &&
								update.status === "pending" &&
								edit.status === "pending" &&
								withEditedText({ ...edit, after: update.after }, update.text).after === edit.after;
							if (saved) continue;
							throw new ORPCError("CONFLICT", {
								message: "This edit changed in another tab or device. Reopen the conversation to see it.",
							});
						}
						if (update.text) {
							// New wording replaces an edit only while it's undecided; a decided edit keeps what was applied.
							if (edit.status !== "pending" || update.status !== "pending")
								throw new ORPCError("CONFLICT", {
									message: "This edit was already decided. Undo it to change its wording.",
								});
							message = withEditWording(message, input.toolCallId, edit.id, update.text);
							continue;
						}
						// "Accepted" is a receipt for a document write that already happened: the edit's current wording has to
						// be in the document, and tailoring has to be allowed there. Apps record it with the save itself.
						if (update.status === "accepted" && edit.status !== "accepted") {
							if (!reader || !acceptedEditAllowed(current, output, edit, reader, true))
								throw new ORPCError("CONFLICT", {
									message:
										"This edit isn't in the document as it reads now, or can't be applied to it. Apply it, then record it.",
								});
						}
						statuses.set(edit.id, update.status);
					}
				}
				message = withEditStatuses(message, input.toolCallId, statuses);
				await tx
					.update(schema.agentMessage)
					.set({ uiMessage: message as never })
					.where(and(eq(schema.agentMessage.id, row.id), eq(schema.agentMessage.userId, input.userId)));

				const accepted = rows
					.map((candidate) => (candidate.id === row.id ? message : toMessage(candidate)))
					.flatMap(proposedEditsOf)
					.filter((edit) => edit.status === "accepted").length;
				const [thread] = await tx
					.update(schema.agentThread)
					.set({ editsAccepted: accepted })
					.where(and(eq(schema.agentThread.id, input.threadId), eq(schema.agentThread.userId, input.userId)))
					.returning({
						editsProposed: schema.agentThread.editsProposed,
						editsAccepted: schema.agentThread.editsAccepted,
					});
				if (!thread) throw new ORPCError("NOT_FOUND");
				return thread;
			});
		},
	},

	attachments: {
		create: async (input: CreateAttachmentInput) => {
			assertAgentEnvironment();
			if (input.data.byteLength > MAX_ATTACHMENT_BYTES)
				throw new ORPCError("AGENT_ATTACHMENT_TOO_LARGE", { status: 400, message: "Files can be up to 25 MB." });

			const mediaType = input.mediaType || inferContentType(input.filename);
			const id = generateId();
			const key = `uploads/${input.userId}/agent/${input.threadId}/${id}`;
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

					// Files already sent belong to their messages: only unsent ones count toward the next message.
					const [unsent] = await tx
						.select({ total: count() })
						.from(schema.agentAttachment)
						.where(
							and(
								eq(schema.agentAttachment.threadId, input.threadId),
								eq(schema.agentAttachment.userId, input.userId),
								isNull(schema.agentAttachment.messageId),
							),
						);
					if ((unsent?.total ?? 0) >= MAX_ATTACHMENTS_PER_MESSAGE)
						throw new ORPCError("AGENT_ATTACHMENT_LIMIT", {
							status: 400,
							message: "Attach up to 10 files per message.",
						});

					const [stats] = await tx
						.select({
							totalBytes: sql<number>`coalesce(sum(${schema.agentAttachment.size}), 0)`,
						})
						.from(schema.agentAttachment)
						.where(
							and(eq(schema.agentAttachment.threadId, input.threadId), eq(schema.agentAttachment.userId, input.userId)),
						);
					if (Number(stats?.totalBytes ?? 0) + input.data.byteLength > MAX_THREAD_ATTACHMENT_BYTES) {
						throw new ORPCError("AGENT_THREAD_ATTACHMENTS_FULL", {
							status: 400,
							message: "A conversation's files can total up to 100 MB. Start a new conversation.",
						});
					}
					// New threads would otherwise each bring a fresh 100 MiB.
					// ponytail: uploads to two threads at once can pass this together; lock the user row if that matters.
					const [account] = await tx
						.select({ totalBytes: sql<number>`coalesce(sum(${schema.agentAttachment.size}), 0)` })
						.from(schema.agentAttachment)
						.where(eq(schema.agentAttachment.userId, input.userId));
					if (Number(account?.totalBytes ?? 0) + input.data.byteLength > MAX_ACCOUNT_ATTACHMENT_BYTES)
						throw new ORPCError("AGENT_ACCOUNT_ATTACHMENTS_FULL", {
							status: 400,
							message: "Your assistant attachments use all their storage. Delete conversations you no longer need.",
						});

					// ponytail: hold the thread lock during storage I/O; reserve quota first if uploads contend.
					storageAttempted = true;
					await storage.write({
						key,
						data: input.data,
						contentType: mediaType,
						private: true,
					});
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
};
