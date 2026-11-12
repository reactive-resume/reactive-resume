import type { Entry, WriteSection } from "./model";
import type { DndLabel } from "@/libs/dnd";
import type { KeyboardEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { i18n } from "@lingui/core";
import { ph, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMemo } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { formatShortcut } from "@reactive-resume/ui/components/kbd";
import { cn } from "@reactive-resume/utils/style";
import { useEditorStore } from "../store";
import { openEntry } from "./actions";
import { useEntry } from "./fields";
import { createEntry, describeEntry, getEntries, getSectionObject, isDraftEntry } from "./model";
import { entryElementId } from "./reveal";
import { ListRow } from "@/components/calm/list-row";
import { useCurrentResume, useResumeStore, useUpdateResumeData } from "@/features/resume/builder/draft";
import { undoToast } from "@/features/resume/builder/undo-toast";
import { announce } from "@/libs/announce";
import { DRAG_SETTLE } from "@/libs/motion";
import { getCompatibleMoveTargets, getSourceSectionTitle, moveItem } from "@/libs/resume/move-item";

/** Moves an entry to another place in its section: one undo step, read out when asked. */
export function moveEntry(section: WriteSection, entryId: string, to: number, announced = false) {
	const { resume, updateResumeData } = useResumeStore.getState();
	const before = resume?.data;
	const entries = before ? getEntries(before, section) : [];
	if (to < 0 || to >= entries.length) return;
	const entry = entries.find((item) => item.id === entryId);
	if (!entry) return;
	updateResumeData(
		(draft) => {
			const items = getEntries(draft, section);
			const from = items.findIndex((item) => item.id === entryId);
			const [moved] = items.splice(from, 1);
			if (moved) items.splice(to, 0, moved);
		},
		{ newStep: true },
	);
	// Said only when the move applied: a locked resume leaves the data as it was.
	if (!announced || useResumeStore.getState().resume?.data === before) return;
	const title = entry ? describeEntry(section.type, entry).title || t`Untitled` : t`Untitled`;
	announce(t`${title}, entry ${i18n.number(to + 1)} of ${i18n.number(entries.length)}`);
}

export function setEntryHidden(section: WriteSection, entryId: string, hidden: boolean) {
	useResumeStore.getState().updateResumeData(
		(draft) => {
			const target = getEntries(draft, section).find((item) => item.id === entryId);
			if (target) target.hidden = hidden;
		},
		{ newStep: true },
	);
}

type EntryRowProps = {
	section: WriteSection;
	entryId: string;
	index: number;
	count: number;
	locked: boolean;
};

/**
 * An entry in its section's list: its name, one quiet line ("role · dates"), and the eye and "…" at the end. The row
 * opens the entry. Drag the grip, or press ⌥↑ / ⌥↓ on the row; the menu has Move up and Move down too. A hidden
 * entry stays listed, dimmed, with the word Hidden. Deleting is immediate, with Undo in the toast.
 */
export function EntryRow({ section, entryId, index, count, locked }: EntryRowProps) {
	const entry = useEntry(section.id, entryId);
	const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({
		id: entryId,
		data: { label: (entry && describeEntry(section.type, entry).title) || t`Untitled` } satisfies DndLabel,
		disabled: locked,
		transition: DRAG_SETTLE,
	});

	if (!entry) return null;

	const { title, meta } = describeEntry(section.type, entry);
	const name = title || t`Untitled`;
	const draft = isDraftEntry(section.type, entry);
	const hidden = entry.hidden;

	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
		event.preventDefault();
		moveEntry(section, entryId, event.key === "ArrowUp" ? index - 1 : index + 1, true);
	};

	return (
		<ListRow
			ref={setNodeRef}
			id={entryElementId(entryId)}
			data-entry-id={entryId}
			role="listitem"
			style={{ transform: CSS.Translate.toString(transform), transition }}
			interactive
			className={cn("gap-2.5", isDragging && "z-10 before:bg-raised before:shadow-e2")}
			leading={
				locked ? undefined : (
					<button
						type="button"
						aria-label={t({
							comment: "An entry's drag handle in a resume section",
							message: `Reorder ${name}. Drag, or press Option and an arrow key`,
						})}
						className="touch-target relative z-10 -me-0.5 flex w-4 shrink-0 cursor-grab justify-center rounded-xs text-ink-3 hover:text-ink active:cursor-grabbing"
						{...attributes}
						{...listeners}
					>
						<Icon name="dots-six-vertical" size={16} />
					</button>
				)
			}
			variant={hidden || !title ? "dim" : "default"}
			title={
				draft || hidden ? (
					<span className="flex items-center gap-2">
						<span dir="auto" className="truncate">
							{name}
						</span>
						{draft && <Badge variant="neutral">{t`Draft`}</Badge>}
						{hidden && <Badge variant="outline">{t`Hidden`}</Badge>}
					</span>
				) : (
					name
				)
			}
			subtitle={meta || undefined}
			trailing={
				locked ? undefined : (
					<span className="flex items-center gap-0.5">
						<IconButton
							icon={hidden ? "eye-slash" : "eye"}
							label={hidden ? t`Show on page: ${name}` : t`Hide from page: ${name}`}
							aria-pressed={hidden}
							size="icon-sm"
							// The eye waits for the pointer or the keyboard; on a hidden entry it is how to bring it back.
							className={cn(
								!hidden &&
									"hidden group-focus-within/row:inline-flex group-hover/row:inline-flex pointer-coarse:inline-flex",
							)}
							onClick={() => setEntryHidden(section, entryId, !hidden)}
						/>
						<EntryMenu section={section} entry={entry} index={index} count={count} onEdit />
					</span>
				)
			}
		>
			<span
				id={`${entryId}-position`}
				className="sr-only"
			>{t`Entry ${i18n.number(index + 1)} of ${ph({ count: i18n.number(count) })}`}</span>
			<button
				type="button"
				aria-label={name}
				data-entry-open=""
				aria-describedby={`${entryId}-position`}
				onClick={() => openEntry(section.id, entryId)}
				onKeyDown={onKeyDown}
				className="absolute -inset-x-3 inset-y-0 rounded-md"
			/>
		</ListRow>
	);
}

/** Deletes an entry at once; the toast names it and puts it back where it was. */
export function deleteEntry(section: WriteSection, entryId: string) {
	const { resume, updateResumeData } = useResumeStore.getState();
	const entries = resume ? getEntries(resume.data, section) : [];
	const index = entries.findIndex((entry) => entry.id === entryId);
	const deleted = entries[index];
	if (!deleted) return;
	if (entries.length === 1) useEditorStore.getState().markSectionAdded(section.id);
	updateResumeData(
		(draft) => {
			const items = getEntries(draft, section);
			const at = items.findIndex((entry) => entry.id === entryId);
			if (at !== -1) items.splice(at, 1);
		},
		{ newStep: true },
	);
	// The open entry is gone: back to its section's list.
	const { selection } = useEditorStore.getState();
	if (selection?.kind === "item" && selection.itemId === entryId)
		useEditorStore.setState({ selection: { kind: "section", sectionId: section.id } });
	// Keyboard and screen-reader users keep their place: the entry before (or after) it, else the section's Add.
	const neighbour = entries[index - 1] ?? entries[index + 1];
	requestAnimationFrame(() => {
		const target = neighbour
			? document.getElementById(entryElementId(neighbour.id))?.querySelector<HTMLElement>("button[data-entry-open]")
			: document.querySelector<HTMLElement>(`[data-add-entry="${globalThis.CSS.escape(section.id)}"]`);
		target?.focus();
	});
	const title = describeEntry(section.type, deleted).title;
	undoToast(title ? t`“${title}” deleted` : t`Entry deleted`, {
		// Later edits came after the delete: put the entry back where it was.
		restore: () => {
			const current = useResumeStore.getState().resume;
			// Its section was deleted since: there's nowhere to put it back.
			if (!current || !getSectionObject(current.data, section)) return false;
			if (getEntries(current.data, section).some((entry) => entry.id === entryId)) return false;
			useResumeStore.getState().updateResumeData(
				(draft) => {
					const items = getEntries(draft, section);
					items.splice(Math.min(index, items.length), 0, structuredClone(deleted));
				},
				{ newStep: true },
			);
			return true;
		},
	});
}

type EntryMenuProps = {
	section: WriteSection;
	entry: Entry;
	index: number;
	count: number;
	/** In a list, the menu starts with Edit; the open entry has no need for it. */
	onEdit?: boolean;
};

/** Edit, Duplicate, Hide from page · Move up, Move down, Move to · Delete entry. Every drag has its twin here. */
export function EntryMenu({ section, entry, index, count, onEdit = false }: EntryMenuProps) {
	const resume = useCurrentResume();
	const updateResumeData = useUpdateResumeData();
	const customSectionId = section.kind === "custom" ? section.id : undefined;
	const moveTargets = useMemo(
		() => getCompatibleMoveTargets(resume.data, section.type, customSectionId),
		[resume.data, section.type, customSectionId],
	);
	const sourceTitle = useMemo(
		() => getSourceSectionTitle(resume.data, section.type, customSectionId),
		[resume.data, section.type, customSectionId],
	);
	const name = describeEntry(section.type, entry).title || t`Untitled`;

	const move = (target: Parameters<typeof moveItem>[1]["target"]) => {
		updateResumeData((draft) => moveItem(draft, { itemId: entry.id, type: section.type, customSectionId, target }), {
			newStep: true,
		});
		// It left this section: the panel goes back to the list it came from.
		const { selection } = useEditorStore.getState();
		if (selection?.kind === "item" && selection.itemId === entry.id)
			useEditorStore.setState({ selection: { kind: "section", sectionId: section.id } });
	};

	const duplicate = () => {
		const copy = { ...structuredClone(entry), id: createEntry(section.type).id } as Entry;
		updateResumeData(
			(draft) => {
				const entries = getEntries(draft, section);
				entries.splice(entries.findIndex((item) => item.id === entry.id) + 1, 0, copy);
			},
			{ newStep: true },
		);
		openEntry(section.id, copy.id);
	};

	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger
				render={
					<IconButton
						icon="dots-three"
						label={t`More for ${name}`}
						size="icon-sm"
						className="aria-expanded:bg-press aria-expanded:text-ink"
					/>
				}
			/>
			<DropdownMenuContent
				align="start"
				side="right"
				sideOffset={9}
				alignOffset={-6}
				aria-label={name}
				className="w-[216px] min-w-0"
			>
				{onEdit && (
					<DropdownMenuItem onClick={() => openEntry(section.id, entry.id)}>
						<Icon name="pencil-simple" />
						<Trans>Edit</Trans>
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onClick={duplicate}>
					<Icon name="copy" />
					<Trans>Duplicate</Trans>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => setEntryHidden(section, entry.id, !entry.hidden)}>
					<Icon name={entry.hidden ? "eye" : "eye-slash"} />
					{entry.hidden ? <Trans>Show on page</Trans> : <Trans>Hide from page</Trans>}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem disabled={index === 0} onClick={() => moveEntry(section, entry.id, index - 1, true)}>
					<Icon name="arrow-up" />
					<Trans>Move up</Trans>
					<DropdownMenuShortcut className="text-xs">{formatShortcut("⌥↑")}</DropdownMenuShortcut>
				</DropdownMenuItem>
				<DropdownMenuItem disabled={index === count - 1} onClick={() => moveEntry(section, entry.id, index + 1, true)}>
					<Icon name="arrow-down" />
					<Trans>Move down</Trans>
					<DropdownMenuShortcut className="text-xs">{formatShortcut("⌥↓")}</DropdownMenuShortcut>
				</DropdownMenuItem>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<Icon name="arrow-bend-up-right" />
						<Trans>Move to</Trans>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="w-56">
						{moveTargets.map(({ pageIndex, sections }) => (
							<DropdownMenuSub key={pageIndex}>
								<DropdownMenuSubTrigger>
									<Icon name="file-text" />
									<Trans>Page {i18n.number(pageIndex + 1)}</Trans>
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent>
									{sections.map(({ sectionId, sectionTitle }) => (
										<DropdownMenuItem key={sectionId} onClick={() => move({ type: "section", sectionId })}>
											{sectionTitle}
										</DropdownMenuItem>
									))}
									{sections.length > 0 && <DropdownMenuSeparator />}
									<DropdownMenuItem onClick={() => move({ type: "new-section", title: sourceTitle, pageIndex })}>
										<Icon name="plus" />
										<Trans>New section</Trans>
									</DropdownMenuItem>
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						))}
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={() => move({ type: "new-page", title: sourceTitle })}>
							<Icon name="file-plus" />
							<Trans>New page</Trans>
						</DropdownMenuItem>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSeparator />
				<DropdownMenuItem variant="destructive" onClick={() => deleteEntry(section, entry.id)}>
					<Icon name="trash" />
					<Trans>Delete entry</Trans>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
