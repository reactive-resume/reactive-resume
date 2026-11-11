// B2 · Section: its entries as two-line rows (what and when), one way to add, and the section's options. Swipe a row
// toward the start to delete it; press and hold to reorder, or open the entry's actions (B21).
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { plural, t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createEntry } from "@reactive-resume/resume/entries";
import { useAnchoredMenu, useAnchorRef, Anchor } from "../shared/anchored-menu";
import {
	BuilderScreen,
	editResume,
	useBuilderParams,
	useLocked,
	useResumeData,
	useBackToResume,
} from "../shared/document";
import { deleteEntry } from "../shared/entries";
import {
	type BuilderSection,
	type Entry,
	entryDetails,
	entryTitle,
	getEntries,
	getSectionObject,
	isEmptyEntry,
	pageOf,
	placeSection,
	resolveSection,
	sectionMeta,
	sectionName,
} from "../shared/model";
import { sectionActions, useRenameSection } from "../shared/section-actions";
import { useResumeStore } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import { IconButton, ListRow, ReorderList, type ReorderHandle, SwipeRow, Text, TextLink, useTheme } from "@/ui";

const ROW = 71;

function EntryRow({
	data,
	section,
	entry,
	locked,
	onOpen,
	onHold,
	last,
}: {
	data: ResumeData;
	section: BuilderSection;
	entry: Entry;
	locked: boolean;
	/** The list's last entry: no rule under it, and nothing of its own in the dump (the boards' borderless rows). */
	last: boolean;
	onOpen: () => void;
	onHold: () => void;
}) {
	const meta = sectionMeta[section.type];
	const empty = isEmptyEntry(entry);
	const title = entryTitle(section.type, entry);
	const details = entryDetails(section.type, entry, data.metadata.page.locale);
	const row = (
		<View style={entry.hidden ? { opacity: 0.45 } : null}>
			<ListRow
				title={title || meta.untitled()}
				titleColor={title ? undefined : "ink3"}
				secondary={empty ? t`Empty · not on the page` : entry.hidden ? t`Not on the page` : details || undefined}
				trailing="caret"
				last={last}
				boxHidden={last}
				onPress={onOpen}
				{...(locked ? {} : { onLongPress: onHold })}
			/>
		</View>
	);
	if (locked) return row;
	return (
		<SwipeRow
			start={{
				key: "delete",
				label: t`Delete`,
				icon: "trash",
				tone: "danger",
				onCommit: () => deleteEntry(section, entry.id),
			}}
		>
			{row}
		</SwipeRow>
	);
}

export function SectionScreen() {
	const { id, section: sectionId } = useBuilderParams();
	const router = useRouter();
	const data = useResumeData();
	const back = useBackToResume();
	const locked = useLocked();
	const insets = useSafeAreaInsets();
	const { colors } = useTheme();
	const menu = useAnchoredMenu();
	const rename = useRenameSection(data);
	const optionsRef = useAnchorRef();
	const reorder = useRef<ReorderHandle>(null);
	const section = data ? resolveSection(data, sectionId) : null;
	// Storyboard flows reach "An entry left empty elsewhere": `preset=untitled` adds one, as the web or an older app
	// leaves it (no undo step).
	const { preset } = useLocalSearchParams<{ preset?: string }>();
	const seed = STORYBOARD && preset === "untitled" && !!section;
	useEffect(() => {
		const s = useResumeStore.getState();
		if (!seed || !s.data || !section) return;
		if (getEntries(s.data, section).some((entry) => isEmptyEntry(entry))) return;
		s.updateDocument((draft) => {
			getEntries(draft.data as ResumeData, section).push({
				...createEntry(section.type),
				id: "storyboard-untitled",
			} as never);
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps -- once per preset visit
	}, [seed]);
	if (!data || !section) return <BuilderScreen title="">{null}</BuilderScreen>;

	const entries = getEntries(data, section);
	const meta = sectionMeta[section.type];
	const page = pageOf(data, section.id);
	const status = [
		plural(entries.length, { one: "# entry", other: "# entries" }),
		page >= 0 ? t`on page ${page + 1}` : t`not on the page`,
	].join(" · ");
	const object = getSectionObject(data, section);
	const base = `/builder/${id}/section/${section.id}`;

	const options = () => {
		const actions = sectionActions(data, section, () => rename.open(section));
		const pages = data.metadata.layout.pages;
		menu.open(optionsRef, [
			actions.rename,
			actions.up,
			actions.down,
			{ ...actions.hide, label: object?.hidden ? t`Show section` : t`Hide section` },
			{
				label: t`Columns`,
				onPress: () =>
					setTimeout(
						() =>
							menu.open(
								optionsRef,
								[1, 2, 3].map((n) => ({
									label: plural(n, { one: "# column", other: "# columns" }),
									onPress: () =>
										editResume((d) => {
											const o = getSectionObject(d, section);
											if (o) o.columns = n;
										}),
								})),
							),
						0,
					),
			},
			{
				label: t`Move to page`,
				disabled: pages.length < 2,
				onPress: () =>
					setTimeout(
						() =>
							menu.open(
								optionsRef,
								pages.map((_, index) => ({
									label: t`Page ${index + 1}`,
									disabled: index === page,
									onPress: () =>
										editResume((d) =>
											placeSection(d, section.id, index, "main", d.metadata.layout.pages[index]?.main.length ?? 0),
										),
								})),
							),
						0,
					),
			},
		]);
	};

	return (
		<BuilderScreen
			title={sectionName(data, section)}
			backLabel={back}
			status={status}
			barEnd={
				locked ? null : (
					<Anchor anchorRef={optionsRef}>
						<IconButton icon="dots-three" label={t`Section options`} onPress={options} />
					</Anchor>
				)
			}
			overlay={
				<>
					{menu.menu}
					{rename.dialog}
				</>
			}
			footer={
				entries.length > 0 && !locked ? (
					<View style={{ paddingTop: 0, paddingHorizontal: 24, paddingBottom: 16 + insets.bottom }}>
						<Text variant="ui" color="ink3">
							{t`Swipe an entry left to delete it. Press and hold to move, hide or duplicate it.`}
						</Text>
					</View>
				) : undefined
			}
		>
			<View style={{ height: 20 }} />
			{entries.length === 0 ? (
				<Text variant="body" color="ink3" style={{ paddingHorizontal: 24 }}>
					{t`Nothing here yet`}
				</Text>
			) : (
				<>
					<View style={{ height: 1, marginHorizontal: 24, backgroundColor: colors.line }} />
					<ReorderList
						ref={reorder}
						data={entries}
						keyOf={(entry) => entry.id}
						itemHeight={ROW}
						label={(entry) => entryTitle(section.type, entry) || meta.untitled()}
						onReorder={(from, to) =>
							editResume((d) => {
								const list = getEntries(d, section);
								const [moved] = list.splice(from, 1);
								if (moved) list.splice(to, 0, moved);
							})
						}
						renderItem={(entry, { index }) => (
							<EntryRow
								data={data}
								section={section}
								entry={entry}
								last={index === entries.length - 1}
								locked={locked}
								onOpen={() => router.push(`${base}/${entry.id}`)}
								onHold={() => router.push(`${base}/${entry.id}/actions?from=hold`)}
							/>
						)}
					/>
				</>
			)}
			{locked ? null : (
				<View style={{ paddingHorizontal: 24, paddingTop: 11 }}>
					<TextLink label={meta.add()} icon="plus" onPress={() => router.push(`${base}/new`)} />
				</View>
			)}
		</BuilderScreen>
	);
}
