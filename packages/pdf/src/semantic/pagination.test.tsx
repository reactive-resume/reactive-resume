import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it, vi } from "vite-plus/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createElement } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../document";
import { pdf, renderToBuffer } from "../forme/testing";
import { rasterizePdf } from "./test/rasterize-pdf";

type HostNode = {
	type: string;
	value?: string;
	props?: Readonly<Record<string, unknown>>;
	children?: HostNode[];
};

const nodeText = (node: HostNode): string =>
	node.value ?? (node.children ?? []).map((child) => nodeText(child)).join("");

const findFirst = (node: HostNode, predicate: (candidate: HostNode) => boolean): HostNode | undefined => {
	if (predicate(node)) return node;
	for (const child of node.children ?? []) {
		const match = findFirst(child, predicate);
		if (match) return match;
	}
};

const renderHostTree = async (data: ResumeData): Promise<HostNode> => {
	const element = createElement(ResumeDocument, { data, template: "onyx" }) as unknown as Parameters<typeof pdf>[0];
	const instance = pdf(element);
	await vi.waitFor(() => expect(instance.container.document).not.toBeNull());
	return instance.container.document as HostNode;
};

const renderPdf = async (data: ResumeData, template: Template): Promise<Uint8Array> => {
	const element = createElement(ResumeDocument, { data, template }) as unknown as Parameters<typeof renderToBuffer>[0];
	return new Uint8Array(await renderToBuffer(element));
};

type PdfTextItem = {
	str: string;
	transform: readonly number[];
};

type ParsedPdfPage = {
	getTextContent: () => Promise<{ items: PdfTextItem[] }>;
};

type ParsedPdf = {
	numPages: number;
	getPage: (pageNumber: number) => Promise<ParsedPdfPage>;
};

const parsePdf = (data: Uint8Array): Promise<ParsedPdf> => getDocument({ data }).promise as Promise<ParsedPdf>;

const azurillAuthoredOverflowFixture = () => {
	const data = structuredClone(defaultResumeData);
	const overflowTokens = Array.from(
		{ length: 180 },
		(_value, index) => `AZURILL_OVERFLOW_${String(index + 1).padStart(3, "0")}`,
	);
	data.picture.hidden = true;
	data.basics.name = "AZURILL HEADER";
	data.summary.title = "Long summary";
	data.summary.content = overflowTokens.map((token) => `<p>${token} generated PDF page content.</p>`).join("");
	data.sections.profiles.title = "Sidebar";
	data.sections.profiles.items = [
		{
			id: "sidebar-profile",
			hidden: false,
			icon: "github-logo",
			iconColor: "",
			network: "SIDEBAR TOKEN",
			username: "authored-page-one",
			website: { url: "", label: "", inlineLink: false },
		},
	];
	data.sections.experience.title = "Experience";
	data.sections.experience.items = [
		{
			id: "manual-continuation",
			hidden: false,
			company: "MANUAL FULL WIDTH TOKEN",
			position: "Independent authored page",
			location: "",
			period: "",
			website: { url: "", label: "", inlineLink: false },
			description: "<p>Second authored page content.</p>",
			roles: [],
		},
	];
	data.metadata.template = "azurill";
	data.metadata.typography.body.fontFamily = "Helvetica";
	data.metadata.typography.heading.fontFamily = "Helvetica";
	data.metadata.layout.pages = [
		{ fullWidth: false, main: ["summary"], sidebar: ["profiles"] },
		{ fullWidth: true, main: ["experience"], sidebar: [] },
	];

	return { data, overflowTokens };
};

const readPhysicalPages = async (document: ParsedPdf) => {
	const pages = [];
	for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
		const page = await document.getPage(pageNumber);
		const content = await page.getTextContent();
		pages.push({
			items: content.items,
			text: content.items.map(({ str }) => str).join(" "),
		});
	}
	return pages;
};

describe("semantic pagination bindings", () => {
	it("passes resolved authored-page size and a fixed header to the existing primitives", async () => {
		const data = structuredClone(defaultResumeData);
		const source = {
			languageVersion: 1,
			text: '@version 1;\npage[page-number="1"] { size: LETTER; }\nheader { -resume-fixed: true; }',
		};
		data.picture.hidden = true;
		data.basics.name = "Ada Lovelace";
		data.metadata.layout.pages = [{ fullWidth: true, main: [], sidebar: [] }];
		data.metadata.stylesheet = { mode: "semantic", source };

		const document = await renderHostTree(data);
		const page = findFirst(document, (node) => node.type === "PAGE");
		const fixed = findFirst(document, (node) => node.props?.fixed === true);

		expect(page?.props?.size).toBe("LETTER");
		expect(fixed?.type).toBe("VIEW");
		expect(fixed && nodeText(fixed)).toContain("Ada Lovelace");
	});

	it("paints only the selected Azurill page and its overflow (#3610)", async () => {
		const data = structuredClone(defaultResumeData);
		data.picture.hidden = true;
		data.basics.name = "Ada Lovelace";
		data.summary.content = Array.from({ length: 100 }, (_, index) => `<p>Second page paragraph ${index + 1}.</p>`).join(
			"",
		);
		data.metadata.typography.body.fontFamily = "Helvetica";
		data.metadata.typography.heading.fontFamily = "Helvetica";
		data.metadata.design.colors.background = "#ffffff";
		data.metadata.design.colors.primary = "#123456";
		data.metadata.layout.pages = [
			{ fullWidth: true, main: [], sidebar: [] },
			{ fullWidth: true, main: ["summary"], sidebar: [] },
		];
		data.metadata.stylesheet = {
			mode: "semantic",
			source: {
				languageVersion: 1,
				text: 'page[page-number="2"] { background-color: var(--resume-primary-color); }',
			},
		};

		const pages = await rasterizePdf(await renderPdf(data, "azurill"));
		expect(pages.length).toBeGreaterThan(2);
		for (const [index, page] of pages.entries()) {
			const expected = index === 0 ? [255, 255, 255, 255] : [18, 52, 86, 255];
			const points = [
				[2, 2],
				[page.width - 3, page.height - 3],
				[page.width / 2, page.height / 2],
			] as const;
			for (const [x, y] of points) {
				const offset = (Math.floor(y) * page.width + Math.floor(x)) * 4;
				expect(Array.from(page.data.subarray(offset, offset + 4))).toEqual(expected);
			}
		}
	});

	it("keeps Azurill overflow lossless while preserving a manual full-width authored continuation", async () => {
		const { data, overflowTokens } = azurillAuthoredOverflowFixture();
		const authoredPagesBeforeRender = structuredClone(data.metadata.layout.pages);
		const document = await parsePdf(await renderPdf(data, "azurill"));
		const pages = await readPhysicalPages(document);
		const renderedText = pages.map(({ text }) => text).join(" ");
		const overflowPageIndexes = overflowTokens.map((token) => pages.findIndex(({ text }) => text.includes(token)));
		const manualPageIndex = pages.findIndex(({ text }) => text.includes("MANUAL FULL WIDTH TOKEN"));
		const firstOverflowToken = overflowTokens[0];
		if (!firstOverflowToken) throw new Error("Expected an overflow fixture token.");
		const firstOverflowItem = pages.flatMap(({ items }) => items).find(({ str }) => str.includes(firstOverflowToken));
		const manualContinuationItem = pages[manualPageIndex]?.items.find(({ str }) => str === "MANUAL FULL WIDTH TOKEN");

		expect(document.numPages).toBeGreaterThan(authoredPagesBeforeRender.length);
		for (const token of overflowTokens) {
			expect(renderedText.split(token)).toHaveLength(2);
		}
		expect(renderedText).toContain("SIDEBAR TOKEN");
		expect(renderedText).toContain("MANUAL FULL WIDTH TOKEN");
		expect(overflowPageIndexes).not.toContain(-1);
		expect(manualPageIndex).toBeGreaterThan(Math.max(...overflowPageIndexes));
		expect(manualContinuationItem?.transform[4]).toBeLessThan(
			firstOverflowItem?.transform[4] ?? Number.NEGATIVE_INFINITY,
		);
		expect(data.metadata.layout.pages).toEqual(authoredPagesBeforeRender);
		expect(data.metadata.layout.pages[1]).toEqual({
			fullWidth: true,
			main: ["experience"],
			sidebar: [],
		});
	});
});
