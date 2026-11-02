import type { ProposedEdit } from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { DbOrTx } from "@reactive-resume/db/client";
import type { UIMessage } from "ai";
import { and, asc, eq, max, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { blockText, withEditedText } from "@reactive-resume/resume/proposals";

// Crash-safe incremental persistence for the assistant message of an agent run.
// A draft row is inserted before the stream starts, folded step-by-step in onStepEnd,
// and finalized (upserted) with the SDK's authoritative response message in onFinish.
// All functions take an injectable database so tests can stub queries without
// touching the send path's positional db mock.

type AgentMessagesDb = Pick<typeof db, "select" | "insert" | "update" | "delete">;

type UiMessagePart = UIMessage["parts"][number];

type StepContentPart = Record<string, unknown> & { type: string };

type AgentStepLike = { content: ReadonlyArray<unknown> };

type EditStatus = "pending" | "accepted" | "rejected";
/**
 * What a client records about an edit: its status, the user's own wording (pending edits only), and the new text
 * (`after`) the client reviewed, so a decision made on wording another tab or device has since changed is refused.
 */
export type EditUpdate = { status: EditStatus; text?: string | undefined; after?: string | undefined };
type ProposeEditsPart = UiMessagePart & {
	toolCallId?: string;
	state?: string;
	output?: { edits?: ProposedEdit[] };
};

const proposeEditsParts = (message: UIMessage) =>
	message.parts.filter(
		(part): part is ProposeEditsPart =>
			part.type === "tool-propose_edits" && (part as ProposeEditsPart).state === "output-available",
	);

/** The edits a message proposed, with what the user did with each. */
export const proposedEditsOf = (message: UIMessage) =>
	proposeEditsParts(message).flatMap((part) => part.output?.edits ?? []);

function mapEdits(
	message: UIMessage,
	toolCallId: string | null,
	update: (edit: ProposedEdit) => ProposedEdit,
): UIMessage {
	return {
		...message,
		parts: message.parts.map((part) => {
			const output = (part as ProposeEditsPart).output;
			if (part.type !== "tool-propose_edits" || !output?.edits) return part;
			if (toolCallId && (part as ProposeEditsPart).toolCallId !== toolCallId) return part;
			return { ...part, output: { ...output, edits: output.edits.map(update) } } as UiMessagePart;
		}),
	};
}

/** The message with edit statuses set, in one propose_edits result (by tool call) or in all of them. */
export function withEditStatuses(
	message: UIMessage,
	toolCallId: string | null,
	statuses: ReadonlyMap<string, EditStatus>,
): UIMessage {
	if (statuses.size === 0) return message;
	return mapEdits(message, toolCallId, (edit) => ({ ...edit, status: statuses.get(edit.id) ?? edit.status }));
}

const sameTarget = (a: ProposedEdit["target"], b: ProposedEdit["target"]) =>
	a.sectionId === b.sectionId && a.itemId === b.itemId && a.roleId === b.roleId && a.field === b.field;

/**
 * Undecided passage edits in `message` that `newer` replaces: the same field and the same passage, as text (an
 * addition's anchor carries its list item's end tag). Ones the document already holds are left out: their acceptance
 * can be recorded after the save that applied them.
 */
export function supersededEdits(
	message: UIMessage,
	newer: readonly ProposedEdit[],
	held: (edit: ProposedEdit) => boolean,
): string[] {
	return proposedEditsOf(message).flatMap((edit) => {
		const passage = blockText(edit.before);
		const replaced =
			edit.status === "pending" &&
			!edit.snapshot &&
			!!passage &&
			newer.some(
				(next) =>
					next.id !== edit.id &&
					!next.snapshot &&
					sameTarget(next.target, edit.target) &&
					blockText(next.before) === passage,
			) &&
			!held(edit);
		return replaced ? [edit.id] : [];
	});
}

/**
 * The user's own wording in place of an edit's new text. The server rebuilds the block from plain text, so a rewrite
 * can't carry markup into the document; flags whose words the user removed go.
 */
export function withEditWording(message: UIMessage, toolCallId: string, id: string, text: string): UIMessage {
	return mapEdits(message, toolCallId, (edit) => (edit.id === id ? withEditedText(edit, text) : edit));
}

/** A run's rewrite of its message keeps what the user already decided and wrote (they can act while it streams). */
function withStoredDecisions(message: UIMessage, stored: UIMessage): UIMessage {
	const kept = new Map(proposedEditsOf(stored).map((edit) => [edit.id, edit]));
	return mapEdits(message, null, (edit) => {
		const decided = kept.get(edit.id);
		if (!decided) return edit;
		const { after, unsupported, edited } = decided;
		return { ...edit, status: decided.status, ...(edited ? { after, unsupported, edited } : {}) };
	});
}

/** Every message writer locks messages in ID order, then their thread, before reading/merging decisions. */
export async function lockThreadMessages(
	database: Pick<DbOrTx, "select">,
	input: { userId: string; threadId: string },
) {
	const rows = await database
		.select()
		.from(schema.agentMessage)
		.where(and(eq(schema.agentMessage.threadId, input.threadId), eq(schema.agentMessage.userId, input.userId)))
		.orderBy(asc(schema.agentMessage.id))
		.for("update");
	await database
		.select({ id: schema.agentThread.id })
		.from(schema.agentThread)
		.where(and(eq(schema.agentThread.id, input.threadId), eq(schema.agentThread.userId, input.userId)))
		.for("update");
	return rows;
}

function toolPartFromCall(part: StepContentPart): UiMessagePart {
	const metadata = {
		...(part.providerMetadata ? { callProviderMetadata: part.providerMetadata } : {}),
		...(part.providerExecuted ? { providerExecuted: true } : {}),
	};
	if (part.dynamic) {
		return {
			...metadata,
			type: "dynamic-tool",
			toolName: String(part.toolName),
			toolCallId: String(part.toolCallId),
			state: "input-available",
			input: part.input,
		} as UiMessagePart;
	}

	return {
		...metadata,
		type: `tool-${String(part.toolName)}`,
		toolCallId: String(part.toolCallId),
		state: "input-available",
		input: part.input,
	} as UiMessagePart;
}

// Pure fold: append one step's content (text, reasoning, tool call/result/error) to a UI message.
// Files and approval parts are skipped — the authoritative onFinish message carries them.
export function applyStepToUiMessage(message: UIMessage, step: AgentStepLike): UIMessage {
	const parts: UiMessagePart[] = [...message.parts, { type: "step-start" } as UiMessagePart];
	const toolPartIndexByCallId = new Map<string, number>();

	for (const rawContent of step.content) {
		if (!rawContent || typeof rawContent !== "object" || typeof (rawContent as { type?: unknown }).type !== "string") {
			continue;
		}
		const content = rawContent as StepContentPart;
		if (content.type === "source" && content.sourceType === "url" && typeof content.url === "string") {
			parts.push({
				type: "source-url",
				sourceId: String(content.id),
				url: content.url,
				...(typeof content.title === "string" ? { title: content.title } : {}),
			});
			continue;
		}
		if (content.type === "text" && typeof content.text === "string" && content.text) {
			parts.push({ type: "text", text: content.text } as UiMessagePart);
			continue;
		}

		if (content.type === "reasoning" && typeof content.text === "string" && content.text) {
			parts.push({ type: "reasoning", text: content.text } as UiMessagePart);
			continue;
		}

		if (content.type === "tool-call" && typeof content.toolCallId === "string") {
			toolPartIndexByCallId.set(content.toolCallId, parts.length);
			parts.push(toolPartFromCall(content));
			continue;
		}

		if ((content.type === "tool-result" || content.type === "tool-error") && typeof content.toolCallId === "string") {
			const resolution =
				content.type === "tool-result"
					? {
							state: "output-available",
							output: content.output,
							...(content.providerMetadata ? { resultProviderMetadata: content.providerMetadata } : {}),
						}
					: {
							state: "output-error",
							errorText: content.error instanceof Error ? content.error.message : String(content.error),
						};

			const index = toolPartIndexByCallId.get(content.toolCallId);
			if (index === undefined) {
				parts.push({ ...toolPartFromCall(content), ...resolution } as UiMessagePart);
			} else {
				parts[index] = { ...(parts[index] as Record<string, unknown>), ...resolution } as UiMessagePart;
			}
		}
	}

	return { ...message, parts };
}

type UsageDetails = Record<string, number | undefined>;
type UsageLike = {
	inputTokens?: number | undefined;
	outputTokens?: number | undefined;
	totalTokens?: number | undefined;
	inputTokenDetails?: UsageDetails | undefined;
	outputTokenDetails?: UsageDetails | undefined;
};
type MessageWithUsage = { metadata?: Record<string, unknown> & { usage?: UsageLike } };

function addCounts(a: number | undefined, b: number | undefined): number | undefined {
	if (typeof a !== "number" && typeof b !== "number") return undefined;
	return (a ?? 0) + (b ?? 0);
}

function addDetails(a: UsageDetails | undefined, b: UsageDetails | undefined): UsageDetails | undefined {
	if (!a && !b) return undefined;
	const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
	const sum: UsageDetails = {};
	for (const key of keys) {
		const value = addCounts(a?.[key], b?.[key]);
		if (value !== undefined) sum[key] = value;
	}
	return sum;
}

// A question/approval continuation streams into the SAME assistant message; the SDK deep-merges
// metadata but replaces primitive token counts, so the continuation's usage would silently
// overwrite the pre-halt run's. Sum the previous usage into the final message before persisting.
export function withAccumulatedUsageMetadata(previous: UIMessage, next: UIMessage): UIMessage {
	const previousUsage = (previous as MessageWithUsage).metadata?.usage;
	const nextMetadata = (next as MessageWithUsage).metadata;
	if (!previousUsage || !nextMetadata?.usage) return next;

	const usage: UsageLike = {
		inputTokens: addCounts(previousUsage.inputTokens, nextMetadata.usage.inputTokens),
		outputTokens: addCounts(previousUsage.outputTokens, nextMetadata.usage.outputTokens),
		totalTokens: addCounts(previousUsage.totalTokens, nextMetadata.usage.totalTokens),
		inputTokenDetails: addDetails(previousUsage.inputTokenDetails, nextMetadata.usage.inputTokenDetails),
		outputTokenDetails: addDetails(previousUsage.outputTokenDetails, nextMetadata.usage.outputTokenDetails),
	};

	return { ...next, metadata: { ...nextMetadata, usage } } as UIMessage;
}

export async function nextMessageSequence(threadId: string, database: AgentMessagesDb) {
	const [row] = await database
		.select({ maxSequence: max(schema.agentMessage.sequence) })
		.from(schema.agentMessage)
		.where(eq(schema.agentMessage.threadId, threadId));

	return (row?.maxSequence ?? -1) + 1;
}

export async function touchThread(input: { threadId: string; userId: string }, database: AgentMessagesDb) {
	await database
		.update(schema.agentThread)
		.set({ lastMessageAt: new Date() })
		.where(and(eq(schema.agentThread.id, input.threadId), eq(schema.agentThread.userId, input.userId)));
}

export async function insertDraftAssistantMessage(
	input: { userId: string; threadId: string; uiMessageId: string },
	database: AgentMessagesDb = db,
) {
	const sequence = await nextMessageSequence(input.threadId, database);
	const [row] = await database
		.insert(schema.agentMessage)
		.values({
			userId: input.userId,
			threadId: input.threadId,
			role: "assistant",
			status: "streaming",
			sequence,
			uiMessage: { id: input.uiMessageId, role: "assistant", parts: [] },
		})
		.returning({ id: schema.agentMessage.id });

	if (!row) throw new Error("AGENT_DRAFT_MESSAGE_CREATE_FAILED");

	await touchThread(input, database);

	return { rowId: row.id, sequence };
}

// Upsert by row id first, then by the uiMessage's embedded id (a question/approval continuation
// streams into the SAME uiMessage id as the stored assistant row), then insert as a last resort.
export function upsertAssistantUiMessage(
	input: {
		userId: string;
		threadId: string;
		rowId?: string;
		message: UIMessage;
		status: "streaming" | "completed" | "canceled";
	},
	database: Pick<typeof db, "transaction"> = db,
) {
	return database.transaction(async (database) => {
		const rows = await lockThreadMessages(database, input);
		const stored =
			rows.find((row) => row.id === input.rowId) ??
			rows.find((row) => row.role === "assistant" && row.uiMessage.id === input.message.id);
		const message = stored
			? withStoredDecisions(input.message, stored.uiMessage as unknown as UIMessage)
			: input.message;
		const set = {
			status: input.status,
			uiMessage: message as unknown as Record<string, unknown>,
		};
		const isFinal = input.status !== "streaming";

		if (input.rowId) {
			const updated = await database
				.update(schema.agentMessage)
				.set(set)
				.where(
					and(
						eq(schema.agentMessage.id, input.rowId),
						eq(schema.agentMessage.threadId, input.threadId),
						eq(schema.agentMessage.userId, input.userId),
					),
				)
				.returning({ id: schema.agentMessage.id });

			if (updated.length === 1) {
				if (isFinal) await touchThread(input, database);
				// oxlint-disable-next-line typescript/no-non-null-assertion -- length checked above
				return { rowId: updated[0]!.id };
			}
		}

		const updatedById = await database
			.update(schema.agentMessage)
			.set(set)
			.where(
				and(
					eq(schema.agentMessage.threadId, input.threadId),
					eq(schema.agentMessage.userId, input.userId),
					eq(schema.agentMessage.role, "assistant"),
					sql`${schema.agentMessage.uiMessage}->>'id' = ${input.message.id}`,
				),
			)
			.returning({ id: schema.agentMessage.id });

		if (updatedById.length >= 1) {
			if (isFinal) await touchThread(input, database);
			// oxlint-disable-next-line typescript/no-non-null-assertion -- length checked above
			return { rowId: updatedById[0]!.id };
		}

		const sequence = await nextMessageSequence(input.threadId, database);
		const [inserted] = await database
			.insert(schema.agentMessage)
			.values({
				userId: input.userId,
				threadId: input.threadId,
				role: message.role,
				status: input.status,
				sequence,
				uiMessage: message as unknown as Record<string, unknown>,
			})
			.returning({ id: schema.agentMessage.id });

		if (!inserted) throw new Error("AGENT_MESSAGE_CREATE_FAILED");

		await touchThread(input, database);

		return { rowId: inserted.id };
	});
}

// Removes a draft that never received content (sync failure before the stream produced anything).
export async function deleteDraftIfEmpty(
	input: { rowId: string; threadId: string; userId: string },
	database: AgentMessagesDb = db,
) {
	await database
		.delete(schema.agentMessage)
		.where(
			and(
				eq(schema.agentMessage.id, input.rowId),
				eq(schema.agentMessage.threadId, input.threadId),
				eq(schema.agentMessage.userId, input.userId),
				eq(schema.agentMessage.status, "streaming"),
				sql`jsonb_array_length(${schema.agentMessage.uiMessage}->'parts') = 0`,
			),
		);
}

/**
 * The row of a user message already saved for this thread: a retry sends the same message again, and it's kept
 * once.
 */
export async function findUserMessageRow(
	input: { userId: string; threadId: string; uiMessageId: string },
	database: AgentMessagesDb = db,
) {
	const [row] = await database
		.select({ id: schema.agentMessage.id })
		.from(schema.agentMessage)
		.where(
			and(
				eq(schema.agentMessage.threadId, input.threadId),
				eq(schema.agentMessage.userId, input.userId),
				eq(schema.agentMessage.role, "user"),
				sql`${schema.agentMessage.uiMessage}->>'id' = ${input.uiMessageId}`,
			),
		);
	return row ?? null;
}
