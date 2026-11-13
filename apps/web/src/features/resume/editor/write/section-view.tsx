import type { WriteSection } from "./model";
import type { DragEndEvent } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { closestCenter, DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useEffect, useMemo } from "react";
import { sortSectionItemsByPeriod } from "@reactive-resume/resume/section-sort";
import { getDefaultSectionIconName } from "@reactive-resume/schema/resume/section-icons";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Switch } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { formatList } from "@reactive-resume/utils/locale";
import { addEntryTo } from "./actions";
import { EntryRow, moveEntry } from "./entry-row";
import { TextField } from "./fields";
import {
	countEntriesToCheck,
	getEntries,
	getSectionKind,
	getSectionObject,
	getSectionType,
	isDraftEntry,
} from "./model";
import { useProposedCount, useSectionTitle, useSortSensors } from "./outline";
import { SummaryEditor } from "./summary-editor";
import { openOutline } from "./view";
import { Crumb, CrumbButton } from "@/components/calm/crumb";
import { List, ListRow } from "@/components/calm/list-row";
import { SectionHeading } from "@/components/calm/section-heading";
import { IconPicker } from "@/components/input/icon-picker";
import { useCurrentBuilderResumeSelector, useResumeStore, useUpdateResumeData } from "@/features/resume/builder/draft";
import { undoToast } from "@/features/resume/builder/undo-toast";
import { PanelBody, PanelHeader } from "@/features/resume/editor/chrome/panel";
import { usePrompt } from "@/hooks/use-confirm";
import { dndContextProps } from "@/libs/dnd";
import { getSectionTitle } from "@/libs/resume/section";

/** The way back to the outline, above every panel below it. */
export function SectionsCrumb({ children }: { children?: ReactNode }) {
	return (
		<Crumb>
			<CrumbButton onClick={openOutline}>
				<Trans>Sections</Trans>
			</CrumbButton>
			{children}
		</Crumb>
	);
}

type SectionViewProps = { sectionId: string; locked: boolean };

/**
 * One section: its entries as a list (the summary: its text), then what applies to the whole section on the page.
 * The page outlines the section while its list is open.
 */
export function SectionView({ sectionId, locked }: SectionViewProps) {
	// Select the type (a string) rather than a new section object, so the view renders only when it changes.
	const type = useCurrentBuilderResumeSelector((resume) => getSectionType(resume.data, sectionId) ?? null);
	const section = useMemo<WriteSection | null>(
		() => (type ? { id: sectionId, kind: getSectionKind(sectionId), type } : null),
		[sectionId, type],
	);
	// A section that's gone (deleted, or a stale link): the outline.
	useEffect(() => {
		if (!type) openOutline();
	}, [type]);
	if (!section) return null;

	return <SectionBody section={section} locked={locked} />;
}

function SectionBody({ section, locked }: { section: WriteSection; locked: boolean }) {
	const title = useSectionTitle(section);
	const isSummary = section.kind === "summary";
	const proposed = useProposedCount(section.id);
	const update = useUpdateResumeData();

	return (
		<PanelBody id={`sidebar-${section.id}`} data-section-id={section.id} className="pb-6">
			<PanelHeader
				crumb={<SectionsCrumb />}
				title={title}
				titleEnd={
					proposed > 0 ? (
						<Badge variant="accent">
							<Plural value={proposed} one="# proposed" other="# proposed" />
						</Badge>
					) : undefined
				}
				actions={
					!isSummary &&
					!locked && (
						<Button variant="secondary" data-add-entry={section.id} onClick={() => addEntryTo(section)}>
							<Icon name="plus" />
							<Trans>Add entry</Trans>
						</Button>
					)
				}
			/>

			{section.kind === "custom" && (
				<fieldset disabled={locked} className="mt-3 grid grid-cols-2 gap-3 border-0 p-0">
					<TextField
						label={<Trans>Title</Trans>}
						value={title}
						onChange={(title) =>
							update(
								(draft) => {
									const target = getSectionObject(draft, section);
									if (target) target.title = title;
								},
								{ coalesceKey: `${section.id}:title` },
							)
						}
					/>
					<TextField
						label={<Trans>Kind</Trans>}
						value={getSectionTitle(section.type)}
						readOnly
						onChange={() => {}}
						// Fixed when the section is added: drawn sunken, as a value rather than a field to type in (B10 tile 16).
						className="border-transparent bg-sunken text-ink-2"
					/>
					<p className="col-span-full t-caption text-ink-3">
						<Trans>
							The kind is chosen when the section is added and can be any of the 13. Entries use that kind's form;
							Summary gives entries of one rich text.
						</Trans>
					</p>
				</fieldset>
			)}
			{isSummary ? (
				<fieldset disabled={locked} className="m-0 mt-3 min-w-0 border-0 p-0">
					<SummaryEditor locked={locked} />
				</fieldset>
			) : (
				<Entries section={section} locked={locked} />
			)}

			<SectionOptions section={section} title={title} locked={locked} />
		</PanelBody>
	);
}

/** The count line with Sort by date, then the entries. They reorder by the grip, ⌥↑ / ⌥↓, or the row's menu. */
function Entries({ section, locked }: { section: WriteSection; locked: boolean }) {
	const ids = useCurrentBuilderResumeSelector((resume) =>
		getEntries(resume.data, section)
			.map((entry) => entry.id)
			.join("\u0000"),
	);
	const entryIds = useMemo(() => (ids ? ids.split("\u0000") : []), [ids]);
	const printed = useCurrentBuilderResumeSelector(
		(resume) =>
			getEntries(resume.data, section).filter((entry) => !entry.hidden && !isDraftEntry(section.type, entry)).length,
	);
	const toCheck = useCurrentBuilderResumeSelector((resume) => countEntriesToCheck(getEntries(resume.data, section)));
	const locale = useCurrentBuilderResumeSelector((resume) => resume.data.metadata.page.locale);
	const updateResumeData = useUpdateResumeData();
	const sensors = useSortSensors();
	const count = entryIds.length;
	const canSort = (section.type === "experience" || section.type === "education") && !locked && count > 1;

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		moveEntry(section, String(active.id), entryIds.indexOf(String(over.id)));
	};

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

	const total = plural(count, { one: "# entry", other: "# entries" });

	return (
		<>
			<div className="mt-2 flex min-h-5 items-center justify-between gap-3">
				<span className="t-small text-ink-3">
					{count === 0 ? (
						<Trans>No entries yet</Trans>
					) : printed === count ? (
						total
					) : (
						<Trans comment="A resume section's entries: how many there are, and how many of them print">
							{total}, {i18n.number(printed)} on the page
						</Trans>
					)}
				</span>
				<span className="flex items-center gap-3">
					{toCheck > 0 && (
						<Badge variant="warn">
							<Plural value={toCheck} one="# to check" other="# to check" />
						</Badge>
					)}
					{canSort && (
						<button
							type="button"
							onClick={sortByDate}
							className="rounded-xs text-[13px]/5 font-medium text-accent-text hover:underline"
						>
							<Trans>Sort by date</Trans>
						</button>
					)}
				</span>
			</div>

			{count > 0 && (
				<DndContext
					{...dndContextProps(true)}
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragEnd={onDragEnd}
				>
					<SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
						<List cap role="list" aria-label={t`Entries`} className="mt-2">
							{entryIds.map((entryId, index) => (
								<EntryRow
									key={entryId}
									section={section}
									entryId={entryId}
									index={index}
									count={count}
									locked={locked}
								/>
							))}
						</List>
					</SortableContext>
				</DndContext>
			)}
		</>
	);
}

type SectionOptionsProps = { section: WriteSection; title: string; locked: boolean };

/** "On the page": what applies to the whole section, one row each, then Clear (or Delete, for a custom section). */
function SectionOptions({ section, title, locked }: SectionOptionsProps) {
	const prompt = usePrompt();
	const updateResumeData = useUpdateResumeData();
	const settings = useCurrentBuilderResumeSelector((resume) => getSectionObject(resume.data, section) ?? null);
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
	const skills = settings as { layout?: string; keywordLayout?: string };
	const inline = isSkills && skills.layout === "inline";
	const count = "items" in settings ? settings.items.length : 0;
	const renamed = Boolean(settings.title.trim());
	const defaultIcon = getDefaultSectionIconName(section.type);
	const iconName = settings.icon === "none" ? null : settings.icon || defaultIcon;

	const rename = async () => {
		const next = await prompt(t`Rename section`, {
			description: t`Leave it empty to use the original title.`,
			// The title as shown, also for a built-in section that keeps its default name.
			defaultValue: title,
			confirmText: t`Rename`,
		});
		if (next === null || next === settings.title || next === title) return;
		edit((target) => {
			target.title = next;
		});
	};

	const clear = () => {
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
		openOutline();
		undoToast(t`“${title}” deleted`, {
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

	const setColumns = (columns: number) =>
		edit((target) => {
			target.columns = Math.min(6, Math.max(1, columns));
		});

	const textAction = "rounded-xs text-sm/5 font-medium text-accent-text hover:underline disabled:opacity-45";
	const row = "gap-2.5! py-[5px]!";

	return (
		<fieldset disabled={locked} className="m-0 min-w-0 border-0 p-0">
			<SectionHeading className="pt-[26px]" note={<Trans>applies to the whole section</Trans>}>
				<Trans>On the page</Trans>
			</SectionHeading>
			<List tight>
				<ListRow
					className={row}
					title={<Trans>Show this section</Trans>}
					trailing={
						<Switch
							aria-label={t`Show this section`}
							checked={!settings.hidden}
							onCheckedChange={(checked) =>
								edit((target) => {
									target.hidden = !checked;
								})
							}
						/>
					}
				/>
				<ListRow
					className={row}
					title={<Trans>Heading</Trans>}
					value={<bdi>{title}</bdi>}
					trailing={
						<span className="flex items-center gap-3">
							{renamed && (
								<button
									type="button"
									className={textAction}
									onClick={() =>
										edit((target) => {
											target.title = "";
										})
									}
								>
									<Trans>Reset</Trans>
								</button>
							)}
							<button type="button" className={textAction} onClick={() => void rename()}>
								<Trans>Rename</Trans>
							</button>
						</span>
					}
				/>
				<ListRow
					className={row}
					title={<Trans>Show the heading</Trans>}
					trailing={
						<Switch
							aria-label={t`Show the heading`}
							checked={settings.showHeading !== false}
							onCheckedChange={(checked) =>
								edit((target) => {
									target.showHeading = checked;
								})
							}
						/>
					}
				/>
				<ListRow
					className={row}
					title={<Trans>Icon</Trans>}
					value={
						<>
							{iconName && <i aria-hidden="true" className={`ph ph-${iconName} text-base/4`} />}
							{settings.icon === "none" ? (
								<Trans>None</Trans>
							) : settings.icon && settings.icon !== defaultIcon ? (
								<Trans>Custom</Trans>
							) : (
								<Trans>Default</Trans>
							)}
						</>
					}
					trailing={
						<IconPicker
							value={settings.icon === "none" ? "" : settings.icon}
							onChange={(icon) =>
								edit((target) => {
									target.icon = icon === "" ? "none" : icon;
								})
							}
							variant="link"
							size="sm"
							aria-label={t`Change the icon of ${title}`}
							className="text-sm/5 font-medium no-underline hover:underline"
						>
							<Trans>Change</Trans>
						</IconPicker>
					}
				/>
				{!inline && (
					<ListRow
						className={row}
						title={<Trans>Columns</Trans>}
						trailing={
							<div
								role="group"
								aria-label={t`Columns, 1 to 6`}
								className="flex h-9 items-center rounded-md bg-raised shadow-[inset_0_0_0_1px_var(--control-border)]"
							>
								<IconButton
									icon="minus"
									label={t`Fewer columns`}
									size="icon-sm"
									disabled={settings.columns <= 1}
									onClick={() => setColumns(settings.columns - 1)}
								/>
								<span aria-live="polite" className="min-w-14 text-center font-mono text-[13px]/[18px] font-medium">
									{i18n.number(settings.columns)}
								</span>
								<IconButton
									icon="plus"
									label={t`More columns`}
									size="icon-sm"
									disabled={settings.columns >= 6}
									onClick={() => setColumns(settings.columns + 1)}
								/>
							</div>
						}
					/>
				)}
				{isSkills && (
					<>
						<ListRow
							className={row}
							title={<Trans>One line per skill</Trans>}
							subtitle={<Trans>Name, level and keywords run on one row. Uses 1 column.</Trans>}
							trailing={
								<Switch
									aria-label={t`One line per skill`}
									checked={inline}
									onCheckedChange={(checked) =>
										edit((target) => {
											(target as { layout?: string }).layout = checked ? "inline" : "default";
											if (checked) target.columns = 1;
										})
									}
								/>
							}
						/>
						<ListRow
							className={row}
							title={<Trans>Keywords</Trans>}
							subtitle={<Trans>How the keywords under a skill print</Trans>}
							trailing={
								<SegmentedControl
									aria-label={t`Keywords`}
									value={skills.keywordLayout ?? "inline"}
									onValueChange={(value) =>
										edit((target) => {
											(target as { keywordLayout?: string }).keywordLayout = String(value);
										})
									}
								>
									<SegmentedControlItem value="inline">
										<Trans>Inline</Trans>
									</SegmentedControlItem>
									<SegmentedControlItem value="list">
										<Trans>Bulleted list</Trans>
									</SegmentedControlItem>
								</SegmentedControl>
							}
						/>
					</>
				)}
				<ListRow
					className={row}
					title={<Trans>Keep on one page</Trans>}
					trailing={
						<Switch
							aria-label={t`Keep on one page`}
							checked={settings.keepTogether}
							onCheckedChange={(checked) =>
								edit((target) => {
									target.keepTogether = checked;
								})
							}
						/>
					}
				/>
				<ListRow
					className={row}
					title={<Trans>Start on a new page</Trans>}
					trailing={
						<Switch
							aria-label={t`Start on a new page`}
							checked={settings.startOnNewPage}
							onCheckedChange={(checked) =>
								edit((target) => {
									target.startOnNewPage = checked;
								})
							}
						/>
					}
				/>
				{!locked &&
					(section.kind === "custom" ? (
						<ListRow
							className={row}
							variant="danger"
							render={<button type="button" onClick={remove} />}
							title={<Trans>Delete section</Trans>}
							subtitle={
								count > 0 ? (
									<Plural
										value={count}
										one="Removes the section and its # entry. Undo brings it back."
										other="Removes the section and its # entries. Undo brings them back."
									/>
								) : (
									<Trans>Removes the section. Undo brings it back.</Trans>
								)
							}
						/>
					) : (
						<ListRow
							className={row}
							variant="danger"
							render={<button type="button" onClick={clear} />}
							title={<Trans>Clear section</Trans>}
							subtitle={
								section.kind === "summary" ? (
									<Trans>Removes the text. Undo brings it back.</Trans>
								) : (
									<Plural
										value={count}
										_0="Nothing to remove yet."
										one="Removes its # entry. Undo brings it back."
										other="Removes all # entries. Undo brings them back."
									/>
								)
							}
						/>
					))}
			</List>
		</fieldset>
	);
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
