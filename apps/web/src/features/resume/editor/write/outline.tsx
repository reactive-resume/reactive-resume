import type { PageSettings } from "./entries";
import type { OutlineRow, WriteSection } from "./model";
import type { DragEndEvent } from "@dnd-kit/core";
import type { MessageDescriptor } from "@lingui/core";
import type { CustomSectionType } from "@reactive-resume/schema/resume/data";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Fragment, useMemo } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { useEditorStore } from "../store";
import { addEntryTo } from "./actions";
import { EntryCard } from "./entry-card";
import { getEntries, getOutlineRows, getSectionKind, getSectionType, moveSection } from "./model";
import { SectionRow } from "./section-row";
import { SummaryEditor } from "./summary-editor";
import { useCurrentBuilderResumeSelector, useUpdateResumeData } from "@/features/resume/builder/draft";

const ADD_LABELS: Record<CustomSectionType, MessageDescriptor> = {
	summary: msg`Add text`,
	experience: msg`Add experience`,
	education: msg`Add education`,
	projects: msg`Add project`,
	skills: msg`Add skill`,
	languages: msg`Add language`,
	interests: msg`Add interest`,
	awards: msg`Add award`,
	certifications: msg`Add certification`,
	publications: msg`Add publication`,
	volunteer: msg`Add volunteering`,
	references: msg`Add reference`,
	profiles: msg`Add profile`,
	"cover-letter": msg`Add cover letter`,
};

const rowKey = (row: OutlineRow) => `${row.id}\u0000${row.page}\u0000${row.column}`;

function parseRows(key: string): OutlineRow[] {
	if (!key) return [];
	return key.split("\u0001").map((part) => {
		const [id = "", page = "0", column = "main"] = part.split("\u0000");
		return { id, page: Number(page), column: column as OutlineRow["column"] };
	});
}

function useSortSensors() {
	return useSensors(
		// A small distance keeps clicks on the handle from starting a drag.
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);
}

type OutlineProps = { locked: boolean; page: PageSettings };

/**
 * The outline: sections in use, in print order. Dragging a row (or ⌥↑ / ⌥↓ on its title) reorders the
 * layout; a divider marks each new page and, on two-column pages, where the sidebar starts.
 */
export function Outline({ locked, page }: OutlineProps) {
	const added = useEditorStore((state) => state.addedSections);
	const key = useCurrentBuilderResumeSelector((resume) =>
		getOutlineRows(resume.data, new Set(added)).map(rowKey).join("\u0001"),
	);
	const rows = useMemo(() => parseRows(key), [key]);
	const multiPage = rows.some((row) => row.page > 0);
	const updateResumeData = useUpdateResumeData();
	const sensors = useSortSensors();

	const move = (id: string, target: OutlineRow | undefined, direction: "up" | "down") => {
		if (!target) return;
		updateResumeData((draft) => moveSection(draft, id, target, direction), { newStep: true });
	};

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		const from = rows.findIndex((row) => row.id === active.id);
		const to = rows.findIndex((row) => row.id === over.id);
		move(String(active.id), rows[to], from < to ? "down" : "up");
	};

	return (
		<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
			<SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
				<div className="grid gap-0.5">
					{rows.map((row, index) => {
						const previous = rows[index - 1];
						const newPage = multiPage && row.page !== previous?.page;
						const sidebarStarts = row.column === "sidebar" && (previous?.column !== "sidebar" || newPage);

						return (
							<Fragment key={row.id}>
								{newPage && <Divider label={<Trans>Page {row.page + 1}</Trans>} />}
								{sidebarStarts && <Divider label={<Trans>Sidebar</Trans>} subtle />}
								<OutlineSection
									sectionId={row.id}
									locked={locked}
									page={page}
									onMove={(direction) => move(row.id, rows[direction === "up" ? index - 1 : index + 1], direction)}
								/>
							</Fragment>
						);
					})}
				</div>
			</SortableContext>
		</DndContext>
	);
}

function Divider({ label, subtle = false }: { label: React.ReactNode; subtle?: boolean }) {
	return (
		<div className="flex items-center gap-2 px-1 pt-2 pb-1">
			<span
				className={
					subtle ? "text-[11px] text-ink-3" : "text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase"
				}
			>
				{label}
			</span>
			<span className="h-px flex-1 bg-line" />
		</div>
	);
}

type OutlineSectionProps = {
	sectionId: string;
	locked: boolean;
	page: PageSettings;
	onMove: (direction: "up" | "down") => void;
};

function OutlineSection({ sectionId, locked, page, onMove }: OutlineSectionProps) {
	const { i18n } = useLingui();
	// Select the type (a string) rather than a new section object, so the row renders only when it changes.
	const type = useCurrentBuilderResumeSelector((resume) => getSectionType(resume.data, sectionId) ?? null);
	const stableSection = useMemo<WriteSection | null>(
		() => (type ? { id: sectionId, kind: getSectionKind(sectionId), type } : null),
		[sectionId, type],
	);
	if (!stableSection) return null;

	return (
		<SectionRow section={stableSection} locked={locked} onMove={onMove}>
			{stableSection.kind === "summary" ? (
				<SummaryEditor locked={locked} />
			) : (
				<>
					<EntryList section={stableSection} locked={locked} page={page} />
					{!locked && (
						<button
							type="button"
							onClick={() => addEntryTo(stableSection)}
							className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-accent-text hover:bg-hover"
						>
							<Icon name="add" size={18} />
							{i18n._(ADD_LABELS[stableSection.type])}
						</button>
					)}
				</>
			)}
		</SectionRow>
	);
}

type EntryListProps = { section: WriteSection; locked: boolean; page: PageSettings };

/** Entries reorder like sections: drag the card's handle, or ⌥↑ / ⌥↓ on its title. */
function EntryList({ section, locked, page }: EntryListProps) {
	const ids = useCurrentBuilderResumeSelector((resume) =>
		getEntries(resume.data, section)
			.map((entry) => entry.id)
			.join("\u0000"),
	);
	const entryIds = useMemo(() => (ids ? ids.split("\u0000") : []), [ids]);
	const updateResumeData = useUpdateResumeData();
	const sensors = useSortSensors();

	const move = (entryId: string, to: number) => {
		if (to < 0 || to >= entryIds.length) return;
		updateResumeData(
			(draft) => {
				const entries = getEntries(draft, section);
				const from = entries.findIndex((entry) => entry.id === entryId);
				const [entry] = entries.splice(from, 1);
				if (entry) entries.splice(to, 0, entry);
			},
			{ newStep: true },
		);
	};

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		move(String(active.id), entryIds.indexOf(String(over.id)));
	};

	return (
		<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
			<SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
				{entryIds.map((entryId, index) => (
					<EntryCard
						key={entryId}
						section={section}
						entryId={entryId}
						index={index}
						count={entryIds.length}
						page={page}
						locked={locked}
						onMove={(id, direction) => move(id, direction === "up" ? index - 1 : index + 1)}
					/>
				))}
			</SortableContext>
		</DndContext>
	);
}
