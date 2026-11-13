// Section and entry model for the builder, ported from apps/web/src/features/resume/editor/write/model.ts (logic
// only), plus the phone's per-type metadata: names, the field set each section type shows, and the copy that
// depends on the type ("Add experience", "New language", "Untitled project").
import type {
	CustomSection,
	CustomSectionItem,
	CustomSectionType,
	ResumeData,
	SectionType,
} from "@reactive-resume/schema/resume/data";
import type { ResumeDates } from "@reactive-resume/schema/resume/dates";
import type { WritableDraft } from "immer";
import { t } from "@lingui/core/macro";
import { sortSectionItemsByPeriod } from "@reactive-resume/resume/section-sort";
import { readLegacyDates } from "@reactive-resume/schema/resume/dates";
import { stripHtml } from "@reactive-resume/utils/string";

type Data = ResumeData | WritableDraft<ResumeData>;
export type Entry = CustomSectionItem;
export type BuilderSection = { id: string; kind: "summary" | "builtin" | "custom"; type: CustomSectionType };

const BUILTIN: readonly SectionType[] = [
	"profiles",
	"experience",
	"education",
	"projects",
	"skills",
	"languages",
	"interests",
	"awards",
	"certifications",
	"publications",
	"volunteer",
	"references",
];
const isBuiltin = (id: string): id is SectionType => (BUILTIN as readonly string[]).includes(id);

export function resolveSection(data: Data, id: string): BuilderSection | null {
	if (id === "summary") return { id, kind: "summary", type: "summary" };
	if (isBuiltin(id)) return { id, kind: "builtin", type: id };
	const custom = data.customSections.find((section) => section.id === id);
	return custom ? { id, kind: "custom", type: custom.type } : null;
}

export function getEntries(data: Data, section: BuilderSection): Entry[] {
	if (section.kind === "builtin") return data.sections[section.id as SectionType].items as Entry[];
	if (section.kind === "custom")
		return (data.customSections.find((custom) => custom.id === section.id)?.items ?? []) as Entry[];
	return [];
}

type SectionObject = ResumeData["summary"] | ResumeData["sections"][SectionType] | CustomSection;
export function getSectionObject(data: Data, section: BuilderSection): SectionObject | undefined {
	if (section.kind === "summary") return data.summary;
	if (section.kind === "builtin") return data.sections[section.id as SectionType];
	return data.customSections.find((custom) => custom.id === section.id);
}

export function findEntry(data: Data, sectionId: string, entryId: string): Entry | undefined {
	const section = resolveSection(data, sectionId);
	return section ? getEntries(data, section).find((entry) => entry.id === entryId) : undefined;
}

/** What one section type is called and asks for. Strings are whole phrases so every language can translate them. */
export type SectionMeta = {
	title: () => string;
	add: () => string;
	placeholder: () => string;
	untitled: () => string;
	/** The field an entry needs before it prints (the PDF renderer's filter). */
	primary: string;
	fields: readonly FieldSpec[];
	/** Rare fields under "More fields". */
	more: readonly FieldSpec[];
};

export type FieldSpec =
	| { kind: "text"; key: string; label: () => string; placeholder?: () => string; keyboard?: "email" | "phone" | "url" }
	| { kind: "dates"; single: boolean }
	| { kind: "level" }
	| { kind: "keywords" }
	| { kind: "website" }
	| { kind: "description"; label: () => string };

const text = (
	key: string,
	label: () => string,
	extra: Partial<Extract<FieldSpec, { kind: "text" }>> = {},
): FieldSpec => ({
	kind: "text",
	key,
	label,
	...extra,
});
const dates: FieldSpec = { kind: "dates", single: false };
const date: FieldSpec = { kind: "dates", single: true };
const description: FieldSpec = { kind: "description", label: () => t`Description` };
const website: FieldSpec = { kind: "website" };
const location = text("location", () => t`Location`);

export const sectionMeta: Record<CustomSectionType, SectionMeta> = {
	summary: {
		title: () => t`Summary`,
		add: () => t`Add summary`,
		placeholder: () => t`New summary`,
		untitled: () => t`Untitled summary`,
		primary: "content",
		fields: [],
		more: [],
	},
	"cover-letter": {
		title: () => t`Cover letter`,
		add: () => t`Add cover letter`,
		placeholder: () => t`New cover letter`,
		untitled: () => t`Untitled cover letter`,
		primary: "recipient",
		fields: [text("recipient", () => t`Recipient`), { kind: "description", label: () => t`Text` }],
		more: [],
	},
	profiles: {
		title: () => t`Profiles`,
		add: () => t`Add profile`,
		placeholder: () => t`New profile`,
		untitled: () => t`Untitled profile`,
		primary: "network",
		fields: [text("network", () => t`Network`), text("username", () => t`Username`), website],
		more: [],
	},
	experience: {
		title: () => t`Experience`,
		add: () => t`Add experience`,
		placeholder: () => t`New experience`,
		untitled: () => t`Untitled experience`,
		primary: "company",
		fields: [text("company", () => t`Company`), text("position", () => t`Position`), dates, location, description],
		more: [website],
	},
	education: {
		title: () => t`Education`,
		add: () => t`Add education`,
		placeholder: () => t`New education`,
		untitled: () => t`Untitled education`,
		primary: "school",
		fields: [
			text("school", () => t`School`),
			text("degree", () => t`Degree`),
			text("area", () => t`Area of study`),
			dates,
			location,
			description,
		],
		more: [text("grade", () => t`Grade`), website],
	},
	projects: {
		title: () => t`Projects`,
		add: () => t`Add project`,
		placeholder: () => t`New project`,
		untitled: () => t`Untitled project`,
		primary: "name",
		fields: [text("name", () => t`Name`), dates, description],
		more: [website],
	},
	skills: {
		title: () => t`Skills`,
		add: () => t`Add skill`,
		placeholder: () => t`New skill`,
		untitled: () => t`Untitled skill`,
		primary: "name",
		fields: [text("name", () => t`Name`), text("proficiency", () => t`Proficiency`), { kind: "level" }],
		more: [{ kind: "keywords" }],
	},
	languages: {
		title: () => t`Languages`,
		add: () => t`Add language`,
		placeholder: () => t`New language`,
		untitled: () => t`Untitled language`,
		primary: "language",
		fields: [
			text("language", () => t`Language`, { placeholder: () => t`German` }),
			text("fluency", () => t`Fluency`, { placeholder: () => t`Native, fluent, conversational…` }),
			{ kind: "level" },
		],
		more: [],
	},
	interests: {
		title: () => t`Interests`,
		add: () => t`Add interest`,
		placeholder: () => t`New interest`,
		untitled: () => t`Untitled interest`,
		primary: "name",
		fields: [text("name", () => t`Name`), { kind: "keywords" }],
		more: [],
	},
	awards: {
		title: () => t`Awards`,
		add: () => t`Add award`,
		placeholder: () => t`New award`,
		untitled: () => t`Untitled award`,
		primary: "title",
		fields: [text("title", () => t`Title`), text("awarder", () => t`Awarder`), date, description],
		more: [website],
	},
	certifications: {
		title: () => t`Certifications`,
		add: () => t`Add certification`,
		placeholder: () => t`New certification`,
		untitled: () => t`Untitled certification`,
		primary: "title",
		fields: [text("title", () => t`Title`), text("issuer", () => t`Issuer`), date, description],
		more: [website],
	},
	publications: {
		title: () => t`Publications`,
		add: () => t`Add publication`,
		placeholder: () => t`New publication`,
		untitled: () => t`Untitled publication`,
		primary: "title",
		fields: [text("title", () => t`Title`), text("publisher", () => t`Publisher`), date, description],
		more: [website],
	},
	volunteer: {
		title: () => t`Volunteer`,
		add: () => t`Add volunteering`,
		placeholder: () => t`New volunteering`,
		untitled: () => t`Untitled volunteering`,
		primary: "organization",
		fields: [text("organization", () => t`Organization`), location, dates, description],
		more: [website],
	},
	references: {
		title: () => t`References`,
		add: () => t`Add reference`,
		placeholder: () => t`New reference`,
		untitled: () => t`Untitled reference`,
		primary: "name",
		fields: [
			text("name", () => t`Name`),
			text("position", () => t`Position`),
			text("phone", () => t`Phone`, { keyboard: "phone" }),
			description,
		],
		more: [website],
	},
};

/** The printed name of a section: the title the author gave it, else its type's name. */
export function sectionName(data: Data, section: BuilderSection): string {
	const own = getSectionObject(data, section)?.title.trim();
	return own || sectionMeta[section.type].title();
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function entryTitle(type: CustomSectionType, entry: Entry): string {
	return str((entry as Record<string, unknown>)[sectionMeta[type].primary]);
}

/**
 * Reorders a section's entries by date, newest first. Returns the names of entries whose dates couldn't be read:
 * they stay at the end, in their previous order.
 */
export function sortEntriesByDate(data: Data, section: BuilderSection, locale: string): string[] {
	const entries = getEntries(data, section);
	const result = sortSectionItemsByPeriod(entries, locale);
	const unresolved = result.unresolvedIds.map((id) => {
		const entry = entries.find((item) => item.id === id);
		return (entry ? entryTitle(section.type, entry) : "").trim() || id;
	});
	entries.splice(0, entries.length, ...result.items);
	return unresolved;
}

/** Every field empty (spaces count as empty): nothing worth keeping (B3 and B20 leaving). */
export function isEmptyEntry(entry: Entry): boolean {
	for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
		if (key === "id" || key === "hidden") continue;
		if (typeof value === "string" && stripHtml(value).trim()) return false;
		if (typeof value === "number" && value > 0) return false;
		if (Array.isArray(value) && value.some((v) => (typeof v === "string" ? v.trim() : v))) return false;
		if (key === "website" && str((value as { url?: string }).url)) return false;
		if (key === "dates") {
			const d = value as ResumeDates;
			if (d.start || d.end || d.present || d.raw?.trim()) return false;
		}
	}
	return true;
}

/** Start and end years of an entry ("2022 – now", "2019 – 2022", "2021"). */
function years(entry: Entry, locale: string): string {
	const e = entry as { dates?: ResumeDates; period?: string; date?: string };
	const single = e.period === undefined;
	const d = e.dates ?? readLegacyDates(e.period ?? e.date ?? "", { locale, single });
	if (d.raw?.trim() && !d.start) return d.raw.trim();
	const start = d.start?.slice(0, 4) ?? "";
	const end = d.present ? t`now` : (d.end?.slice(0, 4) ?? "");
	return start && end ? `${start} – ${end}` : start || end;
}

const join = (...parts: unknown[]) => parts.map(str).filter(Boolean).join(" · ");

/** B2's second line: what and when ("Senior product designer · 2022 – now"). */
export function entryDetails(type: CustomSectionType, entry: Entry, locale: string): string {
	const e = entry as Record<string, unknown> & { keywords?: string[] };
	const when = years(entry, locale);
	switch (type) {
		case "experience":
			return join(e.position, when);
		case "education":
			return join([str(e.degree), str(e.area)].filter(Boolean).join(", "), when);
		case "projects":
			return join(when);
		case "skills":
			return join(e.proficiency, (e.keywords ?? []).join(", "));
		case "languages":
			return join(e.fluency);
		case "interests":
			return (e.keywords ?? []).join(", ");
		case "awards":
			return join(e.awarder, when);
		case "certifications":
			return join(e.issuer, when);
		case "publications":
			return join(e.publisher, when);
		case "volunteer":
			return join(e.location, when);
		case "references":
			return join(e.position);
		case "profiles":
			return join(e.username);
		default:
			return "";
	}
}

type Column = "main" | "sidebar";
export type OutlineRow = { id: string; page: number; column: Column; hidden: boolean };

/** Sections that have something in them. Custom sections always count. */
export function isSectionInUse(data: Data, id: string): boolean {
	const section = resolveSection(data, id);
	if (!section) return false;
	if (section.kind === "summary") return Boolean(stripHtml(data.summary.content).trim());
	if (section.kind === "custom") return true;
	return getEntries(data, section).length > 0;
}

/** The sections in use in print order: page by page, the main column then the sidebar; unplaced ones last. */
export function getOutlineRows(data: Data): OutlineRow[] {
	const rows: OutlineRow[] = [];
	const placed = new Set<string>();
	data.metadata.layout.pages.forEach((page, pageIndex) => {
		for (const column of ["main", "sidebar"] as const) {
			for (const id of page[column]) {
				placed.add(id);
				const section = resolveSection(data, id);
				if (section && isSectionInUse(data, id))
					rows.push({ id, page: pageIndex, column, hidden: !!getSectionObject(data, section)?.hidden });
			}
		}
	});
	const lastPage = Math.max(0, data.metadata.layout.pages.length - 1);
	for (const id of ["summary", ...BUILTIN, ...data.customSections.map((section) => section.id)]) {
		const section = resolveSection(data, id);
		if (!placed.has(id) && section && isSectionInUse(data, id))
			rows.push({ id, page: lastPage, column: "main", hidden: !!getSectionObject(data, section)?.hidden });
	}
	return rows;
}

/** Every section a page places, used or not, in its column order (B8 lists what prints where). */
export function pageSections(data: Data, page: number, column: Column): string[] {
	return (data.metadata.layout.pages[page]?.[column] ?? []).filter((id) => resolveSection(data, id));
}

/** The page a section prints on (0-based), or -1. */
export function pageOf(data: Data, id: string): number {
	return data.metadata.layout.pages.findIndex((page) => page.main.includes(id) || page.sidebar.includes(id));
}

/** Moves a section one place within its page column (B1's long-press, B8's tap menu). */
export function stepSection(draft: WritableDraft<ResumeData>, id: string, step: -1 | 1) {
	for (const page of draft.metadata.layout.pages) {
		for (const column of ["main", "sidebar"] as const) {
			const list = page[column];
			const from = list.indexOf(id);
			const to = from + step;
			if (from === -1 || to < 0 || to >= list.length) continue;
			list.splice(from, 1);
			list.splice(to, 0, id);
			return;
		}
	}
}

/** Moves a section to `index` in a page column, taking it out of wherever it was. */
export function placeSection(
	draft: WritableDraft<ResumeData>,
	id: string,
	page: number,
	column: Column,
	index: number,
) {
	for (const p of draft.metadata.layout.pages) {
		p.main = p.main.filter((section) => section !== id);
		p.sidebar = p.sidebar.filter((section) => section !== id);
	}
	draft.metadata.layout.pages[page]?.[column].splice(index, 0, id);
}
