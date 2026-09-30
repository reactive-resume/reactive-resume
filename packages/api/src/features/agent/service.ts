import type { getModel } from "../ai/service";
import type { WebAccessConnection } from "../web-access/contracts";
import type { AssistantDocument } from "./document";
import type { ProposeEditsInput, ProposeEditsOutput } from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { FilePart, ImagePart, ModelMessage, TextPart, UIMessage, UIMessageChunk } from "ai";
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
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { agentWebSources } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { generateId } from "@reactive-resume/utils/string";
import { aiProvidersService } from "../ai-providers/service";
import { assertAgentEnvironment } from "../ai/credentials";
import { getAgentModel } from "../ai/service";
import { coverLetterService } from "../cover-letters/service";
import { resumeService } from "../resume/service";
import { getStorageService, inferContentType } from "../storage/service";
import { webAccessService } from "../web-access/credentials";
import { readPage, searchWeb } from "../web-access/service";
import { isRunAlive, monitorRunCancellation, requestRunCancellation } from "./cancellation";
import { pruneAgentModelContext } from "./context";
import { documentOf, documentView, findPosting, loadDocument, resolveEdits } from "./document";
import { mergeClientToolResponses } from "./messages-merge";
import {
	applyStepToUiMessage,
	deleteDraftIfEmpty,
	findUserMessageRow,
	insertDraftAssistantMessage,
	nextMessageSequence,
	proposedEditsOf,
	touchThread,
	upsertAssistantUiMessage,
	withAccumulatedUsageMetadata,
	withEditStatuses,
} from "./messages-persistence";
import { repairAgentToolCall } from "./repair";
import { claimActiveAgentRun, clearActiveAgentRunIfCurrent, isStaleAgentRun, reapStaleAgentRun } from "./runs";
import { agentStreamLifecycle } from "./streams";
import { buildAgentInstructions, buildAgentTools, MAX_AGENT_WEB_CALLS } from "./tools";

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
	userId: string;
	/** The document the conversation is about: a resume or a letter. */
	resumeId?: string | undefined;
	coverLetterId?: string | undefined;
	aiProviderId?: string | undefined;
};

/** What a message shares with the model: the open document and the posting it's for. Both on by default. */
type MessageContext = {
	document?: boolean | undefined;
	posting?: boolean | undefined;
	applicationId?: string | undefined;
};

type SendMessageInput = {
	userId: string;
	threadId: string;
	message: UIMessage;
	attachmentIds?: unknown;
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
		throw new ORPCError("BAD_REQUEST", {
			message: "Attachment IDs must be an array.",
		});
	}

	if (ids.length > MAX_ATTACHMENTS_PER_MESSAGE) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Too many attachments for one message.",
		});
	}

	const unique = new Set<string>();
	for (const id of ids) {
		if (typeof id !== "string" || !id.trim()) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Attachment IDs must be non-empty strings.",
			});
		}
		unique.add(id.trim());
	}

	if (unique.size !== ids.length) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Attachment IDs must be unique.",
		});
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
		throw new ORPCError("CONFLICT", {
			message: "One or more attachments were already linked to another message.",
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
					message: `Attachment ${attachment.filename} could not be read.`,
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

async function updateAssistantToolResultMessage(input: { userId: string; threadId: string; message: UIMessage }) {
	const existingRows = await listThreadMessages({
		threadId: input.threadId,
		userId: input.userId,
	});
	const existingRow = existingRows.find((row) => row.role === "assistant" && toMessage(row).id === input.message.id);
	if (!existingRow) {
		throw new ORPCError("BAD_REQUEST", {
			message: "The answered assistant message was not found.",
		});
	}

	const {
		message: mergedMessage,
		mergedCount,
		alreadyResolvedCount,
		pendingContinuationCount,
		conflictingCount,
	} = mergeClientToolResponses(toMessage(existingRow), input.message);

	if (conflictingCount > 0) {
		throw new ORPCError("BAD_REQUEST", {
			message: "This approval was already answered with a different decision.",
		});
	}
	// A recorded-but-unexecuted approval (pendingContinuationCount) proceeds: a prior continuation
	// attempt failed after persisting the decision, and this retry is the recovery path.
	if (mergedCount === 0 && pendingContinuationCount === 0) {
		if (alreadyResolvedCount > 0) {
			throw new ORPCError("CONFLICT", {
				message: "This response was already handled.",
			});
		}
		throw new ORPCError("BAD_REQUEST", {
			message: "No matching unanswered user question was found.",
		});
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

/** Places the model's edits on the document and counts them toward the conversation's outcome. */
async function proposeEdits(input: {
	userId: string;
	threadId: string;
	document: AssistantDocument;
	edits: ProposeEditsInput;
}): Promise<ProposeEditsOutput> {
	const loaded = await loadDocument(input.userId, input.document);
	const output = resolveEdits(loaded, input.edits);
	if (output.edits.length > 0) {
		await db
			.update(schema.agentThread)
			.set({
				editsProposed: sql`${schema.agentThread.editsProposed} + ${output.edits.length}`,
			})
			.where(and(eq(schema.agentThread.id, input.threadId), eq(schema.agentThread.userId, input.userId)));
	}
	return output;
}

function createAgent(input: {
	userId: string;
	threadId: string;
	/** Null when the message leaves the document out. */
	document: (AssistantDocument & { name: string }) | null;
	posting: {
		role: string;
		company: string;
		text: string;
		notes?: string;
	} | null;
	provider: {
		provider: Parameters<typeof getModel>[0]["provider"];
		model: string;
		apiKey: string;
		baseURL?: string;
	};
	model: ReturnType<typeof getModel>;
	connection: WebAccessConnection | null;
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
	const tools = buildAgentTools({
		provider: input.provider,
		document: document?.kind ?? null,
		externalSearch: input.connection !== null,
		signal: input.signal,
		handlers: {
			searchWeb: timedToolHandler("search_web", (query: string, signal: AbortSignal) =>
				searchWeb(query, {
					connection: input.connection,
					userId: input.userId,
					signal,
				}),
			),
			readPage: timedToolHandler("read_page", async (url: string, signal: AbortSignal) => {
				const { html: _html, ...page } = await readPage(url, {
					connection: input.connection,
					userId: input.userId,
					signal,
				});
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
			proposeEdits: timedToolHandler("propose_edits", (edits: ProposeEditsInput) => {
				if (!document) throw new Error("The document isn't shared with this message.");
				return proposeEdits({
					userId: input.userId,
					threadId: input.threadId,
					document,
					edits,
				});
			}),
		},
	});

	const instructionsText = buildAgentInstructions({
		document: document ? { kind: document.kind, name: document.name } : null,
		posting: input.posting,
		searchTool:
			"search_web" in tools
				? "search_web"
				: "web_search" in tools
					? "web_search"
					: "google_search" in tools
						? "google_search"
						: null,
		canReadPage: "read_page" in tools,
	});

	return new ToolLoopAgent({
		// Providers without native inputExamples support get them appended to the tool description.
		model: wrapLanguageModel({
			model: input.model,
			middleware: addToolInputExamplesMiddleware(),
		}),
		// The loop re-sends stable instructions every step; on anthropic, prompt caching pays from step 2.
		instructions:
			input.provider.provider === "anthropic"
				? {
						role: "system",
						content: instructionsText,
						providerOptions: {
							anthropic: { cacheControl: { type: "ephemeral" } },
						},
					}
				: instructionsText,
		repairToolCall: repairAgentToolCall,
		stopWhen: isStepCount(MAX_AGENT_STEPS),
		maxOutputTokens: MAX_AGENT_OUTPUT_TOKENS,
		maxRetries: MAX_AGENT_MODEL_RETRIES,
		...("web_search" in tools && input.provider.provider === "openai"
			? { providerOptions: { openai: { maxToolCalls: MAX_AGENT_WEB_CALLS } } }
			: {}),
		timeout: { stepMs: AGENT_STEP_TIMEOUT_MS },
		// Runs before every loop step, so an older document snapshot never outlives a newer read.
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
	coverLetterId: schema.agentThread.coverLetterId,
	title: schema.agentThread.title,
	status: schema.agentThread.status,
	reviewPatches: schema.agentThread.reviewPatches,
	editsProposed: schema.agentThread.editsProposed,
	editsAccepted: schema.agentThread.editsAccepted,
	activeRunId: schema.agentThread.activeRunId,
	activeStreamId: schema.agentThread.activeStreamId,
	activeRunStartedAt: schema.agentThread.activeRunStartedAt,
	lastMessageAt: schema.agentThread.lastMessageAt,
	archivedAt: schema.agentThread.archivedAt,
	deletedAt: schema.agentThread.deletedAt,
	createdAt: schema.agentThread.createdAt,
	updatedAt: schema.agentThread.updatedAt,
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
			if (!document)
				throw new ORPCError("BAD_REQUEST", {
					message: "Choose a resume or a letter.",
				});

			// Confirms the caller owns the document (throws otherwise) and names it for the summary.
			const described =
				document.kind === "resume"
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
					message: "No tested AI provider is available.",
				});

			const [thread] = await db
				.insert(schema.agentThread)
				.values({
					userId: input.userId,
					aiProviderId: provider.id,
					...(document.kind === "resume"
						? { sourceResumeId: document.id, workingResumeId: document.id }
						: { coverLetterId: document.id }),
					title: "New conversation",
				})
				.returning();
			if (!thread) throw new Error("AGENT_THREAD_CREATE_FAILED");

			return toThreadSummary({
				...thread,
				...(document.kind === "resume" ? { resumeName: described.name } : { coverLetterName: described.name }),
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

			const [messages, attachments, document] = await Promise.all([
				listThreadMessages({ threadId: input.id, userId: input.userId }),
				db
					.select()
					.from(schema.agentAttachment)
					.where(and(eq(schema.agentAttachment.threadId, input.id), eq(schema.agentAttachment.userId, input.userId)))
					.orderBy(asc(schema.agentAttachment.createdAt)),
				describeDocument(input.userId, documentOf(thread)),
			]);

			return {
				thread: toThreadSummary(thread),
				messages: messages.map(toMessage),
				attachments: attachments.map(toAttachment),
				document,
				isReadOnly: !document || !thread.aiProviderId || document.locked,
			};
		},

		/** Switches the model a conversation uses ("Switch model"). */
		update: async (input: { id: string; userId: string; aiProviderId: string }) => {
			assertAgentEnvironment();

			await getThread({ id: input.id, userId: input.userId });
			const provider = await aiProvidersService.getRunnableById({
				id: input.aiProviderId,
				userId: input.userId,
			});

			const [updated] = await db
				.update(schema.agentThread)
				.set({ aiProviderId: provider.id })
				.where(and(eq(schema.agentThread.id, input.id), eq(schema.agentThread.userId, input.userId)))
				.returning();
			if (!updated) throw new ORPCError("NOT_FOUND");

			return toThreadSummary({ ...updated, providerLabel: provider.label });
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

			const thread = await getThread({
				id: input.threadId,
				userId: input.userId,
			});
			if (thread.status === "archived") {
				throw new ORPCError("CONFLICT", {
					message: "This thread is archived.",
				});
			}
			if (thread.activeRunId) {
				if (!isStaleAgentRun(thread)) {
					throw new ORPCError("CONFLICT", {
						message: "This thread already has an active run.",
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
			if (!document || !thread.aiProviderId) {
				throw new ORPCError("BAD_REQUEST", {
					message: "This conversation is read-only.",
				});
			}
			if (input.message.role !== "user" && input.message.role !== "assistant") {
				throw new ORPCError("BAD_REQUEST", {
					message: "Agent messages must be user messages or tool results.",
				});
			}

			// Deliberately schema-less: provider-echoed tool parts must pass, and replayed history is never re-validated.
			const validated = await safeValidateUIMessages({
				messages: [input.message],
			});
			if (!validated.success) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Invalid UI message parts.",
				});
			}

			const loaded = await loadDocument(input.userId, document);
			if (loaded.locked)
				throw new ORPCError("BAD_REQUEST", {
					message: "Unlock the document to change it.",
				});
			const posting =
				input.context?.posting === false
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
					message: "This thread already has an active run.",
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
			};

			try {
				activeRunCleanup.set(runId, await monitorRunCancellation(runId, controller));
				controller.signal.throwIfAborted();
				let attachmentsForModel: AgentAttachmentRecord[] = [];

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

				await aiProvidersService.markUsed({
					id: runnableProvider.id,
					userId: input.userId,
				});

				const messageRows = await repairLegacyAskUserQuestionAnswers(
					await listThreadMessages({
						threadId: input.threadId,
						userId: input.userId,
					}),
					{ threadId: input.threadId, userId: input.userId },
				);
				const messages = messageRows.map(toMessage);
				const connection = await webAccessService.resolve(input.userId);
				const modelMessages = await convertToModelMessages(
					messages.map((message) => toModelInputMessage(message, runnableProvider, connection !== null)),
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

				const agent = createAgent({
					userId: input.userId,
					threadId: input.threadId,
					document: input.context?.document === false ? null : { ...document, name: loaded.name },
					posting,
					connection,
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
									part.type === "finish"
										? {
												usage: part.totalUsage,
												model: runnableProvider.model,
												provider: runnableProvider.provider,
											}
										: undefined,
								onFinish: async ({ responseMessage: completedMessage, isAborted }) => {
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
								onError: (error) => {
									const message = error instanceof Error ? error.message : "Agent run failed.";
									return runnableProvider.apiKey ? message.replaceAll(runnableProvider.apiKey, "***") : message;
								},
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
			edits: Array<{ id: string; status: "pending" | "accepted" | "rejected" }>;
		}) => {
			assertAgentEnvironment();
			await getThread({ id: input.threadId, userId: input.userId });

			const rows = await listThreadMessages({
				threadId: input.threadId,
				userId: input.userId,
			});
			const row = rows.find((candidate) => toMessage(candidate).id === input.messageId);
			if (!row) throw new ORPCError("NOT_FOUND");

			const statuses = new Map(input.edits.map((edit) => [edit.id, edit.status]));
			const message = withEditStatuses(toMessage(row), input.toolCallId, statuses);
			await db
				.update(schema.agentMessage)
				.set({ uiMessage: message as never })
				.where(and(eq(schema.agentMessage.id, row.id), eq(schema.agentMessage.userId, input.userId)));

			const accepted = rows
				.map((candidate) => (candidate.id === row.id ? message : toMessage(candidate)))
				.flatMap(proposedEditsOf)
				.filter((edit) => edit.status === "accepted").length;
			const [thread] = await db
				.update(schema.agentThread)
				.set({ editsAccepted: accepted })
				.where(and(eq(schema.agentThread.id, input.threadId), eq(schema.agentThread.userId, input.userId)))
				.returning({
					editsProposed: schema.agentThread.editsProposed,
					editsAccepted: schema.agentThread.editsAccepted,
				});
			if (!thread) throw new ORPCError("NOT_FOUND");
			return thread;
		},
	},

	attachments: {
		create: async (input: CreateAttachmentInput) => {
			assertAgentEnvironment();
			if (input.data.byteLength > MAX_ATTACHMENT_BYTES) throw new ORPCError("BAD_REQUEST");

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
					if ((unsent?.total ?? 0) >= MAX_ATTACHMENTS_PER_MESSAGE) throw new ORPCError("BAD_REQUEST");

					const [stats] = await tx
						.select({
							totalBytes: sql<number>`coalesce(sum(${schema.agentAttachment.size}), 0)`,
						})
						.from(schema.agentAttachment)
						.where(
							and(eq(schema.agentAttachment.threadId, input.threadId), eq(schema.agentAttachment.userId, input.userId)),
						);
					if (Number(stats?.totalBytes ?? 0) + input.data.byteLength > MAX_THREAD_ATTACHMENT_BYTES) {
						throw new ORPCError("BAD_REQUEST");
					}

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
