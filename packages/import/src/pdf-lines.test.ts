import type { RawExtraction } from "@reactive-resume/resume/ats-pdf";
import { expect, it } from "vite-plus/test";
import { buildExtractedDocument } from "@reactive-resume/resume/ats-pdf";
import { parsePdfResume } from "./pdf-lines";

type Cell = { text: string; x: number; y: number; font?: string };
function document(cells: Cell[]) {
	const raw: RawExtraction = {
		version: 1,
		file: { name: "external.pdf", sizeBytes: 1000, magicBytesOk: true },
		pageCount: 1,
		truncated: false,
		pages: [
			{
				pageNumber: 1,
				width: 595,
				height: 842,
				rotation: 0,
				operators: null,
				items: cells.map((c) => ({
					str: c.text,
					transform: [10, 0, 0, 10, c.x, 832 - c.y],
					width: c.text.length * 5,
					height: 10,
					fontRef: c.font ?? "body",
					hasEol: false,
				})),
			},
		],
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
	return buildExtractedDocument(raw);
}
const prefix: Cell[] = [
	{ text: "Fictional Reviewer", x: 40, y: 20 },
	{ text: "reviewer@example.invalid", x: 40, y: 40 },
	{ text: "Education", x: 40, y: 80, font: "heading" },
];
const first: Cell[] = [
	{ text: "School Alpha", x: 40, y: 110, font: "strong" },
	{ text: "Degree Alpha", x: 450, y: 110 },
	{ text: "Area Alpha", x: 40, y: 130 },
	{ text: "Place Alpha • 2010 – 2014", x: 385, y: 130 },
];
it("keeps an unassigned right-hand body cell in its record description", () => {
	const data = parsePdfResume(
		document([...prefix, ...first, { text: "Unassigned right-hand detail", x: 300, y: 165 }]),
	);
	expect(data.sections.education.items[0]).toMatchObject({
		school: "School Alpha",
		degree: "Degree Alpha",
		area: "Area Alpha",
		location: "Place Alpha",
		period: "2010 – 2014",
		description: "<p>Unassigned right-hand detail</p>",
	});
});
it("declines destructive projection when a later title pair lacks a corroborated second row", () => {
	const data = parsePdfResume(
		document([
			...prefix,
			...first,
			{ text: "School Beta", x: 40, y: 170, font: "strong" },
			{ text: "Degree Beta", x: 455, y: 170 },
			{ text: "Uncertain external header and prose", x: 40, y: 195 },
		]),
	);
	const stored = JSON.stringify(data.sections.education.items);
	for (const text of [
		"School Alpha",
		"Degree Alpha",
		"Area Alpha",
		"Place Alpha",
		"2010 – 2014",
		"School Beta",
		"Degree Beta",
		"Uncertain external header and prose",
	])
		expect(stored).toContain(text);
	expect(data.sections.education.items[0]?.area).toBe("");
});
it("leaves identical-typography external records with the generic parser and retains their text", () => {
	const data = parsePdfResume(document([...prefix, ...first.map((cell) => ({ ...cell, font: "body" }))]));
	const stored = JSON.stringify(data.sections.education.items);
	for (const text of ["School Alpha", "Degree Alpha", "Area Alpha", "Place Alpha", "2010 – 2014"])
		expect(stored).toContain(text);
	expect(data.sections.education.items[0]?.area).toBe("");
});
