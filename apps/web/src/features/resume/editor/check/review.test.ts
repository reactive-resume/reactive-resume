import { expect, it } from "vite-plus/test";
import { getStateIn } from "@reactive-resume/resume/proposals";
import { editWritingProposal, mapWritingReview } from "./review";

it("does not reuse an accepted proposal identity for a fresh writing review", () => {
	const passages = [
		{
			id: "passage",
			target: { sectionId: "summary", field: "content" },
			html: "<p>Original</p>",
			text: "Original",
			location: "Summary",
		},
	];
	const suggestions = [
		{ passageId: "passage", section: null, issue: "Clearer", rewrite: "Rewritten", impact: "high" as const },
	];
	const first = mapWritingReview(suggestions, passages).proposals[0];
	const next = mapWritingReview(suggestions, passages).proposals[0];
	if (!first || !next) throw new Error("Missing proposals");
	expect(next.id).not.toBe(first.id);
	expect(getStateIn("<p>Original</p>", next, { [first.id]: true })).toBe("pending");
});

it("keeps stale original and rewrite readable without an applicable proposal", () => {
	const result = mapWritingReview(
		[
			{
				section: "Summary",
				passageId: "old",
				issue: "Be specific",
				rewrite: "Built fictional systems",
				impact: "medium",
			},
		],
		[],
		[{ id: "old", where: "Summary paragraph 1", text: "Worked on fictional systems" }],
	);
	expect(result.proposals).toEqual([]);
	expect(result.notes).toEqual([
		{
			location: "Summary paragraph 1",
			impact: "medium",
			quote: "Worked on fictional systems",
			rewrite: "Built fictional systems",
			note: "Be specific",
			target: null,
		},
	]);
});

it("flags new writing claims for individual confirmation using the shared proposal guard", () => {
	const passages = [
		{
			id: "bullet",
			target: { sectionId: "experience", itemId: "role", field: "description" },
			html: "<li>Built systems.</li>",
			text: "Built systems.",
			location: "Experience",
		},
	];
	const review = (rewrite: string) =>
		mapWritingReview(
			[{ section: "Experience", passageId: "bullet", issue: "Be specific", rewrite, impact: "medium" }],
			passages,
		).proposals[0];
	expect(review("Built systems for 40 engineers.")).toMatchObject({
		addsClaims: true,
		unsupported: expect.arrayContaining([expect.objectContaining({ kind: "figure" })]),
	});
	expect(review("Built systems.")).toBeUndefined();
	expect(review("Built systems")).not.toHaveProperty("addsClaims");
});

it("rechecks edited writing claims while preserving proposal identity and AI receipt", () => {
	const passages = [
		{
			id: "bullet",
			target: { sectionId: "experience", itemId: "role", field: "description" },
			html: "<li>Built systems.</li>",
			text: "Built systems.",
			location: "Experience",
		},
	];
	const proposal = mapWritingReview(
		[
			{
				section: "Experience",
				passageId: "bullet",
				issue: "Clearer",
				rewrite: "Built better systems.",
				impact: "medium",
			},
		],
		passages,
	).proposals[0];
	if (!proposal) throw new Error("Missing proposal");
	const original = { ...proposal, aiOperationIds: ["receipt"] };
	const edited = editWritingProposal(original, "Built systems for 40 engineers.", passages, "Built systems.");
	expect(edited).toMatchObject({
		id: original.id,
		before: original.before,
		after: "<li>Built systems for 40 engineers.</li>",
		edited: true,
		aiOperationIds: ["receipt"],
		addsClaims: true,
		unsupported: expect.arrayContaining([expect.objectContaining({ kind: "figure" })]),
	});
	expect(editWritingProposal(edited, "Built systems.", passages, "Built systems.")).toMatchObject({
		addsClaims: false,
		unsupported: [],
	});
});
