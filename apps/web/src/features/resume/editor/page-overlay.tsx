import type { EditorSelection } from "./store";
import type { PageMap, PageMapNode } from "@reactive-resume/pdf/page-map";
import type { MouseEvent } from "react";
import { Trans } from "@lingui/react/macro";
import { entryHeaderOf } from "@reactive-resume/schema/resume/data";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { isSameSelection, useEditorStore } from "./store";
import { getSectionType } from "./write/model";
import { useCurrentBuilderResumeSelector, useUpdateResumeData } from "@/features/resume/builder/draft";

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
 * Pointer layer over one rendered page: hovering a block tints it, clicking selects its entry, and the
 * selected block gets an accent outline with an "Editing" tag. On an Experience or Education entry the tag
 * also offers "Swap rows", the Design panel's row order.
 */
export function PageOverlay({ pageIndex, pageMap, onSelect }: PageOverlayProps) {
	const selection = useEditorStore((state) => state.selection);
	const styleHighlight = useEditorStore((state) => state.styleHighlight);
	const updateResumeData = useUpdateResumeData();
	const swappable = useCurrentBuilderResumeSelector((resume) => {
		if (resume.isLocked || selection?.kind !== "item") return false;
		const type = getSectionType(resume.data, selection.sectionId);
		return type === "experience" || type === "education";
	});
	const page = pageMap?.pages[pageIndex];
	if (!pageMap || !page || page.width <= 0 || page.height <= 0) return null;

	const nodes = pageMap.nodes.filter((node) => node.page === pageIndex);
	// A section with entries on this page is selected through its entries; only entry-less sections
	// (the summary, for example) are blocks of their own.
	const sectionsWithItems = new Set(nodes.flatMap((node) => (node.kind === "item" ? [node.sectionId] : [])));
	const blocks = nodes.filter((node) => node.kind !== "section" || !sectionsWithItems.has(node.sectionId));
	const selected = blocks.filter((node) => isSameSelection(selection, toSelection(node)));

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

	const swapRows = () =>
		updateResumeData(
			(draft) => {
				const entry = entryHeaderOf(draft.metadata.design);
				draft.metadata.design.entry = { ...entry, lead: entry.lead === "role" ? "organization" : "role" };
			},
			{ newStep: true },
		);

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
							"absolute cursor-pointer rounded-lg outline-[1.5px] transition-[background-color,outline-color] duration-quick outline-solid hover:bg-[oklch(0.5_0.1_150/0.06)]",
							selected.includes(node) ? "outline-accent" : "outline-transparent",
						)}
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
			{/* The tag sits outside the hidden layer so its button is reachable; clicks elsewhere on it fall through. */}
			{selected.map((node) => (
				<div
					key={`tag:${node.key}:${node.y}`}
					className="pointer-events-none absolute max-sm:hidden"
					style={boxOf(node)}
				>
					<div className="absolute start-1 -top-2 flex gap-1 text-[8px] leading-3 font-semibold">
						<span aria-hidden="true" className="rounded-md bg-accent px-1 text-on-accent">
							<Trans>Editing</Trans>
						</span>
						{swappable && (
							<button
								type="button"
								onClick={swapRows}
								// The canvas reads a press outside an entry as "tapped the page" and closes the tablet drawer.
								onPointerDown={(event) => event.stopPropagation()}
								className="pointer-events-auto flex cursor-pointer items-center gap-0.5 rounded-md bg-raised px-1 text-accent-text ring-1 ring-accent transition-colors duration-quick ring-inset hover:bg-accent-soft"
							>
								<Icon name="arrows-down-up" size={9} />
								<Trans>Swap rows</Trans>
							</button>
						)}
					</div>
				</div>
			))}
		</>
	);
}
