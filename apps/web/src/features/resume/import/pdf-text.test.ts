import type { RawExtraction } from "@reactive-resume/resume/ats-pdf";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { parseResumeText } from "@reactive-resume/import/plain-text";
import { buildExtractedDocument } from "@reactive-resume/resume/ats-pdf";
import { documentToLines } from "./pdf-text";
import { ImportError, readResumeFile } from "./read-file";

const extract = vi.hoisted(() => vi.fn());
vi.mock("@/features/ats-checker/extract-client", () => ({ extractPdf: extract }));

beforeAll(() => i18n.loadAndActivate({ locale: "en-US", messages: {} }));

const PAGE = { width: 595, height: 842 };
const FONT_SIZE = 10;
const CHAR_WIDTH = 5;

type FixtureItem = { text: string; x: number; y: number; width?: number; fontRef?: string };

/** `y` is measured from the top of the page; the builder flips it into the PDF's own space. */
function rawExtraction(pages: FixtureItem[][]): RawExtraction {
	return {
		version: 1,
		file: { name: "resume.pdf", sizeBytes: 1024, magicBytesOk: true },
		pageCount: pages.length,
		truncated: false,
		pages: pages.map((items, index) => ({
			pageNumber: index + 1,
			width: PAGE.width,
			height: PAGE.height,
			rotation: 0,
			items: items.map((item) => ({
				str: item.text,
				transform: [FONT_SIZE, 0, 0, FONT_SIZE, item.x, PAGE.height - item.y - FONT_SIZE] as const,
				width: item.width ?? item.text.length * CHAR_WIDTH,
				height: FONT_SIZE,
				fontRef: item.fontRef ?? "f1",
				hasEol: false,
			})),
			operators: null,
		})),
		fonts: [],
		links: [],
		metadata: {
			producer: null,
			creator: null,
			title: null,
			author: null,
			language: null,
			pdfVersion: null,
			isEncrypted: false,
			isXfa: false,
			isCollection: false,
			isTagged: false,
			hasAcroForm: false,
		},
		operatorsAvailable: false,
	};
}

const linesOf = (...pages: FixtureItem[][]) => documentToLines(buildExtractedDocument(rawExtraction(pages)));

it("refuses a partial PDF harvest before it can report a successful no-AI import", async () => {
	const raw = rawExtraction([[{ text: "Only the first harvested page", x: 40, y: 60 }]]);
	extract.mockResolvedValue({ ...raw, pageCount: 31, truncated: true });
	const result = readResumeFile(new File(["%PDF-fixture"], "resume.pdf"), "pdf", { aiAvailable: false });
	await expect(result).rejects.toThrow(ImportError);
	await expect(result).rejects.toThrow("Split it into smaller files and try again.");
});

describe("documentToLines", () => {
	it("groups items on the same baseline into one line", () => {
		expect(
			linesOf([
				{ text: "Ada", x: 40, y: 60 },
				{ text: "Lovelace", x: 58, y: 60 },
			]),
		).toEqual(["Ada Lovelace"]);
	});

	it("turns a wide field gap into a double space the parser can split on", () => {
		expect(
			linesOf([
				{ text: "Acme", x: 40, y: 60 },
				{ text: "Engineer", x: 120, y: 60 },
			]),
		).toEqual(["Acme  Engineer"]);
	});

	it("reads each column of a sidebar layout in full instead of interleaving them", () => {
		const sidebar = ["SKILLS", "TypeScript", "Rust", "PostgreSQL", "Docker", "Figma"];
		const main = [
			"EXPERIENCE",
			"Acme Corp",
			"Senior Engineer",
			"Jan 2020 - Present",
			"Led the rewrite",
			"Grew the team",
		];

		expect(
			linesOf([
				...sidebar.map((text, index) => ({ text, x: 40, y: 60 + index * 20 })),
				...main.map((text, index) => ({ text, x: 220, y: 70 + index * 20 })),
			]),
		).toEqual([...sidebar, ...main]);
	});
});

it.each(["Remote", "Reykjavík", "Singapore"])(
	"reads a PDF without AI through the web import adapter and shared parser (%s)",
	async (location) => {
		extract.mockResolvedValue(
			rawExtraction([
				[
					{ text: "Ada Lovelace", x: 260, y: 20 },
					{ text: "ada@example.com", x: 40, y: 40, width: 500 },
					{ text: "SKILLS", x: 40, y: 80 },
					{ text: "Rust", x: 40, y: 100 },
					{ text: "TypeScript", x: 40, y: 120 },
					{ text: "SUMMARY", x: 250, y: 80 },
					{ text: "Builds reliable products.", x: 250, y: 100 },
					{ text: "EXPERIENCE", x: 250, y: 140 },
					{ text: "Example Labs", x: 250, y: 160, fontRef: "bold" },
					{ text: location, x: 500, y: 160, width: 50 },
					{ text: "Director, Product", x: 250, y: 180, width: 100 },
					{ text: "2020 – Present", x: 480, y: 180 },
					{ text: "•", x: 250, y: 200 },
					{ text: "Built services for", x: 260, y: 200 },
					{ text: "Global Customers.", x: 260, y: 215 },
				],
			]),
		);
		const data = await readResumeFile(new File(["%PDF-fixture"], "resume.pdf"), "pdf", { aiAvailable: false });
		expect(data.basics.name).toBe("Ada Lovelace");
		expect(data.sections.skills.items.map((item) => item.name)).toEqual(["Rust", "TypeScript"]);
		expect(data.sections.experience.items).toHaveLength(1);
		expect(data.sections.experience.items[0]).toMatchObject({
			company: "Example Labs",
			position: "Director, Product",
			location,
			period: "2020 – Present",
			description: "<ul><li>Built services for Global Customers.</li></ul>",
		});
	},
);

it("does not split tabbed headings when body text crosses the proposed column boundary", () => {
	expect(
		linesOf([
			{ text: "SKILLS", x: 40, y: 80 },
			{ text: "EXPERIENCE", x: 250, y: 80 },
			{ text: "This paragraph spans the page.", x: 40, y: 100, width: 500 },
			{ text: "Another full-width paragraph.", x: 40, y: 120, width: 500 },
			{ text: "Final paragraph.", x: 40, y: 140, width: 500 },
		]),
	).toEqual([
		"SKILLS",
		"EXPERIENCE",
		"This paragraph spans the page.",
		"Another full-width paragraph.",
		"Final paragraph.",
	]);
});

it("preserves a conventional company/title row followed by place/dates", () => {
	const lines = linesOf([
		{ text: "EXPERIENCE", x: 40, y: 60 },
		{ text: "Example Labs", x: 40, y: 80 },
		{ text: "Engineer", x: 500, y: 80, width: 50 },
		{ text: "Paris, France", x: 40, y: 100 },
		{ text: "2020 – Present", x: 480, y: 100, width: 70 },
		{ text: "• Built tools.", x: 40, y: 120 },
	]);
	expect(parseResumeText(lines.join("\n")).sections.experience.items[0]).toMatchObject({
		company: "Example Labs",
		position: "Engineer",
		location: "Paris, France",
		period: "2020 – Present",
	});
});
