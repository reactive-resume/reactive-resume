import type { ElementInfo } from "@formepdf/core";
import assert from "node:assert/strict";
import { expect, it } from "vite-plus/test";
import * as forme from "@formepdf/core";
import { parse } from "node-html-parser";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act } from "react";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { templateSchema } from "@reactive-resume/schema/templates";
import longResume from "./fixtures/long.json";
import { renderResume } from "./render";
import { FIXED_SOURCE, LIST_ROLE } from "./to-forme";

const cases = [
	...templateSchema.options.map((template) => ({ template, roles: 16, lines: 0 })),
	...(["porygon", "azurill"] as const).flatMap((template) => [48, 96].map((roles) => ({ template, roles, lines: 0 }))),
	...(["porygon", "azurill"] as const).flatMap((template) =>
		[24, 48].map((bullets) => ({ template, roles: bullets / 6, lines: 25 })),
	),
];

it.each(cases)(
	"paginates $roles audit roles in $template ($lines explicit lines per bullet)",
	async ({ template, roles, lines }) => {
		// Exact synthetic audit input that reproduced RX-87 in nine templates; keep its fonts, headers and sidebar.
		const data = parseResumeData(structuredClone(longResume));
		data.metadata.template = template;
		const original = data.sections.experience.items;
		data.sections.experience.items = Array.from({ length: roles }, (_, index) => {
			const item = original[lines ? 0 : index % original.length];
			assert(item);
			return {
				...item,
				id: `role-${index}`,
				company: lines ? `Fictional Studio ${index}` : `Synthetic Studio ${index + 1}`,
				description: lines
					? `<ul>${Array.from(
							{ length: 6 },
							(_, bullet) =>
								`<li><p>${Array.from({ length: lines }, (_, line) => `CASE_${index}_${bullet}_${line} fictional outcome`).join("<br>")}</p></li>`,
						).join("")}</ul>`
					: item.description.replace(/Project \d+\./g, `Project ${index + 1}.`),
			};
		});
		const bullets = data.sections.experience.items.flatMap((item) =>
			parse(item.description)
				.querySelectorAll("li")
				.map((li) => li.textContent),
		);
		let calls = 0;
		const result = await act(() =>
			renderResume(
				{
					renderSerializedDocWithLayout(document) {
						calls++;
						return forme.renderSerializedDocWithLayout(document);
					},
				},
				{ data },
			),
		);
		// A4 paragraph-sized rows must settle together too; this is not a tiny-page oversized-row exception.
		if (lines) expect(calls).toBeLessThanOrEqual(3);
		else if (roles > 16) expect(calls).toBeLessThanOrEqual(2);
		expect(result.missingFonts).toEqual([]);
		expect(result.warnings).toEqual([]);
		const markers = new Map<number, { page: number; x: number; y: number; width: number; height: number }>();
		const content = new Map<number, { page: number; x: number; y: number; width: number; height: number }>();
		result.layout.pages.forEach((page, pageIndex) => {
			let contentBottom = page.contentY;
			let bulletLines = 0;
			const visit = (element: ElementInfo, parentSource?: ElementInfo["sourceLocation"], fixed = false) => {
				const source = element.sourceLocation ?? parentSource;
				const repeated = fixed || source?.file === FIXED_SOURCE;
				if (element.kind === "Text") {
					expect(element.x).toBeGreaterThanOrEqual(page.contentX - 0.1);
					expect(element.x + element.width).toBeLessThanOrEqual(page.contentX + page.contentWidth + 0.1);
					expect(element.y).toBeGreaterThanOrEqual(page.contentY - 0.1);
					expect(element.y + element.height).toBeLessThanOrEqual(page.contentY + page.contentHeight + 0.1);
					const positions =
						source?.column === LIST_ROLE.marker ? markers : source?.column === LIST_ROLE.content ? content : null;
					if (source && positions && !positions.has(source.line))
						positions.set(source.line, {
							page: pageIndex,
							x: element.x,
							y: element.y,
							width: element.width,
							height: element.height,
						});
					if (!repeated) contentBottom = Math.max(contentBottom, element.y + element.height);
					if (source?.column === LIST_ROLE.content) {
						bulletLines++;
					}
				}
				for (const child of element.children) visit(child, source, repeated);
			};
			for (const element of page.elements) visit(element);
			// Ignore page furniture; repeated headings alone cannot fill the body. A natural partial last page is allowed.
			if (pageIndex < result.layout.pages.length - 1) {
				expect(bulletLines, `page ${pageIndex + 1}/${result.layout.pages.length}`).toBeGreaterThanOrEqual(6);
				// The review's paragraph fixture has a 74%-filled second page on base; keep the original audit at 75%.
				expect(
					contentBottom,
					`page ${pageIndex + 1}/${result.layout.pages.length}; ${bulletLines} bullet lines`,
				).toBeGreaterThan(page.contentY + page.contentHeight * (lines ? 0.7 : 0.75));
			}
		});
		expect(markers.size).toBe(bullets.length);
		expect(content.size).toBe(bullets.length);
		for (const [key, marker] of markers) {
			const first = content.get(key);
			assert(first);
			expect(marker.page).toBe(first.page);
			expect(marker.y).toBeCloseTo(first.y, 1);
			expect(marker.height).toBeCloseTo(first.height, 1);
			expect(marker.x + marker.width).toBeLessThanOrEqual(first.x + 0.1);
		}
		const loading = getDocument({ data: result.pdf.slice(), useSystemFonts: true });
		try {
			const pdf = await loading.promise;
			expect(pdf.numPages).toBeGreaterThan(1);
			const pages: string[][] = [];
			for (let index = 1; index <= pdf.numPages; index++) {
				const page = await pdf.getPage(index);
				pages.push(
					(await page.getTextContent()).items.flatMap((item) => ("str" in item && item.str.trim() ? [item.str] : [])),
				);
			}
			// Lapras repeats its section heading inside split content in the PDF text stream.
			const text = pages
				.flat()
				.filter((line) => line !== "Experience")
				.join("")
				.replace(/\s/g, "");
			for (const bullet of bullets) expect(text.split(bullet.replace(/\s/g, "")), bullet).toHaveLength(2);
			if (lines) {
				expect([...text.matchAll(/CASE_\d+_\d+_\d+/g)].map(([token]) => token)).toEqual(
					bullets.flatMap((bullet) => [...bullet.matchAll(/CASE_\d+_\d+_\d+/g)].map(([token]) => token)),
				);
			} else {
				expect([...text.matchAll(/Project\d+\.\d+:/g)].map(([token]) => token)).toEqual(
					bullets.map((bullet) => bullet.slice(0, bullet.indexOf(":") + 1).replace(/\s/g, "")),
				);
			}
		} finally {
			await loading.destroy();
		}
	},
);
