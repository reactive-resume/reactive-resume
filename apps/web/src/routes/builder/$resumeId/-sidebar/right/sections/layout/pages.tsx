import type { DndLabel } from "@/libs/dnd";
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
import { i18n } from "@lingui/core";
import { ph, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useReducedMotion } from "motion/react";
import { useCallback, useId, useState } from "react";
import { match } from "ts-pattern";
import { filterSections } from "@reactive-resume/pdf/filtering";
import { shouldShowResumeHeader } from "@reactive-resume/pdf/semantic-tree";
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
import { InputGroup } from "@reactive-resume/ui/components/input-group";
import { Switch } from "@reactive-resume/ui/components/switch";
import { isRTL } from "@reactive-resume/utils/locale";
import { cn } from "@reactive-resume/utils/style";
import { resolveLayoutSectionTitle } from "./title";
import { NumberInput } from "@/components/input/number-input";
import { useCurrentResume, useUpdateResumeData } from "@/features/resume/builder/draft";
import { undoToast } from "@/features/resume/builder/undo-toast";
import { resolveSection, getSectionObject } from "@/features/resume/editor/write/model";
import { dndContextProps } from "@/libs/dnd";
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

/** "Page 2, Sidebar": where a section sits, read out while it's dragged. */
const getPlaceLabel = (pageIndex: number, columnId: ColumnId) => {
	const page = pageIndex + 1;
	const column = getColumnLabel(columnId);
	return t({
		message: `Page ${ph({ page: i18n.number(page) })}, ${column}`,
		comment: "Layout editor: a page and its column, read while dragging",
	});
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
	const ownSide = templateLayouts[template].sidebarSide;
	const defaultSide = isRTL(resume.data.metadata.page.locale) ? (ownSide === "left" ? "right" : "left") : ownSide;
	const templateSidebarPosition =
		templateLayouts[template].columns === 1
			? "none"
			: (resume.data.metadata.layout.sidebarSide ?? defaultSide ?? "none");

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

				updateResumeData(
					(draft) => {
						const page = draft.metadata.layout.pages[activeLocation.pageIndex];
						if (!page) return;
						page[activeLocation.columnId] = arrayMove(page[activeLocation.columnId], oldIdx, newIdx);
					},
					{ newStep: true },
				);
				undoToast(t`Section moved`);
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

			updateResumeData(
				(draft) => {
					const fromPageDraft = draft.metadata.layout.pages[activeLocation.pageIndex];
					const toPageDraft = draft.metadata.layout.pages[overLocation.pageIndex];
					if (!fromPageDraft || !toPageDraft) return;
					const from = fromPageDraft[activeLocation.columnId];
					const to = toPageDraft[overLocation.columnId];

					from.splice(fromIdx, 1);
					to.splice(Math.min(toIdx, to.length), 0, activeIdStr);
				},
				{ newStep: true },
			);
			undoToast(t`Section moved`);
		},
		[findContainer, layout.pages, updateResumeData],
	);

	const handleAddPage = useCallback(() => {
		updateResumeData(
			(draft) => {
				draft.metadata.layout.pages.push({
					fullWidth: false,
					main: [],
					sidebar: [],
				});
			},
			{ newStep: true },
		);
		undoToast(t`Page added`);
	}, [updateResumeData]);

	const handleDeletePage = useCallback(
		(pageIndex: number) => {
			if (layout.pages.length <= 1) return; // Don't allow deleting the last page

			updateResumeData(
				(draft) => {
					const pageToDelete = draft.metadata.layout.pages[pageIndex];
					// Find the first available page that isn't being deleted
					const targetPageIndex = pageIndex === 0 ? 1 : 0;
					const targetPage = draft.metadata.layout.pages[targetPageIndex];
					if (!pageToDelete || !targetPage) return;

					// Move all sections from deleted page to target page
					targetPage.main.push(...pageToDelete.main);
					targetPage.sidebar.push(...pageToDelete.sidebar);

					draft.metadata.layout.pages.splice(pageIndex, 1);
				},
				{ newStep: true },
			);
			undoToast(t`Page removed. Its sections are kept.`);
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
			{...dndContextProps(false)}
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
							main: filterSections(page.main, resume.data),
							sidebar: filterSections(page.sidebar, resume.data),
						}}
						showHeader={shouldShowResumeHeader(resume.data, pageIndex)}
						headerPlacement={templateLayouts[template].headerPlacement}
						canDelete={layout.pages.length > 1}
						sidebarPosition={templateSidebarPosition}
						onDelete={handleDeletePage}
						onToggleFullWidth={handleToggleFullWidth}
					/>
				))}

				<Button variant="secondary" size="sm" className="self-start" onClick={handleAddPage}>
					<Icon name="plus" size={16} />
					<Trans>Add page</Trans>
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
	showHeader: boolean;
	headerPlacement: "full-width" | "main-only" | "sidebar-only";
	canDelete: boolean;
	sidebarPosition: "left" | "right" | "none";
	onDelete: (pageIndex: number) => void;
	onToggleFullWidth: (pageIndex: number, fullWidth: boolean) => void;
};

function PageContainer({
	pageIndex,
	page,
	showHeader,
	headerPlacement,
	canDelete,
	sidebarPosition,
	onDelete,
	onToggleFullWidth,
}: PageContainerProps) {
	const isFullWidth = page.fullWidth;
	const fullWidthSwitchId = useId();

	return (
		<div className="space-y-2">
			<div className="py-1">
				<div className="flex items-center justify-between gap-2">
					<div className="flex min-w-0 flex-1 items-center justify-between gap-2">
						<span className="text-xs font-medium">
							<Trans comment="Layout editor page label with 1-based page number">
								Page {i18n.number(pageIndex + 1)}
							</Trans>
						</span>

						{sidebarPosition !== "none" && (
							<label htmlFor={fullWidthSwitchId} className="flex min-w-0 cursor-pointer items-center gap-2">
								<Switch
									id={fullWidthSwitchId}
									checked={page.fullWidth}
									onCheckedChange={(checked) => onToggleFullWidth(pageIndex, checked)}
								/>

								<span className="text-xs font-medium text-ink-3">
									<Trans comment="Layout editor toggle label that makes a page single-column">Full width</Trans>
								</span>
							</label>
						)}
					</div>

					{canDelete && (
						<Button
							variant="ghost"
							onClick={() => onDelete(pageIndex)}
							className="size-auto gap-x-2.5 justify-self-end p-0!"
						>
							<Icon name="trash" size={16} />
							<Trans>Delete page</Trans>
						</Button>
					)}
				</div>
			</div>

			<div
				className={cn(
					"grid w-full gap-x-3 gap-y-2 rounded-lg border border-line bg-sunken p-2 font-medium",
					sidebarPosition === "none" || isFullWidth ? "grid-cols-1" : "grid-cols-2",
				)}
			>
				{showHeader && (headerPlacement === "full-width" || isFullWidth || sidebarPosition === "none") && (
					<div className="col-span-full rounded-xs border border-dashed border-line-2 px-2 py-1.5 t-caption text-ink-3">
						<Trans>Header · your name and contact details</Trans>
					</div>
				)}
				<LayoutColumn
					header={showHeader && headerPlacement === "main-only" && !isFullWidth && sidebarPosition !== "none"}
					pageIndex={pageIndex}
					columnId="main"
					items={page.main}
					disabled={false}
					className={cn(sidebarPosition === "left" ? "order-2" : "order-1")}
				/>

				{!isFullWidth && (
					<LayoutColumn
						header={showHeader && headerPlacement === "sidebar-only"}
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
	header?: boolean;
	pageIndex: number;
	columnId: ColumnId;
	items: string[];
	hideLabel?: boolean;
	disabled?: boolean;
	className?: string;
};

function LayoutColumn({
	header = false,
	pageIndex,
	columnId,
	items,
	hideLabel = false,
	disabled = false,
	className,
}: LayoutColumnProps) {
	const droppableId = createDroppableId(pageIndex, columnId);
	const { setNodeRef, isOver } = useDroppable({
		id: droppableId,
		data: { label: getPlaceLabel(pageIndex, columnId) } satisfies DndLabel,
		disabled,
	});

	return (
		<SortableContext id={droppableId} items={items} strategy={verticalListSortingStrategy}>
			<div className={cn("space-y-1.5", disabled && "opacity-50", className)}>
				{!hideLabel && <div className="t-caption text-ink-3">{getColumnLabel(columnId)}</div>}

				<div
					ref={setNodeRef}
					className={cn(
						"min-h-8 space-y-2 transition-colors",
						isOver && !disabled ? "border-accent/60 bg-accent/5" : "bg-bg/40",
					)}
				>
					{header && (
						<div className="rounded-xs border border-dashed border-line-2 px-2 py-1.5 t-caption text-ink-3">
							<Trans>Header · your name and contact details</Trans>
						</div>
					)}
					{items.map((id) => (
						<SortableLayoutItem key={id} id={id} pageIndex={pageIndex} columnId={columnId} />
					))}

					{items.length === 0 && (
						<div className="py-2 t-caption text-ink-3">
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
	const resume = useCurrentResume();
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id,
		data: {
			label: resolveLayoutSectionTitle(resume.data, id),
			group: getPlaceLabel(pageIndex, columnId),
		} satisfies DndLabel,
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
		updateResumeData(
			(draft) => {
				const from = draft.metadata.layout.pages[pageIndex]?.[columnId];
				const to = draft.metadata.layout.pages[targetPageIndex]?.[targetColumnId];
				if (!from || !to) return;
				const index = from.indexOf(id);
				if (index === -1) return;
				from.splice(index, 1);
				to.push(id);
			},
			{ newStep: true },
		);
		undoToast(t`Section moved`);
	};

	const moveToNewPage = () => {
		updateResumeData(
			(draft) => {
				const from = draft.metadata.layout.pages[pageIndex]?.[columnId];
				if (!from) return;
				const index = from.indexOf(id);
				if (index === -1) return;
				from.splice(index, 1);
				draft.metadata.layout.pages.push({ fullWidth: false, main: [id], sidebar: [] });
			},
			{ newStep: true },
		);
		undoToast(t`Section moved to a new page`);
	};

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<Icon name="arrow-u-up-right" size={16} />
				<Trans>Move to</Trans>
			</DropdownMenuSubTrigger>

			<DropdownMenuSubContent>
				{pages.map((page, targetPageIndex) => {
					// Full-width pages hide their sidebar, so never offer it as a target.
					const sidebarHidden = sidebarCollapsed || page.fullWidth;
					// With only the main column to choose, the page itself is the target: no third level.
					if (sidebarHidden)
						return (
							<DropdownMenuItem
								key={`page-${targetPageIndex}`}
								disabled={targetPageIndex === pageIndex && columnId === "main"}
								onClick={() => moveTo(targetPageIndex, "main")}
							>
								<Icon name="file" size={16} />
								<Trans>Page {i18n.number(targetPageIndex + 1)}</Trans>
							</DropdownMenuItem>
						);

					return (
						<DropdownMenuSub key={`page-${targetPageIndex}`}>
							<DropdownMenuSubTrigger>
								<Icon name="file" size={16} />
								<Trans>Page {i18n.number(targetPageIndex + 1)}</Trans>
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
					<Icon name="plus-circle" size={16} />
					<Trans>New page</Trans>
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
				<Trans comment="Layout editor toggle that prevents a section from splitting across pages">
					Keep on one page
				</Trans>
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
				<Trans comment="Layout editor toggle that forces a section to begin on a new page">Start on a new page</Trans>
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
				"group/item flex min-h-9 cursor-grab touch-none items-center gap-x-1 rounded-sm border border-line bg-raised px-1.5 py-1 t-small transition-colors duration-quick select-none",
				"hover:bg-sunken/40 active:cursor-grabbing active:border-accent/60 active:bg-sunken/40",
				"data-[overlay=true]:cursor-grabbing data-[overlay=true]:border-accent/60 data-[overlay=true]:bg-bg data-[overlay=true]:shadow-md",
				"data-[dragging=true]:cursor-grabbing data-[dragging=true]:opacity-40",
				className,
			)}
			{...rest}
		>
			<Icon name="dots-six-vertical" size={16} className="opacity-40 transition-opacity group-hover/item:opacity-100" />
			<span className="min-w-0 flex-1 truncate">{title}</span>

			{/* The drag overlay renders without a location; only real rows get the menu. */}
			{!isOverlay && pageIndex !== undefined && columnId !== undefined && (
				<DropdownMenu>
					<DropdownMenuTrigger
						aria-label={t`Move section to another column or page`}
						onPointerDown={(event) => event.stopPropagation()}
						className="flex size-7 shrink-0 cursor-context-menu items-center justify-center rounded-sm text-ink-3 hover:bg-hover focus-visible:outline"
					>
						<Icon name="dots-three" size={16} />
					</DropdownMenuTrigger>

					<DropdownMenuContent side="right" align="start" sideOffset={16}>
						<LayoutMenuItems id={id} pageIndex={pageIndex} columnId={columnId} />
						<MoveToSubmenu id={id} pageIndex={pageIndex} columnId={columnId} />
						<DropdownMenuSeparator />
						<SectionBreakItems id={id} />
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</div>
	);
}

function LayoutMenuItems({ id, pageIndex, columnId }: MoveToSubmenuProps) {
	const resume = useCurrentResume();
	const update = useUpdateResumeData();
	const items = resume.data.metadata.layout.pages[pageIndex]?.[columnId] ?? [];
	const index = items.indexOf(id);
	const section = resolveSection(resume.data, id);
	const settings = section ? getSectionObject(resume.data, section) : null;
	const move = (delta: number) => {
		update(
			(draft) => {
				const page = draft.metadata.layout.pages[pageIndex];
				if (page) page[columnId] = arrayMove(page[columnId], index, index + delta);
			},
			{ newStep: true },
		);
		undoToast(t`Section moved`);
	};

	return (
		<>
			<DropdownMenuItem disabled={index <= 0} onClick={() => move(-1)}>
				<Icon name="arrow-up" />
				<Trans>Move up</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem disabled={index < 0 || index >= items.length - 1} onClick={() => move(1)}>
				<Icon name="arrow-down" />
				<Trans>Move down</Trans>
			</DropdownMenuItem>
			{settings && (
				<>
					<DropdownMenuSeparator />
					<div className="flex items-center gap-3 px-2 py-1.5">
						<span className="flex-1 t-small">
							<Trans>Columns</Trans>
						</span>
						<InputGroup className="h-8 w-20">
							<NumberInput
								aria-label={t`Columns, 1 to 6`}
								value={settings.columns}
								min={1}
								max={6}
								step={1}
								onValueChange={(value) =>
									update(
										(draft) => {
											const target = resolveSection(draft, id);
											const object = target ? getSectionObject(draft, target) : null;
											if (object) object.columns = value;
										},
										{ newStep: true },
									)
								}
							/>
						</InputGroup>
					</div>
					<DropdownMenuItem
						onClick={() => {
							update(
								(draft) => {
									const target = resolveSection(draft, id);
									const object = target ? getSectionObject(draft, target) : null;
									if (object) object.hidden = true;
								},
								{ newStep: true },
							);
							undoToast(t`Section hidden from page`);
						}}
					>
						<Icon name="eye-slash" />
						<Trans>Hide from page</Trans>
					</DropdownMenuItem>
				</>
			)}
		</>
	);
}
