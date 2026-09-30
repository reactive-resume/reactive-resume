import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import type { ResumeData, SectionType } from "@reactive-resume/schema/resume/data";
import type { CSSProperties, HTMLAttributes, Ref } from "react";
import {
	closestCorners,
	DndContext,
	DragOverlay,
	PointerSensor,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useReducedMotion } from "motion/react";
import { useCallback, useId, useState } from "react";
import { match } from "ts-pattern";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Switch } from "@reactive-resume/ui/components/switch";
import { cn } from "@reactive-resume/utils/style";
import { resolveLayoutSectionTitle } from "./title";
import { filterVisibleLayoutSectionIds } from "./visibility";
import { useCurrentResume, useUpdateResumeData } from "@/features/resume/builder/draft";
import { DRAG_SETTLE } from "@/libs/motion";

type ColumnId = "main" | "sidebar";

const getColumnLabel = (columnId: ColumnId): string => {
	return match(columnId)
		.with("main", () =>
			t({
				comment: "Layout editor column label for the primary content area",
				message: "Main",
			}),
		)
		.with("sidebar", () =>
			t({
				comment: "Layout editor column label for the secondary sidebar area",
				message: "Sidebar",
			}),
		)
		.exhaustive();
};

type PageLocation = {
	pageIndex: number;
	columnId: ColumnId;
};

/**
 * Returns the page index and column that contains the given section id.
 * Format: "page-{index}-{columnId}" or "{sectionId}"
 */
const parseDroppableId = (id: string): PageLocation | null => {
	if (id.startsWith("page-")) {
		const parts = id.split("-");
		if (parts.length >= 3) {
			const pageIndex = Number.parseInt(parts[1] ?? "0", 10);
			const columnId = parts[2] as ColumnId;
			if (!Number.isNaN(pageIndex) && (columnId === "main" || columnId === "sidebar")) {
				return { pageIndex, columnId };
			}
		}
	}

	return null;
};

const createDroppableId = (pageIndex: number, columnId: ColumnId): string => {
	return `page-${pageIndex}-${columnId}`;
};

export function LayoutPages() {
	const [activeId, setActiveId] = useState<string | null>(null);
	const reduceMotion = useReducedMotion();

	const resume = useCurrentResume();
	const template = resume.data.metadata.template;
	const templateSidebarPosition = templateLayouts[template].sidebarSide ?? "none";

	const layout = resume.data.metadata.layout;
	const updateResumeData = useUpdateResumeData();

	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

	/**
	 * Returns the page index and column that contains the given section id.
	 */
	const findContainer = useCallback(
		(id: string): PageLocation | null => {
			// Check if it's a droppable ID
			const location = parseDroppableId(id);
			if (location) return location;

			// Search through all pages
			for (const [pageIndex, page] of layout.pages.entries()) {
				const mainSections = new Set(page.main);
				const sidebarSections = new Set(page.sidebar);
				if (mainSections.has(id)) return { pageIndex, columnId: "main" };
				if (sidebarSections.has(id)) return { pageIndex, columnId: "sidebar" };
			}

			return null;
		},
		[layout.pages],
	);

	const handleDragStart = useCallback((event: DragStartEvent) => setActiveId(String(event.active.id)), []);

	const handleDragEnd = useCallback(
		({ active, over }: DragEndEvent) => {
			setActiveId(null);
			if (!over) return;

			const activeIdStr = String(active.id);
			const overIdStr = String(over.id);

			if (activeIdStr === overIdStr) return;

			const activeLocation = findContainer(activeIdStr);
			const overLocation = parseDroppableId(overIdStr) ?? findContainer(overIdStr);

			if (!activeLocation || !overLocation) return;

			// Same location, reorder within column
			if (activeLocation.pageIndex === overLocation.pageIndex && activeLocation.columnId === overLocation.columnId) {
				const page = layout.pages[activeLocation.pageIndex];
				if (!page) return;
				const items = page[activeLocation.columnId];
				const oldIdx = items.indexOf(activeIdStr);
				let newIdx = items.indexOf(overIdStr);
				if (oldIdx === -1 || oldIdx === newIdx) return;
				if (newIdx === -1) newIdx = items.length - 1;

				updateResumeData((draft) => {
					const page = draft.metadata.layout.pages[activeLocation.pageIndex];
					if (!page) return;
					page[activeLocation.columnId] = arrayMove(page[activeLocation.columnId], oldIdx, newIdx);
				});
				return;
			}

			// Different location, move between columns/pages
			const fromPage = layout.pages[activeLocation.pageIndex];
			const toPage = layout.pages[overLocation.pageIndex];
			if (!fromPage || !toPage) return;
			const fromItems = fromPage[activeLocation.columnId];
			const toItems = toPage[overLocation.columnId];
			const fromIdx = fromItems.indexOf(activeIdStr);
			if (fromIdx === -1) return;

			let toIdx = toItems.indexOf(overIdStr);
			if (toIdx === -1) toIdx = toItems.length;

			updateResumeData((draft) => {
				const fromPageDraft = draft.metadata.layout.pages[activeLocation.pageIndex];
				const toPageDraft = draft.metadata.layout.pages[overLocation.pageIndex];
				if (!fromPageDraft || !toPageDraft) return;
				const from = fromPageDraft[activeLocation.columnId];
				const to = toPageDraft[overLocation.columnId];

				from.splice(fromIdx, 1);
				to.splice(Math.min(toIdx, to.length), 0, activeIdStr);
			});
		},
		[findContainer, layout.pages, updateResumeData],
	);

	const handleAddPage = useCallback(() => {
		updateResumeData((draft) => {
			draft.metadata.layout.pages.push({
				fullWidth: false,
				main: [],
				sidebar: [],
			});
		});
	}, [updateResumeData]);

	const handleDeletePage = useCallback(
		(pageIndex: number) => {
			if (layout.pages.length <= 1) return; // Don't allow deleting the last page

			updateResumeData((draft) => {
				const pageToDelete = draft.metadata.layout.pages[pageIndex];
				// Find the first available page that isn't being deleted
				const targetPageIndex = pageIndex === 0 ? 1 : 0;
				const targetPage = draft.metadata.layout.pages[targetPageIndex];
				if (!pageToDelete || !targetPage) return;

				// Move all sections from deleted page to target page
				targetPage.main.push(...pageToDelete.main);
				targetPage.sidebar.push(...pageToDelete.sidebar);

				draft.metadata.layout.pages.splice(pageIndex, 1);
			});
		},
		[layout.pages.length, updateResumeData],
	);

	const handleToggleFullWidth = useCallback(
		(pageIndex: number, fullWidth: boolean) => {
			updateResumeData((draft) => {
				const page = draft.metadata.layout.pages[pageIndex];
				if (!page) return;
				page.fullWidth = fullWidth;

				if (fullWidth) {
					// Move all sidebar sections to main
					page.main.push(...page.sidebar);
					page.sidebar = [];
				}
			});
		},
		[updateResumeData],
	);

	// Don't render until pages are initialized
	if (layout.pages.length === 0) {
		return null;
	}

	return (
		<DndContext
			id="builder-layout"
			sensors={sensors}
			collisionDetection={closestCorners}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
			onDragCancel={() => setActiveId(null)}
		>
			<div className="flex flex-col gap-4">
				{layout.pages.map((page, pageIndex) => (
					<PageContainer
						key={`page-${pageIndex}`}
						pageIndex={pageIndex}
						page={{
							...page,
							main: filterVisibleLayoutSectionIds(page.main, resume.data),
							sidebar: filterVisibleLayoutSectionIds(page.sidebar, resume.data),
						}}
						canDelete={layout.pages.length > 1}
						sidebarPosition={templateSidebarPosition}
						onDelete={handleDeletePage}
						onToggleFullWidth={handleToggleFullWidth}
					/>
				))}

				<Button variant="secondary" className="self-end" onClick={handleAddPage}>
					<Icon name="add" size={16} />
					<Trans>Add Page</Trans>
				</Button>
			</div>

			<DragOverlay dropAnimation={reduceMotion ? null : DRAG_SETTLE}>
				{activeId ? <LayoutItemContent id={activeId} isOverlay /> : null}
			</DragOverlay>
		</DndContext>
	);
}

type PageContainerProps = {
	pageIndex: number;
	page: { fullWidth: boolean; main: string[]; sidebar: string[] };
	canDelete: boolean;
	sidebarPosition: "left" | "right" | "none";
	onDelete: (pageIndex: number) => void;
	onToggleFullWidth: (pageIndex: number, fullWidth: boolean) => void;
};

function PageContainer({
	pageIndex,
	page,
	canDelete,
	sidebarPosition,
	onDelete,
	onToggleFullWidth,
}: PageContainerProps) {
	const isFullWidth = page.fullWidth;
	const fullWidthSwitchId = useId();

	return (
		<div className="space-y-3 rounded-md border border-dashed bg-bg/40">
			<div className="@container bg-sunken/50 px-4 py-3">
				<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 @max-[22rem]:grid-cols-1">
					<div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
						<span className="text-xs font-medium">
							<Trans comment="Layout editor page label with 1-based page number">Page {pageIndex + 1}</Trans>
						</span>

						<label htmlFor={fullWidthSwitchId} className="flex min-w-0 cursor-pointer items-center gap-2">
							<Switch
								id={fullWidthSwitchId}
								checked={page.fullWidth}
								onCheckedChange={(checked) => onToggleFullWidth(pageIndex, checked)}
							/>

							<span className="text-xs font-medium text-ink-3">
								<Trans comment="Layout editor toggle label that makes a page single-column">Full Width</Trans>
							</span>
						</label>
					</div>

					{canDelete && (
						<Button
							variant="ghost"
							onClick={() => onDelete(pageIndex)}
							className="size-auto gap-x-2.5 justify-self-end p-0!"
						>
							<Icon name="delete" size={16} />
							<Trans>Delete Page</Trans>
						</Button>
					)}
				</div>
			</div>

			<div
				className={cn(
					"grid w-full gap-x-4 gap-y-2 p-4 pt-0 font-medium @md:grid-cols-2",
					sidebarPosition === "none" && "@md:grid-cols-1",
				)}
			>
				<LayoutColumn
					pageIndex={pageIndex}
					columnId="main"
					items={page.main}
					disabled={false}
					className={cn(sidebarPosition === "left" ? "order-2" : "order-1")}
				/>

				{!isFullWidth && (
					<LayoutColumn
						pageIndex={pageIndex}
						columnId="sidebar"
						items={page.sidebar}
						hideLabel={sidebarPosition === "none"}
						className={cn(sidebarPosition === "left" ? "order-1" : "order-2")}
					/>
				)}
			</div>
		</div>
	);
}

type LayoutColumnProps = {
	pageIndex: number;
	columnId: ColumnId;
	items: string[];
	hideLabel?: boolean;
	disabled?: boolean;
	className?: string;
};

function LayoutColumn({
	pageIndex,
	columnId,
	items,
	hideLabel = false,
	disabled = false,
	className,
}: LayoutColumnProps) {
	const droppableId = createDroppableId(pageIndex, columnId);
	const { setNodeRef, isOver } = useDroppable({ id: droppableId, disabled });

	return (
		<SortableContext id={droppableId} items={items} strategy={verticalListSortingStrategy}>
			<div className={cn("space-y-1.5", disabled && "opacity-50", className)}>
				{!hideLabel && <div className="ps-4 text-xs font-medium @md:row-start-1">{getColumnLabel(columnId)}</div>}

				<div
					ref={setNodeRef}
					className={cn(
						"space-y-2.5 rounded-md border border-dashed p-3 pb-8 transition-colors",
						isOver && !disabled ? "border-accent/60 bg-accent/5" : "bg-bg/40",
					)}
				>
					{items.map((id) => (
						<SortableLayoutItem key={id} id={id} pageIndex={pageIndex} columnId={columnId} />
					))}

					{items.length === 0 && (
						<div className="rounded-md border border-dashed p-4 text-xs font-medium text-ink-3">
							<Trans>Drag and drop sections here to move them between columns</Trans>
						</div>
					)}
				</div>
			</div>
		</SortableContext>
	);
}

type SortableLayoutItemProps = {
	id: string;
	pageIndex: number;
	columnId: ColumnId;
};

function SortableLayoutItem({ id, pageIndex, columnId }: SortableLayoutItemProps) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id,
		transition: DRAG_SETTLE,
	});

	const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };

	return (
		<LayoutItemContent
			ref={setNodeRef}
			id={id}
			pageIndex={pageIndex}
			columnId={columnId}
			style={style}
			isDragging={isDragging}
			{...attributes}
			{...listeners}
		/>
	);
}

type MoveToSubmenuProps = {
	id: string;
	pageIndex: number;
	columnId: ColumnId;
};

/**
 * "Move to" submenu that mirrors the left-panel item menu but works at the
 * section level: it splices the section out of its current page/column and
 * pushes it onto the chosen target (or a brand new page).
 */
function MoveToSubmenu({ id, pageIndex, columnId }: MoveToSubmenuProps) {
	const resume = useCurrentResume();
	const updateResumeData = useUpdateResumeData();

	const pages = resume.data.metadata.layout.pages;
	// When the template collapses the sidebar, no page has a usable sidebar column.
	const sidebarCollapsed = templateLayouts[resume.data.metadata.template].columns === 1;

	const moveTo = (targetPageIndex: number, targetColumnId: ColumnId) => {
		updateResumeData((draft) => {
			const from = draft.metadata.layout.pages[pageIndex]?.[columnId];
			const to = draft.metadata.layout.pages[targetPageIndex]?.[targetColumnId];
			if (!from || !to) return;
			const index = from.indexOf(id);
			if (index === -1) return;
			from.splice(index, 1);
			to.push(id);
		});
	};

	const moveToNewPage = () => {
		updateResumeData((draft) => {
			const from = draft.metadata.layout.pages[pageIndex]?.[columnId];
			if (!from) return;
			const index = from.indexOf(id);
			if (index === -1) return;
			from.splice(index, 1);
			draft.metadata.layout.pages.push({ fullWidth: false, main: [id], sidebar: [] });
		});
	};

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<Icon name="redo" size={16} />
				<Trans>Move to</Trans>
			</DropdownMenuSubTrigger>

			<DropdownMenuSubContent>
				{pages.map((page, targetPageIndex) => {
					// Full-width pages hide their sidebar, so never offer it as a target.
					const sidebarHidden = sidebarCollapsed || page.fullWidth;

					return (
						<DropdownMenuSub key={`page-${targetPageIndex}`}>
							<DropdownMenuSubTrigger>
								<Icon name="draft" size={16} />
								<Trans>Page {targetPageIndex + 1}</Trans>
							</DropdownMenuSubTrigger>

							<DropdownMenuSubContent>
								<DropdownMenuItem
									disabled={targetPageIndex === pageIndex && columnId === "main"}
									onClick={() => moveTo(targetPageIndex, "main")}
								>
									{getColumnLabel("main")}
								</DropdownMenuItem>

								{!sidebarHidden && (
									<DropdownMenuItem
										disabled={targetPageIndex === pageIndex && columnId === "sidebar"}
										onClick={() => moveTo(targetPageIndex, "sidebar")}
									>
										{getColumnLabel("sidebar")}
									</DropdownMenuItem>
								)}
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					);
				})}

				<DropdownMenuSeparator />

				<DropdownMenuItem onClick={moveToNewPage}>
					<Icon name="add_circle" size={16} />
					<Trans>New Page</Trans>
				</DropdownMenuItem>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

type SectionBreakField = "keepTogether" | "startOnNewPage";

const readSectionBreak = (data: ResumeData, id: string, field: SectionBreakField): boolean => {
	if (id === "summary") return data.summary[field];
	if (id in data.sections) return data.sections[id as SectionType][field];
	return data.customSections.find((section) => section.id === id)?.[field] ?? false;
};

type SectionBreakItemsProps = {
	id: string;
};

/**
 * Per-section page-break controls. These write the declarative `keepTogether` /
 * `startOnNewPage` flags onto the section metadata (summary, standard, or custom),
 * which the PDF renderer applies as `wrap` / `break` on the section container.
 */
function SectionBreakItems({ id }: SectionBreakItemsProps) {
	const resume = useCurrentResume();
	const updateResumeData = useUpdateResumeData();

	const keepTogether = readSectionBreak(resume.data, id, "keepTogether");
	const startOnNewPage = readSectionBreak(resume.data, id, "startOnNewPage");

	const toggle = (field: SectionBreakField) => {
		updateResumeData((draft) => {
			if (id === "summary") {
				draft.summary[field] = !draft.summary[field];
				return;
			}
			if (id in draft.sections) {
				const section = draft.sections[id as SectionType];
				section[field] = !section[field];
				return;
			}
			const custom = draft.customSections.find((section) => section.id === id);
			if (custom) custom[field] = !custom[field];
		});
	};

	return (
		<>
			<DropdownMenuCheckboxItem
				checked={keepTogether}
				onSelect={(event) => event.preventDefault()}
				onCheckedChange={() => toggle("keepTogether")}
			>
				<Trans comment="Layout editor toggle that prevents a section from splitting across pages">Keep together</Trans>
			</DropdownMenuCheckboxItem>

			<p className="px-2 pb-1 text-xs text-ink-3">
				<Trans comment="Helper note explaining the keep-together limitation">
					Only applies when the section fits on a single page.
				</Trans>
			</p>

			<DropdownMenuCheckboxItem
				checked={startOnNewPage}
				onSelect={(event) => event.preventDefault()}
				onCheckedChange={() => toggle("startOnNewPage")}
			>
				<Trans comment="Layout editor toggle that forces a section to begin on a new page">Start on new page</Trans>
			</DropdownMenuCheckboxItem>
		</>
	);
}

type LayoutItemContentProps = HTMLAttributes<HTMLDivElement> & {
	id: string;
	ref?: Ref<HTMLDivElement>;
	pageIndex?: number;
	columnId?: ColumnId;
	isDragging?: boolean;
	isOverlay?: boolean;
};

function LayoutItemContent({
	id,
	ref,
	pageIndex,
	columnId,
	isDragging,
	isOverlay,
	className,
	style,
	...rest
}: LayoutItemContentProps) {
	const resume = useCurrentResume();
	const title = resume ? resolveLayoutSectionTitle(resume.data, id) : id;

	return (
		<div
			ref={ref}
			style={style}
			data-overlay={isOverlay ? "true" : undefined}
			data-dragging={isDragging ? "true" : undefined}
			className={cn(
				"group/item flex cursor-grab touch-none items-center gap-x-2 rounded-md border border-line bg-bg px-2 py-1.5 text-sm font-medium transition-[background-color,border-color] duration-quick select-none",
				"hover:bg-sunken/40 active:cursor-grabbing active:border-accent/60 active:bg-sunken/40",
				"data-[overlay=true]:cursor-grabbing data-[overlay=true]:border-accent/60 data-[overlay=true]:bg-bg data-[overlay=true]:shadow-md",
				"data-[dragging=true]:cursor-grabbing data-[dragging=true]:opacity-40",
				className,
			)}
			{...rest}
		>
			<Icon name="drag_indicator" size={16} className="opacity-40 transition-opacity group-hover/item:opacity-100" />
			<span className="min-w-0 flex-1 truncate">{title}</span>

			{/* The drag overlay renders without a location; only real rows get the menu. */}
			{!isOverlay && pageIndex !== undefined && columnId !== undefined && (
				<DropdownMenu>
					<DropdownMenuTrigger
						aria-label={t`Move section to another column or page`}
						onPointerDown={(event) => event.stopPropagation()}
						className="flex cursor-context-menu items-center rounded p-0.5 opacity-40 transition-opacity group-hover/item:opacity-100 hover:bg-sunken/40 focus:outline-none focus-visible:ring-1"
					>
						<Icon name="more_vert" size={16} />
					</DropdownMenuTrigger>

					<DropdownMenuContent align="end">
						<MoveToSubmenu id={id} pageIndex={pageIndex} columnId={columnId} />
						<DropdownMenuSeparator />
						<SectionBreakItems id={id} />
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</div>
	);
}
