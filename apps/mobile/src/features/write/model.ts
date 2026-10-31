import type { MoveTarget } from "@reactive-resume/resume/move-item";
// Write's data operations, ported from apps/web/src/features/resume/editor/write/model.ts; moving entries is shared
// through @reactive-resume/resume/move-item. Pure: no React, no Lingui, so Design, Check and Node checks can use it.
import type {
	CustomSection,
	CustomSectionItem,
	CustomSectionType,
	LayoutPage,
	ResumeData,
	SectionItem,
	SectionType,
} from "@reactive-resume/schema/resume/data";
import type { ResumeDates } from "@reactive-resume/schema/resume/dates";
import type { WritableDraft } from "immer";
import { createEntry } from "@reactive-resume/resume/entries";
import { moveItem as moveResumeItem } from "@reactive-resume/resume/move-item";
import { sectionTypeSchema } from "@reactive-resume/schema/resume/data";
import { hasUnreadableDateText } from "@reactive-resume/schema/resume/dates";
import { generateId, stripHtml } from "@reactive-resume/utils/string";

type Data = ResumeData | WritableDraft<ResumeData>;

/** One entry of any section. Each section type narrows it in its own field set. */
export type Entry = CustomSectionItem;

/** A section of the outline: the summary, a built-in section (keyed by type) or a custom section (by id). */
export type WriteSection = { id: string; kind: "summary" | "builtin" | "custom"; type: CustomSectionType };

export type LayoutColumn = "main" | "sidebar";

/**
 * A store selector over the open resume's data. Zustand re-renders when the selected value changes by `Object.is`,
 * so `select` must return stored objects or primitives (never a fresh object) and `fallback` must be a constant.
 */
export const readData =
	<T>(select: (data: ResumeData) => T, fallback: T) =>
	(state: { data: ResumeData | null }) =>
		state.data ? select(state.data) : fallback;

export const NO_PAGES: readonly LayoutPage[] = [];
export const selectPages = (data: ResumeData): readonly LayoutPage[] => data.metadata.layout.pages;

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

export function getSectionType(data: Data, id: string): CustomSectionType | undefined {
	if (id === "summary") return "summary";
	if (isBuiltinSectionType(id)) return id;
	return data.customSections.find((section) => section.id === id)?.type;
}

export function resolveSection(data: Data, id: string): WriteSection | null {
	const type = getSectionType(data, id);
	return type ? { id, kind: getSectionKind(id), type } : null;
}

export function getEntries(data: Data, section: WriteSection): Entry[] {
	if (section.kind === "builtin") return data.sections[section.id as SectionType].items as Entry[];
	if (section.kind === "custom")
		return (data.customSections.find((custom) => custom.id === section.id)?.items ?? []) as Entry[];
	return [];
}

type SectionObject = ResumeData["summary"] | ResumeData["sections"][SectionType] | CustomSection;

export function getSectionObject(data: Data, section: WriteSection): SectionObject | undefined {
	if (section.kind === "summary") return data.summary;
	if (section.kind === "builtin") return data.sections[section.id as SectionType];
	return data.customSections.find((custom) => custom.id === section.id);
}

export function isSectionHidden(data: Data, id: string): boolean {
	const section = resolveSection(data, id);
	return section ? (getSectionObject(data, section)?.hidden ?? false) : false;
}

export function findEntry(data: Data, sectionId: string, entryId: string): Entry | undefined {
	const section = resolveSection(data, sectionId);
	return section ? getEntries(data, section).find((entry) => entry.id === entryId) : undefined;
}

/** The field an entry needs before it prints, matching the PDF renderer's filter. Others always print. */
export const PRIMARY_FIELD: Partial<Record<CustomSectionType, string>> = {
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

/** An entry without its primary field is a draft: it's kept, but not printed. */
export function isDraftEntry(type: CustomSectionType, entry: Entry): boolean {
	const field = PRIMARY_FIELD[type];
	if (!field) return false;
	const value = (entry as Record<string, unknown>)[field];
	return typeof value !== "string" || !value.trim();
}

export { createEntry } from "@reactive-resume/resume/entries";

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const join = (...parts: unknown[]) => parts.map(text).filter(Boolean).join(" · ");

/** How an entry reads in the outline: a title and "company · location · dates". */
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

/** Entries (and roles) with nonempty custom date text that could not be read. */
export function countEntriesToCheck(entries: readonly Entry[]): number {
	type WithDates = { dates?: ResumeDates; roles?: readonly { dates?: ResumeDates }[] };
	return (entries as readonly WithDates[]).filter(
		(entry) => hasUnreadableDateText(entry.dates) || entry.roles?.some((role) => hasUnreadableDateText(role.dates)),
	).length;
}

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

export type OutlineRow = { id: string; page: number; column: LayoutColumn; hidden: boolean };

/** Sections in use, in print order: page by page, main column then sidebar; unplaced ones last. */
export function getOutlineRows(data: Data, recentlyAdded?: ReadonlySet<string>): OutlineRow[] {
	const rows: OutlineRow[] = [];
	const placed = new Set<string>();

	data.metadata.layout.pages.forEach((page, pageIndex) => {
		for (const column of ["main", "sidebar"] as const) {
			for (const id of page[column]) {
				placed.add(id);
				if (isSectionInUse(data, id, recentlyAdded)) {
					rows.push({ id, page: pageIndex, column, hidden: isSectionHidden(data, id) });
				}
			}
		}
	});

	const lastPage = Math.max(0, data.metadata.layout.pages.length - 1);
	const candidates = ["summary", ...BUILTIN_SECTION_TYPES, ...data.customSections.map((section) => section.id)];
	for (const id of candidates) {
		if (!placed.has(id) && isSectionInUse(data, id, recentlyAdded)) {
			rows.push({ id, page: lastPage, column: "main", hidden: isSectionHidden(data, id) });
		}
	}

	return rows;
}

function removeFromLayout(draft: WritableDraft<ResumeData>, id: string) {
	for (const page of draft.metadata.layout.pages) {
		page.main = page.main.filter((section) => section !== id);
		page.sidebar = page.sidebar.filter((section) => section !== id);
	}
}

/** Moves a section before (up) or after (down) another row; crossing a page or the sidebar changes column. */
export function moveSection(
	draft: WritableDraft<ResumeData>,
	id: string,
	target: Pick<OutlineRow, "id" | "page" | "column">,
	direction: "up" | "down",
) {
	if (id === target.id) return;
	removeFromLayout(draft, id);
	const column = draft.metadata.layout.pages[target.page]?.[target.column];
	if (!column) return;
	const index = column.indexOf(target.id);
	column.splice(index === -1 ? column.length : direction === "down" ? index + 1 : index, 0, id);
}

/** Section sheet → Move to…: puts a section at the start of a page's column, or on a new last page. */
export function placeSection(
	draft: WritableDraft<ResumeData>,
	id: string,
	target: { page: number; column: LayoutColumn } | "new-page",
) {
	if (target !== "new-page" && !draft.metadata.layout.pages[target.page]) return;
	removeFromLayout(draft, id);
	if (target === "new-page") draft.metadata.layout.pages.push({ fullWidth: false, main: [id], sidebar: [] });
	else draft.metadata.layout.pages[target.page]?.[target.column].unshift(id);
}

/** Where a section sits in the layout, for Move to…'s checked choice. */
export function findPlacement(pages: readonly LayoutPage[], id: string): { page: number; column: LayoutColumn } | null {
	for (const [page, layout] of pages.entries()) {
		if (layout.main.includes(id)) return { page, column: "main" };
		if (layout.sidebar.includes(id)) return { page, column: "sidebar" };
	}
	return null;
}

function ensurePlaced(draft: WritableDraft<ResumeData>, id: string) {
	const pages = draft.metadata.layout.pages;
	if (pages.some((page) => page.main.includes(id) || page.sidebar.includes(id))) return;
	if (pages.length === 0) pages.push({ fullWidth: false, main: [], sidebar: [] });
	pages[pages.length - 1]?.main.push(id);
}

/** Add section: shows and places the section and gives it one draft entry. Returns that entry's id. */
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

export function addCustomSection(draft: WritableDraft<ResumeData>, type: CustomSectionType, title: string) {
	const entry = createEntry(type);
	const section = makeCustomSection(generateId(), type, title, entry as SectionItem);
	draft.customSections.push(section as WritableDraft<CustomSection>);
	ensurePlaced(draft, section.id);
	return { sectionId: section.id, entryId: entry.id };
}

/** Removes a custom section and its place in the layout (Delete section). */
export function deleteCustomSection(draft: WritableDraft<ResumeData>, id: string) {
	draft.customSections = draft.customSections.filter((custom) => custom.id !== id);
	removeFromLayout(draft, id);
}

/** Moves an entry within its section to `to` (clamped). */
export function moveEntry(draft: WritableDraft<ResumeData>, section: WriteSection, entryId: string, to: number) {
	const entries = getEntries(draft, section);
	const from = entries.findIndex((entry) => entry.id === entryId);
	if (from === -1) return;
	const [entry] = entries.splice(from, 1);
	if (entry) entries.splice(Math.max(0, Math.min(to, entries.length)), 0, entry);
}

// ---------------------------------------------------------------------------------------------------------------
// The phone outline is one flat sortable list: dividers, section rows and, under open sections, entry rows.
// ---------------------------------------------------------------------------------------------------------------

export type FlatRow =
	| { kind: "divider"; key: string; label: "page" | "sidebar" | "hidden"; page: number; column: LayoutColumn }
	| { kind: "section"; key: string; row: OutlineRow }
	| { kind: "entry"; key: string; sectionId: string; entryId: string; index: number; count: number }
	| { kind: "add"; key: string; sectionId: string };

/** Flattens the outline. Open sections list their entries and an Add row (the summary has no entries). */
export function flattenOutline(data: Data, rows: readonly OutlineRow[], open: ReadonlySet<string>): FlatRow[] {
	const flat: FlatRow[] = [];
	const active = rows.filter((row) => !row.hidden);
	const hidden = rows.filter((row) => row.hidden);
	const multiPage = active.some((row) => row.page > 0);

	const pushSection = (row: OutlineRow) => {
		flat.push({ kind: "section", key: `s:${row.id}`, row });
		const section = resolveSection(data, row.id);
		if (!section || section.kind === "summary" || !open.has(row.id)) return;
		const entries = getEntries(data, section);
		entries.forEach((entry, index) =>
			flat.push({
				kind: "entry",
				key: `e:${entry.id}`,
				sectionId: row.id,
				entryId: entry.id,
				index,
				count: entries.length,
			}),
		);
		flat.push({ kind: "add", key: `a:${row.id}`, sectionId: row.id });
	};

	active.forEach((row, index) => {
		const previous = active[index - 1];
		const newPage = multiPage && row.page !== previous?.page;
		if (newPage) flat.push({ kind: "divider", key: `p:${row.page}`, label: "page", page: row.page, column: "main" });
		if (row.column === "sidebar" && (previous?.column !== "sidebar" || newPage))
			flat.push({ kind: "divider", key: `b:${row.page}`, label: "sidebar", page: row.page, column: "sidebar" });
		pushSection(row);
	});

	if (hidden.length > 0) {
		flat.push({ kind: "divider", key: "hidden", label: "hidden", page: -1, column: "main" });
		for (const row of hidden) pushSection(row);
	}
	return flat;
}

export type OutlineDrop =
	| { kind: "section"; id: string; target: { page: number; column: LayoutColumn; after: string | null } }
	| { kind: "entry"; sectionId: string; entryId: string; to: number }
	| null;

/**
 * What dropping a dragged row means, from the list in its new order. A section lands after the section above it
 * (or at the start of the column a divider above it opens); an entry stays in its own section, clamped to its
 * first or last place when dropped outside it. Drops into the hidden group do nothing.
 */
export function resolveDrop(reordered: readonly FlatRow[], to: number): OutlineDrop {
	const moved = reordered[to];
	if (!moved) return null;

	if (moved.kind === "section") {
		for (let index = to - 1; index >= 0; index--) {
			const above = reordered[index];
			if (!above) continue;
			if (above.kind === "divider") {
				if (above.label === "hidden") return null;
				return { kind: "section", id: moved.row.id, target: { page: above.page, column: above.column, after: null } };
			}
			if (above.kind === "section") {
				if (above.row.hidden) return null;
				const { page, column, id } = above.row;
				return { kind: "section", id: moved.row.id, target: { page, column, after: id } };
			}
		}
		return { kind: "section", id: moved.row.id, target: { page: 0, column: "main", after: null } };
	}

	if (moved.kind === "entry") {
		const own = (row: FlatRow | undefined) => row?.kind === "entry" && row.sectionId === moved.sectionId;
		const above = reordered[to - 1];
		if (own(above) || (above?.kind === "section" && above.row.id === moved.sectionId)) {
			let position = 0;
			for (let index = 0; index < to; index++) if (own(reordered[index])) position++;
			return { kind: "entry", sectionId: moved.sectionId, entryId: moved.entryId, to: position };
		}
		// Outside its section: snap back to the nearer end.
		const first = reordered.findIndex((row) => own(row) || (row.kind === "add" && row.sectionId === moved.sectionId));
		return {
			kind: "entry",
			sectionId: moved.sectionId,
			entryId: moved.entryId,
			to: first !== -1 && to > first ? moved.count - 1 : 0,
		};
	}
	return null;
}

/** Applies a section drop to the layout. */
export function applySectionDrop(draft: WritableDraft<ResumeData>, drop: Extract<OutlineDrop, { kind: "section" }>) {
	const { id, target } = drop;
	if (target.after === id || !draft.metadata.layout.pages[target.page]) return;
	// Removing replaces the column arrays, so look the column up afterwards.
	removeFromLayout(draft, id);
	const column = draft.metadata.layout.pages[target.page]?.[target.column];
	column?.splice(target.after ? column.indexOf(target.after) + 1 : 0, 0, id);
}

// ---------------------------------------------------------------------------------------------------------------
// Entry options → Move to…
// ---------------------------------------------------------------------------------------------------------------

/** Sections of the same type on each page an entry can move to. Titles are resolved by the caller. */
export function getCompatibleMoveTargets(data: Data, type: CustomSectionType, sourceSectionId: string) {
	return data.metadata.layout.pages.map((page, pageIndex) => ({
		pageIndex,
		sectionIds: [...page.main, ...page.sidebar].filter(
			(id) =>
				id !== sourceSectionId &&
				(id === type || data.customSections.some((custom) => custom.id === id && custom.type === type)),
		),
	}));
}

function makeCustomSection(id: string, type: CustomSectionType, title: string, item: SectionItem): CustomSection {
	return {
		id,
		type,
		title,
		icon: "",
		columns: 1,
		hidden: false,
		showHeading: true,
		keepTogether: false,
		startOnNewPage: false,
		items: [item as never],
	} as CustomSection;
}

/** Moves an entry atomically, then removes only a custom source section emptied by that move. */
export const moveItem = (draft: WritableDraft<ResumeData>, section: WriteSection, itemId: string, target: MoveTarget) =>
	moveResumeItem(draft, {
		itemId,
		type: section.type,
		customSectionId: section.kind === "custom" ? section.id : undefined,
		target,
	});
