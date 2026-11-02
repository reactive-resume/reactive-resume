import type { WriteSection } from "./model";
import type { DndLabel } from "@/libs/dnd";
import type { SectionType } from "@reactive-resume/schema/resume/data";
import type { KeyboardEvent, ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useState } from "react";
import { sortSectionItemsByPeriod } from "@reactive-resume/resume/section-sort";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Collapsible, CollapsibleContent } from "@reactive-resume/ui/components/collapsible";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { toast } from "@reactive-resume/ui/components/toast";
import { formatList } from "@reactive-resume/utils/locale";
import { cn } from "@reactive-resume/utils/style";
import { pendingProposals } from "../proposals/proposals";
import { useEditorStore } from "../store";
import { addEntryTo } from "./actions";
import { countEntriesToCheck, getEntries, getSectionObject } from "./model";
import { IconPicker } from "@/components/input/icon-picker";
import { useCurrentBuilderResumeSelector, useResumeStore, useUpdateResumeData } from "@/features/resume/builder/draft";
import { undoToast } from "@/features/resume/builder/undo-toast";
import { usePrompt } from "@/hooks/use-confirm";
import { DRAG_SETTLE } from "@/libs/motion";
import { getSectionTitle } from "@/libs/resume/section";

/** The printed title: the one the user gave, else the section type's name. */
export function useSectionTitle(section: WriteSection) {
	const title = useCurrentBuilderResumeSelector((resume) => getSectionObject(resume.data, section)?.title ?? "");
	return (
		title.trim() || getSectionTitle(section.kind === "custom" ? section.type : (section.id as SectionType | "summary"))
	);
}

type SectionRowProps = {
	section: WriteSection;
	locked: boolean;
	/** The page and column the row prints in, read out while it's dragged. */
	dragGroup?: string | undefined;
	/** ⌥↑ / ⌥↓ on the focused title. Hidden sections sit outside the print order, so they have none. */
	onMove?: ((direction: "up" | "down") => void) | undefined;
	children: ReactNode;
};

/**
 * An outline row: drag handle, title (opens the section), entry count, the eye (hidden sections keep their
 * content but aren't printed), the chevron and the ⋯ menu. Open, it shows the section's entries.
 */
export function SectionRow({ section, locked, dragGroup, onMove, children }: SectionRowProps) {
	const title = useSectionTitle(section);
	const hidden = useCurrentBuilderResumeSelector((resume) => getSectionObject(resume.data, section)?.hidden ?? false);
	const count = useCurrentBuilderResumeSelector((resume) => getEntries(resume.data, section).length);
	// Dates read from text that wasn't exact ask for a look (they print as typed until then).
	const toCheck = useCurrentBuilderResumeSelector((resume) => countEntriesToCheck(getEntries(resume.data, section)));
	const proposed = useProposedCount(section.id);
	const open = useEditorStore((state) => state.openSections.includes(section.id));
	const setOpen = useEditorStore((state) => state.setSectionOpen);
	const updateResumeData = useUpdateResumeData();
	const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({
		id: section.id,
		data: { label: title, group: dragGroup } satisfies DndLabel,
		disabled: locked || hidden,
		transition: DRAG_SETTLE,
	});

	const toggleHidden = () =>
		updateResumeData(
			(draft) => {
				const target = getSectionObject(draft, section);
				if (target) target.hidden = !target.hidden;
			},
			{ newStep: true },
		);

	const onTitleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
		event.preventDefault();
		onMove?.(event.key === "ArrowUp" ? "up" : "down");
	};

	return (
		<div
			ref={setNodeRef}
			id={`sidebar-${section.id}`}
			data-section-id={section.id}
			style={{ transform: CSS.Translate.toString(transform), transition: transition }}
			className={cn(
				"relative scroll-mt-[60px] rounded-lg transition-shadow duration-quick ease-enter",
				isDragging && "z-10 bg-raised shadow-e2",
			)}
		>
			<div className="group/row flex h-11 items-center gap-0.5 rounded-lg pe-1 hover:bg-hover">
				<button
					type="button"
					aria-label={t`Reorder ${title}`}
					disabled={locked || hidden}
					className={cn(
						"flex h-11 w-7 shrink-0 cursor-grab items-center justify-center text-ink-3 active:cursor-grabbing disabled:cursor-default",
						hidden && "opacity-40",
					)}
					{...attributes}
					{...listeners}
				>
					<Icon name="dots-six-vertical" size={18} />
				</button>

				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen(section.id, !open)}
					onKeyDown={onTitleKeyDown}
					className={cn(
						"min-w-0 flex-1 truncate rounded-md py-1 text-start text-sm font-medium",
						hidden && "text-ink-3 line-through",
					)}
				>
					{title}
				</button>

				{proposed > 0 && (
					<Badge variant="accent" className="shrink-0">
						<Plural value={proposed} one="# proposed" other="# proposed" />
					</Badge>
				)}
				{toCheck > 0 && (
					<Badge variant="warn" className="shrink-0">
						<Plural value={toCheck} one="# to check" other="# to check" />
					</Badge>
				)}
				{section.kind !== "summary" && (
					<span className="px-1 font-mono text-xs text-ink-3">
						<span aria-hidden="true">{count}</span>
						<span className="sr-only">{plural(count, { one: "# entry", other: "# entries" })}</span>
					</span>
				)}

				<IconButton
					icon={hidden ? "eye-slash" : "eye"}
					label={hidden ? t`Show ${title} on the page` : t`Hide ${title} from the page`}
					aria-pressed={hidden}
					size="icon-sm"
					disabled={locked}
					className="text-ink-2"
					onClick={toggleHidden}
				/>
				<IconButton
					icon="caret-down"
					label={open ? t`Close ${title}` : t`Open ${title}`}
					size="icon-sm"
					// Closing turns back as fast as the panel collapses (70% of the standard duration), not after it.
					className={cn(
						"text-ink-2 transition-transform duration-standard ease-enter",
						open ? "rotate-180" : "duration-[calc(var(--d2)*0.7)]",
					)}
					onClick={() => setOpen(section.id, !open)}
				/>
				{!locked && <SectionMenu section={section} title={title} onMove={onMove} />}
			</div>

			<Collapsible open={open}>
				<CollapsibleContent>
					<div className="grid gap-2 ps-[26px] pt-1 pb-3">{children}</div>
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
}

type SectionMenuProps = Pick<SectionRowProps, "section" | "onMove"> & { title: string };

/** Everything else a section can do: add, sort, heading, rename, icon, layout and reset or delete. */
function SectionMenu({ section, title, onMove }: SectionMenuProps) {
	const prompt = usePrompt();
	const updateResumeData = useUpdateResumeData();
	const settings = useCurrentBuilderResumeSelector((resume) => getSectionObject(resume.data, section) ?? null);
	const locale = useCurrentBuilderResumeSelector((resume) => resume.data.metadata.page.locale);
	const [iconPickerOpen, setIconPickerOpen] = useState(false);
	if (!settings) return null;

	const edit = (mutate: (target: NonNullable<ReturnType<typeof getSectionObject>>) => void) =>
		updateResumeData(
			(draft) => {
				const target = getSectionObject(draft, section);
				if (target) mutate(target);
			},
			{ newStep: true },
		);

	const isSkills = section.type === "skills";
	const canSort = section.type === "experience" || section.type === "education";
	const columns =
		isSkills && (settings as { layout?: string }).layout === "inline" ? "inline" : String(settings.columns);

	const sortByDate = () => {
		let unresolved: string[] = [];
		updateResumeData(
			(draft) => {
				const entries = getEntries(draft, section) as never as {
					id: string;
					period: string;
					company?: string;
					school?: string;
				}[];
				const result = sortSectionItemsByPeriod(entries, locale);
				unresolved = result.unresolvedIds.map((id) => {
					const entry = entries.find((item) => item.id === id);
					return (entry?.company || entry?.school || id).trim();
				});
				entries.splice(0, entries.length, ...result.items);
			},
			{ newStep: true },
		);
		if (unresolved.length > 0) {
			const entries = formatList(i18n.locale, unresolved);
			toast.add({
				type: "warning",
				description: t`Couldn't read the dates on ${entries}, so they stay at the end. Fix their dates and sort again.`,
			});
		}
	};

	const rename = async () => {
		const next = await prompt(t`Rename section`, {
			description: t`Leave it empty to use the original title.`,
			defaultValue: settings.title,
		});
		if (next === null || next === settings.title) return;
		edit((target) => {
			target.title = next;
		});
	};

	const reset = () => {
		const before = "items" in settings ? { items: settings.items } : { content: settings.content };
		edit((target) => {
			if ("items" in target) target.items = [];
			else target.content = "";
		});
		undoToast(t`${title} cleared`, {
			// Later edits came after the clear: put the entries back if the section is still empty.
			restore: () => {
				const data = useResumeStore.getState().resume?.data;
				const target = data ? getSectionObject(data, section) : undefined;
				const empty = target ? ("items" in target ? target.items.length === 0 : !target.content) : false;
				if (!empty) return false;
				edit((draft) => {
					if ("items" in draft && "items" in before) draft.items = structuredClone(before.items) as typeof draft.items;
					else if ("content" in draft && "content" in before) draft.content = before.content;
				});
				return true;
			},
		});
	};

	const remove = () => {
		const data = useResumeStore.getState().resume?.data;
		const custom = data?.customSections.find((item) => item.id === section.id);
		const places = layoutPlaces(data?.metadata.layout.pages ?? [], section.id);
		updateResumeData(
			(draft) => {
				draft.customSections = draft.customSections.filter((custom) => custom.id !== section.id);
				for (const page of draft.metadata.layout.pages) {
					page.main = page.main.filter((id) => id !== section.id);
					page.sidebar = page.sidebar.filter((id) => id !== section.id);
				}
			},
			{ newStep: true },
		);
		undoToast(t`${title} deleted`, {
			// Later edits came after the delete: add the section back where it was.
			restore: () => {
				const data = useResumeStore.getState().resume?.data;
				if (!custom || !data || data.customSections.some((item) => item.id === custom.id)) return false;
				updateResumeData(
					(draft) => {
						draft.customSections.push(structuredClone(custom));
						restoreToLayout(draft.metadata.layout.pages, custom.id, places);
					},
					{ newStep: true },
				);
				return true;
			},
		});
	};

	return (
		<span className="relative">
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<IconButton icon="dots-three" label={t`Options for ${title}`} size="icon-sm" className="text-ink-2" />
					}
				/>
				<DropdownMenuContent align="end" className="w-60">
					{section.kind !== "summary" && (
						<DropdownMenuItem onClick={() => addEntryTo(section)}>
							<Icon name="plus" />
							<Trans>Add entry</Trans>
						</DropdownMenuItem>
					)}
					{canSort && (
						<DropdownMenuItem onClick={sortByDate}>
							<Icon name="arrow-down" />
							<Trans>Sort by date</Trans>
						</DropdownMenuItem>
					)}
					{onMove && (
						<>
							<DropdownMenuItem onClick={() => onMove("up")}>
								<Icon name="arrow-up" />
								<Trans>Move up</Trans>
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => onMove("down")}>
								<Icon name="arrow-down" />
								<Trans>Move down</Trans>
							</DropdownMenuItem>
						</>
					)}
					<DropdownMenuItem onClick={rename}>
						<Icon name="pencil-simple" />
						<Trans>Rename…</Trans>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => setIconPickerOpen(true)}>
						<Icon name="bookmark-simple" />
						<Trans>Icon…</Trans>
					</DropdownMenuItem>
					<DropdownMenuCheckboxItem
						checked={settings.showHeading !== false}
						onCheckedChange={(checked) =>
							edit((target) => {
								target.showHeading = checked;
							})
						}
					>
						<Trans>Show heading</Trans>
					</DropdownMenuCheckboxItem>
					<DropdownMenuSeparator />
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<Icon name="squares-four" />
							<Trans>Columns</Trans>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							<DropdownMenuRadioGroup
								value={columns}
								onValueChange={(value) =>
									edit((target) => {
										const skills = target as { layout?: string };
										if (isSkills) skills.layout = value === "inline" ? "inline" : "default";
										target.columns = value === "inline" ? 1 : Number(value);
									})
								}
							>
								{[1, 2, 3, 4, 5, 6].map((column) => (
									<DropdownMenuRadioItem key={column} value={String(column)}>
										<Plural value={column} one="# column" other="# columns" />
									</DropdownMenuRadioItem>
								))}
								{isSkills && (
									<DropdownMenuRadioItem value="inline">
										<Trans>1 column, inline</Trans>
									</DropdownMenuRadioItem>
								)}
							</DropdownMenuRadioGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					{isSkills && (
						<DropdownMenuSub>
							<DropdownMenuSubTrigger>
								<Icon name="list-bullets" />
								<Trans>Keyword layout</Trans>
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent>
								<DropdownMenuRadioGroup
									value={(settings as { keywordLayout?: string }).keywordLayout ?? "inline"}
									onValueChange={(value) =>
										edit((target) => {
											(target as { keywordLayout?: string }).keywordLayout = value;
										})
									}
								>
									<DropdownMenuRadioItem value="inline">
										<Trans>Inline</Trans>
									</DropdownMenuRadioItem>
									<DropdownMenuRadioItem value="list">
										<Trans>Bulleted list</Trans>
									</DropdownMenuRadioItem>
								</DropdownMenuRadioGroup>
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					)}
					<DropdownMenuCheckboxItem
						checked={settings.keepTogether}
						onCheckedChange={(checked) =>
							edit((target) => {
								target.keepTogether = checked;
							})
						}
					>
						<Trans>Keep on one page</Trans>
					</DropdownMenuCheckboxItem>
					<DropdownMenuCheckboxItem
						checked={settings.startOnNewPage}
						onCheckedChange={(checked) =>
							edit((target) => {
								target.startOnNewPage = checked;
							})
						}
					>
						<Trans>Start on a new page</Trans>
					</DropdownMenuCheckboxItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive" onClick={section.kind === "custom" ? remove : reset}>
						<Icon name="trash" />
						{section.kind === "custom" ? <Trans>Delete section</Trans> : <Trans>Clear section</Trans>}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{/* The icon grid opens from the ⋯ button: an invisible trigger laid over it anchors the popover. */}
			<IconPicker
				value={settings.icon === "none" ? "" : settings.icon}
				onChange={(icon) => {
					edit((target) => {
						target.icon = icon === "" ? "none" : icon;
					});
					setIconPickerOpen(false);
				}}
				popoverProps={{ open: iconPickerOpen, onOpenChange: setIconPickerOpen }}
				aria-hidden
				tabIndex={-1}
				className="pointer-events-none absolute inset-0 size-full opacity-0"
			/>
		</span>
	);
}

const NONE: readonly never[] = [];

/** The assistant's pending edits in a section, while the assistant is open: "2 proposed". */
function useProposedCount(sectionId: string) {
	const proposals = useEditorStore((state) => (state.assistantOpen ? state.assistantProposals : NONE));
	const data = useCurrentBuilderResumeSelector((resume) => resume.data);
	const applications = useResumeStore((state) => state.proposalApplications);
	return pendingProposals(data, proposals, sectionId, applications).length;
}

type LayoutPage = { fullWidth: boolean; main: string[]; sidebar: string[] };
type LayoutPlace = { main: number; sidebar: number; others: string[]; pageCount: number };

/** Where a section sits on each page, with the sections it shares that page with, to find the page again later. */
function layoutPlaces(pages: LayoutPage[], id: string): LayoutPlace[] {
	return pages.map((page) => ({
		main: page.main.indexOf(id),
		sidebar: page.sidebar.indexOf(id),
		others: [...page.main, ...page.sidebar].filter((other) => other !== id),
		pageCount: pages.length,
	}));
}

/**
 * Puts a restored section back where it was: its column and place, on the page that still holds the sections it
 * shared it with (pages deleted or reordered since shift indexes). A page made full width since takes it in its main
 * column; a page that can't be found leaves it at the end of the last page.
 */
function restoreToLayout(pages: LayoutPage[], id: string, places: LayoutPlace[]) {
	let placed = false;
	places.forEach((place, index) => {
		if (place.main === -1 && place.sidebar === -1) return;
		const byNeighbours = pages.find((page) =>
			place.others.some((other) => [...page.main, ...page.sidebar].includes(other)),
		);
		// A page it had to itself is known only by position, which holds while the page count hasn't changed.
		const page =
			byNeighbours ?? (place.others.length === 0 && pages.length === place.pageCount ? pages[index] : undefined);
		if (!page) return;
		if (place.sidebar !== -1 && !page.fullWidth)
			page.sidebar.splice(Math.min(place.sidebar, page.sidebar.length), 0, id);
		else page.main.splice(Math.min(place.main === -1 ? page.main.length : place.main, page.main.length), 0, id);
		placed = true;
	});
	if (!placed) pages.at(-1)?.main.push(id);
}
