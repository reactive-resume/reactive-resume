import type { UIMessage } from "ai";

// Pure merge of client-authored tool responses into a stored assistant message. Handles both
// ask_user_question answers and tool-approval responses in one pass (a message can carry both).
// For approvals only the client's decision fields are copied — the stored, server-signed request
// payload (approval id + signature) is kept, so a client cannot substitute a forged request.

type AgentToolPart = UIMessage["parts"][number] & {
	toolCallId?: string;
	state?: string;
	output?: unknown;
	errorText?: string;
	approval?: {
		id: string;
		approved?: boolean;
		reason?: string;
		isAutomatic?: boolean;
		signature?: string;
	};
};

type ApprovalDecision = { approved: boolean; reason?: string };

export type MergeClientToolResponsesResult = {
	message: UIMessage;
	mergedCount: number;
	/** Matches on terminal parts (question answered, approval executed or denied). */
	alreadyResolvedCount: number;
	/** Incoming responses that match a stored question already in a terminal state. */
	resolvedQuestionCount: number;
	/**
	 * Resolved questions whose answer is identical to the stored answer. A retry may reuse this
	 * match only while the stored continuation has not completed, and never for a different answer.
	 */
	idempotentQuestionCount: number;
	/**
	 * Matches on approval parts that are responded but not yet executed — a continuation run was
	 * claimed (or persisted) earlier but never completed. Callers should proceed with a run so the
	 * recorded decision can still execute instead of stranding it.
	 */
	pendingContinuationCount: number;
	conflictingCount: number;
};

function isAnsweredQuestionPart(part: AgentToolPart): part is AgentToolPart & { toolCallId: string } {
	return (
		part.type === "tool-ask_user_question" &&
		typeof part.toolCallId === "string" &&
		(part.state === "output-available" || part.state === "output-error")
	);
}

function approvalKey(toolCallId: string, approvalId: string) {
	return `${toolCallId}:${approvalId}`;
}

export function mergeClientToolResponses(
	existingMessage: UIMessage,
	incomingMessage: UIMessage,
): MergeClientToolResponsesResult {
	const answeredQuestions = new Map<string, AgentToolPart>();
	const approvalDecisions = new Map<string, ApprovalDecision>();

	for (const part of incomingMessage.parts as AgentToolPart[]) {
		if (isAnsweredQuestionPart(part)) {
			answeredQuestions.set(part.toolCallId, part);
			continue;
		}

		if (
			part.state === "approval-responded" &&
			typeof part.toolCallId === "string" &&
			typeof part.approval?.id === "string" &&
			typeof part.approval.approved === "boolean"
		) {
			approvalDecisions.set(approvalKey(part.toolCallId, part.approval.id), {
				approved: part.approval.approved,
				...(part.approval.reason ? { reason: part.approval.reason } : {}),
			});
		}
	}

	let mergedCount = 0;
	let alreadyResolvedCount = 0;
	let resolvedQuestionCount = 0;
	let idempotentQuestionCount = 0;
	let pendingContinuationCount = 0;
	let conflictingCount = 0;

	const parts = existingMessage.parts.map((part) => {
		const existingPart = part as AgentToolPart;

		if (existingPart.type === "tool-ask_user_question" && typeof existingPart.toolCallId === "string") {
			const answer = answeredQuestions.get(existingPart.toolCallId);
			if (answer) {
				if (existingPart.state === "input-available") {
					mergedCount += 1;
					if (answer.state === "output-error") {
						return {
							...part,
							state: "output-error",
							errorText: answer.errorText ?? "User answer failed.",
						} as UIMessage["parts"][number];
					}

					return { ...part, state: "output-available", output: answer.output } as UIMessage["parts"][number];
				}

				if (existingPart.state === "output-available" || existingPart.state === "output-error") {
					alreadyResolvedCount += 1;
					resolvedQuestionCount += 1;
					if (
						existingPart.state === "output-available" &&
						answer.state === "output-available" &&
						typeof existingPart.output === "string" &&
						existingPart.output === answer.output
					)
						idempotentQuestionCount += 1;
				}

				return part;
			}
		}

		if (typeof existingPart.toolCallId === "string" && typeof existingPart.approval?.id === "string") {
			const decision = approvalDecisions.get(approvalKey(existingPart.toolCallId, existingPart.approval.id));
			if (decision) {
				if (existingPart.state === "approval-requested") {
					mergedCount += 1;
					return {
						...part,
						state: "approval-responded",
						// Keep the stored (signed) request payload; copy only the decision fields.
						approval: {
							...existingPart.approval,
							approved: decision.approved,
							...(decision.reason ? { reason: decision.reason } : {}),
						},
					} as UIMessage["parts"][number];
				}

				if (typeof existingPart.approval.approved === "boolean") {
					if (existingPart.approval.approved !== decision.approved) conflictingCount += 1;
					else if (existingPart.state === "approval-responded") pendingContinuationCount += 1;
					else alreadyResolvedCount += 1;
				}

				return part;
			}
		}

		return part;
	});

	return {
		message: { ...existingMessage, parts },
		mergedCount,
		alreadyResolvedCount,
		resolvedQuestionCount,
		idempotentQuestionCount,
		pendingContinuationCount,
		conflictingCount,
	};
}
