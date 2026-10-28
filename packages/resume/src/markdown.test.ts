import { describe, expect, it } from "vite-plus/test";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { copyCoverLetterStyle, createCoverLetterResumeData } from "./cover-letter";
import { getResumeExportData } from "./export-sections";
import { buildMarkdown, htmlToMarkdown } from "./markdown";

// A letter's document, as the letter export builds it: resume data with one cover-letter section.
const withLetter = () => {
	const data = structuredClone(sampleResumeData);
	const letter = createCoverLetterResumeData({
		name: "Cover Letter",
		recipient: "<p>Hiring Manager</p>",
		content: "<p>Dear Hiring Manager,</p><p>I'm excited to apply.</p>",
		style: copyCoverLetterStyle(data, "letter-section", "letter-item"),
	});
	data.customSections.push(...letter.customSections);
	data.metadata.layout.pages.push({ fullWidth: true, main: ["letter-section"], sidebar: [] });
	return data;
};

describe("htmlToMarkdown", () => {
	it("bounds repeated work and indentation across nested lists", () => {
		const rows = "<li>line</li>".repeat(1000);
		const nested = "<ul><li>parent".repeat(30) + `<ul>${rows}</ul>` + "</li></ul>".repeat(30);
		expect(() => htmlToMarkdown(nested)).toThrow("too complex");
	});
	it("preserves numbered-list starts and inline formatting", () => {
		expect(
			htmlToMarkdown(
				'<ol start="3"><li><p><strong>Lead</strong> <em>work</em> with <a href="https://example.com"><strong>proof</strong></a></p></li><li><p><s>Old</s> <u>New</u></p></li></ol>',
			),
		).toBe("3. **Lead** _work_ with [**proof**](https://example.com/)\n4. ~~Old~~ <u>New</u>");
	});
	it("keeps nested list markers beneath their parent", () => {
		expect(htmlToMarkdown("<ul><li><p>Parent</p><ol><li><p>Child</p></li></ol></li></ul>")).toBe(
			"- Parent\n\n  1. Child",
		);
	});
	it("converts the constrained tiptap tag set", () => {
		const html = "<p>Led <strong>teams</strong> of <em>engineers</em>.</p><ul><li>Shipped X</li><li>Owned Y</li></ul>";
		expect(htmlToMarkdown(html)).toBe("Led **teams** of _engineers_.\n\n- Shipped X\n- Owned Y");
	});

	it("converts anchors to Markdown links and decodes entities", () => {
		expect(htmlToMarkdown('<p>See <a href="https://x.com">Tom &amp; Jerry</a></p>')).toBe(
			"See [Tom & Jerry](https://x.com/)",
		);
	});
});

describe("buildMarkdown", () => {
	it("keeps experience descriptions when visible or blank roles are present", () => {
		const data = structuredClone(sampleResumeData);
		const item = data.sections.experience.items[0];
		if (!item) throw new Error("Missing experience fixture");
		item.description = "<p>Company-wide impact</p>";
		item.roles = [{ id: "role", position: "Lead", period: "", description: "<p>Role impact</p>" }];
		expect(buildMarkdown(data)).toContain("Company-wide impact");
		expect(buildMarkdown(data)).toContain("Role impact");
		item.roles = [{ id: "blank-role", position: " ", period: "", description: "<p>Role impact</p>" }];
		expect(buildMarkdown(data)).toContain(`### ${item.company} — ${item.position}`);
		expect(buildMarkdown(data)).not.toContain("Role impact");
	});
	// Section titles are stored empty and resolved by the caller; mimic that with a simple resolver.
	const resolveTitle = (sectionId: string) =>
		({ summary: "Summary", experience: "Experience", education: "Education" })[sectionId];
	const md = buildMarkdown(getResumeExportData(sampleResumeData, "resume"), resolveTitle);

	it("renders resolved section headings as H2", () => {
		expect(md).toContain("## Experience");
	});

	it("ends with a single trailing newline and never contains raw HTML tags", () => {
		expect(md.endsWith("\n")).toBe(true);
		expect(md).not.toMatch(/<[a-z][^>]*>/i);
	});

	it("renders the cover-letter scope without resume header or section heading", () => {
		const cover = buildMarkdown(getResumeExportData(withLetter(), "cover-letter"));

		expect(cover).toContain("Dear Hiring Manager");
		expect(cover).not.toContain(`# ${sampleResumeData.basics.name}`);
		expect(cover).not.toContain(`_${sampleResumeData.basics.headline}_`);
		expect(cover).not.toContain("## Cover Letter");
	});
});
