import type { WritingNote } from "../store";
import type { PageMapTarget } from "@reactive-resume/pdf/page-map";
import type { Passage, Proposal } from "@reactive-resume/resume/proposals";
import { replaceBlockText } from "@reactive-resume/resume/proposals";

type ReviewSuggestion = {
	section: string | null;
	passageId: string | null;
	issue: string;
	rewrite: string | null;
	impact: WritingNote["impact"];
};

const toPageTarget = (target: Proposal["target"]): PageMapTarget =>
	target.itemId
		? { kind: "item", sectionId: target.sectionId, itemId: target.itemId }
		: { kind: "section", sectionId: target.sectionId };

/**
 * Sorts a writing review's suggestions: a rewrite of a passage that was sent becomes a proposal to accept or
 * reject; anything else (advice, or a rewrite of text it wasn't given) stays a note.
 */
export function mapWritingReview(suggestions: readonly ReviewSuggestion[], passages: readonly Passage[]) {
	const byId = new Map(passages.map((passage) => [passage.id, passage]));
	const proposals: Proposal[] = [];
	const notes: WritingNote[] = [];

	for (const suggestion of suggestions) {
		const passage = suggestion.passageId ? byId.get(suggestion.passageId) : undefined;
		const rewrite = suggestion.rewrite?.trim();

		if (passage && rewrite && rewrite !== passage.text) {
			proposals.push({
				id: `w${proposals.length + 1}`,
				target: passage.target,
				location: passage.location,
				before: passage.html,
				after: replaceBlockText(passage.html, rewrite),
				why: suggestion.issue,
				status: "pending",
				source: "check",
			});
			continue;
		}

		notes.push({
			location: passage?.location ?? suggestion.section ?? "",
			impact: suggestion.impact,
			quote: passage?.text ?? "",
			note: suggestion.issue,
			target: passage ? toPageTarget(passage.target) : null,
		});
	}

	return { proposals, notes };
}
