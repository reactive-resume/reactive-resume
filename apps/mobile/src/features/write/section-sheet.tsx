import type { LayoutColumn, WriteSection } from "./model";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { addEntry, edit, requestFocus, useSectionTitle, useSortByDate, useUndoToast, useWriteData } from "./hooks";
import { deleteCustomSection, findPlacement, getSectionObject, NO_PAGES, placeSection, selectPages } from "./model";
import { IconPickerSheet, PromptSheet } from "./pickers";
import { useResumeStore } from "@/draft";
import { routes } from "@/routes";
import { Icon, ListRow, Sheet, Switch, Text, useTheme } from "@/ui";

type SectionSheetProps = {
	resumeId: string;
	section: WriteSection;
	open: boolean;
	onClose: () => void;
	/** Move up / Move down in print order; hidden sections have none. */
	onMove?: ((direction: "up" | "down") => void) | undefined;
};

type Page = "menu" | "columns" | "keywords" | "move";

/** Every web section action: add, sort, move, rename, icon, show, heading, columns, layout, clear or delete. */
export function SectionSheet({ resumeId, section, open, onClose, onMove }: SectionSheetProps) {
	const router = useRouter();
	const { t } = useLingui();
	const { colors, space } = useTheme();
	const title = useSectionTitle(section);
	const settings = useWriteData((data) => getSectionObject(data, section) ?? null, null);
	// Select the stored pages and derive from them: a fresh object from a selector re-renders forever.
	const layoutPages = useWriteData(selectPages, NO_PAGES);
	const placement = findPlacement(layoutPages, section.id);
	const sortByDate = useSortByDate();
	const undoToast = useUndoToast();
	const [page, setPage] = useState<Page>("menu");
	const [renaming, setRenaming] = useState(false);
	const [iconOpen, setIconOpen] = useState(false);
	if (!settings) return null;

	const change = (mutate: (target: NonNullable<typeof settings>) => void) =>
		edit((draft) => {
			const target = getSectionObject(draft, section);
			if (target) mutate(target);
		});
	const close = () => {
		setPage("menu");
		onClose();
	};
	const isSkills = section.type === "skills";
	const canSort = section.type === "experience" || section.type === "education";
	const skills = settings as { layout?: string; keywordLayout?: string };
	const columns = isSkills && skills.layout === "inline" ? "inline" : String(settings.columns);
	const switchRow = (
		label: string,
		icon: Parameters<typeof ListRow>[0]["leading"],
		value: boolean,
		set: (on: boolean) => void,
	) => (
		<ListRow
			title={label}
			leading={icon}
			onPress={() => set(!value)}
			trailing={<Switch label={label} value={value} onValueChange={set} />}
		/>
	);
	const radio = (key: string, label: string, selected: boolean, apply: () => void) => (
		<ListRow
			key={key}
			title={label}
			selected={selected}
			trailing={selected ? <Icon name="check" color={colors.accentText} /> : undefined}
			onPress={() => {
				apply();
				setPage("menu");
			}}
		/>
	);
	const back = <ListRow title={title} leading="caret-left" onPress={() => setPage("menu")} />;

	return (
		<>
			<Sheet
				open={open && !renaming && !iconOpen}
				// Rename and Icon take over from the sheet; its dismissal then isn't a close.
				onClose={() => !renaming && !iconOpen && close()}
				title={
					page === "columns"
						? t`Columns`
						: page === "keywords"
							? t`Keyword layout`
							: page === "move"
								? t`Move ${title} to…`
								: title
				}
				detents={[0.9]}
			>
				{page === "columns" ? (
					<>
						{back}
						{[1, 2, 3, 4, 5, 6].map((count) =>
							radio(
								String(count),
								plural(count, { one: "# column", other: "# columns" }),
								columns === String(count),
								() =>
									change((target) => {
										if (isSkills) (target as { layout?: string }).layout = "default";
										target.columns = count;
									}),
							),
						)}
						{isSkills
							? radio("inline", t`1 column, inline`, columns === "inline", () =>
									change((target) => {
										(target as { layout?: string }).layout = "inline";
										target.columns = 1;
									}),
								)
							: null}
					</>
				) : page === "keywords" ? (
					<>
						{back}
						{radio("inline", t`Inline`, (skills.keywordLayout ?? "inline") === "inline", () =>
							change((target) => {
								(target as { keywordLayout?: string }).keywordLayout = "inline";
							}),
						)}
						{radio("list", t`Bulleted list`, skills.keywordLayout === "list", () =>
							change((target) => {
								(target as { keywordLayout?: string }).keywordLayout = "list";
							}),
						)}
						<Text variant="caption" color="ink3" style={{ paddingHorizontal: space.s4 }}>
							{t`How each skill's keywords print.`}
						</Text>
					</>
				) : page === "move" ? (
					<>
						{back}
						{layoutPages.map((layout, index) =>
							(["main", "sidebar"] as LayoutColumn[])
								.filter((column) => column === "main" || !layout.fullWidth)
								.map((column) =>
									radio(
										`${index}:${column}`,
										column === "main" ? t`Page ${index + 1}` : t`Page ${index + 1} · Sidebar`,
										placement?.page === index && placement.column === column,
										() => edit((draft) => placeSection(draft, section.id, { page: index, column })),
									),
								),
						)}
						<ListRow
							title={t`New page`}
							leading="plus"
							onPress={() => {
								edit((draft) => placeSection(draft, section.id, "new-page"));
								setPage("menu");
							}}
						/>
						<Text variant="caption" color="ink3" style={{ paddingHorizontal: space.s4 }}>
							{t`Sidebar appears only on pages whose template has two columns.`}
						</Text>
					</>
				) : (
					<>
						{section.kind !== "summary" ? (
							<ListRow
								title={t`Add entry`}
								leading="plus"
								onPress={() => {
									const entryId = addEntry(section);
									requestFocus(entryId);
									close();
									router.push(routes.entry(resumeId, section.id, entryId));
								}}
							/>
						) : null}
						{canSort ? (
							<ListRow
								title={t`Sort by date`}
								leading="arrow-down"
								onPress={() => {
									sortByDate(section);
									close();
								}}
							/>
						) : null}
						{onMove ? (
							<>
								<ListRow
									title={t`Move up`}
									leading="arrow-up"
									onPress={() => {
										onMove("up");
										close();
									}}
								/>
								<ListRow
									title={t`Move down`}
									leading="arrow-down"
									onPress={() => {
										onMove("down");
										close();
									}}
								/>
							</>
						) : null}
						<ListRow
							title={t`Move to…`}
							subtitle={
								placement
									? placement.column === "main"
										? t`Page ${placement.page + 1}`
										: t`Page ${placement.page + 1} · Sidebar`
									: undefined
							}
							leading="arrows-left-right"
							chevron
							onPress={() => setPage("move")}
						/>
						<ListRow title={t`Rename…`} leading="pencil-simple" onPress={() => setRenaming(true)} />
						<ListRow
							title={t`Icon…`}
							subtitle={settings.icon && settings.icon !== "none" ? settings.icon : t`None`}
							leading="bookmark-simple"
							chevron
							onPress={() => setIconOpen(true)}
						/>
						{switchRow(t`Show on page`, "eye", !settings.hidden, (shown) =>
							change((target) => {
								target.hidden = !shown;
							}),
						)}
						{switchRow(t`Show heading`, "text-h-one", settings.showHeading !== false, (shown) =>
							change((target) => {
								target.showHeading = shown;
							}),
						)}
						<ListRow
							title={t`Columns`}
							subtitle={
								columns === "inline"
									? t`1 column, inline`
									: plural(Number(columns), { one: "# column", other: "# columns" })
							}
							leading="squares-four"
							chevron
							onPress={() => setPage("columns")}
						/>
						{isSkills ? (
							<ListRow
								title={t`Keyword layout`}
								subtitle={skills.keywordLayout === "list" ? t`Bulleted list` : t`Inline`}
								leading="list-bullets"
								chevron
								onPress={() => setPage("keywords")}
							/>
						) : null}
						{switchRow(t`Keep on one page`, "arrows-in-line-vertical", settings.keepTogether, (on) =>
							change((target) => {
								target.keepTogether = on;
							}),
						)}
						{switchRow(t`Start on a new page`, "square-split-horizontal", settings.startOnNewPage, (on) =>
							change((target) => {
								target.startOnNewPage = on;
							}),
						)}
						<ListRow
							title={section.kind === "custom" ? t`Delete section` : t`Clear section`}
							leading="trash"
							destructive
							onPress={() => {
								close();
								if (section.kind === "custom") {
									const data = useResumeStore.getState().data;
									const custom = data?.customSections.find((item) => item.id === section.id);
									const places = (data?.metadata.layout.pages ?? []).map((page) => ({
										main: page.main.indexOf(section.id),
										sidebar: page.sidebar.indexOf(section.id),
									}));
									edit((draft) => deleteCustomSection(draft, section.id));
									// After later edits, Undo adds the section back where it was.
									undoToast(t`${title} deleted`, (draft) => {
										if (!custom || draft.customSections.some((item) => item.id === custom.id)) return;
										draft.customSections.push(structuredClone(custom));
										draft.metadata.layout.pages.forEach((page, index) => {
											const place = places[index];
											if (place && place.main !== -1) page.main.splice(place.main, 0, custom.id);
											if (place && place.sidebar !== -1) page.sidebar.splice(place.sidebar, 0, custom.id);
										});
									});
								} else {
									const before = "items" in settings ? { items: settings.items } : { content: settings.content };
									change((target) => {
										if ("items" in target) target.items = [];
										else target.content = "";
									});
									// After later edits, Undo puts the entries back if the section is still empty.
									undoToast(t`${title} cleared`, (draft) => {
										const target = getSectionObject(draft, section);
										if (!target) return;
										if ("items" in target && "items" in before && target.items.length === 0)
											target.items = structuredClone(before.items) as typeof target.items;
										else if ("content" in target && "content" in before && !target.content)
											target.content = before.content;
									});
								}
							}}
						/>
						<Text variant="caption" color="ink3" style={{ paddingHorizontal: space.s4 }}>
							{section.kind === "custom"
								? t`Deletes the section and its entries. You can undo.`
								: t`Clears its entries; the section stays. You can undo.`}
						</Text>
					</>
				)}
			</Sheet>
			<PromptSheet
				open={open && renaming}
				title={t`What do you want to rename this section to?`}
				message={t`Leave empty to reset the title to the original.`}
				initialValue={settings.title}
				onClose={() => {
					setRenaming(false);
					close();
				}}
				onSubmit={(next) => {
					if (next !== settings.title)
						change((target) => {
							target.title = next;
						});
					setRenaming(false);
					close();
				}}
			/>
			<IconPickerSheet
				open={open && iconOpen}
				value={settings.icon === "none" ? "" : settings.icon}
				onClose={() => {
					setIconOpen(false);
					close();
				}}
				onChange={(icon) => {
					change((target) => {
						target.icon = icon === "" ? "none" : icon;
					});
					setIconOpen(false);
					close();
				}}
			/>
		</>
	);
}
