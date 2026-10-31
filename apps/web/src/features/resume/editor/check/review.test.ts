import { expect, it } from "vite-plus/test";
import { getStateIn } from "@reactive-resume/resume/proposals";
import { mapWritingReview } from "./review";

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
