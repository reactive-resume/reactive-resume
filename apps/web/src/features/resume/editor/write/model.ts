import type {
	CustomSection,
	CustomSectionItem,
	CustomSectionType,
	ResumeData,
	SectionType,
} from "@reactive-resume/schema/resume/data";
import type { WritableDraft } from "immer";
import { sectionTypeSchema } from "@reactive-resume/schema/resume/data";
import { EMPTY_RESUME_DATES } from "@reactive-resume/schema/resume/dates";
import { generateId, stripHtml } from "@reactive-resume/utils/string";

type Data = ResumeData | WritableDraft<ResumeData>;

/** One entry of any section. Each section type narrows it in its own field set. */
export type Entry = CustomSectionItem;

/** A section of the outline: the summary, a built-in section (keyed by type) or a custom section (by id). */
export type WriteSection = { id: string; kind: "summary" | "builtin" | "custom"; type: CustomSectionType };

export const BUILTIN_SECTION_TYPES: readonly SectionType[] = sectionTypeSchema.options.filter(
	(type) => type !== "summary" && type !== "cover-letter",
);

export const CUSTOM_SECTION_TYPES = [
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
	"profiles",
	"summary",
] as const satisfies readonly CustomSectionType[];

const isBuiltinSectionType = (id: string): id is SectionType =>
	(BUILTIN_SECTION_TYPES as readonly string[]).includes(id);

export const getSectionKind = (id: string): WriteSection["kind"] =>
	id === "summary" ? "summary" : isBuiltinSectionType(id) ? "builtin" : "custom";

/** The type of a section id: its own key for the summary and built-ins, the stored type for custom ones. */
export function getSectionType(data: Data, id: string): CustomSectionType | undefined {
	if (id === "summary") return "summary";
	if (isBuiltinSectionType(id)) return id;
	return data.customSections.find((section) => section.id === id)?.type;
}

export function resolveSection(data: Data, id: string): WriteSection | null {
	const type = getSectionType(data, id);
	return type ? { id, kind: getSectionKind(id), type } : null;
}

/** The entries of a section, from saved data or inside an immer draft. The summary has none. */
export function getEntries(data: Data, section: WriteSection): Entry[] {
	if (section.kind === "builtin") return data.sections[section.id as SectionType].items as Entry[];
	if (section.kind === "custom")
		return (data.customSections.find((custom) => custom.id === section.id)?.items ?? []) as Entry[];
	return [];
}

type SectionObject = ResumeData["summary"] | ResumeData["sections"][SectionType] | CustomSection;

/** The section's own settings (title, icon, columns, hidden…), which every kind of section shares. */
export function getSectionObject(data: Data, section: WriteSection): SectionObject | undefined {
	if (section.kind === "summary") return data.summary;
	if (section.kind === "builtin") return data.sections[section.id as SectionType];
	return data.customSections.find((custom) => custom.id === section.id);
}

export function findEntry(data: Data, sectionId: string, entryId: string): Entry | undefined {
	const section = resolveSection(data, sectionId);
	return section ? getEntries(data, section).find((entry) => entry.id === entryId) : undefined;
}

/** The field an entry needs before it prints, matching the PDF renderer's filter. Others always print. */
const PRIMARY_FIELD: Partial<Record<CustomSectionType, string>> = {
	profiles: "network",
	experience: "company",
	education: "school",
	projects: "name",
	skills: "name",
	languages: "language",
	interests: "name",
	awards: "title",
	certifications: "title",
	publications: "title",
	volunteer: "organization",
	references: "name",
};

export const getPrimaryField = (type: CustomSectionType) => PRIMARY_FIELD[type];

/** An entry without its primary field is a draft: it's kept, but not printed. */
export function isDraftEntry(type: CustomSectionType, entry: Entry): boolean {
	const field = PRIMARY_FIELD[type];
	if (!field) return false;
	const value = (entry as Record<string, unknown>)[field];
	return typeof value !== "string" || !value.trim();
}

const website = () => ({ url: "", label: "", inlineLink: false });
const dates = () => ({ ...EMPTY_RESUME_DATES });

/** A new, empty entry of a type: the starting point for "+ Add" and for Add section's first draft. */
export function createEntry(type: CustomSectionType): Entry {
	const base = { id: generateId(), hidden: false };
	const fields: Record<CustomSectionType, Record<string, unknown>> = {
		profiles: { icon: "", iconColor: "", network: "", username: "", website: website() },
		experience: {
			company: "",
			position: "",
			location: "",
			period: "",
			dates: dates(),
			website: website(),
			description: "",
			roles: [],
		},
		education: {
			school: "",
			degree: "",
			area: "",
			grade: "",
			location: "",
			period: "",
			dates: dates(),
			website: website(),
			description: "",
		},
		projects: { name: "", period: "", dates: dates(), website: website(), description: "" },
		skills: { icon: "", iconColor: "", name: "", proficiency: "", level: 0, keywords: [] },
		languages: { language: "", fluency: "", level: 0 },
		interests: { icon: "", iconColor: "", name: "", keywords: [] },
		awards: { title: "", awarder: "", date: "", dates: dates(), website: website(), description: "" },
		certifications: { title: "", issuer: "", date: "", dates: dates(), website: website(), description: "" },
		publications: { title: "", publisher: "", date: "", dates: dates(), website: website(), description: "" },
		volunteer: { organization: "", location: "", period: "", dates: dates(), website: website(), description: "" },
		references: { name: "", position: "", website: website(), phone: "", description: "" },
		summary: { content: "" },
		"cover-letter": { recipient: "", content: "" },
	};
	return { ...base, ...fields[type] } as Entry;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const join = (...parts: unknown[]) => parts.map(text).filter(Boolean).join(" · ");

/**
 * How an entry reads in the outline: a title and a line of details ("company · location · dates"). Dates come
 * from the legacy text, which is kept formatted from the structured dates.
 */
export function describeEntry(type: CustomSectionType, entry: Entry): { title: string; meta: string } {
	const e = entry as Record<string, unknown> & { website?: { label?: string }; keywords?: string[] };
	const keywords = (e.keywords ?? []).join(", ");

	switch (type) {
		case "experience": {
			const position = text(e.position);
			return { title: position || text(e.company), meta: join(position ? e.company : "", e.location, e.period) };
		}
		case "education":
			return {
				title: text(e.school),
				meta: join([text(e.degree), text(e.area)].filter(Boolean).join(", "), e.location, e.period),
			};
		case "projects":
			return { title: text(e.name), meta: join(e.period, e.website?.label) };
		case "skills":
			return { title: text(e.name), meta: join(e.proficiency, keywords) };
		case "languages":
			return { title: text(e.language), meta: join(e.fluency) };
		case "interests":
			return { title: text(e.name), meta: keywords };
		case "awards":
			return { title: text(e.title), meta: join(e.awarder, e.date) };
		case "certifications":
			return { title: text(e.title), meta: join(e.issuer, e.date) };
		case "publications":
			return { title: text(e.title), meta: join(e.publisher, e.date) };
		case "volunteer":
			return { title: text(e.organization), meta: join(e.location, e.period) };
		case "references":
			return { title: text(e.name), meta: join(e.position) };
		case "profiles":
			return { title: text(e.network), meta: join(e.username) };
		case "summary":
		case "cover-letter": {
			const body = stripHtml(String(e.content ?? "")).trim();
			return { title: body.length > 80 ? `${body.slice(0, 80)}…` : body, meta: "" };
		}
	}
}

/** Entries (and roles) whose dates came from text that couldn't be read exactly and still ask for a look. */
export function countEntriesToCheck(entries: readonly Entry[]): number {
	let count = 0;
	type WithDates = { dates?: { raw?: string }; roles?: readonly { dates?: { raw?: string } }[] };
	for (const entry of entries as readonly WithDates[]) {
		if (entry.dates?.raw !== undefined || entry.roles?.some((role) => role.dates?.raw !== undefined)) count += 1;
	}
	return count;
}

/** What an import brought in, as the editor shows it now: sections, their entries, and entries still to check. */
export function summarizeContent(data: Data): { sections: number; entries: number; toCheck: number } {
	const rows = getOutlineRows(data);
	let entries = 0;
	let toCheck = 0;
	for (const row of rows) {
		const section = resolveSection(data, row.id);
		if (!section || section.kind === "summary") continue;
		const items = getEntries(data, section);
		entries += items.length;
		toCheck += countEntriesToCheck(items);
	}
	return { sections: rows.length, entries, toCheck };
}

/** Sections that have something in them. The rest wait in Add section. Custom sections always count. */
export function isSectionInUse(data: Data, id: string, recentlyAdded: ReadonlySet<string> = new Set()): boolean {
	if (recentlyAdded.has(id)) return true;
	const section = resolveSection(data, id);
	if (!section) return false;
	if (section.kind === "summary") return Boolean(stripHtml(data.summary.content).trim());
	if (section.kind === "custom") return true;
	return getEntries(data, section).length > 0;
}

type LayoutColumn = "main" | "sidebar";

/** A row of the outline, in print order, with where it sits in the layout. */
export type OutlineRow = { id: string; page: number; column: LayoutColumn };

/**
 * The outline lists the sections in use in print order: page by page, the main column and then the sidebar.
 * Sections in use that no page places (rare) are listed last, as the last page's main column.
 */
export function getOutlineRows(data: Data, recentlyAdded?: ReadonlySet<string>): OutlineRow[] {
	const rows: OutlineRow[] = [];
	const placed = new Set<string>();

	data.metadata.layout.pages.forEach((page, pageIndex) => {
		for (const column of ["main", "sidebar"] as const) {
			for (const id of page[column]) {
				placed.add(id);
				if (isSectionInUse(data, id, recentlyAdded)) rows.push({ id, page: pageIndex, column });
			}
		}
	});

	const lastPage = Math.max(0, data.metadata.layout.pages.length - 1);
	const candidates = ["summary", ...BUILTIN_SECTION_TYPES, ...data.customSections.map((section) => section.id)];
	for (const id of candidates) {
		if (!placed.has(id) && isSectionInUse(data, id, recentlyAdded)) rows.push({ id, page: lastPage, column: "main" });
	}

	return rows;
}

function removeFromLayout(draft: WritableDraft<ResumeData>, id: string) {
	for (const page of draft.metadata.layout.pages) {
		page.main = page.main.filter((section) => section !== id);
		page.sidebar = page.sidebar.filter((section) => section !== id);
	}
}

/**
 * Moves a section to where another row sits: before it when moving up, after it when moving down. Rows in a
 * different page or column take the section with them, so dragging across the sidebar divider changes columns.
 */
export function moveSection(
	draft: WritableDraft<ResumeData>,
	id: string,
	target: OutlineRow,
	direction: "up" | "down",
) {
	if (id === target.id) return;
	removeFromLayout(draft, id);

	const page = draft.metadata.layout.pages[target.page];
	if (!page) return;
	const column = page[target.column];
	const index = column.indexOf(target.id);
	const insertAt = index === -1 ? column.length : direction === "down" ? index + 1 : index;
	column.splice(insertAt, 0, id);
}

/** Puts a section on the last page's main column unless a page already places it. */
function ensurePlaced(draft: WritableDraft<ResumeData>, id: string) {
	const pages = draft.metadata.layout.pages;
	if (pages.some((page) => page.main.includes(id) || page.sidebar.includes(id))) return;
	if (pages.length === 0) pages.push({ fullWidth: false, main: [], sidebar: [] });
	pages[pages.length - 1]?.main.push(id);
}

/**
 * Add section: shows the section, places it if needed and gives it one draft entry to fill in. Returns the
 * new entry's id (none for the summary, which is one rich text).
 */
export function addBuiltinSection(draft: WritableDraft<ResumeData>, type: "summary" | SectionType): string | null {
	ensurePlaced(draft, type);
	if (type === "summary") {
		draft.summary.hidden = false;
		return null;
	}

	const section = draft.sections[type];
	section.hidden = false;
	const entry = createEntry(type);
	(section.items as Entry[]).push(entry);
	return entry.id;
}

/** Add section → Custom section: a new section of a type, named after it, with one draft entry. */
export function addCustomSection(draft: WritableDraft<ResumeData>, type: CustomSectionType, title: string) {
	const entry = createEntry(type);
	const section = {
		id: generateId(),
		title,
		type,
		icon: "",
		columns: 1,
		hidden: false,
		showHeading: true,
		keepTogether: false,
		startOnNewPage: false,
		items: [entry],
	} as CustomSection;
	draft.customSections.push(section);
	ensurePlaced(draft, section.id);
	return { sectionId: section.id, entryId: entry.id };
}
