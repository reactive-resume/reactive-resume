import type { OutlineRow, WriteSection } from "./model";
import type { DndLabel } from "@/libs/dnd";
import type { DragEndEvent } from "@dnd-kit/core";
import type { CustomSectionType, SectionType } from "@reactive-resume/schema/resume/data";
import type { ComponentProps, KeyboardEvent, ReactNode } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { i18n } from "@lingui/core";
import { ph, plural, t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { Fragment, useMemo } from "react";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { cn } from "@reactive-resume/utils/style";
import { pendingProposals } from "../proposals/proposals";
import { useEditorStore } from "../store";
import {
	countEntriesToCheck,
	getEntries,
	getOutlineRows,
	getSectionKind,
	getSectionObject,
	getSectionType,
	moveSection,
	resolveSection,
	summarizeSection,
} from "./model";
import { BASICS, openSection } from "./view";
import { List, ListRow } from "@/components/calm/list-row";
import { useCurrentBuilderResumeSelector, useResumeStore, useUpdateResumeData } from "@/features/resume/builder/draft";
import { announce } from "@/libs/announce";
import { dndContextProps } from "@/libs/dnd";
import { DRAG_SETTLE } from "@/libs/motion";
import { getSectionTitle } from "@/libs/resume/section";

const rowKey = (row: OutlineRow) => `${row.id}\u0000${row.page}\u0000${row.column}\u0000${row.hidden ? 1 : 0}`;

function parseRows(key: string): OutlineRow[] {
	if (!key) return [];
	return key.split("\u0001").map((part) => {
		const [id = "", page = "0", column = "main", hidden = "0"] = part.split("\u0000");
		return { id, page: Number(page), column: column as OutlineRow["column"], hidden: hidden === "1" };
	});
}

export function useSortSensors() {
	return useSensors(
		// A small distance keeps clicks on the handle from starting a drag.
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);
}

/** The printed title: the one the user gave, else the section type's name. */
export function useSectionTitle(section: WriteSection) {
	const title = useCurrentBuilderResumeSelector((resume) => getSectionObject(resume.data, section)?.title ?? "");
	return (
		title.trim() || getSectionTitle(section.kind === "custom" ? section.type : (section.id as SectionType | "summary"))
	);
}

/** "8 skills": how a section with too many entries to name says what it holds. */
function countLabel(type: CustomSectionType, count: number) {
	switch (type) {
		case "skills":
			return plural(count, { one: "# skill", other: "# skills" });
		case "languages":
			return plural(count, { one: "# language", other: "# languages" });
		case "projects":
			return plural(count, { one: "# project", other: "# projects" });
		case "interests":
			return plural(count, { one: "# interest", other: "# interests" });
		case "awards":
			return plural(count, { one: "# award", other: "# awards" });
		case "certifications":
			return plural(count, { one: "# certification", other: "# certifications" });
		case "publications":
			return plural(count, { one: "# publication", other: "# publications" });
		case "references":
			return plural(count, { one: "# reference", other: "# references" });
		case "profiles":
			return plural(count, { one: "# profile", other: "# profiles" });
		default:
			return plural(count, { one: "# entry", other: "# entries" });
	}
}

/** Entries are named while there are few of them; past that, counted. */
const NAMED_ENTRIES = 3;

type OutlineProps = { locked: boolean };

/**
 * The outline: Basics, then the sections in use in print order, one row each with a line saying what it holds. A row
 * opens its section. Dragging a row (or ⌥↑ / ⌥↓ on it) reorders the layout; a quiet line marks each new page and, on
 * two-column pages, where the sidebar starts. Hidden sections stay listed, dimmed, after the ones that print.
 */
export function Outline({ locked }: OutlineProps) {
	const added = useEditorStore((state) => state.addedSections);
	const key = useCurrentBuilderResumeSelector((resume) =>
		getOutlineRows(resume.data, new Set(added)).map(rowKey).join("\u0001"),
	);
	const rows = useMemo(() => parseRows(key), [key]);
	const activeRows = useMemo(() => rows.filter((row) => !row.hidden), [rows]);
	const hiddenRows = useMemo(() => rows.filter((row) => row.hidden), [rows]);
	const multiPage = activeRows.some((row) => row.page > 0);
	// A one-column template prints sidebar sections after the main ones: no "Sidebar" to name.
	const twoColumns = useCurrentBuilderResumeSelector(
		(resume) => templateLayouts[resume.data.metadata.template].columns === 2,
	);
	const updateResumeData = useUpdateResumeData();
	const sensors = useSortSensors();

	const move = (id: string, target: OutlineRow | undefined, direction: "up" | "down", announced = false) => {
		if (!target) return;
		const before = useResumeStore.getState().resume?.data;
		updateResumeData((draft) => moveSection(draft, id, target, direction), { newStep: true });
		if (!announced) return;
		// A keyboard move: say where the section is now (a drag has dnd-kit's own announcements). A move that didn't
		// apply (a locked resume) leaves the data as it was, and says nothing.
		const data = useResumeStore.getState().resume?.data;
		if (data === before) return;
		const section = data ? resolveSection(data, id) : null;
		if (!data || !section) return;
		const rows = getOutlineRows(data, new Set(added)).filter((row) => !row.hidden);
		const position = rows.findIndex((row) => row.id === id) + 1;
		const title =
			getSectionObject(data, section)?.title.trim() ||
			getSectionTitle(section.kind === "custom" ? section.type : (section.id as SectionType | "summary"));
		if (position > 0)
			announce(t`${title} moved to position ${ph({ position: i18n.number(position) })} of ${i18n.number(rows.length)}`);
	};

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		const from = activeRows.findIndex((row) => row.id === active.id);
		const to = activeRows.findIndex((row) => row.id === over.id);
		move(String(active.id), activeRows[to], from < to ? "down" : "up");
	};

	return (
		<DndContext {...dndContextProps(true)} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
			<List className="mt-2" aria-label={t`Sections`}>
				<BasicsRow locked={locked} />
				<SortableContext items={activeRows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
					{activeRows.map((row, index) => {
						const previous = activeRows[index - 1];
						const newPage = multiPage && row.page !== previous?.page;
						const sidebarStarts = twoColumns && row.column === "sidebar" && (previous?.column !== "sidebar" || newPage);

						return (
							<Fragment key={row.id}>
								{newPage && row.page > 0 && <Divider label={<Trans>Page {i18n.number(row.page + 1)}</Trans>} />}
								{sidebarStarts && <Divider label={<Trans>Sidebar</Trans>} />}
								<SectionRow
									sectionId={row.id}
									locked={locked}
									dragGroup={dragGroup(row, multiPage, twoColumns)}
									onMove={(direction) =>
										move(row.id, activeRows[direction === "up" ? index - 1 : index + 1], direction, true)
									}
								/>
							</Fragment>
						);
					})}
				</SortableContext>
				{hiddenRows.map((row) => (
					<SectionRow key={row.id} sectionId={row.id} locked={locked} hidden />
				))}
			</List>
		</DndContext>
	);
}

/** The page and column a row prints in, as the dividers show it, for drag announcements. */
function dragGroup(row: OutlineRow, multiPage: boolean, twoColumns: boolean) {
	if (twoColumns && row.column === "sidebar")
		return multiPage ? t`Page ${i18n.number(row.page + 1)}, sidebar` : t`Sidebar`;
	return multiPage ? t`Page ${i18n.number(row.page + 1)}` : undefined;
}

/** Where a new page or the sidebar starts: a quiet line between rows, with the hairline of the row above it. */
function Divider({ label }: { label: ReactNode }) {
	return <div className="border-b border-line pt-4 pb-1.5 t-caption text-ink-3">{label}</div>;
}

/** The grip at the start of a row. Without handlers it is only drawn (Basics always comes first). */
function Grip({ label, className, ...props }: Omit<ComponentProps<"button">, "aria-label"> & { label?: string }) {
	const icon = <Icon name="dots-six-vertical" size={18} />;
	if (!label) return <span className={cn("flex shrink-0 text-ink-3", className)}>{icon}</span>;

	return (
		<button
			type="button"
			aria-label={label}
			className={cn(
				"touch-target relative z-10 flex shrink-0 cursor-grab rounded-xs text-ink-3 hover:text-ink active:cursor-grabbing",
				className,
			)}
			{...props}
		>
			{icon}
		</button>
	);
}

type OpenRowProps = {
	label: string;
	onOpen: () => void;
	onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

/** The row's one action, laid over the whole row and named by its title, so the grip stays a control of its own. */
function OpenRow({ label, onOpen, onKeyDown }: OpenRowProps) {
	return (
		<button
			type="button"
			aria-label={label}
			onClick={onOpen}
			onKeyDown={onKeyDown}
			className="absolute -inset-x-3 inset-y-0 rounded-md"
		/>
	);
}

/** Basics: who the resume is about. Always first, so its grip is only drawn. */
function BasicsRow({ locked }: { locked: boolean }) {
	const line = useCurrentBuilderResumeSelector((resume) =>
		[resume.data.basics.name, resume.data.basics.headline].filter((part) => part.trim()).join(" · "),
	);

	return (
		<ListRow
			id={`sidebar-${BASICS}`}
			interactive
			leading={locked ? undefined : <Grip />}
			title={getSectionTitle("basics")}
			subtitle={line || <Trans>Your name and how to reach you</Trans>}
			caret
		>
			<OpenRow label={getSectionTitle("basics")} onOpen={() => openSection(BASICS)} />
		</ListRow>
	);
}

type SectionRowProps = {
	sectionId: string;
	locked: boolean;
	/** Set aside: listed after the sections that print, dimmed, and out of the drag order. */
	hidden?: boolean;
	/** The page and column the row prints in, read out while it's dragged. */
	dragGroup?: string | undefined;
	/** ⌥↑ / ⌥↓ on the focused row. Hidden sections sit outside the print order, so they have none. */
	onMove?: ((direction: "up" | "down") => void) | undefined;
};

function SectionRow({ sectionId, locked, hidden = false, dragGroup, onMove }: SectionRowProps) {
	// Select the type (a string) rather than a new section object, so the row renders only when it changes.
	const type = useCurrentBuilderResumeSelector((resume) => getSectionType(resume.data, sectionId) ?? null);
	const section = useMemo<WriteSection | null>(
		() => (type ? { id: sectionId, kind: getSectionKind(sectionId), type } : null),
		[sectionId, type],
	);
	if (!section) return null;
	return <SectionRowBody section={section} locked={locked} hidden={hidden} dragGroup={dragGroup} onMove={onMove} />;
}

type SectionRowBodyProps = Omit<SectionRowProps, "sectionId" | "hidden"> & { section: WriteSection; hidden: boolean };

function SectionRowBody({ section, locked, hidden, dragGroup, onMove }: SectionRowBodyProps) {
	const title = useSectionTitle(section);
	// Joined so the selector returns a stable value.
	const summary = useCurrentBuilderResumeSelector((resume) => {
		const { names, printed, hidden, text } = summarizeSection(resume.data, section);
		return [names.join("\u0000"), printed, hidden, text].join("\u0001");
	});
	const toCheck = useCurrentBuilderResumeSelector((resume) => countEntriesToCheck(getEntries(resume.data, section)));
	const proposed = useProposedCount(section.id);
	const updateResumeData = useUpdateResumeData();
	const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({
		id: section.id,
		data: { label: title, group: dragGroup } satisfies DndLabel,
		disabled: locked || hidden,
		transition: DRAG_SETTLE,
	});

	const show = () =>
		updateResumeData(
			(draft) => {
				const target = getSectionObject(draft, section);
				if (target) target.hidden = false;
			},
			{ newStep: true },
		);

	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
		event.preventDefault();
		onMove?.(event.key === "ArrowUp" ? "up" : "down");
	};

	const [nameList = "", printed = "0", hiddenCount = "0", text = ""] = summary.split("\u0001");
	const names = nameList ? nameList.split("\u0000") : [];
	const line = hidden ? (
		<Trans>Hidden, not on the page</Trans>
	) : section.kind === "summary" ? (
		text || <Trans>Nothing written yet</Trans>
	) : (
		[
			Number(printed) === 0
				? t`Nothing on the page yet`
				: names.length === Number(printed) && names.length <= NAMED_ENTRIES
					? new Intl.ListFormat(i18n.locale, { type: "unit", style: "short" }).format(names)
					: countLabel(section.type, Number(printed)),
			Number(hiddenCount) > 0 ? plural(Number(hiddenCount), { one: "# hidden", other: "# hidden" }) : "",
		]
			.filter(Boolean)
			.join(" · ")
	);

	return (
		<ListRow
			ref={setNodeRef}
			id={`sidebar-${section.id}`}
			data-section-id={section.id}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			interactive
			variant={hidden ? "dim" : "default"}
			className={cn(isDragging && "z-10 before:bg-raised before:shadow-e2")}
			leading={
				locked ? undefined : hidden ? (
					<Grip />
				) : (
					<Grip
						label={t({
							comment: "A section's drag handle in the resume outline",
							message: `Reorder ${title}. Drag, or press Option and an arrow key`,
						})}
						{...attributes}
						{...listeners}
					/>
				)
			}
			title={title}
			subtitle={line}
			value={
				proposed > 0 || toCheck > 0 ? (
					<>
						{proposed > 0 && (
							<Badge variant="accent">
								<Plural value={proposed} one="# proposed" other="# proposed" />
							</Badge>
						)}
						{toCheck > 0 && (
							<Badge variant="warn">
								<Plural value={toCheck} one="# to check" other="# to check" />
							</Badge>
						)}
					</>
				) : undefined
			}
			trailing={
				hidden ? (
					locked ? (
						<Icon name="eye-slash" size={18} className="text-ink-3" />
					) : (
						<IconButton
							icon="eye-slash"
							iconSize={18}
							label={t`Show ${title} on the page`}
							size="icon-sm"
							className="-mx-[5px] text-ink-3"
							onClick={show}
						/>
					)
				) : undefined
			}
			caret={!hidden}
		>
			<OpenRow label={title} onOpen={() => openSection(section.id)} onKeyDown={onKeyDown} />
		</ListRow>
	);
}

const NONE: readonly never[] = [];

/** The assistant's pending edits in a section, while the assistant is open: "2 proposed". */
export function useProposedCount(sectionId: string) {
	const proposals = useEditorStore((state) => (state.assistantOpen ? state.assistantProposals : NONE));
	const data = useCurrentBuilderResumeSelector((resume) => resume.data);
	const applications = useResumeStore((state) => state.proposalApplications);
	return pendingProposals(data, proposals, sectionId, applications).length;
}
