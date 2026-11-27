import type { ElementInfo } from "@formepdf/core";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vite-plus/test";
import * as forme from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../../document";
import { renderResume } from "../../forme/render";
import { renderToBuffer } from "../../forme/testing";
import { extractPageMap } from "../../page-map";

type SkillFixture = {
	id: string;
	name: string;
	proficiency?: string;
	level?: number;
	keywords?: string[];
};

/**
 * Issue #4010: with the skills "One line per skill" option (`layout: "inline"`), rows misaligned —
 * the name shrank when the fields after it overflowed the row, wrapping a multi-word name onto two
 * lines and leaving a dead gap before the remaining fields, while single-line rows centered the name
 * against the smaller keywords instead of sharing its baseline. The row must keep the name on one
 * line and put the first detail line on the name's baseline.
 */

const skill = ({ id, name, proficiency = "", level = 0, keywords = [] }: SkillFixture) => ({
	id,
	hidden: false,
	icon: "",
	iconColor: "",
	name,
	proficiency,
	level,
	keywords,
});

const TEXT_DETAIL_ITEMS: SkillFixture[] = [
	{ id: "s0", name: "Frontend", keywords: ["HTML", "CSS", "JavaScript", "Responsive Design", "React", "Linux/Ubuntu"] },
	{ id: "s1", name: "Databases", keywords: ["PostgreSQL", "MySQL", "relational database design"] },
	{
		id: "s2",
		name: "Cloud & DevOps",
		keywords: [
			"Oracle Cloud VPS",
			"Docker",
			"Nginx",
			"linux",
			"CI/CD",
			"Oracle Cloud Infrastructure (OCI)",
			"Docker Compose",
			"Git Branching",
			"Pull Requests",
			"Code Reviews",
		],
	},
	{ id: "s3", name: "Networking", keywords: ["TCP/IP fundamentals", "reverse proxy", "VPN (WireGuard)"] },
	{
		id: "s4",
		name: "Backend",
		keywords: [
			"Python (basic)",
			"REST APIs",
			"Server-side logic",
			"laravel",
			"REST API development",
			"PostgreSQL integration",
			"Open Banking API",
			"Database design",
			"server-side development",
		],
	},
	{ id: "s5", name: "Tools & Version Control", keywords: ["Git", "GitHub"] },
	{ id: "s6", name: "Software Engineering", keywords: ["SDLC", "Agile", "UML", "Requirements Analysis"] },
	{ id: "s7", name: "Proficient", proficiency: "Experienced" },
	{ id: "s8", name: "Proficient Keywords", proficiency: "Intermediate", keywords: ["Alpha", "Beta", "Gamma"] },
	{ id: "s9", name: "Rated Keywords", level: 3, keywords: ["Delta", "Epsilon", "Zeta"] },
];

const LEVEL_ONLY_ITEM: SkillFixture = { id: "s10", name: "LevelOnly", level: 4 };
const NAME_ONLY_ITEM: SkillFixture = { id: "s11", name: "NameOnly" };

const fixture = (items: SkillFixture[], placement: "main" | "sidebar" = "main"): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.metadata.typography.body.fontFamily = "Helvetica";
	data.metadata.typography.heading.fontFamily = "Helvetica";
	data.metadata.page.hideIcons = true;
	data.metadata.design.colors.primary = "rgba(255, 0, 0, 1)";
	data.metadata.design.level = { type: "circle", icon: "star" };
	data.metadata.layout.pages = [
		{
			fullWidth: placement === "main",
			main: placement === "main" ? ["skills"] : [],
			sidebar: placement === "sidebar" ? ["skills"] : [],
		},
	];
	data.sections.skills = {
		...data.sections.skills,
		title: "Skills",
		columns: 1,
		layout: "inline",
		keywordLayout: "inline",
		items: items.map(skill),
	};
	return data;
};

type TextItem = { str: string; x: number; y: number; w: number };

const extractTextItems = async (bytes: Uint8Array): Promise<TextItem[][]> => {
	const loading = getDocument({ data: bytes.slice(), useSystemFonts: true });
	try {
		const pdf = await loading.promise;
		const pages: TextItem[][] = [];
		for (let index = 1; index <= pdf.numPages; index++) {
			const page = await pdf.getPage(index);
			const items = (await page.getTextContent()).items.flatMap((item) =>
				"str" in item && item.str.trim() !== ""
					? [{ str: item.str, x: item.transform[4], y: item.transform[5], w: item.width }]
					: [],
			);
			pages.push(items);
		}
		return pages;
	} finally {
		await loading.destroy();
	}
};

const renderPages = async (data: ResumeData, template: Template) => {
	const bytes = new Uint8Array(await act(() => renderToBuffer(<ResumeDocument data={data} template={template} />)));
	return extractTextItems(bytes);
};

const required = <T,>(value: T | undefined, label: string): T => {
	if (value === undefined) throw new Error(`Missing ${label}`);
	return value;
};

/** The name item and the first detail item sharing its baseline (smallest x right of the name). */
const rowPair = (items: TextItem[], name: string) => {
	const nameItem = required(
		items.find((item) => item.str === name),
		`name item ${name}`,
	);
	const detail = items
		.filter((item) => item !== nameItem && Math.abs(item.y - nameItem.y) < 1 && item.x > nameItem.x + nameItem.w - 0.5)
		.sort((a, b) => a.x - b.x)[0];
	return { name: nameItem, detail };
};

const flatten = (node: ElementInfo): ElementInfo[] => [node, ...node.children.flatMap(flatten)];

describe("inline skills row alignment (#4010)", () => {
	it.each(["onyx", "gengar"] as const)(
		"keeps every name on one line and shares its baseline with the first detail in %s",
		async (template) => {
			const data = fixture([...TEXT_DETAIL_ITEMS, LEVEL_ONLY_ITEM, NAME_ONLY_ITEM]);
			const pages = await renderPages(data, template);

			for (const item of [...TEXT_DETAIL_ITEMS, LEVEL_ONLY_ITEM, NAME_ONLY_ITEM]) {
				// The name never wraps onto a second line.
				expect(
					pages.flat().filter((text) => text.str === item.name),
					`${item.name} must appear as a single text item`,
				).toHaveLength(1);
			}

			for (const item of TEXT_DETAIL_ITEMS) {
				const { name, detail } = rowPair(pages.flat(), item.name);
				expect(detail, `${item.name} first detail line`).toBeDefined();
				// First detail line sits on the name's baseline, not centered against a smaller box.
				expect(Math.abs((detail?.y ?? 0) - name.y), `${item.name} baseline`).toBeLessThan(0.1);
				if (template === "onyx") {
					// The detail column starts one columnGap after the name ends — no dead gap.
					expect(detail && Math.abs(detail.x - (name.x + name.w + 4)), `${item.name} detail x`).toBeLessThan(1);
				}
			}

			// The trailing name-only and name+level rows keep their names on single lines too.
			expect(pages.flat().some((text) => text.str === "NameOnly")).toBe(true);
		},
	);

	it("centers the rating band on name+level-only rows", async () => {
		const data = fixture([LEVEL_ONLY_ITEM]);
		const { layout } = await act(() => renderResume(forme, { data, template: "onyx" }));
		const elements = layout.pages.flatMap((page) => page.elements.flatMap(flatten));

		const nameLine = required(
			elements.find((element) => element.nodeType === "TextLine" && element.textContent === "LevelOnly"),
			"LevelOnly text line",
		);
		const squares = elements.filter(
			(element) => element.nodeType === "View" && element.children.length === 0 && Math.abs(element.height - 8) < 0.5,
		);
		expect(squares).toHaveLength(5);

		const nameCenter = nameLine.y + nameLine.height / 2;
		for (const square of squares) {
			expect(Math.abs(square.y + square.height / 2 - nameCenter)).toBeLessThan(2);
		}
	});

	it("keeps the level rating after the details on a non-skillLevelAfterName template", async () => {
		const data = fixture([{ id: "s0", name: "Rated", level: 3, keywords: ["Delta", "Epsilon"] }]);
		const { layout } = await act(() => renderResume(forme, { data, template: "onyx" }));
		const elements = layout.pages.flatMap((page) => page.elements.flatMap(flatten));

		const nameLine = required(
			elements.find((element) => element.nodeType === "TextLine" && element.textContent === "Rated"),
			"Rated text line",
		);
		const keywordLine = required(
			elements.find((element) => element.nodeType === "TextLine" && element.textContent?.includes("Delta")),
			"keyword text line",
		);
		const squares = elements.filter(
			(element) => element.nodeType === "View" && element.children.length === 0 && Math.abs(element.height - 8) < 0.5,
		);
		expect(squares).toHaveLength(5);
		// Name, keywords, then rating (#2611 ordering): the rating band starts right of the keyword text.
		expect(keywordLine.x).toBeGreaterThan(nameLine.x + nameLine.width);
		expect(Math.min(...squares.map((square) => square.y))).toBeGreaterThanOrEqual(keywordLine.y);
	});

	it("keeps names and shared baselines intact across an automatic page break", async () => {
		const items = Array.from({ length: 60 }, (_, index) => ({
			id: `skill-${index}`,
			name: `Skill ${index}`,
			proficiency: "",
			level: 0,
			keywords: [`Keyword${index}A`, `Keyword${index}B`],
		}));
		const data = fixture(items);
		const { layout } = await act(() => renderResume(forme, { data, template: "onyx" }));
		expect(layout.pages.length).toBeGreaterThan(1);

		const bytes = new Uint8Array(await act(() => renderToBuffer(<ResumeDocument data={data} template="onyx" />)));
		const pages = await extractTextItems(bytes);
		expect(pages.length).toBeGreaterThan(1);

		// Every skill still renders its name exactly once and, inside its own page, its details keep
		// the name's baseline. A row landing exactly on the break fragments into bare text boxes
		// upstream; that pre-existing engine quirk drops the pairing, so the boundary row only has to
		// keep all of its text.
		for (const [index, item] of items.entries()) {
			expect(pages.flat().filter((text) => text.str === item.name)).toHaveLength(1);
			const page = required(
				pages.find((pageItems) => pageItems.some((text) => text.str === item.name)),
				`page for ${item.name}`,
			);
			const { name, detail } = rowPair(page, item.name);
			if (detail) expect(Math.abs(detail.y - name.y), `${item.name} baseline`).toBeLessThan(0.1);
			else {
				// Fragmented boundary row: only the topmost row on a page may land here, and its
				// keywords still render, just outside a shared baseline.
				const topmost = Math.max(...page.map((text) => text.y));
				expect(topmost - name.y, `${item.name} may only fragment at a page top`).toBeLessThan(3);
				expect(
					pages.flat().filter((text) => text.str === `Keyword${index}A, Keyword${index}B`),
					`${item.name} keywords`,
				).not.toHaveLength(0);
			}
		}

		// Page map click targets track the laid-out item boxes and stay inside every page.
		const map = extractPageMap(layout);
		const pageSizes = map.pages;
		const mappedIds = new Set(
			map.nodes.flatMap((node) => (node.kind === "item" && node.sectionId === "skills" ? [node.itemId] : [])),
		);
		for (const item of items) expect(mappedIds, `page-map item ${item.id}`).toContain(item.id);
		for (const node of map.nodes) {
			const page = pageSizes[node.page];
			expect(page, `${node.key} page`).toBeDefined();
			if (!page) continue;
			expect(node.x, `${node.key} x`).toBeGreaterThanOrEqual(-0.5);
			expect(node.y, `${node.key} y`).toBeGreaterThanOrEqual(-0.5);
			expect(node.x + node.width, `${node.key} right`).toBeLessThanOrEqual(page.width + 0.5);
			expect(node.y + node.height, `${node.key} bottom`).toBeLessThanOrEqual(page.height + 0.5);
		}
	});
});
