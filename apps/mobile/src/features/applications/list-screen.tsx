import type { ApplicationSort } from "./list";
import type { ApplicationClosedReason, ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { RefreshControl, Pressable, SectionList, View } from "react-native";
import Animated from "react-native-reanimated";
import { AddApplicationSheet } from "./add-sheet";
import { applicationError } from "./error";
import { filterApplications, groupApplications, visibleSelection } from "./list";
import { describeNextStep, getNextStep } from "./next-step";
import { useApplicationMutations, useApplications } from "./queries";
import { CLOSED_REASONS, getClosedReasonLabel, getStageColor, getStageLabel, PIPELINE } from "./stages";
import { useSession } from "@/auth/session";
import { useUserTime } from "@/features/application-detail/hooks";
import { useApplicationSearch } from "@/features/applications-board/search";
import { ApplicationsViewFrame } from "@/features/applications-board/views";
import { routes } from "@/routes";
import {
	Banner,
	Button,
	EmptyState,
	Icon,
	IconButton,
	ListRow,
	Screen,
	SelectSheet,
	Sheet,
	Skeleton,
	Switch,
	Text,
	TextField,
	listItemMotion,
	useFirstAppearance,
	useTheme,
} from "@/ui";
import { usePullRefresh } from "@/ui/use-pull-refresh";

export function ApplicationsListScreen() {
	const session = useSession();
	const { space } = useTheme();
	// Discard selection/forms when switching servers or leaving the authenticated session.
	return session.status === "signed-in" ? (
		<ApplicationsList key={session.server} />
	) : (
		<Screen>{session.status === "loading" ? <Skeleton height={space.s12} /> : <SignedOut />}</Screen>
	);
}
function SignedOut() {
	const router = useRouter();
	const { t } = useLingui();
	return <Button label={t`Sign in to view applications`} onPress={() => router.push(routes.signIn())} />;
}
function ApplicationsList() {
	const router = useRouter();
	const { t, i18n } = useLingui();
	const { colors, space, radius, size } = useTheme();
	const query = useApplications();
	const pull = usePullRefresh(query.refetch);
	const firstAppearance = useFirstAppearance(!query.isPending);
	const { timeZone } = useUserTime();
	const { bulkUpdate, bulkDelete } = useApplicationMutations();
	const { search, setSearch } = useApplicationSearch();
	const [tag, setTag] = useState("");
	const [showClosed, setShowClosed] = useState(false);
	const [sort, setSort] = useState<ApplicationSort>("updated");
	const [direction, setDirection] = useState<"asc" | "desc">("desc");
	const [collapsed, setCollapsed] = useState<Set<ApplicationStatus>>(new Set());
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [selecting, setSelecting] = useState(false);
	const [adding, setAdding] = useState(false);
	const [filters, setFilters] = useState(false);
	const [bulk, setBulk] = useState<"move" | "tag" | "close" | "delete" | null>(null);
	const [moveStage, setMoveStage] = useState<ApplicationStatus>("applied");
	const [reason, setReason] = useState<ApplicationClosedReason>("not-selected");
	const [newTag, setNewTag] = useState("");
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const [result, setResult] = useState<string | null>(null);
	const lock = useRef(false);
	const applications = query.data ?? [];
	const filtered = filterApplications(applications, { search, tag, showClosed });
	const filtersActive = Boolean(search.trim() || tag || showClosed);
	const groups = groupApplications(filtered, sort, direction);
	const selectedIds = visibleSelection(groups, collapsed, selected);
	const tags = [...new Set(applications.flatMap((item) => item.tags))].sort();
	const changeFilters = (change: () => void) => {
		change();
		setSelected(new Set());
	};
	const toggle = (id: string) =>
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	const applyBulk = async () => {
		if (!bulk || lock.current || !selectedIds.length || selectedIds.length > 200 || (bulk === "tag" && !newTag.trim()))
			return;
		lock.current = true;
		setBusy(true);
		setFailure(null);
		const ids = selectedIds;
		try {
			const count =
				bulk === "delete"
					? (await bulkDelete.mutateAsync({ ids })).deleted
					: (
							await bulkUpdate.mutateAsync({
								ids,
								...(bulk === "tag"
									? { addTags: [newTag.trim()] }
									: { status: bulk === "close" ? "closed" : moveStage }),
								...(bulk === "close" ? { closedReason: reason } : {}),
							})
						).updated;
			setResult(
				plural(ids.length, { one: `${count} of # application changed.`, other: `${count} of # applications changed.` }),
			);
			setBulk(null);
			setSelected(new Set());
			setSelecting(false);
			setNewTag("");
		} catch (cause) {
			setFailure(applicationError(cause));
		} finally {
			lock.current = false;
			setBusy(false);
		}
	};
	const content = (
		<>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s3 }}>
				<Button
					label={t`Sort and filter`}
					variant="secondary"
					icon="sliders-horizontal"
					disabled={busy}
					onPress={() => setFilters(true)}
				/>
				{selecting && (
					<Button
						label={t`Done selecting`}
						variant="link"
						disabled={busy}
						onPress={() => {
							setSelecting(false);
							setSelected(new Set());
						}}
					/>
				)}
			</View>
			{(search || tag || showClosed) && (
				<Text color="ink2">
					{plural(filtered.length, { one: "# match", other: "# matches" })}
					{tag ? ` · ${tag}` : ""}
					{showClosed ? ` · ${t`Including closed`}` : ""}
				</Text>
			)}
			{failure && bulk === null && <Banner tone="danger" message={failure} onDismiss={() => setFailure(null)} />}
			{result && <Banner tone="info" message={result} onDismiss={() => setResult(null)} />}
			{query.isError && (
				<>
					<Banner tone="warn" message={applicationError(query.error)} />
					<Button label={t`Retry loading applications`} onPress={() => void query.refetch()} />
				</>
			)}
			{!query.isError && query.isPending && (
				<>
					<Skeleton height={space.s12} />
					<Skeleton height={space.s12} />
					<Skeleton height={space.s12} />
				</>
			)}
			{selecting && (
				<>
					<Text variant="title">{t`${selectedIds.length} selected`}</Text>
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
						<Button
							label={t`Select visible`}
							variant="secondary"
							disabled={busy}
							onPress={() =>
								setSelected(
									new Set(
										groups
											.filter((group) => !collapsed.has(group.status))
											.flatMap((group) => group.data.map((item) => item.id)),
									),
								)
							}
						/>
						<Button label={t`Clear selection`} variant="ghost" disabled={busy} onPress={() => setSelected(new Set())} />
						<Button
							label={t`Move to…`}
							variant="secondary"
							disabled={busy || !selectedIds.length}
							onPress={() => {
								setFailure(null);
								setBulk("move");
							}}
						/>
						<Button
							label={t`Add tag`}
							variant="secondary"
							disabled={busy || !selectedIds.length}
							onPress={() => {
								setFailure(null);
								setBulk("tag");
							}}
						/>
						<Button
							label={t`Close…`}
							variant="secondary"
							disabled={busy || !selectedIds.length}
							onPress={() => {
								setFailure(null);
								setBulk("close");
							}}
						/>
						<Button
							label={t`Delete…`}
							variant="danger"
							disabled={busy || !selectedIds.length}
							onPress={() => {
								setFailure(null);
								setBulk("delete");
							}}
						/>
					</View>
					{selectedIds.length > 200 && (
						<Banner tone="warn" message={t`Choose up to 200 applications per bulk action.`} />
					)}
				</>
			)}
		</>
	);
	return (
		<ApplicationsViewFrame
			current="list"
			search={{ value: search, onChangeText: (value) => changeFilters(() => setSearch(value)), disabled: busy }}
			actions={<IconButton icon="plus" label={t`Save a job`} disabled={busy} onPress={() => setAdding(true)} />}
		>
			<Screen scroll={false} contentStyle={{ padding: 0 }}>
				<SectionList
					sections={
						query.isError
							? []
							: groups.map((group) => ({
									...group,
									total: group.data.length,
									data: collapsed.has(group.status) ? [] : group.data,
								}))
					}
					keyExtractor={(item) => item.id}
					keyboardShouldPersistTaps="handled"
					refreshControl={<RefreshControl {...pull} tintColor={colors.accent} colors={[colors.accent]} />}
					stickySectionHeadersEnabled={false}
					contentContainerStyle={{ padding: space.s4, gap: space.s2 }}
					ListHeaderComponent={<View style={{ gap: space.s3, paddingBottom: space.s4 }}>{content}</View>}
					ListEmptyComponent={
						!query.isPending && !query.isError ? (
							<EmptyState
								icon="briefcase"
								title={
									!applications.length
										? t`Your job search starts here`
										: filtersActive
											? t`No matching applications`
											: t`All your applications are closed`
								}
								message={
									applications.length
										? filtersActive
											? t`Try different words or clear your filters.`
											: t`Show closed applications to see your past job searches.`
										: t`Save a job link, paste a posting, or fill in the details manually.`
								}
								action={{
									label: !applications.length ? t`Save a job` : filtersActive ? t`Clear filters` : t`Show closed`,
									onPress: () =>
										applications.length
											? !filtersActive
												? setShowClosed(true)
												: changeFilters(() => {
														setSearch("");
														setTag("");
														setShowClosed(false);
													})
											: setAdding(true),
								}}
							/>
						) : undefined
					}
					renderSectionHeader={({ section }) => (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={plural(section.total, {
								one: `${getStageLabel(section.status)}, # application`,
								other: `${getStageLabel(section.status)}, # applications`,
							})}
							accessibilityState={{ expanded: !collapsed.has(section.status) }}
							disabled={busy}
							onPress={() => {
								setSelected(new Set());
								setCollapsed((current) => {
									const next = new Set(current);
									if (next.has(section.status)) next.delete(section.status);
									else next.add(section.status);
									return next;
								});
							}}
							style={{
								minHeight: size.hit,
								flexDirection: "row",
								alignItems: "center",
								gap: space.s2,
								marginTop: space.s4,
							}}
						>
							<View
								style={{
									width: space.s2,
									height: space.s2,
									borderRadius: radius.rLg,
									backgroundColor: getStageColor(section.status, colors),
								}}
							/>
							<Text variant="title" style={{ flex: 1 }}>
								{getStageLabel(section.status)}
							</Text>
							<Text color="ink3">{section.total}</Text>
							<Icon
								name={collapsed.has(section.status) ? "caret-right" : "caret-down"}
								size={size.icon.meta}
								color={colors.ink3}
							/>
						</Pressable>
					)}
					renderItem={({ item, index }) => {
						const next = describeNextStep(getNextStep(item), item, i18n.locale, timeZone);
						return (
							<Animated.View
								{...listItemMotion(index, firstAppearance)}
								style={{
									borderBottomWidth: 1,
									borderBottomColor: colors.line,
									flexDirection: "row",
									alignItems: "center",
								}}
							>
								<View style={{ flex: 1 }}>
									<ListRow
										title={item.role}
										subtitle={`${item.company}${item.location ? ` · ${item.location}` : ""}\n${next.title}${next.sub ? ` · ${next.sub}` : ""}`}
										selected={selectedIds.includes(item.id)}
										leading={selecting ? (selectedIds.includes(item.id) ? "check-square" : "square") : undefined}
										accessibilityHint={selecting ? t`Toggle selection` : t`Open application`}
										disabled={busy}
										onPress={() => (selecting ? toggle(item.id) : router.push(routes.applicationDetails(item.id)))}
									/>
								</View>
								<IconButton
									icon="dots-three"
									label={t`Actions for ${item.role} at ${item.company}`}
									disabled={busy}
									onPress={() => {
										setSelected(new Set([item.id]));
										setSelecting(true);
									}}
								/>
							</Animated.View>
						);
					}}
				/>
				<Sheet open={filters} onClose={() => setFilters(false)} title={t`Sort and filter`}>
					<View style={{ padding: space.s4, gap: space.s3 }}>
						<SelectSheet
							label={t`Sort by`}
							value={sort}
							options={[
								{ value: "updated", label: t`Updated` },
								{ value: "role", label: t`Role` },
								{ value: "next", label: t`Next step` },
							]}
							onChange={setSort}
						/>
						<SelectSheet
							label={t`Direction`}
							value={direction}
							options={[
								{ value: "asc", label: t`Ascending` },
								{ value: "desc", label: t`Descending` },
							]}
							onChange={setDirection}
						/>
						<SelectSheet
							label={t`Tag`}
							value={tag}
							options={[{ value: "", label: t`All tags` }, ...tags.map((value) => ({ value, label: value }))]}
							onChange={(value) => changeFilters(() => setTag(value))}
						/>
						<Text>{t`Show closed applications`}</Text>
						<Switch
							label={t`Show closed applications`}
							value={showClosed}
							onValueChange={(value) => changeFilters(() => setShowClosed(value))}
						/>
						<Button label={t`Done`} onPress={() => setFilters(false)} />
					</View>
				</Sheet>
				<Sheet
					open={bulk !== null}
					onClose={() => setBulk(null)}
					title={
						bulk === "delete"
							? plural(selectedIds.length, { one: "Delete # application?", other: "Delete # applications?" })
							: bulk === "close"
								? t`Close selected applications`
								: bulk === "tag"
									? t`Tag selected applications`
									: t`Move selected applications`
					}
				>
					<View style={{ padding: space.s4, gap: space.s3 }}>
						<Text>
							{plural(selectedIds.length, { one: "# application selected.", other: "# applications selected." })}
						</Text>
						{busy && (
							<Banner tone="info" message={t`Applying changes. Closing this sheet does not cancel the request.`} />
						)}
						{failure && <Banner tone="danger" message={failure} />}
						{bulk === "move" && (
							<SelectSheet
								label={t`Move to…`}
								value={moveStage}
								options={PIPELINE.map((value) => ({ value, label: getStageLabel(value) }))}
								onChange={setMoveStage}
								disabled={busy}
							/>
						)}
						{bulk === "tag" && <TextField label={t`Tag`} value={newTag} onChangeText={setNewTag} editable={!busy} />}
						{bulk === "close" && (
							<SelectSheet
								label={t`Reason`}
								value={reason}
								options={CLOSED_REASONS.map((value) => ({ value, label: getClosedReasonLabel(value) }))}
								onChange={setReason}
								disabled={busy}
							/>
						)}
						{bulk === "delete" && (
							<Banner
								tone="warn"
								message={t`Applications and their attachments will be deleted permanently. This can't be undone.`}
							/>
						)}
						<Button
							label={
								bulk === "delete"
									? plural(selectedIds.length, { one: "Delete # application", other: "Delete # applications" })
									: bulk === "close"
										? t`Close applications`
										: bulk === "tag"
											? t`Add tag`
											: t`Move applications`
							}
							variant={bulk === "delete" ? "danger" : "primary"}
							loading={busy}
							disabled={busy || !selectedIds.length || selectedIds.length > 200 || (bulk === "tag" && !newTag.trim())}
							onPress={() => void applyBulk()}
						/>
						<Button label={t`Cancel`} variant="ghost" disabled={busy} onPress={() => setBulk(null)} />
					</View>
				</Sheet>
				{adding && <AddApplicationSheet onClose={() => setAdding(false)} />}
			</Screen>
		</ApplicationsViewFrame>
	);
}
