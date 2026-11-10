import type { RouterInput } from "@/api/client";
import type { Proposal, ProposalApplicationResult } from "@reactive-resume/resume/proposals";
import { t } from "@lingui/core/macro";
import { applyResumeProposals, getProposalState } from "@reactive-resume/resume/proposals";
import { dataClient } from "./client";
import { useResumeStore } from "./draft";
import { useConversation } from "./platform";
import { activeDataScope, assertDataScope } from "./scope";
export { getProposalState };
/** The server verifies wording before the draft applies; the draft saves atomic proposal applications with its patch. */
export async function decideResumeProposals(
	input: Omit<RouterInput["agent"]["messages"]["setEditStatus"], "edits">,
	proposals: readonly Proposal[],
	decision: "accepted" | "rejected",
) {
	const scope = activeDataScope();
	const store = useResumeStore.getState();
	if (!store.document || !store.data || store.locked) throw new Error(t`Open an unlocked resume first.`);
	const id = store.document.id;
	const data = store.data;
	const result: ProposalApplicationResult = { applied: [], stale: [] };
	const eligible = proposals.filter((proposal) => {
		if (decision === "accepted" && getProposalState(data, proposal, store.proposalApplications) !== "pending") {
			result.stale.push(proposal);
			return false;
		}
		return true;
	});
	if (!eligible.length) return result;
	await dataClient.agent.messages.setEditStatus(
		{ ...input, edits: eligible.map((proposal) => ({ id: proposal.id, status: decision, after: proposal.after })) },
		{ context: { scope } },
	);
	assertDataScope(scope);
	const current = useResumeStore.getState();
	if (current.document?.id !== id || current.data !== data || current.locked)
		throw new Error(t`Resume changed. Review the proposals again.`);
	if (decision === "accepted") {
		const applied: Proposal[] = [];
		current.update(
			(draft) => {
				const actual = applyResumeProposals(draft, eligible, current.proposalApplications);
				result.applied.push(...actual.applied);
				result.stale.push(...actual.stale);
				applied.push(...actual.applied);
			},
			{ newStep: true, applied },
		);
		await useResumeStore.getState().flush();
	}
	return result;
}

export function useAssistantProposals(threadId: string) {
	const conversation = useConversation(threadId);
	const groups = (conversation.data?.messages ?? []).flatMap((message) =>
		message.parts.flatMap((part) => {
			const tool = part as { type: string; toolCallId?: string; state?: string; output?: { edits?: Proposal[] } };
			if (
				tool.type !== "tool-propose_edits" ||
				tool.state !== "output-available" ||
				!tool.toolCallId ||
				!Array.isArray(tool.output?.edits)
			)
				return [];
			return [
				{
					messageId: message.id,
					toolCallId: tool.toolCallId,
					proposals: tool.output.edits.map((edit) => ({ ...edit, source: "assistant" as const })),
				},
			];
		}),
	);
	return {
		conversation,
		groups,
		decide: (
			group: { messageId: string; toolCallId: string },
			proposals: readonly Proposal[],
			decision: "accepted" | "rejected",
		) => decideResumeProposals({ threadId, ...group }, proposals, decision),
	};
}
