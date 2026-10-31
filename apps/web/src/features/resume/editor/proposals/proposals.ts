import type { Proposal, ProposalApplicationResult, ProposalApplications } from "@reactive-resume/resume/proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { plural, t } from "@lingui/core/macro";
import { produce } from "immer";
import { applyResumeProposals, getProposalState, splitBlock, splitBlocks } from "@reactive-resume/resume/proposals";
import { toast } from "@reactive-resume/ui/components/toast";
import { useResumeStore } from "@/features/resume/builder/draft";

// Colours of the page marks (README §5.9), as the PDF needs them: old text struck through in grey, new text on
// a pale accent highlight.
const OLD_TEXT_COLOR = "#7d7b73";
const NEW_TEXT_BACKGROUND = "#d4efd9";

const struck = (html: string) => `<s style="color: ${OLD_TEXT_COLOR}">${html}</s>`;
const highlighted = (html: string) => `<mark data-color="${NEW_TEXT_BACKGROUND}">${html}</mark>`;

/** The old text struck through, then the new text highlighted, inside the passage's own block. */
export function markChange(before: string, after: string) {
	// An addition keeps the passage and adds a block after it: only the new block is marked.
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

/** The proposals still waiting on the user (not accepted, rejected or out of date), optionally in one section. */
export const pendingProposals = (
	data: ResumeData,
	proposals: readonly Proposal[],
	sectionId?: string,
	applications: ProposalApplications = {},
) =>
	proposals.filter(
		(proposal) =>
			(sectionId === undefined || proposal.target.sectionId === sectionId) &&
			getProposalState(data, proposal, applications) === "pending",
	);

/**
 * The page as it would read with the proposals: each passage struck through, followed by its replacement,
 * highlighted. For the preview only; it's never saved.
 */
export function markProposals(
	data: ResumeData,
	proposals: readonly Proposal[],
	applications: ProposalApplications = {},
): ResumeData {
	const pending = pendingProposals(data, proposals, undefined, applications);
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

/** Applies proposals as one undo step, returning only real writes for callers to record as accepted. */
export function acceptResumeProposals(proposals: readonly Proposal[]): ProposalApplicationResult {
	const store = useResumeStore.getState();
	const resume = store.resume;
	if (!resume || resume.isLocked) return { applied: [], stale: [] };
	let result: ProposalApplicationResult = { applied: [], stale: [] };
	const next = produce(resume.data, (draft) => {
		result = applyResumeProposals(draft as ResumeData, proposals, store.proposalApplications);
	});
	if (result.applied.length > 0)
		store.updateResumeData(
			(draft) => {
				Object.assign(draft, next);
			},
			{ newStep: true, proposalIds: result.applied.map((proposal) => proposal.id) },
		);
	const accepted = useResumeStore.getState().resume?.data;
	if (result.applied.length > 0 || result.stale.length > 0)
		toast.add({
			description: proposalResultMessage(result),
			...(result.applied.length > 0
				? {
						actionProps: {
							children: t`Undo`,
							onClick: () => {
								const current = useResumeStore.getState();
								if (current.resume?.id === resume.id && current.resume.data === accepted) current.undo();
							},
						},
					}
				: {}),
		});
	return result;
}
