import { describe, expect, it } from "vite-plus/test";
import { zipSync } from "fflate";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { extractDocxText } from "./docx-text";
import { notImportedLines, reviewImport, withLeftoverSection, withLinkTargets } from "./review";

const resume = () => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Priya Raman";
	data.summary.content = "<p>Product designer focused on accessible checkout flows.</p>";
	data.sections.experience.items = [
		{
			id: "1",
			hidden: false,
			company: "Northwind Labs",
			position: "Senior Designer",
			location: "Berlin",
			period: "2021 – Present",
			website: { url: "", label: "", inlineLink: false },
			description: "<ul><li><p>Improved checkout-flow accessibility.</p></li></ul>",
			roles: [],
		} as never,
	];
	return data;
};

describe("notImportedLines", () => {
	it("lists source lines the resume doesn't hold, skipping headings and tidied lines", () => {
		const lines = [
			"PRIYA RAMAN",
			"Patents",
			"US 11,234,567 · Accessible payment form validation, 2023",
			"Improved checkout-flow accessability.",
			"Senior Designer, Northwind Labs, Berlin",
			"References",
			"Dana Lee, Head of Design at Northwind, dana@example.com",
		];
		expect(notImportedLines(resume(), lines)).toEqual([
			"US 11,234,567 · Accessible payment form validation, 2023",
			"Dana Lee, Head of Design at Northwind, dana@example.com",
		]);
	});
});

describe("reviewImport", () => {
	it("counts sections with content and notices missing contact details", () => {
		const data = resume();
		expect(reviewImport(data).sections.map(({ key, entries }) => [key, entries])).toEqual([
			["summary", 1],
			["experience", 1],
		]);
		expect(reviewImport(data).missingContact).toBe(false);
		data.basics.name = "";
		expect(reviewImport(data).missingContact).toBe(true);
	});
});

describe("withLeftoverSection", () => {
	it("keeps leftovers as a placed section of their own", () => {
		const data = withLeftoverSection(resume(), ["US 11,234,567 · Payment validation"], "More from your file");
		const section = data.customSections.at(-1);
		expect(section).toMatchObject({ type: "summary", title: "More from your file" });
		expect(data.metadata.layout.pages.at(-1)?.main.at(-1)).toBe(section?.id);
		expect(JSON.stringify(section?.items)).toContain("US 11,234,567");
	});
});

describe("withLinkTargets", () => {
	it("fills an empty profile address from the link behind it, and an empty email from a mail link", () => {
		const data = resume();
		data.sections.profiles.items = [
			{
				id: "p",
				hidden: false,
				icon: "",
				network: "LinkedIn",
				username: "",
				website: { url: "", label: "", inlineLink: false },
			} as never,
		];
		const linked = withLinkTargets(data, [
			"https://www.linkedin.com/in/priya-raman-example",
			"mailto:priya@example.com",
		]);
		expect(linked.sections.profiles.items[0]?.website.url).toBe("https://www.linkedin.com/in/priya-raman-example");
		expect(linked.basics.email).toBe("priya@example.com");
	});
});

describe("extractDocxText", () => {
	it("reads headers before the body", () => {
		const part = (root: string, text: string) =>
			new TextEncoder().encode(`<w:${root}><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:${root}>`);
		expect(
			extractDocxText(
				zipSync({ "word/document.xml": part("document", "Body"), "word/header1.xml": part("hdr", "Name") }),
			),
		).toBe("Name\n\nBody");
	});
});
