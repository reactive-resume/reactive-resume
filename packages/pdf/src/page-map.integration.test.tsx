import type { PageMap } from "./page-map";
import type { SectionTitleResolver } from "./section-title";
import type { ElementInfo, LayoutInfo } from "@formepdf/core";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vitest";
import * as forme from "@formepdf/core";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { renderResume } from "./forme/render";
import { extractPageMap, parseResumeNodeKey } from "./page-map";

const resolveSectionTitle: SectionTitleResolver = (input) => input.defaultEnglishTitle ?? input.sectionId;

// The sample's picture points at a web path that doesn't exist in Node; hide it so renders stay quiet.
const data: ResumeData = { ...sampleResumeData, picture: { ...sampleResumeData.picture, hidden: true } };

const renderPageMap = async (template: Template): Promise<PageMap> =>
	(await renderResume(forme, { data, template, resolveSectionTitle })).pageMap;

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
