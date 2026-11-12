import type { EditorSelection } from "./store";
import type { PageMap, PageMapNode } from "@reactive-resume/pdf/page-map";
import type { SectionType } from "@reactive-resume/schema/resume/data";
import type { MouseEvent } from "react";
import { Trans } from "@lingui/react/macro";
import { cn } from "@reactive-resume/utils/style";
import { isSameSelection, useEditorStore } from "./store";
import { useEditorMode } from "./use-editor-mode";
import { describeEntry, findEntry, getSectionObject, resolveSection } from "./write/model";
import { useCurrentBuilderResumeSelector } from "@/features/resume/builder/draft";
import { getSectionTitle } from "@/libs/resume/section";

type PageOverlayProps = {
	pageIndex: number;
	pageMap: PageMap | undefined;
	onSelect: (selection: EditorSelection) => void;
};

const toSelection = (node: PageMapNode): EditorSelection => {
	if (node.kind === "item") return { kind: "item", sectionId: node.sectionId, itemId: node.itemId };
	if (node.kind === "section") return { kind: "section", sectionId: node.sectionId };
	return { kind: "header" };
};

const readSelection = (element: HTMLElement): EditorSelection | null => {
	const { kind, sectionId, itemId } = element.dataset;
	if (kind === "header") return { kind: "header" };
	if (kind === "section" && sectionId) return { kind: "section", sectionId };
	if (kind === "item" && sectionId && itemId) return { kind: "item", sectionId, itemId };
	return null;
};

/**
 * Pointer layer over one rendered page: hovering a block outlines it, clicking opens it in the panel, and what the
 * panel has open is outlined in accent and named on a tag: an entry, or a whole section while its list is open.
 */
export function PageOverlay({ pageIndex, pageMap, onSelect }: PageOverlayProps) {
	const selection = useEditorStore((state) => state.selection);
	const styleHighlight = useEditorStore((state) => state.styleHighlight);
	// Only Write edits the entry: Design and Check keep the outline but say nothing about editing.
	const [mode] = useEditorMode();
	const page = pageMap?.pages[pageIndex];
	if (!pageMap || !page || page.width <= 0 || page.height <= 0) return null;

	const nodes = pageMap.nodes.filter((node) => node.page === pageIndex);
	// A section with entries on this page is selected through its entries; only entry-less sections
	// (the summary, for example) are blocks of their own.
	const sectionsWithItems = new Set(nodes.flatMap((node) => (node.kind === "item" ? [node.sectionId] : [])));
	const blocks = nodes.filter((node) => node.kind !== "section" || !sectionsWithItems.has(node.sectionId));
	const selected = blocks.filter((node) => isSameSelection(selection, toSelection(node)));
	// A section's list is open: the whole section is outlined, entries and all (they stay clickable inside it).
	const openSection =
		selection?.kind === "section" && selected.length === 0
			? nodes.filter((node) => node.kind === "section" && node.sectionId === selection.sectionId)
			: [];

	// Custom Styles: each node the rule under the cursor matches, outlined as the closest block the page map knows
	// (a field inside an entry lights up its entry).
	const highlighted = new Set(
		styleHighlight.flatMap((key) => {
			const owner = nodes
				.filter((node) => key === node.key || key.startsWith(`${node.key}/`))
				.sort((left, right) => right.key.length - left.key.length)[0];
			return owner ? [owner] : [];
		}),
	);

	const boxOf = (node: PageMapNode) => ({
		left: `calc(${(node.x / page.width) * 100}% - 4px)`,
		top: `calc(${(node.y / page.height) * 100}% - 3px)`,
		width: `calc(${(node.width / page.width) * 100}% + 8px)`,
		height: `calc(${(node.height / page.height) * 100}% + 6px)`,
	});

	const handleClick = (event: MouseEvent<HTMLDivElement>) => {
		const target = (event.target as HTMLElement).closest<HTMLElement>("[data-kind]");
		const next = target ? readSelection(target) : null;
		if (next) onSelect(next);
	};

	return (
		<>
			{/* A pointer shortcut, hidden from assistive tech: the panel selects the same entries by keyboard. */}
			<div aria-hidden="true" data-slot="page-overlay" className="absolute inset-0" onClick={handleClick}>
				{blocks.map((node) => (
					<div
						key={`${node.key}:${node.y}`}
						data-kind={node.kind}
						data-section-id={node.kind === "header" ? undefined : node.sectionId}
						data-item-id={node.kind === "item" ? node.itemId : undefined}
						className={cn(
							"absolute cursor-pointer rounded-md transition-[outline-color] duration-quick outline-solid",
							selected.includes(node)
								? "outline-2 outline-accent"
								: "outline-1 outline-transparent hover:outline-line-2",
						)}
						style={boxOf(node)}
					/>
				))}
				{openSection.map((node) => (
					<div
						key={`section:${node.key}:${node.y}`}
						className="pointer-events-none absolute rounded-md outline-2 outline-accent"
						style={boxOf(node)}
					/>
				))}
				{[...highlighted].map((node) => (
					<div
						key={`style:${node.key}:${node.y}`}
						data-slot="style-highlight"
						className="pointer-events-none absolute rounded-lg bg-[oklch(0.5_0.1_150/0.08)] outline-[1.5px] outline-accent transition-opacity duration-quick ease-enter outline-dashed starting:opacity-0"
						style={boxOf(node)}
					/>
				))}
			</div>
			{/* The tag is in the app's language and direction, not the resume's. */}
			{mode === "write" &&
				[...selected, ...openSection].map((node) => (
					<div
						key={`tag:${node.key}:${node.y}`}
						className="pointer-events-none absolute max-sm:hidden"
						style={boxOf(node)}
					>
						{/* On the outline's top edge, at its end. */}
						<span
							aria-hidden="true"
							className="absolute -end-0.5 -top-2.5 h-5 max-w-full truncate rounded-xs bg-accent px-1.5 text-[11px]/5 font-medium whitespace-nowrap text-on-accent"
						>
							<SelectionName node={node} />
						</span>
					</div>
				))}
		</>
	);
}

/** What a tag says: the section, and for an entry its name after it ("Experience · Northwind Labs"). */
function SelectionName({ node }: { node: PageMapNode }) {
	const name = useCurrentBuilderResumeSelector((resume) => {
		if (node.kind === "header") return "";
		const section = resolveSection(resume.data, node.sectionId);
		if (!section) return "";
		const title =
			getSectionObject(resume.data, section)?.title.trim() ||
			getSectionTitle(section.kind === "custom" ? section.type : (section.id as SectionType | "summary"));
		if (node.kind !== "item") return title;
		const entry = findEntry(resume.data, node.sectionId, node.itemId);
		const entryTitle = entry ? describeEntry(section.type, entry).title : "";
		return entryTitle ? `${title} · ${entryTitle}` : title;
	});
	return name || <Trans>Basics</Trans>;
}
