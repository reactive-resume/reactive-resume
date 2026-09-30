import type { WriteSection } from "./model";
import type { SectionType } from "@reactive-resume/schema/resume/data";
import type { KeyboardEvent, ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import { cn } from "@reactive-resume/utils/style";
import { pendingProposals } from "../proposals/proposals";
import { useEditorStore } from "../store";
import { addEntryTo } from "./actions";
import { countEntriesToCheck, getEntries, getSectionObject } from "./model";
import { IconPicker } from "@/components/input/icon-picker";
import { useCurrentBuilderResumeSelector, useResumeStore, useUpdateResumeData } from "@/features/resume/builder/draft";
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
	/** ⌥↑ / ⌥↓ on the focused title. */
	onMove: (direction: "up" | "down") => void;
	children: ReactNode;
};

/**
 * An outline row: drag handle, title (opens the section), entry count, the eye (hidden sections keep their
 * content but aren't printed), the chevron and the ⋯ menu. Open, it shows the section's entries.
 */
export function SectionRow({ section, locked, onMove, children }: SectionRowProps) {
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
		disabled: locked,
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
		onMove(event.key === "ArrowUp" ? "up" : "down");
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
					disabled={locked}
					className="flex h-11 w-7 shrink-0 cursor-grab items-center justify-center text-ink-3 active:cursor-grabbing disabled:cursor-default"
					{...attributes}
					{...listeners}
				>
					<Icon name="drag_indicator" size={18} />
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
					icon={hidden ? "visibility_off" : "visibility"}
					label={hidden ? t`Show ${title} on the page` : t`Hide ${title} from the page`}
					aria-pressed={hidden}
					size="icon-sm"
					disabled={locked}
					className="text-ink-2"
					onClick={toggleHidden}
				/>
				<IconButton
					icon="expand_more"
					label={open ? t`Close ${title}` : t`Open ${title}`}
					size="icon-sm"
					className={cn("text-ink-2 transition-transform duration-standard ease-enter", open && "rotate-180")}
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

type SectionMenuProps = { section: WriteSection; title: string; onMove: (direction: "up" | "down") => void };

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

	const undoToast = (description: string) =>
		toast.add({ description, actionProps: { children: t`Undo`, onClick: () => useResumeStore.getState().undo() } });

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
			toast.add({
				type: "warning",
				description: t`Could not sort these items; they stayed at the end: ${unresolved.join(", ")}.`,
			});
		}
	};

	const rename = async () => {
		const next = await prompt(t`What do you want to rename this section to?`, {
			description: t`Leave empty to reset the title to the original.`,
			defaultValue: settings.title,
		});
		if (next === null || next === settings.title) return;
		edit((target) => {
			target.title = next;
		});
	};

	const reset = () => {
		edit((target) => {
			if ("items" in target) target.items = [];
			else target.content = "";
		});
		undoToast(t`${title} cleared`);
	};

	const remove = () => {
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
		undoToast(t`${title} deleted`);
	};

	return (
		<span className="relative">
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<IconButton icon="more_horiz" label={t`Options for ${title}`} size="icon-sm" className="text-ink-2" />
					}
				/>
				<DropdownMenuContent align="end" className="w-60">
					{section.kind !== "summary" && (
						<DropdownMenuItem onClick={() => addEntryTo(section)}>
							<Icon name="add" />
							<Trans>Add entry</Trans>
						</DropdownMenuItem>
					)}
					{canSort && (
						<DropdownMenuItem onClick={sortByDate}>
							<Icon name="arrow_downward" />
							<Trans>Sort by date</Trans>
						</DropdownMenuItem>
					)}
					<DropdownMenuItem onClick={() => onMove("up")}>
						<Icon name="arrow_upward" />
						<Trans>Move up</Trans>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => onMove("down")}>
						<Icon name="arrow_downward" />
						<Trans>Move down</Trans>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={rename}>
						<Icon name="edit" />
						<Trans>Rename…</Trans>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => setIconPickerOpen(true)}>
						<Icon name="bookmark" />
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
							<Icon name="grid_view" />
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
								<Icon name="format_list_bulleted" />
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
						<Icon name="delete" />
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
	return pendingProposals(data, proposals, sectionId).length;
}
