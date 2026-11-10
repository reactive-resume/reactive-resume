import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { applyResumeProposals, getProposalState, splitBlocks, type Proposal } from "@reactive-resume/resume/proposals";

export function storyboardProposals(data: ResumeData): Proposal[] {
	const entry = data.sections.experience.items.find((e) => e.id === "northwind");
	const before = splitBlocks(entry?.description ?? "")[1]?.html ?? "";
	return [
		{
			id: "storyboard-design-system",
			target: { sectionId: "experience", itemId: entry?.id ?? "", field: "description" },
			location: "Experience › Northwind Labs › line 2",
			before,
			after:
				"<li>Built and scaled a design system adopted by six product teams; cut interface defects by a third.</li>",
			why: "Lumen asks for design systems at scale; your design system fact backs it.",
			status: "pending",
			source: "assistant",
		},
		{
			id: "storyboard-summary",
			target: { sectionId: "summary", field: "content" },
			location: "Summary",
			before: splitBlocks(data.summary.content)[0]?.html ?? "",
			after:
				"<p>Product designer with eight years in onboarding, payments and design systems for business software. I lead accessibility audits and turn research into shipped, measurable changes.</p>",
			why: "Nothing checked backs this yet.",
			status: "pending",
			source: "assistant",
			unsupported: [{ kind: "term", text: "I lead accessibility audits" }],
		},
	];
}
/**
 * The storyboard's third edit, decided before the capture (B17 draws it folded to "Skills · Accepted" with Undo).
 * Gap: the fake conversation carries only the two open edits.
 */
export const storyboardDecided: { id: string; location: string; decision: "accepted" | "rejected" }[] = [
	{ id: "storyboard-skills", location: "Skills", decision: "accepted" },
];
export { applyResumeProposals, getProposalState };
