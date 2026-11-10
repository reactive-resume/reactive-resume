// J1 List, J2 Board and J3 Calendar: the Applications tab, one view at a time under a three-option segmented
// control. The content crossfades (d2) when the view changes; Segmented plays `selection`.
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { nextStage, useApplicationActions } from "./actions";
import {
	addDays,
	agendaItems,
	type ApplicationRow,
	BOARD_ORDER,
	cardLine,
	CLOSED_REASONS,
	clockTime,
	dayDate,
	groupByStage,
	isoDay,
	type ListContext,
	LIST_ORDER,
	longDay,
	monogram,
	monthGrid,
	offerHints,
	outcomeLabel,
	PIPELINE,
	rowLine,
	rowTitles,
	stageLabel,
	weekOf,
	weekRange,
	zoneCity,
} from "./model";
import { ApplicationsActions, ChoiceSheet, FadeIn, LoadError, RowPlaceholders, SettingsAvatar } from "./parts";
import { storyboard } from "./storyboard";
import { useApplications, useCareerOffers } from "@/data";
import { now, timeZone } from "@/data/clock";
import {
	BoardCard,
	BoardDrag,
	BoardDragCard,
	Box,
	BottomSheet,
	Button,
	Checkbox,
	ExpandingStrip,
	haptic,
	HeroCard,
	IconButton,
	layout,
	ListRow,
	Monogram,
	radius,
	Ring,
	SectionHeading,
	Segmented,
	SnapCarousel,
	type SnapCarouselHandle,
	StageButton,
	StageDot,
	SwipeRow,
	type SwipeAction,
	type IconName,
	TabScreen,
	Text,
	TextLink,
	Touch,
	useTheme,
} from "@/ui";

export type ApplicationsView = "list" | "board" | "calendar";
// ponytail: the view choice lives for the session; persisting it across launches needs a settings field (requested).
let rememberedView: ApplicationsView = "list";

export function ApplicationsScreen() {
	const params = useLocalSearchParams<{ view?: string; day?: string; stage?: string }>();
	const router = useRouter();
	const requested =
		params.view === "board" || params.view === "calendar" || params.view === "list" ? params.view : null;
	const view: ApplicationsView = requested ?? rememberedView;
	const applications = useApplications();
	const offers = useCareerOffers();
	const context = useMemo<ListContext>(
		() => ({ now: now(), zone: timeZone(), offers: offerHints(offers.data) }),
		[offers.data],
	);
	const rows = applications.data ?? [];

	const choose = (next: ApplicationsView) => {
		rememberedView = next;
		router.setParams({ view: next });
	};

	return (
		<TabScreen
			title={t`Applications`}
			actions={<ApplicationsActions />}
			avatar={<SettingsAvatar />}
			refreshing={applications.isRefetching}
			onRefresh={() => void applications.refetch()}
		>
			<View style={{ paddingTop: 16, paddingHorizontal: layout.screenMargin }}>
				<Segmented
					accessibilityLabel={t`View`}
					value={view}
					onChange={choose}
					options={[
						{ key: "list", label: t`List` },
						{ key: "board", label: t`Board` },
						{ key: "calendar", label: t`Calendar` },
					]}
				/>
			</View>
			<FadeIn key={view}>
				{applications.isError ? (
					<View style={{ paddingTop: 4 }}>
						<LoadError onRetry={() => void applications.refetch()} />
					</View>
				) : applications.isPending ? (
					<View style={{ paddingTop: 20 }}>
						<RowPlaceholders count={5} />
					</View>
				) : view === "list" ? (
					<ListView rows={rows} context={context} />
				) : view === "board" ? (
					<BoardView rows={rows} context={context} initialStage={params.stage} />
				) : (
					<CalendarView rows={rows} context={context} initialDay={params.day} />
				)}
			</FadeIn>
		</TabScreen>
	);
}

// ---------------------------------------------------------------------------------------------------------------
// J1 · List
// ---------------------------------------------------------------------------------------------------------------

type Sheet =
	| { kind: "actions"; app: ApplicationRow }
	| { kind: "move"; apps: ApplicationRow[] }
	| { kind: "close"; apps: ApplicationRow[] }
	| null;

function ListView({ rows, context }: { rows: ApplicationRow[]; context: ListContext }) {
	const router = useRouter();
	const actions = useApplicationActions();
	const [selecting, setSelecting] = useState(false);
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [showClosed, setShowClosed] = useState(false);
	const [sheet, setSheet] = useState<Sheet>(null);
	const { groups, closed } = groupByStage(rows, context);
	if (storyboard) for (const group of groups) group.rows.sort((a, b) => order(a.id) - order(b.id));
	const titles = rowTitles(rows.filter((row) => row.status !== "closed"));
	const picked = rows.filter((row) => selected.has(row.id));

	const toggle = (id: string) =>
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	const enterSelect = (id?: string) => {
		haptic("light");
		setSelecting(true);
		setSelected(new Set(id ? [id] : []));
	};
	const leaveSelect = () => {
		setSelecting(false);
		setSelected(new Set());
	};

	if (rows.length === 0)
		return (
			<HeroCard
				title={t`Track your first job`}
				body={t`Paste a job link. We'll save the posting so Check, the assistant and your letter can use it.`}
			>
				<Button label={t`Save job`} tone="primary" size="lg" block onPress={() => router.push("/applications/new")} />
			</HeroCard>
		);

	const renderRow = (app: ApplicationRow, last: boolean) => {
		const next = nextStage(app.status);
		const row = (
			<ListRow
				title={titles.get(app.id) ?? app.company}
				secondary={storyboard?.rowLines[app.id] ?? rowLine(app, context)}
				leading={
					selecting ? (
						<Checkbox value={selected.has(app.id)} interactive={false} saves={false} />
					) : (
						<Monogram letters={storyboard?.monograms[app.id] ?? monogram(app.company)} />
					)
				}
				trailing={selecting ? undefined : "caret"}
				last={last}
				accessibilityRole={selecting ? "checkbox" : "button"}
				{...(selecting ? { accessibilityState: { checked: selected.has(app.id) } } : {})}
				onPress={() => (selecting ? toggle(app.id) : router.push(`/applications/${app.id}`))}
				onLongPress={() => (selecting ? toggle(app.id) : setSheet({ kind: "actions", app }))}
				testID={`application-row-${app.id}`}
			/>
		);
		if (selecting) return <View key={app.id}>{row}</View>;
		const trash: SwipeAction = {
			key: "trash",
			label: t`Move to Trash`,
			icon: "trash",
			tone: "danger",
			onCommit: () => void actions.moveToTrash([app.id]),
		};
		const forward: SwipeAction | null = next
			? {
					key: "next",
					label: t`Move to ${stageLabel(next)}`,
					icon: "arrows-left-right",
					tone: "accent",
					// Applied asks what you sent first: the row stays until that is confirmed.
					slides: next !== "applied",
					onCommit: () => void actions.moveTo(app, next),
				}
			: null;
		return forward ? (
			<SwipeRow key={app.id} start={trash} end={forward}>
				{row}
			</SwipeRow>
		) : (
			<SwipeRow key={app.id} start={trash}>
				{row}
			</SwipeRow>
		);
	};

	return (
		<View>
			{groups.length === 0 ? (
				<HeroCard title={t`All your applications are closed`}>
					<Button
						label={t`Show closed applications`}
						tone="secondary"
						size="lg"
						block
						onPress={() => setShowClosed(true)}
					/>
				</HeroCard>
			) : null}
			{groups.map((group, index) => (
				<View key={group.status}>
					<SectionHeading
						title={stageLabel(group.status)}
						count={String(storyboard?.groupCounts[group.status] ?? group.rows.length)}
						first={index === 0}
					/>
					{group.rows.map((app, i) => renderRow(app, i === group.rows.length - 1))}
				</View>
			))}
			{closed.length > 0 ? (
				showClosed ? (
					<View>
						<SectionHeading title={stageLabel("closed")} count={String(closed.length)} />
						{closed.map((app, i) => renderRow(app, i === closed.length - 1))}
					</View>
				) : (
					<View style={{ paddingTop: 8 }}>
						<ListRow
							top
							last
							title={t`Closed · ${closed.length}`}
							trailing="caret"
							onPress={() => setShowClosed(true)}
						/>
					</View>
				)
			) : null}
			<View
				style={{
					paddingTop: 12,
					paddingHorizontal: layout.screenMargin,
					flexDirection: "row",
					flexWrap: "wrap",
					columnGap: 28,
				}}
			>
				{selecting ? (
					<>
						<ToolLink label={t`Done`} icon="check" onPress={leaveSelect} />
						<ToolLink
							label={t`Move…`}
							icon="arrows-left-right"
							onPress={() => picked.length && setSheet({ kind: "move", apps: picked })}
						/>
						<ToolLink
							label={t`Close…`}
							icon="check-circle"
							onPress={() => picked.length && setSheet({ kind: "close", apps: picked })}
						/>
						<ToolLink
							label={t`Move to Trash`}
							icon="trash"
							onPress={() => {
								if (!picked.length) return;
								void actions.moveToTrash(picked.map((app) => app.id));
								leaveSelect();
							}}
						/>
					</>
				) : (
					<>
						<ToolLink label={t`Select`} icon="check-square" onPress={() => enterSelect()} />
						<ToolLink label={t`Stages`} icon="kanban" onPress={() => router.setParams({ view: "board" })} />
						<ToolLink label={t`Import`} icon="file-csv" />
					</>
				)}
			</View>
			{sheet?.kind === "actions" ? (
				<ActionsSheet
					app={sheet.app}
					onClose={() => setSheet(null)}
					onSelect={() => {
						setSheet(null);
						enterSelect(sheet.app.id);
					}}
					onMove={() => setSheet({ kind: "move", apps: [sheet.app] })}
					onCloseApp={() => {
						setSheet(null);
						router.push(`/applications/${sheet.app.id}/stage?step=close`);
					}}
					onTrash={() => {
						setSheet(null);
						void actions.moveToTrash([sheet.app.id]);
					}}
				/>
			) : null}
			{sheet?.kind === "move" ? (
				<ChoiceSheet<ApplicationStatus>
					title={t`Move to…`}
					height={480}
					choices={PIPELINE.map((status) => ({
						key: status,
						title: stageLabel(status),
						trailing: <StageDot stage={status} />,
					}))}
					value={sheet.apps.length === 1 ? sheet.apps[0]?.status : undefined}
					onClose={() => setSheet(null)}
					onChoose={(status) => {
						const apps = sheet.apps;
						setSheet(null);
						leaveSelect();
						void actions.moveMany(apps, status);
					}}
				/>
			) : null}
			{sheet?.kind === "close" ? (
				<ChoiceSheet
					title={t`How did it end?`}
					height={480}
					choices={CLOSED_REASONS.map((reason) => ({ key: reason, title: outcomeLabel(reason) }))}
					onClose={() => setSheet(null)}
					onChoose={(reason) => {
						const apps = sheet.apps;
						setSheet(null);
						leaveSelect();
						void (async () => {
							for (const app of apps) await actions.close(app.id, reason, undefined, app.status);
						})();
					}}
				/>
			) : null}
		</View>
	);
}

/** Storyboard order inside a group; unlisted rows keep the app's order after the listed ones. */
const order = (id: string) => {
	const i = storyboard?.listOrder.indexOf(id) ?? -1;
	return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};

function ToolLink({ label, icon, onPress }: { label: string; icon: IconName; onPress?: () => void }) {
	return (
		<View style={{ paddingVertical: 12 }}>
			<TextLink label={label} icon={icon} color="ink3" onPress={onPress} />
		</View>
	);
}

/** Long-press on a row: its actions (the same as the row's swipes, plus Select). */
function ActionsSheet({
	app,
	onClose,
	onSelect,
	onMove,
	onCloseApp,
	onTrash,
}: {
	app: ApplicationRow;
	onClose: () => void;
	onSelect: () => void;
	onMove: () => void;
	onCloseApp: () => void;
	onTrash: () => void;
}) {
	return (
		<BottomSheet title={app.company} height={360} onClose={onClose}>
			<View style={{ paddingTop: 8 }}>
				<ListRow title={t`Move to…`} trailing="caret" onPress={onMove} />
				<ListRow title={t`Select`} onPress={onSelect} />
				<ListRow title={t`Close…`} onPress={onCloseApp} />
				<ListRow title={t`Move to Trash`} danger last onPress={onTrash} />
			</View>
		</BottomSheet>
	);
}

// ---------------------------------------------------------------------------------------------------------------
// J2 · Board
// ---------------------------------------------------------------------------------------------------------------

const COLUMN = 300;
const COLUMN_GAP = 16;

function BoardView({
	rows,
	context,
	initialStage,
}: {
	rows: ApplicationRow[];
	context: ListContext;
	initialStage?: string | undefined;
}) {
	const router = useRouter();
	const actions = useApplicationActions();
	const carousel = useRef<SnapCarouselHandle>(null);
	const busiest = LIST_ORDER.find((status) => rows.some((row) => row.status === status)) ?? "saved";
	const firstBusy = BOARD_ORDER.indexOf(busiest);
	const start = BOARD_ORDER.findIndex((status) => status === initialStage);
	const [index, setIndex] = useState(start >= 0 ? start : Math.max(0, firstBusy));
	const [choosing, setChoosing] = useState(false);
	const columns = BOARD_ORDER.map((status) => ({ status, rows: rows.filter((row) => row.status === status) }));
	const current = columns[index] ?? columns[0];
	if (!current) return null;
	const columnOf = (id: string) => BOARD_ORDER.indexOf(rows.find((row) => row.id === id)?.status ?? "saved");
	const onDrop = (id: string, _from: number, to: number) => {
		const app = rows.find((row) => row.id === id);
		const status = BOARD_ORDER[to];
		return app && status ? actions.moveTo(app, status) : false;
	};
	return (
		<View>
			<View style={{ paddingTop: 8, paddingHorizontal: layout.screenMargin }}>
				<StageButton
					stage={stageLabel(current.status)}
					dot={current.status}
					count={t`${index + 1} of ${columns.length}`}
					onPress={() => setChoosing(true)}
				/>
			</View>
			<BoardDrag carousel={carousel} columnOf={columnOf} onDrop={onDrop}>
				<SnapCarousel
					ref={carousel}
					data={columns}
					keyOf={(column) => column.status}
					itemWidth={COLUMN}
					gap={COLUMN_GAP}
					inset={layout.screenMargin}
					index={index}
					onIndexChange={setIndex}
					style={{ paddingTop: 20 }}
					renderItem={(column) => (
						<View>
							<View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
								<Text variant="sheetTitle" accessibilityRole="header">
									{stageLabel(column.status)}
								</Text>
								<Text variant="ui" color="ink3">
									{String(column.rows.length)}
								</Text>
							</View>
							<View style={{ paddingTop: 16, gap: 12 }}>
								{column.rows.length === 0 ? (
									<Box component="BoardCard" radius={radius.xl} style={{ padding: 16, alignItems: "center" }}>
										<Ring color="line2" radius={radius.xl} dashed />
										<Text variant="ui" color="ink3">
											{t`Drag an application here`}
										</Text>
									</Box>
								) : (
									column.rows.map((app) => (
										<BoardDragCard key={app.id} id={app.id}>
											<BoardCard
												company={app.company}
												role={app.role}
												next={cardLine(app, context)}
												onPress={() => router.push(`/applications/${app.id}`)}
											/>
										</BoardDragCard>
									))
								)}
							</View>
						</View>
					)}
				/>
			</BoardDrag>
			{choosing ? (
				<ChoiceSheet<ApplicationStatus>
					title={t`Stages`}
					height={540}
					value={current.status}
					choices={columns.map((column) => ({
						key: column.status,
						title: stageLabel(column.status),
						secondary: String(column.rows.length),
						trailing: <StageDot stage={column.status} />,
					}))}
					onClose={() => setChoosing(false)}
					onChoose={(status) => {
						setChoosing(false);
						carousel.current?.scrollToIndex(Math.max(0, BOARD_ORDER.indexOf(status)));
					}}
				/>
			) : null}
		</View>
	);
}

// ---------------------------------------------------------------------------------------------------------------
// J3 · Calendar
// ---------------------------------------------------------------------------------------------------------------

function CalendarView({
	rows,
	context,
	initialDay,
}: {
	rows: ApplicationRow[];
	context: ListContext;
	initialDay?: string | undefined;
}) {
	const router = useRouter();
	const today = isoDay(context.now, context.zone);
	const [day, setDay] = useState(initialDay && /^\d{4}-\d{2}-\d{2}$/.test(initialDay) ? initialDay : today);
	const [month, setMonth] = useState(false);
	const items = agendaItems(rows, context);
	const marked = new Set(items.map((item) => item.day));
	const { width } = useWindowDimensions();
	const weeks = useRef<SnapCarouselHandle>(null);
	// Weeks page around the week first shown; the arrows page the same carousel (same motion and haptic).
	const [anchor] = useState(() => weekOf(day)[0] ?? day);
	const weekIndex =
		WEEK_SPAN + Math.round((dayDate(weekOf(day)[0] ?? day).getTime() - dayDate(anchor).getTime()) / (7 * 86_400_000));
	const agenda = items.filter((item) => item.day >= day);
	const byDay = [...new Set(agenda.map((item) => item.day))];

	const pick = (next: string) => {
		if (next === day) return;
		haptic("selection");
		setDay(next);
	};
	const page = (step: number) => {
		if (month) {
			haptic("selection");
			setDay(addDays(day, step * 7));
		} else weeks.current?.scrollToIndex(weekIndex + step);
	};

	return (
		<View>
			<View
				style={{
					paddingTop: 12,
					paddingStart: layout.screenMargin,
					paddingEnd: 16,
					flexDirection: "row",
					alignItems: "center",
				}}
			>
				<View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 4 }}>
					<Text variant="textLink" weight={600}>
						{month ? monthLabel(day) : weekRange(weekOf(day))}{" "}
						<Text variant="textLink" weight={400} color="ink3">
							{t`· ${zoneCity(context.zone)} time`}
						</Text>
					</Text>
				</View>
				<IconButton
					icon="caret-left"
					label={month ? t`Previous month` : t`Previous week`}
					onPress={() => page(month ? -4 : -1)}
				/>
				<IconButton
					icon="caret-right"
					label={month ? t`Next month` : t`Next week`}
					onPress={() => page(month ? 4 : 1)}
					style={{ marginStart: 8 }}
				/>
				<Button
					label={month ? t`Week` : t`Month`}
					tone="ghost"
					size="sm"
					onPress={() => setMonth((m) => !m)}
					style={{ marginStart: 12, alignSelf: "center" }}
				/>
			</View>
			<View style={{ paddingTop: 20, paddingHorizontal: 16 }}>
				<ExpandingStrip
					collapsedHeight={DAY_CELL}
					expandedHeight={(monthGrid(day).length / 7) * DAY_CELL}
					expanded={month}
					onExpandedChange={setMonth}
				>
					{() =>
						month ? (
							<View style={{ flexDirection: "row", flexWrap: "wrap" }}>
								{monthGrid(day).map((d) => (
									<DayCell key={d} day={d} selected={d === day} marked={marked.has(d)} onPress={() => pick(d)} />
								))}
							</View>
						) : (
							<SnapCarousel
								ref={weeks}
								data={WEEKS}
								keyOf={(offset) => String(offset)}
								itemWidth={width - 32}
								index={weekIndex}
								onIndexChange={(i) => setDay(addDays(anchor, (i - WEEK_SPAN) * 7 + dayOfWeek(day)))}
								renderItem={(offset) =>
									// Only the shown week and its neighbours draw; the neighbours sit off screen until paged.
									Math.abs(offset - weekIndex) > 1 ? (
										<View style={{ height: DAY_CELL }} />
									) : (
										<View style={{ flexDirection: "row" }}>
											{weekOf(addDays(anchor, (offset - WEEK_SPAN) * 7)).map((d) => (
												<DayCell
													key={d}
													day={d}
													selected={d === day}
													marked={marked.has(d)}
													onPress={() => pick(d)}
													offscreen={offset !== weekIndex}
												/>
											))}
										</View>
									)
								}
							/>
						)
					}
				</ExpandingStrip>
			</View>
			{items.length === 0 ? (
				<HeroCard
					title={t`Nothing scheduled yet`}
					body={t`Nothing scheduled yet. Add screening calls and technical interviews to see them here and on the calendar.`}
				/>
			) : (
				byDay.map((d, index) => {
					const dayItems = agenda.filter((item) => item.day === d);
					return (
						<View key={d}>
							<SectionHeading title={longDay(dayDate(d), "UTC")} first={index === 0} />
							{dayItems.map((item, i) => (
								<ListRow
									key={item.key}
									title={item.title}
									secondary={item.line}
									leading={
										<Text variant="monoUi" color="ink2" weight={500} style={{ width: 60 }}>
											{item.at ? clockTime(item.at, context.zone) : t`All day`}
										</Text>
									}
									trailing="caret"
									last={i === dayItems.length - 1}
									onPress={() =>
										router.push(
											item.kind === "interview"
												? `/applications/${item.applicationId}`
												: item.kind === "follow-up"
													? `/applications/${item.applicationId}/messages`
													: "/career/offers",
										)
									}
								/>
							))}
						</View>
					);
				})
			)}
		</View>
	);
}

const DAY_CELL = 71;
/** Weeks either side of the first one shown. */
const WEEK_SPAN = 26;
const WEEKS = Array.from({ length: WEEK_SPAN * 2 + 1 }, (_, i) => i);
const dayOfWeek = (day: string) => (dayDate(day).getUTCDay() + 6) % 7;

const monthLabel = (day: string) =>
	new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(dayDate(day));

function DayCell({
	day,
	selected,
	marked,
	onPress,
	offscreen = false,
}: {
	day: string;
	selected: boolean;
	marked: boolean;
	onPress: () => void;
	/** A neighbouring week's cell, off screen until paged: not in the layout dump. */
	offscreen?: boolean;
}) {
	const { colors } = useTheme();
	const date = dayDate(day);
	const label = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(date);
	return (
		<Touch
			onPress={onPress}
			feedback="none"
			accessibilityRole="button"
			accessibilityLabel={longDay(date, "UTC")}
			accessibilityState={{ selected }}
			style={{ width: `${100 / 7}%` }}
		>
			<View
				style={{
					height: DAY_CELL,
					paddingVertical: 8,
					alignItems: "center",
					borderRadius: radius.lg,
					backgroundColor: selected ? colors.accent : undefined,
				}}
			>
				<Text variant="caption" color={selected ? "onAccent" : "ink3"} tag={!offscreen}>
					{label}
				</Text>
				<Text
					variant="sheetTitle"
					color={selected ? "onAccent" : "ink"}
					style={{ lineHeight: 26, marginTop: 4 }}
					tag={!offscreen}
				>
					{String(date.getUTCDate())}
				</Text>
				{marked ? (
					<View
						style={{
							width: 5,
							height: 5,
							marginTop: 4,
							borderRadius: radius.full,
							backgroundColor: selected ? colors.onAccent : colors.accent,
						}}
					/>
				) : null}
			</View>
		</Touch>
	);
}
