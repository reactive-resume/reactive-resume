import type { DocumentSheet } from "./document-sheets";
import type { DocumentSort, DocumentSummary, DocumentTypeFilter } from "./filter";
import type { LegendListProps } from "@legendapp/list/react-native";
import { AnimatedLegendList } from "@legendapp/list/reanimated";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useObserve } from "expo-observe";
import { useRouter, Stack, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { RefreshControl, I18nManager, Platform, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated from "react-native-reanimated";
import { DocumentSheets } from "./document-sheets";
import { daysLeftInTrash, documentKey, documentRef } from "./filter";
import { isNewDocument, useNewDocuments } from "./new-documents";
import { usePendingDocuments } from "./pending";
import { useDocumentOperations } from "./queries";
import { Thumbnail } from "./thumbnail";
import { client, orpc } from "@/api/client";
import { getAccountScope, useSession } from "@/auth/session";
import { CollectionHeader } from "@/components/collection-header";
import { routes } from "@/routes";
import {
	Banner,
	Button,
	Card,
	Chip,
	ConfirmDialog,
	EmptyState,
	Icon,
	IconButton,
	ListRow,
	Screen,
	Segmented,
	Sheet,
	Skeleton,
	Text,
	haptics,
	listItemMotion,
	listLayout,
	useFirstAppearance,
	useTheme,
} from "@/ui";
import { usePullRefresh } from "@/ui/use-pull-refresh";

type DocumentItemProps = {
	document: DocumentSummary;
	visible: boolean;
	grid: boolean;
	selected: boolean;
	selecting: boolean;
	busy: boolean;
	unsynced: boolean;
	onOpen: () => void;
	onSelect: () => void;
	onMenu: () => void;
	onTrash: () => void;
	onDuplicate: () => void;
};

function DocumentItem({
	document,
	visible,
	grid,
	selected,
	selecting,
	busy,
	unsynced,
	onOpen,
	onSelect,
	onMenu,
	onTrash,
	onDuplicate,
}: DocumentItemProps) {
	const { t, i18n } = useLingui();
	const { colors, space, radius, size } = useTheme();
	const ids = useNewDocuments((state) => state.ids);
	const trashed = document.trashedAt;
	const meta = trashed
		? plural(daysLeftInTrash(trashed), { one: "# day left", other: "# days left" })
		: document.updatedAt.toLocaleDateString(i18n.locale);
	const body = (
		<View
			style={{
				flexDirection: grid ? "column" : "row",
				gap: space.s2,
				padding: space.s3,
				backgroundColor: selected ? colors.selectedFill : colors.surface,
				borderRadius: radius.rLg,
				borderWidth: 1,
				borderColor: selected ? colors.accent : colors.line,
			}}
		>
			<Pressable
				accessibilityRole={selecting ? "checkbox" : "button"}
				accessibilityLabel={selecting ? t`Select ${document.name}` : document.name}
				accessibilityState={{ checked: selecting ? selected : undefined, disabled: busy }}
				disabled={busy}
				accessibilityHint={unsynced ? t`Unsynced on this device` : !selecting ? t`Long press to select` : undefined}
				onPress={selecting ? onSelect : onOpen}
				onLongPress={selecting ? undefined : onSelect}
				style={{ flex: 1, flexDirection: grid ? "column" : "row", gap: space.s3, minHeight: size.hit }}
			>
				<Thumbnail document={document} visible={visible} compact={!grid} />
				<View style={{ flex: 1, gap: space.s1 }}>
					<Text variant="label" numberOfLines={2}>
						{document.name}
					</Text>
					<Text variant="caption" color="ink3">
						{document.type === "letter" ? t`Letter` : t`Resume`}
						{" · "}
						{meta}
					</Text>
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s1 }}>
						{unsynced && <Text variant="caption" color="warnText">{t`Unsynced on this device`}</Text>}
						{!trashed && isNewDocument(ids, document) && <Text variant="caption" color="accentText">{t`New`}</Text>}
						{selecting && (
							<Icon name={selected ? "check-square" : "square"} color={colors.accent} size={size.icon.row} />
						)}
						{document.isPublic && <Text variant="caption" color="accentText">{t`Public`}</Text>}
						{document.isLocked && <Text variant="caption" color="ink2">{t`Locked`}</Text>}
						{document.application && (
							<Text variant="caption" color="ink2">
								{document.application.company}
							</Text>
						)}
						{document.tags.map((tag) => (
							<Text key={tag} variant="caption" color="ink3">
								{tag}
							</Text>
						))}
					</View>
				</View>
			</Pressable>
			{!selecting && (
				<IconButton icon="dots-three" label={t`Options for ${document.name}`} onPress={onMenu} disabled={busy} />
			)}
		</View>
	);
	if (Platform.OS !== "ios" || grid || selecting || trashed) return body;
	const actions = () => (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space.s1 }}>
			<Button label={t`Duplicate`} variant="secondary" disabled={busy} onPress={onDuplicate} />
			<Button label={t`Move to Trash`} variant="danger" disabled={busy || document.isLocked} onPress={onTrash} />
		</View>
	);
	return (
		<ReanimatedSwipeable {...(I18nManager.isRTL ? { renderLeftActions: actions } : { renderRightActions: actions })}>
			{body}
		</ReanimatedSwipeable>
	);
}

type DocumentsLibraryProps = { trashed?: boolean };
const viewabilityConfig = { itemVisiblePercentThreshold: 1 };

export function DocumentsLibrary({ trashed = false }: DocumentsLibraryProps) {
	const router = useRouter();
	const { t } = useLingui();
	const { colors, space, size } = useTheme();
	const { fontScale } = useWindowDimensions();
	const [width, setWidth] = useState(0);
	const session = useSession();
	const scope = getAccountScope();
	const pending = usePendingDocuments();
	const countsOptions = orpc.documents.counts.queryOptions();
	const counts = useQuery({
		...countsOptions,
		queryKey: [...countsOptions.queryKey, scope],
		enabled: session.status === "signed-in",
	});
	const [q, setQ] = useState("");
	const [query, setQuery] = useState(q);
	useEffect(() => {
		const timer = setTimeout(() => setQuery(q), 300);
		return () => clearTimeout(timer);
	}, [q]);
	const [type, setType] = useState<DocumentTypeFilter>("all");
	const [sort, setSort] = useState<DocumentSort>("edited");
	const [tags, setTags] = useState<string[]>([]);
	const [publicOnly, setPublicOnly] = useState(false);
	const filterKey = JSON.stringify([trashed, q, type, tags, publicOnly, sort, scope]);
	const [page, setPage] = useState({ filterKey, offset: 0, total: 0 });
	const offset = page.filterKey === filterKey ? page.offset : 0;
	const pageOptions = orpc.documents.page.queryOptions({
		input: { trashed, q: query, type, tags, public: publicOnly, sort, limit: 100, offset },
	});
	const documents = useQuery({
		...pageOptions,
		gcTime: 0,
		queryKey: [...pageOptions.queryKey, scope],
		placeholderData: (previous, previousQuery) => (previousQuery?.queryKey.at(-1) === scope ? previous : undefined),
		enabled: session.status === "signed-in",
	});
	const [lastPage, setLastPage] = useState({ scope, data: documents.data, offset });
	if (
		scope !== lastPage.scope ||
		(documents.data && !documents.isPlaceholderData && (documents.data !== lastPage.data || offset !== lastPage.offset))
	)
		setLastPage({ scope, data: documents.data, offset });
	const displayed = documents.data ?? (lastPage.scope === scope ? lastPage.data : undefined);
	const displayedOffset = documents.data && !documents.isPlaceholderData ? offset : lastPage.offset;
	const rowsCurrent =
		session.status === "signed-in" &&
		Boolean(documents.data) &&
		!documents.isPlaceholderData &&
		!documents.isError &&
		q === query;
	const operations = useDocumentOperations(rowsCurrent);
	const changePage = (next: number) => {
		setSelection([]);
		setSheet(null);
		setPurge(null);
		setPage({ filterKey, offset: next, total: documents.data?.total ?? page.total });
	};
	const { markInteractive } = useObserve();
	// Documents is the signed-in launch screen; only the first call per session is recorded.
	useEffect(() => {
		if (!trashed && !documents.isPending) markInteractive();
	}, [trashed, documents.isPending, markInteractive]);
	const [view, setView] = useState<"list" | "grid" | null>(null);
	const [selecting, setSelecting] = useState(false);
	const [selection, setSelection] = useState<string[]>([]);
	const [recoveryOffset, setRecoveryOffset] = useState(0);
	const [sheet, setSheet] = useState<DocumentSheet | null>(null);
	const [purge, setPurge] = useState<{ documents: DocumentSummary[]; all: boolean } | null>(null);
	const [visible, setVisible] = useState<string[]>([]);
	const onViewableItemsChanged = useCallback<NonNullable<LegendListProps<DocumentSummary>["onViewableItemsChanged"]>>(
		({ viewableItems }) => {
			setVisible(viewableItems.filter((token) => token.isViewable).map((token) => token.key));
		},
		[],
	);
	const grid = !trashed && (view ?? (width >= 768 ? "grid" : "list")) === "grid";
	const columns = grid ? (width >= 1000 ? 3 : 2) : 1;
	if (
		page.filterKey !== filterKey ||
		(documents.data && !documents.isPlaceholderData && offset > 0 && offset >= documents.data.total)
	) {
		setPage({
			filterKey,
			total: documents.data?.total ?? 0,
			offset:
				page.filterKey !== filterKey ? 0 : Math.max(0, Math.floor(((documents.data?.total ?? 0) - 1) / 100) * 100),
		});
		setSelection([]);
		setSheet(null);
		setPurge(null);
		setRecoveryOffset(0);
	}
	const all = session.status === "signed-in" ? (displayed?.items ?? []) : [];
	const trashTotal = counts.data?.trash ?? documents.data?.total ?? 0;
	const purgeCount = purge?.all ? trashTotal : (purge?.documents.length ?? 0);
	const pendingKeys = new Set(pending.map(documentKey));
	// Device recovery is independent of which server page or filter happens to be open.
	const recoveryStart = Math.min(recoveryOffset, Math.max(0, Math.floor((pending.length - 1) / 100) * 100));
	const recoverable = trashed ? [] : pending.slice(recoveryStart, recoveryStart + 100);
	const filtered = all;
	const firstAppearance = useFirstAppearance(filtered.length > 0);
	const selected = rowsCurrent ? filtered.filter((document) => selection.includes(documentKey(document))) : [];
	const { refetch: refetchDocuments } = documents;
	const { refetch: refetchCounts } = counts;
	const pull = usePullRefresh(async () => {
		if (session.status === "signed-in") await Promise.allSettled([documents.refetch(), counts.refetch()]);
	});
	useFocusEffect(
		useCallback(() => {
			if (session.status === "signed-in") {
				void refetchDocuments();
				void refetchCounts();
			}
		}, [session.status, refetchDocuments, refetchCounts]),
	);
	const toggle = (document: DocumentSummary) => {
		if (!rowsCurrent) return;
		if (!selecting) {
			setSelecting(true);
			haptics.light();
		}
		const key = documentKey(document);
		setSelection((previous) =>
			previous.includes(key) ? previous.filter((entry) => entry !== key) : [...previous, key],
		);
	};
	const finishSelection = () => {
		setSelecting(false);
		setSelection([]);
	};
	const open = (document: DocumentSummary) => {
		if (!rowsCurrent) return;
		if (trashed) {
			setPurge(null);
			setSheet({ kind: "menu", documents: [document] });
			return;
		}
		useNewDocuments.getState().markOpened(document);
		router.push(document.type === "resume" ? routes.builder(document.id) : routes.letter(document.id));
	};
	const duplicate = (document: DocumentSummary) =>
		operations.run(async () => {
			const id =
				document.type === "resume"
					? await client.resume.duplicate({
							id: document.id,
							name: t`${document.name} (copy)`.slice(0, 100),
							tags: document.tags,
						})
					: (await client.coverLetters.duplicate({ id: document.id })).id;
			useNewDocuments.getState().markNew({ type: document.type, id });
		});
	const clearFilters = () => {
		changePage(0);
		setQ("");
		setType("all");
		setTags([]);
		setPublicOnly(false);
	};
	const sortLabel = { edited: t`Last edited`, name: t`Name`, created: t`Date created` }[sort];
	const cycleSort = () => setSort(sort === "edited" ? "name" : sort === "name" ? "created" : "edited");
	const sortControl =
		fontScale > 1.3 ? (
			<ListRow title={t`Sort`} value={sortLabel} leading="arrows-down-up" onPress={cycleSort} />
		) : (
			<Chip icon="arrows-down-up" label={sortLabel} onPress={cycleSort} />
		);
	const header = (
		<View style={{ gap: space.s4 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.s2 }}>
				{trashed && (
					<IconButton
						icon="arrow-left"
						label={t`Back to documents`}
						onPress={() => router.replace(routes.documents())}
					/>
				)}
				<View style={{ flex: 1 }}>
					<CollectionHeader
						title={trashed ? t`Trash` : t`Documents`}
						searchLabel={t`Search documents`}
						placeholder={t`Names, tags or applications`}
						value={q}
						maxLength={500}
						onChangeText={(value) => setQ(value.slice(0, 500))}
						actions={
							<>
								{selecting && <Button variant="ghost" label={t`Done`} onPress={finishSelection} />}
								{!trashed && (
									<IconButton icon="plus" label={t`New document`} onPress={() => router.push(routes.new())} />
								)}
							</>
						}
					/>
				</View>
			</View>
			{session.status === "signed-in" && (
				<>
					{trashed && <Text color="ink2">{t`Documents are deleted permanently after 30 days.`}</Text>}
					{recoverable.length > 0 && (
						<View style={{ gap: space.s2 }}>
							<Text variant="title" accessibilityRole="header">{t`Unsynced on this device`}</Text>
							{recoverable.map((document) => (
								<ListRow
									key={documentKey(document)}
									title={document.name}
									subtitle={document.type === "resume" ? t`Resume` : t`Letter`}
									leading="cloud-slash"
									chevron
									onPress={() =>
										router.push(document.type === "resume" ? routes.builder(document.id) : routes.letter(document.id))
									}
								/>
							))}
							{pending.length > 100 && (
								<View style={{ gap: space.s2 }}>
									<Text>{t`${recoveryStart + 1}–${Math.min(recoveryStart + 100, pending.length)} of ${pending.length}`}</Text>
									<View style={{ flexDirection: "row", gap: space.s2 }}>
										<Button
											label={t`Previous unsynced drafts`}
											variant="secondary"
											disabled={recoveryStart === 0}
											onPress={() => setRecoveryOffset(Math.max(0, recoveryStart - 100))}
										/>
										<Button
											label={t`Next unsynced drafts`}
											variant="secondary"
											disabled={recoveryStart + 100 >= pending.length}
											onPress={() => setRecoveryOffset(recoveryStart + 100)}
										/>
									</View>
								</View>
							)}
						</View>
					)}
					{(documents.isError || counts.isError) && (
						<Banner
							tone="danger"
							message={t`Couldn't refresh your documents.`}
							action={{
								label: t`Retry`,
								onPress: () => {
									void documents.refetch();
									void counts.refetch();
								},
							}}
						/>
					)}
					{operations.error && <Banner tone="danger" message={operations.error} />}
					{!trashed && (
						<>
							<Segmented
								orientation={fontScale > 1.3 ? "vertical" : "horizontal"}
								value={type}
								label={t`Document type`}
								onChange={setType}
								options={[
									{
										value: "all",
										label: t`All (${(displayed?.counts.resume ?? 0) + (displayed?.counts.letter ?? 0)})`,
									},
									{
										value: "resume",
										label: plural(displayed?.counts.resume ?? 0, {
											one: "Resume (#)",
											other: "Resumes (#)",
										}),
									},
									{
										value: "letter",
										label: plural(displayed?.counts.letter ?? 0, {
											one: "Letter (#)",
											other: "Letters (#)",
										}),
									},
								]}
							/>
							{fontScale > 1.3 && sortControl}
							<ScrollView
								horizontal
								showsHorizontalScrollIndicator={false}
								contentContainerStyle={{ alignItems: "center", gap: space.s2 }}
								style={{ flexGrow: 0 }}
							>
								{fontScale <= 1.3 && sortControl}
								<Chip label={t`Public`} selected={publicOnly} onPress={() => setPublicOnly(!publicOnly)} />
								{(displayed?.tags ?? []).map((tag) => (
									<Chip
										key={tag}
										label={tag}
										selected={tags.includes(tag)}
										onPress={() => setTags(tags.includes(tag) ? tags.filter((entry) => entry !== tag) : [...tags, tag])}
									/>
								))}
								<IconButton
									icon={grid ? "rows" : "squares-four"}
									label={grid ? t`List view` : t`Grid view`}
									onPress={() => setView(grid ? "list" : "grid")}
								/>
							</ScrollView>
						</>
					)}
					{trashed && <View style={{ alignItems: fontScale > 1.3 ? "stretch" : "flex-start" }}>{sortControl}</View>}
					{selecting && (
						<View style={{ gap: space.s2 }}>
							<Text variant="label">{plural(selected.length, { one: "# selected", other: "# selected" })}</Text>
							<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
								<Button
									label={t`Select this page`}
									variant="ghost"
									disabled={!rowsCurrent}
									onPress={() => {
										if (rowsCurrent) setSelection(filtered.map(documentKey));
									}}
								/>
								{trashed ? (
									<>
										<Button
											label={t`Restore`}
											variant="secondary"
											disabled={!rowsCurrent || !selected.length || operations.busy}
											loading={operations.busy}
											onPress={() =>
												void operations.restoreSelected(selected).then((success) => {
													if (success) finishSelection();
												})
											}
										/>
										<Button
											label={t`Delete permanently…`}
											variant="danger"
											disabled={!selected.length || operations.busy}
											onPress={() => setPurge({ documents: selected, all: false })}
										/>
									</>
								) : (
									<>
										{(["tags", "sharing", "lock"] as const).map((kind) => (
											<Button
												key={kind}
												label={{ tags: t`Tags`, sharing: t`Sharing`, lock: t`Lock` }[kind]}
												variant="secondary"
												disabled={!selected.length || operations.busy}
												onPress={() => setSheet({ kind, documents: selected })}
											/>
										))}
										<Button
											label={t`Move to Trash`}
											variant="danger"
											disabled={!selected.length}
											loading={operations.busy}
											onPress={() => void operations.trash(selected)}
										/>
									</>
								)}
							</View>
						</View>
					)}
					{trashed && all.length > 0 && (
						<Button
							label={t`Empty trash`}
							variant="danger"
							disabled={!rowsCurrent || operations.busy}
							onPress={() => setPurge({ documents: all, all: true })}
						/>
					)}
				</>
			)}
		</View>
	);
	return (
		<Screen
			scroll={false}
			edges={["top"]}
			onLayout={(event) => setWidth(event.nativeEvent.layout.width - space.s4 * 2)}
		>
			<Stack.Screen options={{ title: trashed ? t`Trash` : t`Documents`, headerShown: false }} />
			<AnimatedLegendList
				data={session.status === "signed-in" ? filtered : []}
				ListHeaderComponent={header}
				numColumns={columns}
				keyExtractor={documentKey}
				extraData={visible}
				viewabilityConfig={viewabilityConfig}
				onViewableItemsChanged={onViewableItemsChanged}
				refreshControl={<RefreshControl {...pull} tintColor={colors.accent} colors={[colors.accent]} />}
				style={{ flex: 1 }}
				keyboardShouldPersistTaps="handled"
				contentContainerStyle={{ paddingBottom: space.s4 }}
				ItemSeparatorComponent={() => <View style={{ height: space.s3 }} />}
				{...(columns > 1 ? { columnWrapperStyle: { gap: space.s3 } } : {})}
				// Reanimated's item layout animation supports one column only.
				{...(columns === 1 ? { itemLayoutAnimation: listLayout } : {})}
				renderItem={({ item, index }) => (
					<Animated.View
						{...listItemMotion(index, firstAppearance)}
						style={{ flex: 1, maxWidth: Math.max(0, (width - space.s3 * (columns - 1)) / columns) }}
					>
						<DocumentItem
							document={item}
							visible={visible.includes(documentKey(item))}
							grid={grid}
							selected={rowsCurrent && selection.includes(documentKey(item))}
							selecting={selecting}
							busy={operations.busy || !rowsCurrent}
							unsynced={!trashed && pendingKeys.has(documentKey(item))}
							onOpen={() => open(item)}
							onSelect={() => toggle(item)}
							onMenu={() => {
								if (rowsCurrent) setSheet({ kind: "menu", documents: [item] });
							}}
							onTrash={() => {
								if (rowsCurrent) void operations.trash([item]);
							}}
							onDuplicate={() => {
								if (rowsCurrent) void duplicate(item);
							}}
						/>
					</Animated.View>
				)}
				ListEmptyComponent={
					session.status !== "signed-in" ? (
						<EmptyState
							icon="file-text"
							title={t`Sign in to see your documents`}
							action={{ label: t`Sign in`, onPress: () => router.push(routes.signIn()) }}
						/>
					) : recoverable.length > 0 ? undefined : documents.isPending || (!rowsCurrent && !documents.isError) ? (
						<View style={{ gap: space.s3 }}>
							<Skeleton height={size.row * 2} />
							<Skeleton height={size.row * 2} />
							<Skeleton height={size.row * 2} />
						</View>
					) : documents.isError ? undefined : (
						<EmptyState
							icon={trashed ? "trash" : "file-text"}
							title={
								q || type !== "all" || tags.length || publicOnly || offset > 0
									? t`No matches`
									: trashed
										? t`Trash is empty`
										: t`Let's start with what you have`
							}
							message={
								q || type !== "all" || tags.length || publicOnly || offset > 0
									? t`Try another search or clear your filters.`
									: trashed
										? t`Documents you move here stay for 30 days.`
										: t`Import your current resume, or start fresh with your name.`
							}
							action={
								q || type !== "all" || tags.length || publicOnly || offset > 0
									? { label: t`Clear filters`, onPress: clearFilters }
									: trashed
										? undefined
										: { label: t`New document`, onPress: () => router.push(routes.new()) }
							}
						/>
					)
				}
				ListFooterComponent={
					<View style={{ gap: space.s3 }}>
						{session.status === "signed-in" && (offset > 0 || (displayed?.total ?? page.total) > 100) && (
							<View style={{ gap: space.s2 }}>
								<Text accessibilityLiveRegion="polite">{t`${Math.min(displayedOffset + 1, displayed?.total ?? page.total)}–${Math.min(displayedOffset + 100, displayed?.total ?? page.total)} of ${displayed?.total ?? page.total}`}</Text>
								<View style={{ flexDirection: "row", gap: space.s2 }}>
									<Button
										label={t`Previous`}
										variant="secondary"
										disabled={!rowsCurrent || documents.isFetching || operations.busy || offset === 0}
										onPress={() => changePage(Math.max(0, offset - 100))}
									/>
									<Button
										label={t`Next`}
										variant="secondary"
										disabled={
											!rowsCurrent ||
											documents.isFetching ||
											operations.busy ||
											offset + 100 >= (documents.data?.total ?? page.total)
										}
										onPress={() => changePage(offset + 100)}
									/>
								</View>
							</View>
						)}
						{session.status === "signed-in" && !trashed && counts.data?.trash ? (
							<Card style={{ paddingVertical: space.s3 / 2 }}>
								<ListRow
									title={t`Trash`}
									subtitle={plural(counts.data.trash, { one: "# document", other: "# documents" })}
									leading="trash"
									chevron
									onPress={() => router.push(routes.trash())}
								/>
							</Card>
						) : undefined}
					</View>
				}
			/>
			{session.status === "signed-in" &&
				rowsCurrent &&
				sheet &&
				(trashed ? (
					<SheetForTrash
						document={sheet.documents[0]}
						busy={operations.busy}
						onClose={() => setSheet(null)}
						onRestore={(document) =>
							void operations
								.run(() => client.documents.restore(documentRef(document)))
								.then((success) => {
									if (success) setSheet(null);
								})
						}
						onDelete={(document) => {
							setSheet(null);
							setPurge({ documents: [document], all: false });
						}}
					/>
				) : (
					<DocumentSheets
						key={`${sheet.kind}:${sheet.documents.map(documentKey).join(",")}`}
						value={sheet}
						onClose={() => setSheet(null)}
						onChange={setSheet}
						onSelect={toggle}
					/>
				))}
			<ConfirmDialog
				open={rowsCurrent && purge !== null}
				title={
					purge?.all
						? t`Empty Trash?`
						: purgeCount === 1
							? t`Delete “${purge?.documents[0]?.name}” forever?`
							: plural(purgeCount, {
									one: "Delete # selected document forever?",
									other: "Delete # selected documents forever?",
								})
				}
				message={
					purge?.all
						? purgeCount === 1
							? t`The document in Trash will be deleted for good and can't be restored.`
							: t`All ${purgeCount} documents in Trash will be deleted for good and can't be restored.`
						: purgeCount === 1
							? t`“${purge?.documents[0]?.name}” will be deleted for good and can't be restored.`
							: t`The selected documents will be deleted for good and can't be restored.`
				}
				confirmLabel={t`Hold to delete`}
				destructive
				hold
				onCancel={() => {
					if (!operations.busy) setPurge(null);
				}}
				onConfirm={() => {
					if (!rowsCurrent || !purge) return;
					const action = purge.all ? operations.emptyTrash() : operations.purgeSelected(purge.documents);
					void action.then((success) => {
						if (!success) return;
						setPurge(null);
						finishSelection();
					});
				}}
			/>
		</Screen>
	);
}

type SheetForTrashProps = {
	document: DocumentSummary | undefined;
	busy: boolean;
	onClose: () => void;
	onRestore: (document: DocumentSummary) => void;
	onDelete: (document: DocumentSummary) => void;
};

function SheetForTrash({ document, busy, onClose, onRestore, onDelete }: SheetForTrashProps) {
	const { t } = useLingui();
	if (!document) return null;
	return (
		<Sheet
			open
			onClose={() => {
				if (!busy) onClose();
			}}
			title={document.name}
		>
			<ListRow
				title={t`Restore`}
				leading="arrow-counter-clockwise"
				disabled={busy}
				onPress={() => onRestore(document)}
			/>
			<ListRow
				title={t`Delete forever…`}
				leading="trash"
				destructive
				disabled={busy}
				onPress={() => onDelete(document)}
			/>
		</Sheet>
	);
}
