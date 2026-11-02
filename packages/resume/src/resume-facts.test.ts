import { expect, it } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { copyCoverLetterStyle, createCoverLetterResumeData } from "./cover-letter";
import { buildMarkdown, resumeFactProposals } from "./markdown";

it("proposes visible career excerpts, retaining exact evidence without contact, hidden or letter content", () => {
	const data = structuredClone(defaultResumeData);
	data.basics.email = "private-contact@example.test";
	data.summary.content = "<p>Built reliable tools with a team of twelve.</p>";
	data.sections.skills.items = [
		{
			icon: "",
			iconColor: "",
			id: "skill",
			name: "TypeScript",
			proficiency: "",
			level: 0,
			keywords: ["Accessibility"],
			hidden: false,
		},
	];
	data.sections.experience.hidden = true;
	data.sections.experience.items = sampleResumeData.sections.experience.items;
	const letter = createCoverLetterResumeData({
		name: "Cover letter",
		recipient: "<p>Hiring Manager</p>",
		content: "<p>Letter-only confidential statement.</p>",
		style: copyCoverLetterStyle(data, "letter-section", "letter-item"),
	});
	data.customSections.push(...letter.customSections);
	data.metadata.layout.pages.push({ fullWidth: true, main: ["letter-section"], sidebar: [] });
	const result = resumeFactProposals(data);
	expect(result).toEqual({
		omitted: 0,
		proposals: [
			{
				text: "Built reliable tools with a team of twelve.",
				quote: "Built reliable tools with a team of twelve.",
				category: "experience",
			},
			{ text: "TypeScript: Accessibility", quote: "- **TypeScript**: Accessibility", category: "skill" },
		],
	});
	const markdown = buildMarkdown(data);
	expect(markdown).toContain("Letter-only confidential statement.");
	for (const proposal of result.proposals) expect(markdown).toContain(proposal.quote);
});

it("does not silently clip a long claim or propose contact-only documents", () => {
	const data = structuredClone(defaultResumeData);
	data.basics.headline = "Contact-only headline";
	expect(resumeFactProposals(data)).toEqual({ proposals: [], omitted: 0 });
	data.summary.content = `<p>${"Long claim ".repeat(210)}</p>`;
	expect(resumeFactProposals(data)).toEqual({ proposals: [], omitted: 1 });
});

it("bounds review without clipping or duplicating visible skill statements", () => {
	const data = structuredClone(defaultResumeData);
	data.sections.skills.items = Array.from({ length: 52 }, (_, i) => ({
		id: String(i),
		hidden: false,
		icon: "",
		iconColor: "",
		name: `Skill ${i}`,
		proficiency: "",
		level: 0,
		keywords: [],
	}));
	const result = resumeFactProposals(data);
	expect(result.proposals).toHaveLength(50);
	expect(result.omitted).toBe(2);
	expect(result.proposals[49]).toEqual({ text: "Skill 49", quote: "- **Skill 49**", category: "skill" });
});
