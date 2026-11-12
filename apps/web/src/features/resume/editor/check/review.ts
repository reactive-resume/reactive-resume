import type { WritingNote } from "../store";
import type { PageMapTarget } from "@reactive-resume/pdf/page-map";
import type { Passage, Proposal } from "@reactive-resume/resume/proposals";
import { replaceBlockText, unverifiedClaims } from "@reactive-resume/resume/proposals";
import { generateId } from "@reactive-resume/utils/string";

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
export function mapWritingReview(
	suggestions: readonly ReviewSuggestion[],
	passages: readonly Passage[],
	savedPassages: readonly { id: string; where: string; text: string }[] = [],
	documentText = passages.map((passage) => passage.text).join("\n"),
) {
	const byId = new Map(passages.map((passage) => [passage.id, passage]));
	const proposals: Proposal[] = [];
	const notes: WritingNote[] = [];

	for (const suggestion of suggestions) {
		const passage = suggestion.passageId ? byId.get(suggestion.passageId) : undefined;
		const rewrite = suggestion.rewrite?.trim();
		const saved = savedPassages.find((entry) => entry.id === suggestion.passageId);

		if (passage && rewrite && rewrite !== passage.text) {
			const entryText = passages
				.filter(
					(entry) =>
						entry.target.sectionId === passage.target.sectionId &&
						entry.target.itemId === passage.target.itemId &&
						entry.target.roleId === passage.target.roleId,
				)
				.map((entry) => entry.text)
				.join("\n");
			const unsupported = unverifiedClaims(rewrite, { entry: entryText, document: documentText });
			proposals.push({
				id: generateId(),
				target: passage.target,
				location: passage.location,
				before: passage.html,
				after: replaceBlockText(passage.html, rewrite),
				why: suggestion.issue,
				status: "pending",
				source: "check",
				...(unsupported.length ? { unsupported, addsClaims: true } : {}),
			});
			continue;
		}

		notes.push({
			location: passage?.location ?? saved?.where ?? suggestion.section ?? "",
			impact: suggestion.impact,
			quote: passage?.text ?? saved?.text ?? "",
			...(rewrite ? { rewrite } : {}),
			note: suggestion.issue,
			target: passage ? toPageTarget(passage.target) : null,
		});
	}

	return { proposals, notes };
}
