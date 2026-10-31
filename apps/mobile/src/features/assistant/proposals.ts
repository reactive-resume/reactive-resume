// Proposed edits from the assistant: as cards in the chat, applied to the draft through the M3-T3 store, and marked on
// the Page tab (ported from apps/web/src/features/resume/editor/proposals/proposals.ts).
import type {
	Proposal,
	ProposalApplicationResult,
	ProposalApplications,
	RequirementCoverage,
} from "@reactive-resume/resume/proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { plural, t } from "@lingui/core/macro";
import { produce } from "immer";
import { useMemo } from "react";
import { create } from "zustand";
import { applyResumeProposals, getProposalState, splitBlock, splitBlocks } from "@reactive-resume/resume/proposals";
import { getAccountScope } from "@/auth/session";
import { useResumeStore } from "@/draft";
import { dismissToast, showToast } from "@/ui";

type ProposeEditsOutput = {
	edits?: Array<Omit<Proposal, "source" | "target"> & { target: Record<string, string | undefined> }>;
	skipped?: unknown[];
	requirements?: RequirementCoverage[];
};

/** What the user did with an edit in this session: its status, and their wording when they rewrote it. */
/** What the server's receipts say about an edit: its decision, and the user's saved wording when they changed it. */
export type Receipt = { status: Proposal["status"] } & Partial<Pick<Proposal, "after" | "unsupported" | "edited">>;

export type ToolPart = {
	type: string;
	toolCallId?: string;
	state?: string;
	input?: unknown;
	output?: unknown;
	errorText?: string;
};

export const isProposeEdits = (part: { type: string }): part is ToolPart =>
	part.type === "tool-propose_edits" && (part as ToolPart).state === "output-available";

export const skippedCount = (part: ToolPart) => (part.output as ProposeEditsOutput | undefined)?.skipped?.length ?? 0;

/** The posting's requirements as the assistant read them for this set, gaps included. */
export const requirementsOf = (part: ToolPart) => (part.output as ProposeEditsOutput | undefined)?.requirements ?? [];

/** The edits in a `propose_edits` result, with what the user has done with each since. */
export function toProposals(part: ToolPart, receipts: ReadonlyMap<string, Receipt>): Proposal[] {
	const output = part.output as ProposeEditsOutput | undefined;
	return (output?.edits ?? []).map((streamed) => {
		const receipt = receipts.get(streamed.id);
		const edit = receipt?.edited ? { ...streamed, ...receipt } : streamed;
		return {
			...edit,
			target: {
				sectionId: edit.target.sectionId ?? "",
				field: edit.target.field ?? "",
				...(edit.target.itemId === undefined ? {} : { itemId: edit.target.itemId }),
				...(edit.target.roleId === undefined ? {} : { roleId: edit.target.roleId }),
			},
			status: receipt?.status ?? edit.status,
			source: "assistant",
		};
	});
}

/** The toast uses actual writes, with placement failures reported separately from successes. */
export function proposalResultMessage({ applied, stale }: ProposalApplicationResult) {
	return [
		applied.length > 0 ? plural(applied.length, { 1: "Edit applied", other: "# edits applied" }) : "",
		stale.length > 0
			? plural(stale.length, {
					one: "# edit couldn't be placed: its text changed. Ask again to redo it.",
					other: "# edits couldn't be placed: their text changed. Ask again to redo them.",
				})
			: "",
	]
		.filter(Boolean)
		.join(" · ");
}

/** Applies proposals to the open resume as one undo step; the toast's Undo takes them back. */
export function acceptResumeProposals(proposals: readonly Proposal[]): ProposalApplicationResult {
	let result: ProposalApplicationResult = { applied: [], stale: [] };
	const applied: Proposal[] = [];
	const store = useResumeStore.getState();
	const scope = getAccountScope();
	const id = store.document?.id;
	if (!id || !store.data || store.locked) return result;
	store.update(
		(draft) => {
			result = applyResumeProposals(draft as ResumeData, proposals, store.proposalApplications);
			applied.push(...result.applied);
		},
		{ newStep: true, applied },
	);
	const accepted = useResumeStore.getState().data;
	if (result.applied.length === 0) {
		if (result.stale.length > 0) showToast({ message: proposalResultMessage(result) });
		return result;
	}
	let eligible = true;
	const toastId = showToast({
		message: proposalResultMessage(result),
		action: {
			label: t`Undo`,
			onPress: () => {
				const current = useResumeStore.getState();
				if (
					eligible &&
					getAccountScope() === scope &&
					current.document?.id === id &&
					current.data === accepted &&
					!current.locked
				)
					current.undo();
				else showToast({ message: t`Use the builder's Undo to undo earlier changes.` });
			},
		},
	});
	const unsubscribe = useResumeStore.subscribe((current) => {
		if (getAccountScope() === scope && current.document?.id === id && current.data === accepted) return;
		eligible = false;
		dismissToast(toastId);
		unsubscribe();
	});
	// Action toasts last up to 12 seconds with a screen reader; eligibility ends with monitoring.
	setTimeout(() => {
		eligible = false;
		unsubscribe();
	}, 12000);
	return result;
}

// ---- Page markings ----

const NONE: readonly Proposal[] = [];

/** The assistant's proposals for one resume, kept after the assistant closes so Page can mark them. */
export const useAssistantProposals = create<{
	resumeId: string | null;
	proposals: readonly Proposal[];
	revision: string | number | null;
}>(() => ({
	resumeId: null,
	proposals: [],
	revision: null,
}));

/** Skips an unchanged list: a streaming reply rebuilds it on every chunk, and Page re-marks on each publish. */
export const publishProposals = (resumeId: string, proposals: readonly Proposal[]) => {
	const current = useAssistantProposals.getState();
	const revision = useResumeStore.getState().proposalRevision;
	if (
		current.resumeId === resumeId &&
		current.revision === revision &&
		JSON.stringify(current.proposals) === JSON.stringify(proposals)
	)
		return;
	useAssistantProposals.setState({ resumeId, proposals, revision });
};

/** The proposals still waiting on the user (not accepted, rejected or out of date). */
export const pendingProposals = (
	data: ResumeData,
	proposals: readonly Proposal[],
	applications: ProposalApplications = {},
) => proposals.filter((proposal) => getProposalState(data, proposal, applications) === "pending");

// The PDF needs literal colours for its marks (web README §5.9), the same as web's page canvas.
const OLD_TEXT_COLOR = "#7d7b73";
const NEW_TEXT_BACKGROUND = "#d4efd9";
const struck = (html: string) => `<s style="color: ${OLD_TEXT_COLOR}">${html}</s>`;
const highlighted = (html: string) => `<mark data-color="${NEW_TEXT_BACKGROUND}">${html}</mark>`;

function markChange(before: string, after: string) {
	if (after.startsWith(before) && after.length > before.length) {
		const added = after.slice(before.length);
		const marked = splitBlocks(added).reduce((html, block) => {
			const parts = splitBlock(block.html);
			return parts ? html.replace(block.html, () => `${parts.open}${highlighted(parts.inner)}${parts.close}`) : html;
		}, added);
		return `${before}${marked === added ? highlighted(added) : marked}`;
	}
	const old = splitBlock(before);
	const next = splitBlock(after);
	if (!old || !next) return `${struck(before)} ${highlighted(after)}`;
	return `${old.open}${struck(old.inner)} ${highlighted(next.inner)}${old.close}`;
}

/** The page as it would read with the proposals: old text struck through, new text highlighted. Never saved. */
export function markProposals(
	data: ResumeData,
	proposals: readonly Proposal[],
	applications: ProposalApplications = {},
): ResumeData {
	const pending = pendingProposals(data, proposals, applications);
	if (pending.length === 0) return data;
	return produce(data, (draft) => {
		applyResumeProposals(
			draft,
			pending.map((proposal) =>
				proposal.snapshot ? proposal : { ...proposal, after: markChange(proposal.before, proposal.after) },
			),
			applications,
		);
	});
}

/**
 * For the Page tab: the resume data with this resume's pending assistant edits marked, and how many there are.
 * `data` is the draft's data; pass the result to `usePreview` instead.
 */
export function useMarkedResumeData(resumeId: string, data: ResumeData | null) {
	const applications = useResumeStore((state) => state.proposalApplications);
	const revision = useResumeStore((state) => state.proposalRevision);
	const proposals = useAssistantProposals((state) =>
		state.resumeId === resumeId && state.revision === revision ? state.proposals : NONE,
	);
	return useMemo(
		() =>
			!data || proposals.length === 0
				? { data, pending: 0 }
				: {
						data: markProposals(data, proposals, applications),
						pending: pendingProposals(data, proposals, applications).length,
					},
		[data, proposals, applications],
	);
}
