import type { PageMap } from "./page-map";
import type { ElementInfo, LayoutInfo } from "@formepdf/core";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vite-plus/test";
import * as forme from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act } from "react";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { renderResume } from "./forme/render";
import { extractPageMap, measureOverflow, parseResumeNodeKey } from "./page-map";

// The sample's picture points at a web path that doesn't exist in Node; hide it so renders stay quiet.
const data: ResumeData = { ...sampleResumeData, picture: { ...sampleResumeData.picture, hidden: true } };

const renderPageMap = async (template: Template): Promise<PageMap> =>
	(await renderResume(forme, { data, template })).pageMap;

describe("authored page overflow", () => {
	it.each(["onyx", "rhyhorn", "lapras", "porygon"] as const)(
		"maps the sample's early spill pages in %s",
		async (template) => {
			const rendered = await act(() => renderResume(forme, { data, template }));
			const pageMap = rendered.pageMap;
			const overflow = measureOverflow(data, { pageMap, pageCount: pageMap.pages.length });
			expect(pageMap.pages).toHaveLength(5);
			expect(overflow?.spills.map(({ authoredPage, pages }) => ({ authoredPage, pages }))).toEqual([
				{ authoredPage: 1, pages: [2] },
				{ authoredPage: 2, pages: [4] },
			]);
			expect(overflow?.spills[0]?.lines).toBeGreaterThan(0);
			const loading = getDocument({ data: rendered.pdf.slice(), useSystemFonts: true });
			try {
				const pdf = await loading.promise;
				const lineHeight = data.metadata.typography.body.fontSize * data.metadata.typography.body.lineHeight;
				for (const spill of overflow?.spills ?? []) {
					let height = 0;
					for (const number of spill.pages) {
						const page = await pdf.getPage(number);
						const baselines = (await page.getTextContent()).items.flatMap((item) =>
							"str" in item && item.str.trim() ? [item.transform[5] as number] : [],
						);
						height += Math.max(...baselines) - Math.min(...baselines) + lineHeight;
					}
					// PDF text baselines independently bound the visible content; the chip is approximate to one line.
					expect(Math.abs((spill.lines ?? 0) - Math.round(height / lineHeight))).toBeLessThanOrEqual(1);
				}
			} finally {
				await loading.destroy();
			}
		},
	);

	it("counts each spill's extent once, excludes the next authored page, and tolerates a missing map", () => {
		const boxes: [number, number, number, number][] = [
			[0, 1, 20, 600],
			[1, 1, 20, 150],
			[1, 1, 30, 100],
			[2, 2, 20, 600],
			[3, 2, 20, 195],
			[4, 3, 20, 500],
		];
		const pageMap: PageMap = {
			pages: Array.from({ length: 5 }, () => ({ width: 600, height: 800 })),
			nodes: boxes.map(([page, authoredPage, y, height]) => ({
				kind: "section" as const,
				sectionId: "experience",
				key: `page-${authoredPage}/region-main/section-experience`,
				page,
				x: 20,
				y,
				width: 500,
				height,
			})),
		};
		expect(measureOverflow(data, { pageMap, pageCount: 5 })).toEqual({
			authored: 3,
			pageCount: 5,
			spills: [
				{ authoredPage: 1, pages: [2], lines: 10 },
				{ authoredPage: 2, pages: [4], lines: 13 },
			],
		});
		expect(measureOverflow(data, { pageMap, pageCount: 3 })).toBeNull();
		expect(measureOverflow(data, { pageMap: undefined, pageCount: 5 })).toEqual({
			authored: 3,
			pageCount: 5,
			spills: [],
		});
	});
});

describe("parseResumeNodeKey", () => {
	it("reads headers, sections and items, and ignores deeper nodes", () => {
		expect(parseResumeNodeKey("page-1/region-header/header")).toEqual({ kind: "header" });
		expect(parseResumeNodeKey("page-1/region-main/section-experience")).toEqual({
			kind: "section",
			sectionId: "experience",
		});
		expect(parseResumeNodeKey("page-2/region-main/section-experience/section-items/item-a%2Fb")).toEqual({
			kind: "item",
			sectionId: "experience",
			itemId: "a/b",
		});
		expect(parseResumeNodeKey("page-1/region-main/section-sidebar%3Askills/section-items/item-s")).toEqual({
			kind: "item",
			sectionId: "skills",
			itemId: "s",
		});
		expect(parseResumeNodeKey("page-1/region-main/section-experience/section-heading")).toBeUndefined();
		expect(
			parseResumeNodeKey("page-1/region-main/section-experience/section-items/item-a/item-header"),
		).toBeUndefined();
		expect(parseResumeNodeKey("page-1/region-main")).toBeUndefined();
	});
});

describe("extractPageMap", () => {
	const box = (x: number, y: number, width: number, height: number, file?: string, children: ElementInfo[] = []) =>
		({
			x,
			y,
			width,
			height,
			kind: "View",
			children,
			...(file ? { sourceLocation: { file, line: 1, column: 1 } } : {}),
		}) as unknown as ElementInfo;

	it("maps tagged boxes on every page they reach, and ignores untagged ones", () => {
		const layout = {
			pages: [
				{
					width: 600,
					height: 800,
					elements: [
						box(20, 30, 500, 770, "rr-node:page-1/region-main/section-skills", [
							box(20, 70, 100, 20, "rr-node:page-1/region-main/section-skills/section-items/item-x"),
							box(20, 95, 100, 20),
						]),
					],
				},
				{ width: 600, height: 800, elements: [box(20, 20, 500, 40, "rr-node:page-1/region-main/section-skills")] },
			],
		} as unknown as LayoutInfo;

		expect(extractPageMap(layout)).toEqual({
			pages: [
				{ width: 600, height: 800 },
				{ width: 600, height: 800 },
			],
			nodes: [
				{
					kind: "section",
					sectionId: "skills",
					key: "page-1/region-main/section-skills",
					page: 0,
					x: 20,
					y: 30,
					width: 500,
					height: 770,
				},
				{
					kind: "item",
					sectionId: "skills",
					itemId: "x",
					key: "page-1/region-main/section-skills/section-items/item-x",
					page: 0,
					x: 20,
					y: 70,
					width: 100,
					height: 20,
				},
				{
					kind: "section",
					sectionId: "skills",
					key: "page-1/region-main/section-skills",
					page: 1,
					x: 20,
					y: 20,
					width: 500,
					height: 40,
				},
			],
		});
	});
});

describe("rendered page maps", () => {
	const visibleExperienceIds = data.sections.experience.items.filter((item) => !item.hidden).map((item) => item.id);

	it("azurill maps the header and every experience entry onto the page", async () => {
		const { pages, nodes } = await renderPageMap("azurill");

		expect(pages.length).toBeGreaterThan(0);
		expect(nodes.some((node) => node.kind === "header" && node.page === 0)).toBe(true);

		const mappedItems = new Set(
			nodes.flatMap((node) => (node.kind === "item" && node.sectionId === "experience" ? [node.itemId] : [])),
		);
		for (const id of visibleExperienceIds) expect(mappedItems, `experience item ${id}`).toContain(id);

		for (const node of nodes) {
			const page = pages[node.page];
			expect(page, `${node.key} page`).toBeDefined();
			if (!page) continue;
			expect(node.x, `${node.key} x`).toBeGreaterThanOrEqual(-0.5);
			expect(node.y, `${node.key} y`).toBeGreaterThanOrEqual(-0.5);
			expect(node.x + node.width, `${node.key} right`).toBeLessThanOrEqual(page.width + 0.5);
			expect(node.y + node.height, `${node.key} bottom`).toBeLessThanOrEqual(page.height + 0.5);
		}
	});
});
