import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../document";
import { rasterizePdf } from "./test/rasterize-pdf";

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

const fixture = (html: string, mode: "legacy" | "semantic", css = ""): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Table probe";
	data.picture.hidden = true;
	// Keep the featured summary heading off: these assertions measure table geometry/borders only.
	data.summary.showHeading = false;
	data.summary.content = html;
	data.metadata.layout.pages = [{ fullWidth: true, main: ["summary"], sidebar: [] }];
	data.metadata.typography.body.fontFamily = "Helvetica";
	data.metadata.typography.heading.fontFamily = "Helvetica";
	data.metadata.stylesheet = { mode, source: { languageVersion: 1, text: `@version 1; ${css}` } };
	return data;
};

const readPdf = async (data: ResumeData, template: Template) => {
	const bytes = new Uint8Array(await act(() => renderToBuffer(<ResumeDocument data={data} template={template} />)));
	const loading = getDocument({ data: bytes.slice() });
	try {
		const document = await loading.promise;
		const page = await document.getPage(1);
		const content = await page.getTextContent();
		const operators = await page.getOperatorList();
		return {
			bytes,
			operators,
			items: content.items.flatMap((item) =>
				"str" in item ? [{ text: item.str, x: item.transform[4], y: item.transform[5] }] : [],
			),
		};
	} finally {
		await loading.destroy();
	}
};

const inspectTableBorders = async ({ bytes, operators }: Awaited<ReturnType<typeof readPdf>>) => {
	let stroke = "";
	let horizontal = 0;
	let vertical = 0;
	let anyHorizontal = 0;
	let anyVertical = 0;
	for (const [index, fn] of operators.fnArray.entries()) {
		if (fn === OPS.setStrokeRGBColor) stroke = operators.argsArray[index][0];
		if (fn !== OPS.constructPath) continue;
		const bounds = operators.argsArray[index][2] as ArrayLike<number>;
		const width = Math.abs((bounds[2] ?? 0) - (bounds[0] ?? 0));
		const height = Math.abs((bounds[3] ?? 0) - (bounds[1] ?? 0));
		if (height > 0 && height <= 1.01 && width > height) {
			anyHorizontal++;
			if (stroke === "#cc00cc") horizontal++;
		}
		if (width > 0 && width <= 1.01 && height > width) {
			anyVertical++;
			if (stroke === "#cc00cc") vertical++;
		}
	}

	const [page] = await rasterizePdf(bytes);
	if (!page) throw new Error("Missing rendered page");
	let pixels = 0;
	for (let index = 0; index < page.data.length; index += 4) {
		if ((page.data[index] ?? 0) > 180 && (page.data[index + 1] ?? 255) < 80 && (page.data[index + 2] ?? 0) > 180)
			pixels++;
	}
	return {
		colored: { horizontal, vertical, pixels },
		geometry: { horizontal: anyHorizontal, vertical: anyVertical },
	};
};

const tableCoordinates = (items: Awaited<ReturnType<typeof readPdf>>["items"]) =>
	Object.fromEntries(
		items
			.filter(({ text }) => ["Alpha", "Beta", "Beta!", "Gamma", "Delta", "Epsilon", "Zeta"].includes(text))
			.map(({ text, x, y }) => [text, [Number(x.toFixed(3)), Number(y.toFixed(3))]]),
	);

describe("imported rich-text tables", () => {
	for (const template of ["ditgar", "onyx"] as const) {
		for (const mode of ["legacy", "semantic"] as const) {
			it(`${template} ${mode} preserves bare cell text and row/column positions`, async () => {
				const { items } = await readPdf(fixture(table(), mode), template);
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
		}
	}

	it("preserves table cells containing recognized paragraphs", async () => {
		const { items } = await readPdf(fixture(table(true), "semantic"), "ditgar");
		expect(items.map((item) => item.text)).toEqual(expect.arrayContaining(["Alpha", "Beta", "Gamma", "Delta"]));
	});

	it("preserves raw text inside an unrecognized block wrapper", async () => {
		const { items } = await readPdf(fixture("<div>Wrapper content</div>", "semantic"), "ditgar");
		expect(items.map((item) => item.text)).toContain("Wrapper content");
	});

	it("still honors explicit semantic rich-text hiding", async () => {
		const { items } = await readPdf(fixture(table(), "semantic", "rich-text { display: none; }"), "ditgar");
		expect(items.map((item) => item.text)).toContain("Table probe");
		expect(items.map((item) => item.text)).not.toContain("Alpha");
	});

	it.each(["legacy", "semantic"] as const)(
		"keeps six cell coordinates, border operators, and fixed-DPI pixels through %s persistence",
		async (mode) => {
			const bordered = table().replaceAll("black", "#cc00cc");
			const unrelated = fixture(bordered, mode);
			unrelated.basics.name = "Border Probe unrelated edit";
			const stages = [
				{ name: "original", data: fixture(bordered, mode), expectedBeta: "Beta" },
				{ name: "unrelated edit", data: unrelated, expectedBeta: "Beta" },
				{ name: "table edit", data: fixture(bordered.replace("Beta", "Beta!"), mode), expectedBeta: "Beta!" },
			];
			for (const stage of stages) {
				const pdf = await readPdf(stage.data, "ditgar");
				expect(tableCoordinates(pdf.items), stage.name).toEqual({
					Alpha: [227.348, 808.69],
					[stage.expectedBeta]: [327.348, 808.69],
					Gamma: [427.348, 808.69],
					Delta: [227.348, 778.89],
					Epsilon: [327.348, 778.89],
					Zeta: [427.348, 778.89],
				});
				expect((await inspectTableBorders(pdf)).colored, stage.name).toEqual({
					horizontal: 17,
					vertical: 12,
					pixels: 1851,
				});
			}
		},
		30_000,
	);

	it.each(["legacy", "semantic"] as const)("keeps borderless tables borderless in %s mode", async (mode) => {
		const borderless = table().replaceAll("border: 1pt solid black; ", "");
		const pdf = await readPdf(fixture(borderless, mode), "ditgar");
		expect((await inspectTableBorders(pdf)).geometry).toEqual({ horizontal: 0, vertical: 0 });
	});
});
