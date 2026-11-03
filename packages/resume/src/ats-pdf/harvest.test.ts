import type { PdfDocumentLike, PdfPageLike } from "./harvest";
import { describe, expect, it, vi } from "vite-plus/test";
import { harvestPdfDocument } from "./harvest";
import { PDF_OPS } from "./pdf-ops";

const FILE = { name: "resume.pdf", sizeBytes: 120_000, magicBytesOk: true };

type PageOptions = {
	items?: unknown[];
	operatorList?: unknown;
	operatorDelayMs?: number;
	fontObject?: unknown;
	rotate?: number;
};

function makePage(pageNumber: number, options: PageOptions = {}): PdfPageLike {
	return {
		pageNumber,
		rotate: options.rotate ?? 0,
		view: [0, 0, 595.28, 841.89],
		commonObjs: {
			has: () => options.fontObject !== undefined,
			get: () => options.fontObject,
		},
		getTextContent: vi.fn(async () => ({
			items: options.items ?? [
				{
					str: "Ada Lovelace",
					transform: [10, 0, 0, 10, 56, 780],
					width: 60,
					height: 10,
					fontName: "g_d0_f1",
					hasEOL: true,
				},
			],
		})),
		getAnnotations: vi.fn(async () => []),
		getOperatorList: vi.fn(async () => {
			if (options.operatorDelayMs) await new Promise((resolve) => setTimeout(resolve, options.operatorDelayMs));
			return options.operatorList ?? { fnArray: [], argsArray: [] };
		}),
		cleanup: vi.fn(),
	};
}

function makeDocument(pages: PdfPageLike[]): PdfDocumentLike {
	return {
		numPages: pages.length,
		getPage: async (pageNumber) => pages[pageNumber - 1] as PdfPageLike,
		getMetadata: async () => ({ info: { Producer: "Test", Language: "en-GB" } }),
		getMarkInfo: async () => ({ Marked: true }),
	};
}

describe("harvestPdfDocument", () => {
	it("harvests text, metadata and fonts into plain JSON", async () => {
		const raw = await harvestPdfDocument(
			makeDocument([makePage(1, { fontObject: { name: "AAAAAA+Inter", isType3Font: false } })]),
			{ file: FILE },
		);

		expect(raw.pages).toHaveLength(1);
		expect(raw.pages[0]?.items[0]?.str).toBe("Ada Lovelace");
		expect(raw.pages[0]?.width).toBeCloseTo(595.28, 2);
		expect(raw.metadata.language).toBe("en-GB");
		expect(raw.metadata.isTagged).toBe(true);
		expect(raw.fonts[0]?.name).toBe("AAAAAA+Inter");
		expect(JSON.parse(JSON.stringify(raw))).toEqual(raw);
	});

	it("stops at the page ceiling and says so", async () => {
		const pages = Array.from({ length: 5 }, (_, index) => makePage(index + 1));
		const raw = await harvestPdfDocument(makeDocument(pages), { file: FILE, maxPages: 2 });

		expect(raw.pages).toHaveLength(2);
		expect(raw.pageCount).toBe(5);
		expect(raw.truncated).toBe(true);
	});

	it("distinguishes a failed text read from a readable blank page and preserves other pages", async () => {
		const failed = makePage(2);
		failed.getTextContent = vi.fn(async () => {
			throw new Error("Fictional page text failure");
		});
		const blank = makePage(3, { items: [] });
		const raw = await harvestPdfDocument(makeDocument([makePage(1), failed, blank]), { file: FILE });
		expect(raw.textReadFailed).toBe(true);
		expect(raw.truncated).toBe(false);
		expect(raw.pages.map((page) => page.items.length)).toEqual([1, 0, 0]);
		const readable = await harvestPdfDocument(makeDocument([makePage(1), blank]), { file: FILE });
		expect(readable.textReadFailed).toBe(false);
	});

	it("leaves operators null when the page blows its budget", async () => {
		const page = makePage(1, { operatorDelayMs: 50 });
		const raw = await harvestPdfDocument(makeDocument([page]), {
			file: FILE,
			operatorBudgetPerPageMs: 5,
		});

		expect(raw.pages[0]?.operators).toBeNull();
		expect(raw.operatorsAvailable).toBe(false);
	});

	it("summarises the operator list when it arrives in time", async () => {
		const page = makePage(1, {
			operatorList: {
				fnArray: [PDF_OPS.setTextRenderingMode, PDF_OPS.showText],
				argsArray: [[3], [[]]],
			},
		});

		const raw = await harvestPdfDocument(makeDocument([page]), { file: FILE });

		expect(raw.pages[0]?.operators?.invisibleTextItems).toBe(1);
		expect(raw.operatorsAvailable).toBe(true);
	});

	it("drops text items the reader could not describe rather than throwing", async () => {
		const raw = await harvestPdfDocument(
			makeDocument([
				makePage(1, {
					items: [{ type: "beginMarkedContent" }, { str: 42 }, { str: "ok", transform: [10, 0, 0, 10, 0, 0] }],
				}),
			]),
			{ file: FILE },
		);

		expect(raw.pages[0]?.items.map((item) => item.str)).toEqual(["ok"]);
	});

	it("tolerates a font object the reader refuses to resolve", async () => {
		const page = makePage(1);
		page.commonObjs = {
			get: () => {
				throw new Error("not resolved");
			},
		};

		const raw = await harvestPdfDocument(makeDocument([page]), { file: FILE });
		expect(raw.fonts).toEqual([]);
	});
});
