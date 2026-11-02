import type { ResumeData } from "@reactive-resume/schema/resume/data";

type PageLayout = ResumeData["metadata"]["layout"]["pages"][number];

/** Where a rendered section sits: the page map's section boxes (0-based physical pages). */
export type RenderedSection = { kind: string; sectionId?: string; page: number };

export type SpillingSections = { main: string[]; sidebar: string[] };

/**
 * Sections to move onto a new page so the content stops spilling past the authored pages: those of the last page that
 * start past it on the rendered page, else the last one that runs across the break (unless it's all its column holds).
 * Each keeps its column. Null when nothing can move.
 */
export function spillingSections(
	pages: readonly PageLayout[],
	rendered: readonly RenderedSection[] | undefined,
): SpillingSections | null {
	const last = pages.at(-1);
	if (!last || !rendered) return null;
	const authored = pages.length;
	const starts = new Map<string, number>();
	const spills = new Set<string>();
	for (const node of rendered) {
		if (node.kind !== "section" || !node.sectionId) continue;
		starts.set(node.sectionId, Math.min(starts.get(node.sectionId) ?? node.page, node.page));
		if (node.page >= authored) spills.add(node.sectionId);
	}
	const starting = (id: string) => (starts.get(id) ?? -1) >= authored;
	const crossing = (ids: readonly string[]) => {
		const id = ids.findLast((section) => spills.has(section));
		return id && ids.length > 1 ? [id] : [];
	};
	let main = last.main.filter(starting);
	let sidebar = last.sidebar.filter(starting);
	if (main.length === 0 && sidebar.length === 0) {
		main = crossing(last.main);
		if (main.length === 0) sidebar = crossing(last.sidebar);
	}
	return main.length + sidebar.length > 0 ? { main, sidebar } : null;
}

/** Adds a page after the last one and moves `moving` onto it, in place (safe inside an immer draft). */
export function addPageWith(pages: PageLayout[], moving: SpillingSections) {
	const last = pages.at(-1);
	if (!last) return;
	last.main = last.main.filter((id) => !moving.main.includes(id));
	last.sidebar = last.sidebar.filter((id) => !moving.sidebar.includes(id));
	pages.push({ fullWidth: last.fullWidth, main: [...moving.main], sidebar: [...moving.sidebar] });
}
