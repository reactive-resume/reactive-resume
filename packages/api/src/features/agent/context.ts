import type { ModelMessage } from "ai";
import { pruneMessages } from "ai";
import { estimateTokenCount as estimateTextTokenCount } from "tokenx";
import { getVisibleResumeStructure } from "@reactive-resume/resume/markdown";
import { resumeEntryTypeSchema } from "@reactive-resume/resume/structural-proposals";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";

// Pure model-context pruning, wired into the agent loop via prepareStep so it runs before every
// step. Tier 0 always runs (a stale resume snapshot is actively harmful — shifted array indexes);
// the remaining tiers only fire once the estimated token count exceeds the budget.

const AGENT_CONTEXT_TOKEN_BUDGET = 40_000;

const SNAPSHOT_TOOL_NAMES = new Set(["read_resume", "read_letter", "apply_resume_patch"]);
const SUPERSEDED_SNAPSHOT_NOTE =
	"Superseded document snapshot removed. Base further edits on the latest read_resume, read_letter or apply_resume_patch result.";
const PRUNED_TOOL_RESULT_NOTE = "Older tool result pruned to fit the context budget.";

type LoosePart = Record<string, unknown> & { type: string };

// Binary attachment data (up to 25MB per file) must never be JSON.stringified — each byte would
// expand into a numeric-key object entry and repeated estimation would exhaust the heap.
function isBinary(value: unknown): value is ArrayBufferView | ArrayBuffer {
	return ArrayBuffer.isView(value) || value instanceof ArrayBuffer;
}

// Manual walk instead of JSON.stringify: a Buffer's toJSON() runs before any stringify replacer,
// so serialization-based estimation would expand binary into per-byte entries (hundreds of MB of
// JSON for one allowed 25MB attachment). String leaves go through tokenx; binary counts as
// opaque bytes; structural syntax gets a small flat cost.
export function estimateTokens(value: unknown): number {
	if (value === null || value === undefined) return 1;
	if (typeof value === "string") return estimateTextTokenCount(value);
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return 2;
	if (isBinary(value)) return Math.ceil(value.byteLength / 4);
	if (Array.isArray(value)) {
		let sum = 1;
		for (const item of value) sum += estimateTokens(item) + 1;
		return sum;
	}
	if (typeof value === "object") {
		let sum = 1;
		for (const [key, nested] of Object.entries(value)) sum += estimateTextTokenCount(key) + 1 + estimateTokens(nested);
		return sum;
	}
	return 2;
}

function contentParts(message: ModelMessage): LoosePart[] {
	return Array.isArray(message.content) ? (message.content as unknown as LoosePart[]) : [];
}

function unwrapToolOutput(output: unknown): unknown {
	if (output && typeof output === "object" && "type" in output && "value" in output) {
		return (output as { value: unknown }).value;
	}
	return output;
}

function wrapToolOutput(original: unknown, value: unknown): unknown {
	if (original && typeof original === "object" && "type" in original && "value" in original) {
		return { ...(original as Record<string, unknown>), type: "json", value };
	}
	return value;
}

const resumeStructureSchema = resumeDataSchema
	.pick({ basics: true, summary: true, sections: true, customSections: true })
	.extend({
		summary: resumeDataSchema.shape.summary.optional(),
		sections: resumeDataSchema.shape.sections.partial(),
	});
const recordOf = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const isToolFailure = (output: unknown) =>
	["error-text", "error-json", "execution-denied"].includes(String(recordOf(output).type));

/** Always before provider calls, including restored UI history: application snapshots never belong in model context. */
function projectDocumentResults(messages: ModelMessage[]): ModelMessage[] {
	return messages.map((message) => {
		const parts = contentParts(message);
		let changed = false;
		const content = parts.map((part) => {
			if (part.type !== "tool-result" || !["read_resume", "propose_edits"].includes(String(part.toolName))) return part;
			if (isToolFailure(part.output)) return part;
			let value = unwrapToolOutput(part.output);
			if (typeof value === "string") {
				try {
					value = JSON.parse(value);
				} catch {
					value = {};
				}
			}
			const output = recordOf(value);
			let projected: unknown;
			if (part.toolName === "propose_edits") {
				// Acknowledgement only. Full cards/snapshots remain in the owned UI message and save receipt.
				projected = {
					edits: Array.isArray(output.edits)
						? output.edits.map((edit: unknown) => {
								const record = recordOf(edit);
								return {
									id: typeof record.id === "string" ? record.id : undefined,
									status: typeof record.status === "string" ? record.status : undefined,
								};
							})
						: [],
					skipped: Array.isArray(output.skipped)
						? output.skipped.map((edit: unknown) => ({
								passageId: typeof recordOf(edit).passageId === "string" ? recordOf(edit).passageId : undefined,
								reason: typeof recordOf(edit).reason === "string" ? recordOf(edit).reason : undefined,
							}))
						: [],
					...(Array.isArray(output.edits) && output.edits.length > 0
						? {
								note: "Prepared changes are shown in the review cards. This tool does not apply them. Read the document again for current visible content. Use Write for unsupported fields and Documents for cover letters.",
							}
						: {}),
				};
			} else {
				const data = recordOf(output.data);
				const structure = resumeStructureSchema.safeParse(data.structure);
				const templates = recordOf(data.entryTemplates);
				projected = {
					name: typeof output.name === "string" ? output.name : undefined,
					updatedAt: typeof output.updatedAt === "string" ? output.updatedAt : undefined,
					data: {
						resume: typeof data.resume === "string" ? data.resume : undefined,
						passages: Array.isArray(data.passages)
							? data.passages.map((passage: unknown) => {
									const record = recordOf(passage);
									return Object.fromEntries(
										["id", "sectionId", "location", "text"]
											.filter((key) => typeof record[key] === "string")
											.map((key) => [key, record[key]]),
									);
								})
							: [],
						...(structure.success ? { structure: getVisibleResumeStructure(structure.data) } : {}),
						entryTemplates: Object.fromEntries(
							resumeEntryTypeSchema.options.filter((type) => type in templates).map((type) => [type, templates[type]]),
						),
					},
				};
			}
			changed = true;
			return { ...part, output: wrapToolOutput(part.output, projected) };
		});
		return changed ? ({ ...message, content } as ModelMessage) : message;
	});
}

function isSnapshotResultPart(part: LoosePart): boolean {
	if (isToolFailure(part.output)) return false;
	if (part.type !== "tool-result" || typeof part.toolName !== "string" || !SNAPSHOT_TOOL_NAMES.has(part.toolName)) {
		return false;
	}

	const value = unwrapToolOutput(part.output);
	if (!value || typeof value !== "object") return false;

	return part.toolName === "apply_resume_patch" ? "resume" in value : "data" in value;
}

function supersedeSnapshotPart(part: LoosePart): LoosePart {
	const value = unwrapToolOutput(part.output);
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	const { data: _data, resume: _resume, ...rest } = record;

	return { ...part, output: wrapToolOutput(part.output, { ...rest, note: SUPERSEDED_SNAPSHOT_NOTE }) };
}

// Tier 0: exactly one full resume snapshot survives — the last one, positioned where the model
// last acted. Runs regardless of budget.
function supersedeStaleSnapshots(messages: ModelMessage[]): ModelMessage[] {
	const locations: Array<{ messageIndex: number; partIndex: number }> = [];

	for (const [messageIndex, message] of messages.entries()) {
		for (const [partIndex, part] of contentParts(message).entries()) {
			if (isSnapshotResultPart(part)) locations.push({ messageIndex, partIndex });
		}
	}

	if (locations.length <= 1) return messages;

	const stale = locations.slice(0, -1);
	const next = [...messages];
	for (const { messageIndex, partIndex } of stale) {
		const message = next[messageIndex] as ModelMessage & { content: LoosePart[] };
		const parts = [...contentParts(message)];
		// oxlint-disable-next-line typescript/no-non-null-assertion -- location was collected from this array
		parts[partIndex] = supersedeSnapshotPart(parts[partIndex]!);
		next[messageIndex] = { ...message, content: parts } as ModelMessage;
	}

	return next;
}

function hasApprovalContent(message: ModelMessage): boolean {
	return contentParts(message).some(
		(part) => part.type === "tool-approval-request" || part.type === "tool-approval-response",
	);
}

// Tier 2: collapse the oldest tool call/result pairs into stubs — always both sides of a pair
// (several BYOK gateways reject unpaired tool messages), never the protected regions.
function collapseOldestToolPairs(messages: ModelMessage[], budget: number): ModelMessage[] {
	const lastAssistantIndex = messages.findLastIndex((message) => message.role === "assistant");
	const survivingSnapshotCallIds = new Set<string>();

	// The surviving snapshot (last one, by Tier 0) must keep its full pair.
	for (let index = messages.length - 1; index >= 0; index--) {
		// oxlint-disable-next-line typescript/no-non-null-assertion -- index is in range
		const part = contentParts(messages[index]!).findLast(isSnapshotResultPart);
		if (part && typeof part.toolCallId === "string") {
			survivingSnapshotCallIds.add(part.toolCallId);
			break;
		}
	}

	const resolvedCallIds = new Set<string>();
	for (const message of messages) {
		for (const part of contentParts(message)) {
			if (part.type === "tool-result" && typeof part.toolCallId === "string") resolvedCallIds.add(part.toolCallId);
		}
	}

	const next = [...messages];
	const stubbedCallIds = new Set<string>();
	let changed = false;

	for (const [index, message] of next.entries()) {
		if (estimateTokens(next) <= budget) break;
		if (index === lastAssistantIndex || hasApprovalContent(message)) continue;
		if (message.role !== "assistant" && message.role !== "tool") continue;

		const parts = contentParts(message).map((part) => {
			const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : null;
			if (!toolCallId || survivingSnapshotCallIds.has(toolCallId)) return part;

			if (part.type === "tool-call" && resolvedCallIds.has(toolCallId)) {
				stubbedCallIds.add(toolCallId);
				return { ...part, input: {} };
			}

			if (part.type === "tool-result" && stubbedCallIds.has(toolCallId)) {
				return { ...part, output: wrapToolOutput(part.output, { note: PRUNED_TOOL_RESULT_NOTE }) };
			}

			return part;
		});

		if (parts.some((part, partIndex) => part !== contentParts(message)[partIndex])) {
			next[index] = { ...message, content: parts } as ModelMessage;
			changed = true;
		}
	}

	return changed ? next : messages;
}

// Tier 3 (last resort): drop the oldest complete turns. A turn is one user message plus every
// message up to the next user message, so tool call/result and approval request/response pairs
// are always dropped atomically. The final two turns (latest user turn and the trailing
// assistant turn, when present) are never dropped.
function dropOldestTurns(messages: ModelMessage[], budget: number): ModelMessage[] {
	const turnStarts: number[] = [];
	for (const [index, message] of messages.entries()) {
		if (message.role === "user" || turnStarts.length === 0) turnStarts.push(index);
	}
	if (turnStarts.length <= 2) return messages;

	const turns = turnStarts.map((start, turnIndex) => messages.slice(start, turnStarts[turnIndex + 1]));
	let dropCount = 0;
	while (dropCount < turns.length - 2 && estimateTokens(turns.slice(dropCount).flat()) > budget) {
		dropCount += 1;
	}

	return dropCount === 0 ? messages : turns.slice(dropCount).flat();
}

export function pruneAgentModelContext(
	messages: ModelMessage[],
	budget: number = AGENT_CONTEXT_TOKEN_BUDGET,
): ModelMessage[] {
	let current = supersedeStaleSnapshots(projectDocumentResults(messages));
	if (estimateTokens(current) <= budget) return current;

	// Tier 1: strip reasoning from all but the last assistant message.
	const withoutReasoning = pruneMessages({ messages: current, reasoning: "before-last-message" });
	if (estimateTokens(withoutReasoning) < estimateTokens(current)) current = withoutReasoning;
	if (estimateTokens(current) <= budget) return current;

	current = collapseOldestToolPairs(current, budget);
	if (estimateTokens(current) <= budget) return current;

	return dropOldestTurns(current, budget);
}
