// Layout pages: which sections sit in Main or Sidebar on each page. Ports the web Layout editor
// (apps/web/src/routes/builder/$resumeId/-sidebar/right/sections/layout). Pure: no React.
import type { ResumeData, SectionType } from "@reactive-resume/schema/resume/data";
import type { WritableDraft } from "immer";

type Layout = ResumeData["metadata"]["layout"];
export type ColumnId = "main" | "sidebar";
export type Location = { page: number; column: ColumnId };
/** Where a dragged section lands: a column on a page and the index among that column's visible sections. */
export type Drop = Location & { index: number };

// A section shows in the editor only when it has visible content, as on the page.
export { isSectionVisible as isVisibleSection } from "@reactive-resume/pdf/filtering";

export function locate(layout: Layout, id: string): Location | null {
	for (const [page, value] of layout.pages.entries()) {
		if (value.main.includes(id)) return { page, column: "main" };
		if (value.sidebar.includes(id)) return { page, column: "sidebar" };
	}
	return null;
}

/**
 * Moves `id` to `to`. `to.index` counts only the visible sections of the target column (what the editor shows);
 * hidden ones keep their place relative to their neighbours. Returns false when nothing changed.
 */
export function moveSection(layout: WritableDraft<Layout>, id: string, to: Drop, visible: (id: string) => boolean) {
	const from = locate(layout, id);
	const target = layout.pages[to.page]?.[to.column];
	const source = from && layout.pages[from.page]?.[from.column];
	if (!source || !target) return false;
	if (source === target) {
		// Dropped back where it was: leave hidden neighbours alone too, so there is no empty undo step.
		const order = target.filter((item) => item !== id && visible(item));
		order.splice(to.index, 0, id);
		if (order.join("\n") === target.filter((item) => item === id || visible(item)).join("\n")) return false;
	}
	const before = JSON.stringify(layout.pages);
	source.splice(source.indexOf(id), 1);
	const shown = target.filter(visible);
	const anchor = shown[to.index];
	const position = anchor === undefined ? target.length : target.indexOf(anchor);
	target.splice(position, 0, id);
	return JSON.stringify(layout.pages) !== before;
}

/** Moves a section to the end of a column (the Move to menu). */
export function moveToEnd(layout: WritableDraft<Layout>, id: string, to: Location) {
	return moveSection(layout, id, { ...to, index: Number.POSITIVE_INFINITY }, () => true);
}

export function moveToNewPage(layout: WritableDraft<Layout>, id: string) {
	const from = locate(layout, id);
	const source = from && layout.pages[from.page]?.[from.column];
	if (!source) return;
	source.splice(source.indexOf(id), 1);
	layout.pages.push({ fullWidth: false, main: [id], sidebar: [] });
}

/** Full width hides the sidebar, so its sections move into Main. */
export function setFullWidth(layout: WritableDraft<Layout>, page: number, fullWidth: boolean) {
	const value = layout.pages[page];
	if (!value) return;
	value.fullWidth = fullWidth;
	if (fullWidth) {
		value.main.push(...value.sidebar);
		value.sidebar = [];
	}
}

export function addPage(layout: WritableDraft<Layout>) {
	layout.pages.push({ fullWidth: false, main: [], sidebar: [] });
}

/** Deleting a page moves its sections to the first remaining page. The last page cannot be deleted. */
export function deletePage(layout: WritableDraft<Layout>, page: number) {
	const removed = layout.pages[page];
	const target = layout.pages[page === 0 ? 1 : 0];
	if (!removed || !target) return;
	target.main.push(...removed.main);
	// Full-width pages hide their sidebar, so its sections join main, as setFullWidth does.
	(target.fullWidth ? target.main : target.sidebar).push(...removed.sidebar);
	layout.pages.splice(page, 1);
}

export type BreakField = "keepTogether" | "startOnNewPage";

export function readBreak(data: ResumeData, id: string, field: BreakField): boolean {
	if (id === "summary") return data.summary[field];
	if (id in data.sections) return data.sections[id as SectionType][field];
	return data.customSections.find((section) => section.id === id)?.[field] ?? false;
}

export function toggleBreak(data: WritableDraft<ResumeData>, id: string, field: BreakField) {
	if (id === "summary") data.summary[field] = !data.summary[field];
	else if (id in data.sections) {
		const section = data.sections[id as SectionType];
		section[field] = !section[field];
	} else {
		const custom = data.customSections.find((section) => section.id === id);
		if (custom) custom[field] = !custom[field];
	}
}

/** Window rectangles measured when a drag starts. Rows are the visible sections, excluding the one being dragged. */
export type DropZone = Location & {
	top: number;
	bottom: number;
	rows: { top: number; bottom: number }[];
};

/**
 * The drop under a finger at window `y`: the zone that contains it (else the nearest), and the index of the first
 * row whose middle is below the finger.
 */
export function dropAt(zones: DropZone[], y: number): Drop | null {
	let best: DropZone | null = null;
	let distance = Number.POSITIVE_INFINITY;
	for (const zone of zones) {
		const gap = y < zone.top ? zone.top - y : y > zone.bottom ? y - zone.bottom : 0;
		if (gap < distance) {
			best = zone;
			distance = gap;
		}
	}
	if (!best) return null;
	const index = best.rows.filter((row) => (row.top + row.bottom) / 2 < y).length;
	return { page: best.page, column: best.column, index };
}
