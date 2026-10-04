import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../document";
import { renderToBuffer } from "../forme/testing";

const table = (paragraphs = false) =>
	`<table style="width: 300pt; border-collapse: collapse"><tbody>${[
		["Alpha", "Beta", "Gamma"],
		["Delta", "Epsilon", "Zeta"],
	]
		.map(
			(row) =>
				`<tr>${row.map((text) => `<td style="width: 100pt; border: 1pt solid black; padding: 4pt">${paragraphs ? `<p>${text}</p>` : text}</td>`).join("")}</tr>`,
		)
		.join("")}</tbody></table>`;

const fixture = (html: string): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Table probe";
	data.picture.hidden = true;
	// Keep the featured summary heading off: these assertions measure table geometry/borders only.
	data.summary.showHeading = false;
	data.summary.content = html;
	data.metadata.layout.pages = [{ fullWidth: true, main: ["summary"], sidebar: [] }];
	data.metadata.typography.body.fontFamily = "Helvetica";
	data.metadata.typography.heading.fontFamily = "Helvetica";
	data.metadata.stylesheet = { mode: "semantic", source: { languageVersion: 1, text: "@version 1;" } };
	return data;
};

const readPdf = async (data: ResumeData, template: Template) => {
	const bytes = new Uint8Array(await act(() => renderToBuffer(<ResumeDocument data={data} template={template} />)));
	const loading = getDocument({ data: bytes.slice() });
	try {
		const document = await loading.promise;
		const page = await document.getPage(1);
		const content = await page.getTextContent();
		return {
			items: content.items.flatMap((item) =>
				"str" in item ? [{ text: item.str, x: item.transform[4], y: item.transform[5] }] : [],
			),
		};
	} finally {
		await loading.destroy();
	}
};

describe("imported rich-text tables", () => {
	it("ditgar preserves bare cell text and row/column positions", async () => {
		const { items } = await readPdf(fixture(table()), "ditgar");
		const cell = (text: string) => {
			const cell = items.find((item) => item.text === text);
			if (!cell) throw new Error(`Missing table cell ${text}`);
			return cell;
		};
		const alpha = cell("Alpha");
		const beta = cell("Beta");
		const gamma = cell("Gamma");
		const delta = cell("Delta");
		const epsilon = cell("Epsilon");
		const zeta = cell("Zeta");
		expect(alpha.y).toBe(beta.y);
		expect(alpha.y).toBe(gamma.y);
		expect(delta.y).toBe(epsilon.y);
		expect(delta.y).toBe(zeta.y);
		expect(alpha.y).toBeGreaterThan(delta.y);
		expect(alpha.x).toBe(delta.x);
		expect(beta.x).toBe(epsilon.x);
		expect(gamma.x).toBe(zeta.x);
		expect(beta.x).toBeGreaterThan(alpha.x);
		expect(gamma.x).toBeGreaterThan(beta.x);
	});

	it("preserves table cells containing recognized paragraphs", async () => {
		const { items } = await readPdf(fixture(table(true)), "ditgar");
		expect(items.map((item) => item.text)).toEqual(expect.arrayContaining(["Alpha", "Beta", "Gamma", "Delta"]));
	});

	it("preserves raw text inside an unrecognized block wrapper", async () => {
		const { items } = await readPdf(fixture("<div>Wrapper content</div>"), "ditgar");
		expect(items.map((item) => item.text)).toContain("Wrapper content");
	});
});
