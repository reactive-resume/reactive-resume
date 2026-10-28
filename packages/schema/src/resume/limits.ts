import type { ResumeData } from "./data";

const MAX_RENDER_CHARS = 10_000_000;
const MAX_RENDER_UNITS = 20_000;
const MAX_DEPTH = 64;
const VOID_TAGS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

/** Check before parsing: deeply nested HTML can exhaust parsers and multiply Markdown indentation. */
export function assertRichTextComplexity(html: string): void {
	if (html.length > 200_000) throw new Error("Rich text is too large to render.");
	const ancestors: string[] = [];
	let tags = 0;
	for (const match of html.matchAll(/<(\/?)([a-z][a-z\d-]*)\b[^<>]*>/gi)) {
		if (++tags > MAX_RENDER_UNITS) throw new Error("Rich text has too many elements to render.");
		const tag = (match[2] ?? "").toLowerCase();
		if (match[1]) {
			const index = ancestors.lastIndexOf(tag);
			if (index !== -1) ancestors.length = index;
		} else if (!VOID_TAGS.has(tag) && !match[0].endsWith("/>")) {
			ancestors.push(tag);
			if (ancestors.length > MAX_DEPTH) throw new Error("Rich text is nested too deeply to render.");
		}
	}
}

type Cost = { chars: number; units: number };

function renderCost(value: unknown, depth = 0): Cost {
	if (depth > MAX_DEPTH) throw new Error("Resume content is nested too deeply to render.");
	if (typeof value === "string") {
		let tags = 0;
		for (const character of value) if (character === "<") tags++;
		return { chars: value.length, units: 1 + tags };
	}
	const cost = { chars: 0, units: 1 };
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) {
			const next = renderCost(child, depth + 1);
			cost.chars += next.chars;
			cost.units += next.units;
			assertCost(cost);
		}
	}
	return cost;
}

function assertCost(cost: Cost): void {
	if (cost.chars > MAX_RENDER_CHARS || cost.units > MAX_RENDER_UNITS)
		throw new Error("Resume is too complex to render. Reduce repeated sections or content.");
}

/** Bound expanded content, including repeated section references, before any renderer allocates it. */
export function assertResumeRenderBudget(data: ResumeData): void {
	const sections = new Map<string, unknown>([
		["summary", data.summary],
		...Object.entries(data.sections),
		...data.customSections.map((section): [string, unknown] => [section.id, section]),
	]);
	const costs = new Map<string, Cost>();
	const header = renderCost([data.basics, data.picture]);
	const total = { chars: 0, units: 0 };
	for (const page of data.metadata.layout.pages) {
		total.chars += header.chars;
		total.units += header.units + 1;
		assertCost(total);
		for (const id of [...page.main, ...page.sidebar]) {
			let cost = costs.get(id);
			if (!cost) {
				cost = renderCost(sections.get(id));
				costs.set(id, cost);
			}
			total.chars += cost.chars;
			total.units += cost.units;
			assertCost(total);
		}
	}
}
