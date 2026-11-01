import type { RawExtraction } from "@reactive-resume/resume/ats-pdf";
import { expect, it } from "vite-plus/test";
import { buildExtractedDocument } from "@reactive-resume/resume/ats-pdf";
import { documentToLines, parsePdfResume } from "./pdf-lines";

type Cell = { text: string; x: number; y: number; font?: string; page?: number; width?: number; size?: number };
function document(cells: Cell[], links: RawExtraction["links"] = []) {
	const pageCount = Math.max(1, ...cells.map((cell) => cell.page ?? 1));
	const raw: RawExtraction = {
		version: 1,
		file: { name: "external.pdf", sizeBytes: 1000, magicBytesOk: true },
		pageCount,
		truncated: false,
		pages: Array.from({ length: pageCount }, (_, index) => ({
			pageNumber: index + 1,
			width: 595,
			height: 842,
			rotation: 0,
			operators: null,
			items: cells
				.filter((cell) => (cell.page ?? 1) === index + 1)
				.map((c) => ({
					str: c.text,
					transform: [c.size ?? 10, 0, 0, c.size ?? 10, c.x, 842 - c.y - (c.size ?? 10)],
					width: c.width ?? c.text.length * 5,
					height: c.size ?? 10,
					fontRef: c.font ?? "body",
					hasEol: false,
				})),
		})),
		fonts: [],
		links,
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
	expect(data.sections.education.items).toHaveLength(1);
	expect(data.sections.education.items[0]?.school).not.toContain("School Beta");
	expect(data.sections.education.items[0]?.degree).not.toContain("Degree Beta");
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

it.each([
	{ name: "partial overlap", rect: [40, 772, 52, 782], url: "https://portfolio.example/" },
	{ name: "edge contact only", rect: [85, 772, 110, 782], url: "" },
])("matches annotation geometry with $name", ({ rect, url }) => {
	const data = parsePdfResume(
		document(
			[
				{ text: "Fictional Reviewer", x: 40, y: 20 },
				{ text: "reviewer@example.invalid", x: 40, y: 40 },
				{ text: "Portfolio", x: 40, y: 60 },
				...prefix.slice(2),
				...first,
			],
			[{ page: 1, rect: rect as [number, number, number, number], url: "https://portfolio.example/" }],
		),
	);
	expect(data.basics.website.url).toBe(url);
});

it.each(["https://other.example/", "https://primary.example/"])(
	"preserves a printed identity website alongside annotation %s",
	(url) => {
		const data = parsePdfResume(
			document(
				[
					{ text: "Fictional Reviewer", x: 40, y: 20 },
					{ text: "reviewer@example.invalid", x: 40, y: 40 },
					{ text: "https://primary.example/", x: 40, y: 60 },
					{ text: "Portfolio", x: 40, y: 80 },
					{ text: "Education", x: 40, y: 120, font: "heading" },
					...first.map((cell) => ({ ...cell, y: cell.y + 40 })),
				],
				[{ page: 1, rect: [40, 752, 85, 762], url }],
			),
		);
		expect(data.basics.website).toEqual({
			url: "https://primary.example/",
			label: url.includes("primary") ? "Portfolio" : "",
		});
		expect(data.basics.customFields).toMatchObject(url.includes("other") ? [{ text: "Portfolio", link: url }] : []);
	},
);

it("keeps a full-column Education website block that precedes its description", () => {
	const data = parsePdfResume(
		document(
			[
				...prefix,
				...first,
				{ text: "Details", x: 40, y: 150 },
				{ text: "Completed independent research.", x: 40, y: 170 },
				{ text: "Read the thesis", x: 40, y: 190 },
			],
			[
				{ page: 1, rect: [40, 682, 550, 692], url: "https://school.example/" },
				{ page: 1, rect: [40, 642, 115, 652], url: "https://thesis.example/" },
			],
		),
	);
	expect(data.sections.education.items[0]?.website).toMatchObject({ url: "https://school.example/", label: "Details" });
	expect(data.sections.education.items[0]?.description).toBe(
		"<p>Completed independent research.</p><p>Read the thesis</p>",
	);
});

it.each([
	["leading", 150, 170],
	["trailing", 170, 150],
])("keeps a %s linked body paragraph in the description when there is no website", (_, linkY, proseY) => {
	const data = parsePdfResume(
		document(
			[
				...prefix,
				...first,
				{ text: "Completed independent research.", x: 40, y: proseY },
				{ text: "Read the thesis", x: 40, y: linkY },
			],
			[{ page: 1, rect: [40, 832 - linkY, 115, 842 - linkY], url: "https://thesis.example/" }],
		),
	);
	const paragraphs = ["<p>Completed independent research.</p>", "<p>Read the thesis</p>"];
	expect(data.sections.education.items[0]?.website.url).toBe("");
	expect(data.sections.education.items[0]?.description).toBe(
		(linkY < proseY ? paragraphs.reverse() : paragraphs).join(""),
	);
});

it("retains a full-row footer website after description text", () => {
	const data = parsePdfResume(
		document(
			[
				...prefix,
				...first,
				{ text: "Completed independent research.", x: 40, y: 150 },
				{ text: "Details", x: 40, y: 170 },
			],
			[{ page: 1, rect: [40, 662, 550, 672], url: "https://school.example/" }],
		),
	);
	expect(data.sections.education.items[0]?.website).toMatchObject({ url: "https://school.example/", label: "Details" });
	expect(data.sections.education.items[0]?.description).toBe("<p>Completed independent research.</p>");
});

it.each([false, true])("joins a cross-page bullet only with a filled previous line (filled=%s)", (filled) => {
	const lines = documentToLines(
		document([
			{ text: "EXPERIENCE", x: 40, y: 80, font: "heading" },
			{ text: "Company Alpha", x: 40, y: 110, font: "strong" },
			{ text: "Engineer", x: 40, y: 130 },
			{ text: "2020 – 2021", x: 450, y: 130 },
			{ text: "•", x: 40, y: 800 },
			{ text: "Delivered useful work", x: 50, y: 800, width: filled ? 500 : 100 },
			{ text: "Company Beta", x: 50, y: 40, page: 2 },
			{ text: "• Another achievement", x: 40, y: 80, page: 2 },
		]),
	);
	expect(lines).toContain(filled ? "• Delivered useful work Company Beta" : "Company Beta");
	if (!filled) expect(lines).toContain("• Delivered useful work");
});

it("recognizes tight uppercase section labels that share the body style when no heading style is anchored", () => {
	const data = parsePdfResume(
		document([
			{ text: "Fictional Reviewer", x: 40, y: 20 },
			{ text: "reviewer@example.invalid", x: 40, y: 40 },
			{ text: "EXPERIENCE", x: 40, y: 55 },
			{ text: "Company Alpha", x: 40, y: 70, font: "strong" },
			{ text: "Engineer", x: 40, y: 85 },
			{ text: "2020 – 2021", x: 450, y: 85 },
			{ text: "•", x: 40, y: 100 },
			{ text: "Built useful", x: 50, y: 100 },
			{ text: "EXPERIENCE", x: 50, y: 115 },
			{ text: "EDUCATION", x: 40, y: 130 },
			...first.map((cell) => ({ ...cell, y: cell.y + 35 })),
		]),
	);
	expect(data.sections.experience.items).toHaveLength(1);
	expect(data.sections.experience.items[0]?.description).toContain("Built useful EXPERIENCE");
	expect(data.sections.education.items).toHaveLength(1);
	expect(data.sections.education.items[0]).toMatchObject({ school: "School Alpha", degree: "Degree Alpha" });
});

it("keeps body-style uppercase sub-labels in a role when a distinct heading style is anchored", () => {
	const data = parsePdfResume(
		document([
			{ text: "Fictional Reviewer", x: 40, y: 20 },
			{ text: "reviewer@example.invalid", x: 40, y: 40 },
			{ text: "EXPERIENCE", x: 40, y: 80, font: "heading" },
			{ text: "Company Alpha", x: 40, y: 100, font: "strong" },
			{ text: "Engineer", x: 40, y: 120 },
			{ text: "2020 – 2021", x: 450, y: 120 },
			{ text: "PROJECTS", x: 40, y: 135 },
			{ text: "• Built Atlas tooling.", x: 40, y: 150 },
			{ text: "SKILLS", x: 40, y: 165 },
			{ text: "• Led platform reviews.", x: 40, y: 180 },
			{ text: "EDUCATION", x: 40, y: 210, font: "heading" },
			...first.map((cell) => ({ ...cell, y: cell.y + 120 })),
		]),
	);
	expect(data.sections.experience.items).toHaveLength(1);
	const description = data.sections.experience.items[0]?.description ?? "";
	for (const text of ["PROJECTS", "Built Atlas tooling.", "SKILLS", "Led platform reviews."])
		expect(description).toContain(text);
	expect(data.sections.projects.items).toEqual([]);
	expect(data.sections.skills.items).toEqual([]);
	expect(data.sections.education.items).toHaveLength(1);
	expect(data.sections.education.items[0]).toMatchObject({ school: "School Alpha", degree: "Degree Alpha" });
});

it("keeps labelled email and phone contacts after Summary without borrowing a body URL", () => {
	const data = parsePdfResume(
		document(
			[
				{ text: "Fictional Reviewer", x: 40, y: 20 },
				{ text: "Summary", x: 40, y: 60, font: "heading" },
				{ text: "Builds useful products.", x: 40, y: 80 },
				{ text: "Email", x: 40, y: 120 },
				{ text: "Phone", x: 140, y: 120 },
				{ text: "Portfolio", x: 240, y: 120 },
				{ text: "Education", x: 40, y: 160, font: "heading" },
				...first.map((cell) => ({ ...cell, y: cell.y + 60 })),
				{ text: "https://school.example/", x: 40, y: 220 },
			],
			[
				{ page: 1, rect: [40, 712, 65, 722], url: "mailto:reviewer@example.invalid" },
				{ page: 1, rect: [140, 712, 165, 722], url: "tel:+12025550199" },
				{ page: 1, rect: [240, 712, 285, 722], url: "https://portfolio.example/" },
			],
		),
	);
	expect(data.basics).toMatchObject({
		email: "reviewer@example.invalid",
		phone: "+12025550199",
		website: { url: "https://portfolio.example/", label: "Portfolio" },
		customFields: [],
	});
});

it("keeps a dense run of body-style aliases and contact rows on the geometry path within the default budget", () => {
	const aliases = ["SKILLS", "PROJECTS", "AWARDS", "EXPERIENCE", "EDUCATION", "LANGUAGES", "INTERESTS", "REFERENCES"];
	const rows = Array.from({ length: 320 }, (_, i) => ({
		text:
			i % 2
				? (aliases[((i - 1) / 2) % 8] ?? "")
				: `pat${i}@example.invalid +1 202 555 01${String(i % 100).padStart(2, "0")}`,
		x: 40,
		y: 60 + (i % 36) * 20,
		page: 1 + Math.floor(i / 36),
	}));
	const page = 2 + Math.floor(319 / 36);
	const doc = document([
		{ text: "Fictional Reviewer", x: 40, y: 10, size: 16 },
		{ text: "Summary", x: 40, y: 34, size: 14 },
		...rows,
		{ text: "Education", x: 40, y: 60, size: 14, page },
		...first.map((cell) => ({ ...cell, page })),
	]);
	// Geometry joins separate fields with two spaces; the flat fallback keeps the extractor's single space.
	expect(documentToLines(doc)).toContain("Area Alpha  Place Alpha • 2010 – 2014");
	const data = parsePdfResume(doc);
	expect(data.sections.education.items.map((item) => item.school)).toEqual(["School Alpha"]);
	for (const key of ["experience", "skills", "projects", "awards", "languages", "interests", "references"] as const)
		expect(data.sections[key].items).toEqual([]);
	const text = JSON.stringify(data);
	for (let i = 0; i < 320; i += 2) expect(text).toContain(`pat${i}@example.invalid`);
});

it("keeps every body line and the geometry contacts when no section heading is found", () => {
	// Full prose lines: a short first line could legitimately open a custom section instead.
	const body = [
		"Built accessible scheduling tools for regional clinics and their many partners.",
		"Led four engineers through a calm migration without losing a single appointment.",
	];
	const data = parsePdfResume(
		document(
			[
				{ text: "Fictional Reviewer", x: 40, y: 10, size: 16 },
				{ text: "reviewer@example.invalid", x: 40, y: 40 },
				{ text: "Portfolio", x: 40, y: 60 },
				...body.map((text, index) => ({ text, x: 40, y: 100 + index * 20 })),
			],
			[{ page: 1, rect: [40, 772, 85, 782], url: "https://portfolio.example/" }],
		),
	);
	expect(data.basics).toMatchObject({
		email: "reviewer@example.invalid",
		website: { url: "https://portfolio.example/", label: "Portfolio" },
	});
	for (const text of body) expect(data.summary.content).toContain(text);
});

it("keeps a header-only PDF as identity without copying it into Summary", () => {
	const data = parsePdfResume(
		document([
			{ text: "Fictional Reviewer", x: 40, y: 10, size: 16 },
			{ text: "reviewer@example.invalid", x: 40, y: 40 },
			{ text: "+1 202 555 0199", x: 240, y: 40 },
		]),
	);
	expect(data.basics).toMatchObject({
		name: "Fictional Reviewer",
		email: "reviewer@example.invalid",
		phone: "+1 202 555 0199",
	});
	expect(data.summary.content).toBe("");
	expect(Object.values(data.sections).reduce((count, section) => count + section.items.length, 0)).toBe(0);
});

const shortResume = (labels: Cell[]) => [
	{ text: "Fictional Reviewer", x: 40, y: 10, size: 16 },
	{ text: "reviewer@example.invalid", x: 40, y: 40 },
	{ text: "Summary", x: 40, y: 70, font: "heading" },
	{ text: "Builds useful products for careful teams.", x: 40, y: 88 },
	{ text: "Education", x: 40, y: 120, font: "heading" },
	...first.map((cell) => ({ ...cell, y: cell.y + 25 })),
	{ text: "Experience", x: 40, y: 190, font: "heading" },
	{ text: "Company Alpha", x: 40, y: 210, font: "strong" },
	{ text: "Engineer", x: 40, y: 225 },
	{ text: "2020 – 2021", x: 450, y: 225 },
	...labels,
];

it.each([
	["isolated by a blank line", "body", 30, false],
	["repeated in their own bold style", "strong", 15, true],
	["used once each in their own bold style after blank lines", "strong", 30, false],
])("keeps role sub-labels as role text when they are %s", (_, font, gap, repeat) => {
	// Three real headings in a distinct style; four sub-labels outnumber them, all inside the Experience section.
	const labels = ["ACHIEVEMENTS", "PROJECTS", "SKILLS", "LANGUAGES", ...(repeat ? ["PROJECTS"] : [])];
	const cells = labels.flatMap((text, index) => {
		const y = 250 + index * (gap + 15);
		return [
			{ text, x: 40, y, font },
			{ text: `• Outcome ${index + 1} for the team.`, x: 40, y: y + 15 },
		];
	});
	const data = parsePdfResume(document(shortResume(cells)));
	expect(data.summary.content).toBe("<p>Builds useful products for careful teams.</p>");
	expect(data.sections.education.items.map((item) => item.school)).toEqual(["School Alpha"]);
	expect(data.sections.experience.items).toHaveLength(1);
	expect(data.sections.experience.items[0]).toMatchObject({ company: "Company Alpha", position: "Engineer" });
	for (const text of labels) expect(data.sections.experience.items[0]?.description).toContain(text);
	for (const key of ["projects", "skills", "awards", "languages"] as const)
		expect(data.sections[key].items).toEqual([]);
});

it("treats one heading style rendered a tenth of a point apart as one style", () => {
	// Sub-labels in the body style outnumber headings split by rounding at 9.45pt.
	const sizes = { Summary: 9.4, Education: 9.5, Experience: 9.4 } as Record<string, number>;
	const cells = shortResume(
		["ACHIEVEMENTS", "PROJECTS", "SKILLS", "LANGUAGES"].flatMap((text, index) => [
			{ text, x: 40, y: 240 + index * 30 },
			{ text: `• Outcome ${index + 1} for the team.`, x: 40, y: 255 + index * 30 },
		]),
	).map((cell) => (cell.text in sizes ? { ...cell, size: sizes[cell.text] ?? 10 } : cell));
	const data = parsePdfResume(document(cells));
	expect(data.sections.education.items.map((item) => item.school)).toEqual(["School Alpha"]);
	expect(data.sections.experience.items.map((item) => item.company)).toEqual(["Company Alpha"]);
	expect(data.summary.content).toBe("<p>Builds useful products for careful teams.</p>");
});

it("keeps a header band with linked contacts out of the zero-heading fallback", () => {
	const data = parsePdfResume(
		document(
			[
				{ text: "Fictional Reviewer", x: 40, y: 10, size: 16 },
				{ text: "reviewer@example.invalid", x: 40, y: 40 },
				{ text: "Selected work", x: 300, y: 40 },
				{ text: "github.com/reviewer", x: 400, y: 40 },
			],
			// Custom fields render as links, like the website.
			[
				{ page: 1, rect: [300, 792, 365, 802], url: "https://work.example/" },
				{ page: 1, rect: [400, 792, 495, 802], url: "https://github.com/reviewer" },
			],
		),
	);
	expect(data.summary.content).toBe("");
	expect(data.basics.email).toBe("reviewer@example.invalid");
});

it.each([
	["a duplicated section title", "Qualifications", "heading", 9],
	["headings in the body style", "", "body", 10],
	["a larger label inside a section", "", "heading", 9],
])("keeps the real headings beside one isolated bold label with %s", (_, extra, font, size) => {
	// One bold "Projects" label inside a role must not outrank the section headings that contain it.
	const heading = (text: string, y: number) => ({ text, x: 40, y, font, size });
	const data = parsePdfResume(
		document([
			{ text: "Fictional Reviewer", x: 40, y: 10, size: 16 },
			{ text: "reviewer@example.invalid", x: 40, y: 40 },
			heading("Summary", 70),
			{ text: "Builds useful products for careful teams.", x: 40, y: 88 },
			heading("Education", 120),
			...first.map((cell) => ({ ...cell, y: cell.y + 25 })),
			heading("Experience", 190),
			{ text: "Company Alpha", x: 40, y: 210, font: "strong" },
			{ text: "Engineer", x: 40, y: 225 },
			{ text: "2020 – 2021", x: 450, y: 225 },
			{ text: "• Delivered careful platform work for the team.", x: 40, y: 245 },
			{
				text: "Projects",
				x: 40,
				y: 280,
				font: "strong",
			},
			{ text: "• Built Atlas tooling.", x: 40, y: 295 },
			heading("Projects", 330),
			{ text: "Atlas", x: 40, y: 350, font: "strong" },
			{ text: "Open-source scheduling toolkit for regional teams.", x: 40, y: 365 },
			...(extra
				? [heading(extra, 400), { text: "Certified first aider with current credentials.", x: 40, y: 420 }]
				: []),
		]),
	);
	expect(data.summary.content).toBe("<p>Builds useful products for careful teams.</p>");
	expect(data.sections.experience.items).toHaveLength(1);
	expect(data.sections.experience.items[0]).toMatchObject({ company: "Company Alpha", position: "Engineer" });
	expect(data.sections.experience.items[0]?.description).toContain("Built Atlas tooling.");
	expect(data.sections.education.items[0]?.school).toBe("School Alpha");
	expect(data.sections.projects.items.map((item) => item.name)).toEqual(["Atlas"]);
	if (extra) expect(JSON.stringify(data)).toContain("Certified first aider with current credentials.");
});

it("does not let one differently styled title swallow the section headings below it", () => {
	// A single label in its own style opens one section at most; it cannot contain the document's other headings.
	const data = parsePdfResume(
		document([
			{ text: "Fictional Reviewer", x: 40, y: 10, size: 16 },
			{ text: "reviewer@example.invalid", x: 40, y: 40 },
			{ text: "Summary", x: 40, y: 70, font: "title" },
			{ text: "Builds useful products for careful teams.", x: 40, y: 88 },
			{ text: "Education", x: 40, y: 120, font: "heading" },
			...first.map((cell) => ({ ...cell, y: cell.y + 25 })),
			{ text: "Experience", x: 40, y: 190, font: "heading" },
			{ text: "Company Alpha", x: 40, y: 210, font: "strong" },
			{ text: "Engineer", x: 40, y: 225 },
			{ text: "2020 – 2021", x: 450, y: 225 },
			{ text: "• Delivered careful platform work for the team.", x: 40, y: 245 },
		]),
	);
	// The lone title has no consistent heading evidence of its own and stays Summary text (as before this change).
	expect(data.summary.content).toContain("Builds useful products for careful teams.");
	expect(data.sections.education.items.map((item) => item.school)).toEqual(["School Alpha"]);
	expect(data.sections.experience.items.map((item) => item.company)).toEqual(["Company Alpha"]);
});
