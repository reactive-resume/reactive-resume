import type { PageSettings } from "./entries";
import type { Entry, WriteSection } from "./model";
import type { MessageDescriptor } from "@lingui/core";
import type { KeyboardEvent, ReactNode } from "react";
import { useDirection } from "@base-ui/react/direction-provider";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { AnimatePresence, m } from "motion/react";
import { useEffect, useMemo } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Collapsible, CollapsibleContent } from "@reactive-resume/ui/components/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { useEditorStore } from "../store";
import { EntryFields } from "./entries";
import { useEntry, useEntryWriter } from "./fields";
import { createEntry, describeEntry, getEntries, getPrimaryField, isDraftEntry } from "./model";
import { entryElementId, keepOpenedEntryInView } from "./reveal";
import { useSectionTitle } from "./section-row";
import { useCurrentResume, useResumeStore, useUpdateResumeData } from "@/features/resume/builder/draft";
import { D3, DRAG_SETTLE, EASE, EXIT } from "@/libs/motion";
import { getCompatibleMoveTargets, getSourceSectionTitle, moveItem } from "@/libs/resume/move-item";

const DRAFT_HINTS: Record<string, MessageDescriptor> = {
	company: msg`Appears on the page once it has a company.`,
	school: msg`Appears on the page once it has a school.`,
	name: msg`Appears on the page once it has a name.`,
	language: msg`Appears on the page once it has a language.`,
	title: msg`Appears on the page once it has a title.`,
	organization: msg`Appears on the page once it has an organization.`,
	network: msg`Appears on the page once it has a network.`,
};

type EntryCardProps = {
	section: WriteSection;
	entryId: string;
	index: number;
	count: number;
	page: PageSettings;
	locked: boolean;
	/** ⌥↑ / ⌥↓ on the title. */
	onMove: (entryId: string, direction: "up" | "down") => void;
};

/**
 * An entry in the outline. Collapsed: its title and "company · location · dates". Open (one at a time, the
 * editor's selection): its fields, saved as you type. Deleting is immediate, with Undo in the toast.
 */
export function EntryCard({ section, entryId, index, count, page, locked, onMove }: EntryCardProps) {
	const { i18n } = useLingui();
	const entry = useEntry(section.id, entryId);
	const write = useEntryWriter(section.id, entryId);
	const open = useEditorStore((state) => state.selection?.kind === "item" && state.selection.itemId === entryId);
	const autoFocus = useEditorStore((state) => state.focusEntryId === entryId);
	const select = useEditorStore((state) => state.select);
	const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({
		id: entryId,
		disabled: locked,
		transition: DRAG_SETTLE,
	});
	const isPhone = useBreakpoint() === "mobile";

	// The first field took focus as it mounted; later openings shouldn't steal focus again.
	useEffect(() => {
		if (autoFocus) useEditorStore.getState().setFocusEntry(null);
	}, [autoFocus]);

	if (!entry) return null;

	const { title, meta } = describeEntry(section.type, entry);
	const draft = isDraftEntry(section.type, entry);
	const primaryField = getPrimaryField(section.type);
	const hint = draft && primaryField ? DRAFT_HINTS[primaryField] : undefined;

	const toggle = () => {
		select(open ? null : { kind: "item", sectionId: section.id, itemId: entryId });
		if (!open) keepOpenedEntryInView(entryId);
	};
	const fields = (
		<>
			{hint && <p className="col-span-full text-xs text-ink-3">{i18n._(hint)}</p>}
			<EntryFields type={section.type} entry={entry} write={write} page={page} autoFocus={autoFocus} />
		</>
	);

	const onTitleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
		event.preventDefault();
		onMove(entryId, event.key === "ArrowUp" ? "up" : "down");
	};

	return (
		<div
			ref={setNodeRef}
			id={entryElementId(entryId)}
			data-entry-id={entryId}
			style={{ transform: CSS.Translate.toString(transform), transition: transition }}
			className={cn(
				"group/entry relative scroll-mt-[60px] rounded-[10px] border border-line bg-surface transition-[border-color,box-shadow] duration-quick ease-enter",
				open && "border-accent shadow-e1",
				isDragging && "z-10 bg-raised shadow-e2",
			)}
		>
			<div className="flex items-center gap-0.5 pe-1">
				{!locked && (
					<button
						type="button"
						aria-label={t`Reorder ${title || t`Untitled`}`}
						className="-ms-px flex h-10 w-5 shrink-0 cursor-grab items-center justify-center text-ink-3 opacity-0 transition-opacity duration-quick group-hover/entry:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
						{...attributes}
						{...listeners}
					>
						<Icon name="drag_indicator" size={16} />
					</button>
				)}
				<button
					type="button"
					aria-expanded={open}
					aria-label={t`${title || t`Untitled`}, entry ${index + 1} of ${count}`}
					onClick={toggle}
					onKeyDown={onTitleKeyDown}
					className={cn(
						"flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-[9px] py-2.5 pe-2 text-start",
						locked ? "ps-3" : "ps-0.5",
					)}
				>
					<span className="flex max-w-full items-center gap-2">
						<span className={cn("truncate text-[13px] leading-[18px] font-semibold", !title && "text-ink-3")}>
							{title || <Trans>Untitled</Trans>}
						</span>
						{draft && (
							<Badge variant="neutral" className="shrink-0">
								<Trans>Draft</Trans>
							</Badge>
						)}
						{entry.hidden && (
							<Badge variant="outline" className="shrink-0">
								<Trans>Hidden</Trans>
							</Badge>
						)}
					</span>
					{meta && <span className="max-w-full truncate text-xs leading-4 text-ink-3">{meta}</span>}
				</button>

				{open && !locked && (
					<IconButton
						icon="delete"
						label={t`Delete entry`}
						size="icon-sm"
						className="text-ink-2 hover:bg-danger-soft hover:text-danger-text"
						onClick={() => deleteEntry(section, entryId)}
					/>
				)}
				{!locked && <EntryMenu section={section} entry={entry} />}
			</div>

			{!isPhone && (
				<Collapsible open={open}>
					<CollapsibleContent>
						<fieldset
							disabled={locked}
							className="m-0 grid min-w-0 gap-y-2.5 border-0 border-t border-line px-3 pt-3 pb-3.5"
						>
							{fields}
						</fieldset>
					</CollapsibleContent>
				</Collapsible>
			)}

			<AnimatePresence>
				{open && isPhone && (
					<PhoneEntryScreen
						key="entry"
						section={section}
						title={title}
						locked={locked}
						onDelete={() => deleteEntry(section, entryId)}
						onBack={() => select(null)}
					>
						{fields}
					</PhoneEntryScreen>
				)}
			</AnimatePresence>
		</div>
	);
}

type PhoneEntryScreenProps = {
	section: WriteSection;
	title: string;
	locked: boolean;
	onBack: () => void;
	onDelete: () => void;
	children: ReactNode;
};

/** Phones: an open entry pushes in full screen, with a back label naming its section and 44px fields. */
function PhoneEntryScreen({ section, title, locked, onBack, onDelete, children }: PhoneEntryScreenProps) {
	const sectionTitle = useSectionTitle(section);
	// Off-screen at the end edge: the screen pushes in from there and goes back there.
	const offscreen = useDirection() === "rtl" ? "translateX(-100%)" : "translateX(100%)";

	return (
		<m.div
			role="dialog"
			aria-label={title || t`Untitled`}
			className="fixed inset-0 z-40 flex flex-col bg-surface pb-[env(safe-area-inset-bottom)]"
			initial={{ transform: offscreen }}
			animate={{ transform: "translateX(0%)", transition: { duration: D3, ease: EASE } }}
			exit={{ transform: offscreen, transition: { duration: D3 * EXIT, ease: EASE } }}
		>
			<div className="flex h-14 shrink-0 items-center gap-1 border-b border-line px-1.5">
				<button
					type="button"
					onClick={onBack}
					className="flex h-11 items-center gap-0.5 rounded-lg px-2 text-[15px] font-medium text-accent-text"
				>
					<Icon name="chevron_left" size={24} />
					{sectionTitle}
				</button>
				<span className="min-w-0 flex-1" />
				{!locked && (
					<IconButton icon="delete" label={t`Delete entry`} className="text-danger-text" onClick={onDelete} />
				)}
			</div>
			<fieldset
				disabled={locked}
				className="m-0 grid min-w-0 flex-1 auto-rows-min gap-y-3 overflow-y-auto border-0 p-4 [&_input]:h-11"
			>
				{children}
			</fieldset>
		</m.div>
	);
}

function deleteEntry(section: WriteSection, entryId: string) {
	const { updateResumeData, undo } = useResumeStore.getState();
	updateResumeData(
		(draft) => {
			const entries = getEntries(draft, section);
			const index = entries.findIndex((entry) => entry.id === entryId);
			if (index !== -1) entries.splice(index, 1);
		},
		{ newStep: true },
	);
	useEditorStore.getState().select(null);
	toast.add({ description: t`Entry deleted`, actionProps: { children: t`Undo`, onClick: undo } });
}

type EntryMenuProps = { section: WriteSection; entry: Entry };

/** Hide from page, Duplicate, Move to… and Delete. */
function EntryMenu({ section, entry }: EntryMenuProps) {
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

	const move = (target: Parameters<typeof moveItem>[1]["target"]) =>
		updateResumeData((draft) => moveItem(draft, { itemId: entry.id, type: section.type, customSectionId, target }), {
			newStep: true,
		});

	const duplicate = () => {
		const copy = { ...structuredClone(entry), id: createEntry(section.type).id } as Entry;
		updateResumeData(
			(draft) => {
				const entries = getEntries(draft, section);
				entries.splice(entries.findIndex((item) => item.id === entry.id) + 1, 0, copy);
			},
			{ newStep: true },
		);
		useEditorStore.getState().select({ kind: "item", sectionId: section.id, itemId: copy.id });
	};

	const toggleHidden = () =>
		updateResumeData(
			(draft) => {
				const target = getEntries(draft, section).find((item) => item.id === entry.id);
				if (target) target.hidden = !target.hidden;
			},
			{ newStep: true },
		);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<IconButton icon="more_horiz" label={t`Entry options`} size="icon-sm" className="text-ink-2" />}
			/>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuItem onClick={toggleHidden}>
					<Icon name={entry.hidden ? "visibility" : "visibility_off"} />
					{entry.hidden ? <Trans>Show on page</Trans> : <Trans>Hide from page</Trans>}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={duplicate}>
					<Icon name="content_copy" />
					<Trans>Duplicate</Trans>
				</DropdownMenuItem>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<Icon name="arrow_forward" />
						<Trans>Move to…</Trans>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="w-56">
						{moveTargets.map(({ pageIndex, sections }) => (
							<DropdownMenuSub key={pageIndex}>
								<DropdownMenuSubTrigger>
									<Icon name="description" />
									<Trans>Page {pageIndex + 1}</Trans>
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent>
									{sections.map(({ sectionId, sectionTitle }) => (
										<DropdownMenuItem key={sectionId} onClick={() => move({ type: "section", sectionId })}>
											{sectionTitle}
										</DropdownMenuItem>
									))}
									{sections.length > 0 && <DropdownMenuSeparator />}
									<DropdownMenuItem onClick={() => move({ type: "new-section", title: sourceTitle, pageIndex })}>
										<Icon name="add" />
										<Trans>New section</Trans>
									</DropdownMenuItem>
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						))}
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={() => move({ type: "new-page", title: sourceTitle })}>
							<Icon name="note_add" />
							<Trans>New page</Trans>
						</DropdownMenuItem>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSeparator />
				<DropdownMenuItem variant="destructive" onClick={() => deleteEntry(section, entry.id)}>
					<Icon name="delete" />
					<Trans>Delete</Trans>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
