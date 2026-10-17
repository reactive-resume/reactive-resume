import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import * as forme from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act } from "react";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { renderResume } from "../../forme/render";

// Layout fixtures use Forme's built-in Times faces; no network font download is needed.
vi.mock("../../forme/fonts", () => ({ loadFonts: async () => ({ fonts: [], warnings: [], missing: [] }) }));

function fixture() {
	const data = structuredClone(sampleResumeData);
	data.metadata.template = "persian";
	data.metadata.typography.body.fontFamily = "Times-Roman";
	data.metadata.typography.heading.fontFamily = "Times-Roman";
	data.metadata.page.marginX = 30;
	data.metadata.page.marginY = 30;
	data.metadata.page.hideSectionIcons = true;
	data.metadata.layout.pages = [
		{ fullWidth: false, main: ["experience", "education", "projects"], sidebar: ["skills"] },
	];
	data.picture.hidden = true;
	for (const section of ["experience", "education", "projects", "skills"] as const) {
		data.sections[section].items.splice(1);
		const item = data.sections[section].items[0];
		if (!item) throw new Error(`Missing sample ${section}`);
		if ("description" in item) item.description = "<p>Sample detail.</p>";
		if ("level" in item) item.level = 0;
		if ("website" in item) item.website = { url: `https://example.com/${section}`, label: section, inlineLink: true };
	}
	data.sections.experience.items[0]?.roles.push({
		id: "role-1",
		position: "Research Intern",
		period: "2023",
		description: "<p>Evaluated markets.</p>",
	});
	return data;
}

async function render(data = fixture()) {
	const result = await act(() => renderResume(forme, { data, template: "persian" }));
	expect(result.missingFonts).toEqual([]);
	const loading = getDocument({
		data: result.pdf.slice(),
		standardFontDataUrl: fileURLToPath(new URL("standard_fonts/", import.meta.resolve("pdfjs-dist/package.json"))),
	});
	try {
		const document = await loading.promise;
		const pages = await Promise.all(
			Array.from({ length: document.numPages }, async (_, index) => {
				const page = await document.getPage(index + 1);
				const content = await page.getTextContent();
				return {
					items: content.items.filter((item): item is TextItem => "str" in item && Boolean(item.str.trim())),
					styles: content.styles,
					width: page.getViewport({ scale: 1 }).width,
					height: page.getViewport({ scale: 1 }).height,
					links: (await page.getAnnotations()).flatMap((annotation) =>
						typeof annotation.url === "string" ? [annotation.url] : [],
					),
				};
			}),
		);
		return pages;
	} finally {
		await loading.destroy();
	}
}

describe("Persian Wall Street template (#3520)", () => {
	it.each(["a4", "letter"] as const)(
		"centers the header and keeps standard entry headers aligned on %s",
		async (format) => {
			const data = fixture();
			data.metadata.page.format = format;
			data.metadata.typography.heading.fontFamily = "Helvetica";
			const pages = await render(data);
			expect(pages).toHaveLength(1);
			const page = pages[0];
			if (!page) throw new Error("Missing first page");
			const find = (value: string) => {
				const item = page.items.find((candidate) => candidate.str.includes(value));
				if (!item) throw new Error(`Missing PDF text: ${value}`);
				return item;
			};
			const name = find(data.basics.name);
			expect(page.styles[name.fontName]?.fontFamily).toBe("sans-serif");
			for (const title of ["Experience", "Education", "Projects", "Skills"]) {
				expect(page.styles[find(title).fontName]?.fontFamily).toBe("sans-serif");
			}
			const experience = data.sections.experience.items[0];
			const education = data.sections.education.items[0];
			const skill = data.sections.skills.items[0];
			const project = data.sections.projects.items[0];
			if (!experience || !education || !skill || !project) throw new Error("Missing sample entries");
			expect(name.transform[4] + name.width / 2).toBeCloseTo(page.width / 2, 0);
			const position = find(experience.position);
			expect(page.styles[position.fontName]?.fontFamily).toBe("serif");
			const period = find(experience.period);
			expect(position.transform[5]).toBeCloseTo(period.transform[5], 1);
			expect(period.transform[4] + period.width).toBeCloseTo(page.width - 30, 0);
			expect(find(experience.company).transform[5]).toBeGreaterThan(position.transform[5] ?? 0);
			expect(find(education.area).transform[5]).toBeCloseTo(find(education.period).transform[5], 1);
			for (const expected of [
				education.degree,
				education.grade,
				education.location,
				"Research Intern",
				skill.name,
				project.name,
			])
				find(expected);
			expect(page.links).toContain("https://example.com/experience");
			expect(page.links).toContain("https://example.com/education");
			for (const item of page.items) {
				expect(item.transform[4]).toBeGreaterThanOrEqual(29.9);
				expect((item.transform[4] ?? 0) + item.width).toBeLessThanOrEqual(page.width - 29.9);
			}
		},
	);

	it("prints every overflowing entry without losing the final section", async () => {
		const data = fixture();
		const project = data.sections.projects.items[0];
		if (!project) throw new Error("Missing project fixture");
		data.sections.projects.items = Array.from({ length: 35 }, (_, index) => ({
			...project,
			id: `project-${index}`,
			name: `Project ${index}`,
			description: "<p>Researched companies and built detailed financial models for portfolio decisions.</p>",
		}));
		const pages = await render(data);
		expect(pages.length).toBeGreaterThan(1);
		const text = pages.flatMap((page) => page.items.map((item) => item.str)).join(" ");
		for (let index = 0; index < 35; index++) expect(text).toContain(`Project ${index}`);
		expect(text).toContain(data.sections.skills.items[0]?.name);
	});
});
