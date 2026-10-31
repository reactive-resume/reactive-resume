import type { ColumnRect, PendingMove } from "./board";
import type { ApplicationLane } from "@/features/applications/lanes";
import type { ApplicationSummary as Application } from "@/features/applications/types";
import type { ComponentRef } from "react";
import type { ScrollView } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, Pressable, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, LegacyScrollView } from "react-native-gesture-handler";
import Animated, {
	useAnimatedReaction,
	useAnimatedScrollHandler,
	useAnimatedStyle,
	useFrameCallback,
	useSharedValue,
	withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { keepPending, pendingAfterError, stageAt } from "./board";
import { useApplicationSearch } from "./search";
import { ApplicationsViewFrame } from "./views";
import { useUserTime } from "@/features/application-detail/hooks";
import { CloseSheet, MarkAppliedSheet } from "@/features/application-detail/sheets";
import { applicationError } from "@/features/applications/error";
import { useApplicationLanes } from "@/features/applications/lane-queries";
import { getLaneLabel, laneInput, resolveLane, visibleLanes } from "@/features/applications/lanes";
import { filterApplications } from "@/features/applications/list";
import { describeNextStep, getNextStep } from "@/features/applications/next-step";
import { useApplicationMutations, useApplications } from "@/features/applications/queries";
import { routes } from "@/routes";
import { useIsTablet } from "@/shell/use-is-tablet";
import {
	Banner,
	Button,
	Card,
	EmptyState,
	ListRow,
	Sheet,
	Skeleton,
	Text,
	haptics,
	listItemMotion,
	listLayout,
	showToast,
	useFirstAppearance,
	useReducedMotion,
	useTheme,
} from "@/ui";
import { usePullRefresh } from "@/ui/use-pull-refresh";

// Column widths from the mockup (career.html `.column`): phone 268 pt, tablet 250 pt.
const PHONE_COLUMN = 268;
const TABLET_COLUMN = 250;
// Cards mounted per column at first; the rest show in batches, as web.
const COLUMN_PAGE_SIZE = 50;
const LONG_PRESS_MS = 400;
// While a card is held this close to the board's edge, the board scrolls one column, at most this often.
const AUTO_SCROLL_EVERY_MS = 500;
const AnimatedScrollView = Animated.createAnimatedComponent(LegacyScrollView);

type Drag = { application: Application; left: number; top: number; width: number };
type DragEvent = { absoluteX: number; absoluteY: number; x: number; y: number };
type DragHandlers = {
	start: (application: Application, event: DragEvent, width: number) => void;
	move: (absoluteX: number) => void;
	end: (drop: boolean, absoluteX: number) => void;
	motion: { x: SharedValue<number>; y: SharedValue<number>; finger: SharedValue<number>; active: SharedValue<boolean> };
};

export function BoardScreen() {
	return (
		<ApplicationsViewFrame current="board">
			<Board />
		</ApplicationsViewFrame>
	);
}

/**
 * A column per stage. Long press a card to drag it to another column; Move to… does the same without dragging.
 * Dropping on Closed asks for a reason and Saved → Applied asks what was sent, as the detail screen does.
 */
function Board() {
	const router = useRouter();
	const { t } = useLingui();
	const { motion, radius, shadows, space } = useTheme();
	const { width: windowWidth } = useWindowDimensions();
	const tablet = useIsTablet();
	const reduceMotion = useReducedMotion();
	const query = useApplications();
	const laneQuery = useApplicationLanes();
	const [actionLane, setActionLane] = useState<ApplicationLane | undefined>();
	const { search } = useApplicationSearch();
	const { update } = useApplicationMutations();
	// One open flag per sheet: a sheet's late dismissal can never close the one that replaced it.
	const [moving, setMoving] = useState<Application | null>(null);
	const [moveOpen, setMoveOpen] = useState(false);
	const [closing, setClosing] = useState<Application | null>(null);
	const [closeOpen, setCloseOpen] = useState(false);
	const [marking, setMarking] = useState<Application | null>(null);
	const [markOpen, setMarkOpen] = useState(false);
	const [drag, setDrag] = useState<Drag | null>(null);
	const [hover, setHover] = useState<string | null>(null);
	// The list publishes the optimistic move after an await, so until then the board shows the card in its new column
	// itself; otherwise it blinks back for a frame (web board does the same).
	const [pending, setPending] = useState<PendingMove | null>(null);
	const translateX = useSharedValue(0);
	const translateY = useSharedValue(0);
	const finger = useSharedValue(0);
	const dragActive = useSharedValue(false);
	const lift = useSharedValue(1);
	const columnRects = useSharedValue<{ stage: string; x: number; width: number }[]>([]);
	const bounds = useSharedValue({ x: 0, width: 0 });
	const lastEdgeScroll = useSharedValue(0);
	const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
	const board = useRef<ComponentRef<typeof View>>(null);
	const boardRect = useRef({ x: 0, y: 0, width: 0 });
	const columns = useRef(new Map<string, ComponentRef<typeof View>>());
	const rects = useRef(new Map<string, ColumnRect>());
	const scrollX = useSharedValue(0);
	const autoScrolled = useRef(false);
	const hovered = useRef<string | null>(null);
	const dragged = useRef<Application | null>(null);

	const applications = filterApplications(query.data ?? [], { search, tag: "", showClosed: true });
	if (pending && !keepPending(pending, query.data ?? [])) setPending(null);
	const statusOf = (application: Application) =>
		pending?.id === application.id ? pending.to : resolveLane(laneQuery.lanes, application).id;
	const stages = visibleLanes(laneQuery.lanes, applications);
	const stageIds = stages.map((lane) => lane.id);
	const byStage = new Map<string, Application[]>(stageIds.map((stage) => [stage, []]));
	for (const application of applications) byStage.get(statusOf(application))?.push(application);

	const columnWidth = tablet ? TABLET_COLUMN : Math.min(PHONE_COLUMN, windowWidth - space.s4 * 2 - space.s8);
	const cardWidth = columnWidth - space.s3 * 2;

	const moveTo = (application: Application, stage: string) => {
		const lane = laneQuery.active.find((item) => item.id === stage);
		if (!laneQuery.ready || !lane || update.isPending || stage === statusOf(application)) return;
		setActionLane(lane);
		if (lane.category === "closed" && !lane.closedReason) {
			setClosing(application);
			return setCloseOpen(true);
		}
		if (application.status === "saved" && lane.category === "applied") {
			setMarking(application);
			return setMarkOpen(true);
		}
		setPending({ id: application.id, from: application.laneId ?? application.status, to: stage });
		update.mutate(
			{ id: application.id, ...laneInput(lane, laneQuery.supported) },
			{
				onSuccess: () => showToast({ message: t`Moved to ${getLaneLabel(lane)}` }),
				onError: (error) => {
					setPending((current) => pendingAfterError(current, application.id, stage));
					showToast({ message: applicationError(error) });
				},
			},
		);
	};

	// Column positions in the window, re-read whenever the board scrolls during a drag (also right for RTL).
	const measureColumns = async () => {
		await Promise.all(
			[...columns.current].map(
				([stage, view]) =>
					new Promise<void>((resolve) =>
						view.measureInWindow((x, _y, width) => {
							rects.current.set(stage, { x, width });
							resolve();
						}),
					),
			),
		);
		columnRects.set([...rects.current].map(([stage, rect]) => ({ stage, ...rect })));
	};
	const hoverAt = (x: number) => {
		const stage = columnRects.get().find((column) => x >= column.x && x <= column.x + column.width)?.stage ?? null;
		if (stage !== hovered.current) {
			hovered.current = stage;
			setHover(stage);
		}
	};

	const handlers: DragHandlers = {
		motion: { x: translateX, y: translateY, finger, active: dragActive },
		start: (application, event, width) => {
			lift.set(withSpring(reduceMotion ? 1 : 1.03, { duration: 260, dampingRatio: 0.8 }));
			rects.current.clear();
			void measureColumns();
			hovered.current = null;
			dragged.current = application;
			setHover(null);
			// The card's corner in the window; the preview sits there inside the board, then follows the finger.
			const originX = event.absoluteX - event.x;
			const originY = event.absoluteY - event.y;
			setDrag({ application, left: originX - boardRect.current.x, top: originY - boardRect.current.y, width });
			board.current?.measureInWindow((x, y, boardWidth) => {
				boardRect.current = { x, y, width: boardWidth };
				bounds.set({ x, width: boardWidth });
				setDrag((current) => current && { ...current, left: originX - x, top: originY - y });
			});
			haptics.light();
		},
		move: (absoluteX) => {
			if (!dragged.current) return;
			hoverAt(absoluteX);
			const { x, width } = boardRect.current;
			const edge = absoluteX < x + space.s10 ? -1 : absoluteX > x + width - space.s10 ? 1 : 0;
			if (edge !== 0 && !autoScrolled.current) {
				autoScrolled.current = true;
				setTimeout(() => {
					autoScrolled.current = false;
				}, AUTO_SCROLL_EVERY_MS);
				const target = Math.max(0, scrollX.get() + edge * (columnWidth + space.s3));
				scrollRef.current?.scrollTo({ x: target, animated: !reduceMotion });
			}
		},
		end: (drop, x) => {
			const application = dragged.current;
			// Every tap finalizes the pan too; only a started drag has anything to undo.
			if (!application) return;
			hovered.current = null;
			dragged.current = null;
			setHover(null);
			lift.set(
				withSpring(1, { duration: reduceMotion ? 0 : 260, dampingRatio: 0.8 }, (finished) => {
					if (finished) scheduleOnRN(setDrag, null);
				}),
			);
			if (!drop) return;
			// Auto-scroll may still be moving the columns: resolve the target from fresh positions at the release point.
			void measureColumns().then(() => {
				const target = stageAt(x, rects.current);
				if (!target) return;
				haptics.light();
				moveTo(application, target);
			});
		},
	};
	// Cards get a proxy that never changes, so a re-render mid-drag doesn't rebuild (and cancel) their pan gesture.
	const latest = useRef(handlers);
	useEffect(() => {
		latest.current = handlers;
	});
	const [stableHandlers] = useState<DragHandlers>(() => ({
		motion: handlers.motion,
		start: (...args) => latest.current.start(...args),
		move: (...args) => latest.current.move(...args),
		end: (...args) => latest.current.end(...args),
	}));
	useAnimatedReaction(
		() => {
			if (!dragActive.get()) return null;
			const x = finger.get();
			const rect = bounds.get();
			const stage = columnRects.get().find((column) => x >= column.x && x <= column.x + column.width)?.stage;
			const edge = x < rect.x + space.s10 ? -1 : x > rect.x + rect.width - space.s10 ? 1 : 0;
			return { stage, edge };
		},
		(current, previous) => {
			// Only column/edge crossings notify React; the card's position never waits for JS.
			if (current && (current.stage !== previous?.stage || current.edge !== previous?.edge)) {
				scheduleOnRN(stableHandlers.move, finger.get());
			}
		},
	);
	const edgeScroll = useFrameCallback((frame) => {
		if (!dragActive.get()) return;
		const x = finger.get();
		const rect = bounds.get();
		if (x >= rect.x + space.s10 && x <= rect.x + rect.width - space.s10) return;
		if (frame.timestamp - lastEdgeScroll.get() < AUTO_SCROLL_EVERY_MS) return;
		lastEdgeScroll.set(frame.timestamp);
		scheduleOnRN(stableHandlers.move, x);
	}, false);
	useEffect(() => {
		edgeScroll.setActive(drag !== null);
		return () => edgeScroll.setActive(false);
	}, [drag, edgeScroll]);
	const onBoardScroll = useAnimatedScrollHandler((event) => {
		const delta = event.contentOffset.x - scrollX.get();
		scrollX.set(event.contentOffset.x);
		if (dragActive.get()) columnRects.set((rects) => rects.map((rect) => ({ ...rect, x: rect.x - delta })));
	});

	// The lifted card follows the finger, slightly raised unless Reduce Motion is on.
	const overlayStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: translateX.get() }, { translateY: translateY.get() }, { scale: lift.get() }],
	}));

	if (query.isError) {
		return (
			<View style={{ padding: space.s4, gap: space.s3 }}>
				<Banner tone="warn" message={applicationError(query.error)} />
				<Button label={t`Retry loading applications`} onPress={() => void query.refetch()} />
			</View>
		);
	}
	if (query.isPending) {
		return (
			<View style={{ padding: space.s4, gap: space.s3 }}>
				<Skeleton height={space.s12} />
				<Skeleton height={space.s12} />
			</View>
		);
	}
	if (applications.length === 0) {
		return (
			<EmptyState
				variant="card"
				icon="briefcase"
				title={search.trim() && query.data?.length ? t`No matching applications` : t`Track your first job`}
				message={
					search.trim() && query.data?.length
						? t`Try different words or clear your filters.`
						: t`Paste a job link. We'll save the posting so Check, the assistant and your letter can use it.`
				}
				action={
					search.trim() && query.data?.length
						? { label: t`Clear filters`, onPress: () => useApplicationSearch.getState().setSearch("") }
						: { label: t`Save a job`, onPress: () => router.setParams({ create: "1" }) }
				}
			/>
		);
	}

	return (
		<View style={{ flex: 1 }}>
			<View
				ref={board}
				style={{ flex: 1 }}
				onLayout={() =>
					board.current?.measureInWindow((x, y, width) => {
						boardRect.current = { x, y, width };
						bounds.set({ x, width });
					})
				}
			>
				<AnimatedScrollView
					ref={scrollRef}
					horizontal
					showsHorizontalScrollIndicator={false}
					scrollEnabled={!drag}
					snapToInterval={tablet ? undefined : columnWidth + space.s3}
					decelerationRate={tablet ? "normal" : "fast"}
					scrollEventThrottle={16}
					onScroll={onBoardScroll}
					contentContainerStyle={{ padding: space.s4, gap: space.s3 }}
				>
					{stages.map((lane) => (
						<Column
							key={lane.id}
							onRefresh={query.refetch}
							stage={lane}
							applications={byStage.get(lane.id) ?? []}
							width={columnWidth}
							cardWidth={cardWidth}
							highlighted={hover === lane.id && drag !== null && statusOf(drag.application) !== lane.id}
							draggingId={drag?.application.id ?? null}
							handlers={stableHandlers}
							onMove={(application) => {
								setMoving(application);
								setMoveOpen(true);
							}}
							register={(view) => {
								if (view) columns.current.set(lane.id, view);
								else columns.current.delete(lane.id);
							}}
						/>
					))}
				</AnimatedScrollView>
				{drag ? (
					<Animated.View
						pointerEvents="none"
						style={[
							{
								position: "absolute",
								left: drag.left,
								top: drag.top,
								width: drag.width,
								borderRadius: radius.rLg,
								boxShadow: shadows.e2.boxShadow,
							},
							overlayStyle,
						]}
					>
						<BoardCard application={drag.application} />
					</Animated.View>
				) : null}
			</View>
			<MoveSheet
				application={moving}
				current={moving ? statusOf(moving) : null}
				open={moveOpen}
				onClose={() => setMoveOpen(false)}
				onPick={(stage) => {
					setMoveOpen(false);
					// A Close or Mark as applied sheet replaces this one once its dismissal (d3) has run.
					if (moving) setTimeout(() => moveTo(moving, stage), motion.d3);
				}}
			/>
			{closing ? (
				<CloseSheet lane={actionLane} application={closing} open={closeOpen} onClose={() => setCloseOpen(false)} />
			) : null}
			{marking ? (
				<MarkAppliedSheet lane={actionLane} application={marking} open={markOpen} onClose={() => setMarkOpen(false)} />
			) : null}
		</View>
	);
}

type ColumnProps = {
	onRefresh: () => Promise<unknown>;
	stage: ApplicationLane;
	applications: Application[];
	width: number;
	cardWidth: number;
	highlighted: boolean;
	draggingId: string | null;
	handlers: DragHandlers;
	onMove: (application: Application) => void;
	register: (view: ComponentRef<typeof View> | null) => void;
};

function Column({
	onRefresh,
	stage,
	applications,
	width,
	cardWidth,
	highlighted,
	draggingId,
	handlers,
	onMove,
	register,
}: ColumnProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const pull = usePullRefresh(onRefresh);
	const [visible, setVisible] = useState(COLUMN_PAGE_SIZE);
	const shown = applications.slice(0, visible);
	// Columns mount once the board has data, so cards stagger in when the board opens.
	const firstAppearance = useFirstAppearance(true);
	const remaining = applications.length - shown.length;

	return (
		<View
			ref={register}
			style={{
				width,
				borderRadius: radius.rLg,
				borderWidth: 1,
				borderColor: highlighted ? colors.accent : "transparent",
				backgroundColor: highlighted ? colors.accentSoft : colors.sunken,
			}}
		>
			<View
				accessible
				accessibilityRole="header"
				accessibilityLabel={plural(applications.length, {
					one: `${getLaneLabel(stage)}, # application`,
					other: `${getLaneLabel(stage)}, # applications`,
				})}
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space.s2,
					padding: space.s3,
					paddingBottom: space.s1,
				}}
			>
				<View
					style={{
						width: space.s2,
						height: space.s2,
						borderRadius: radius.rLg,
						backgroundColor: stage.color,
					}}
				/>
				<Text variant="label" style={{ flex: 1 }}>
					{getLaneLabel(stage)}
				</Text>
				<Text variant="mono" color="ink3">
					{applications.length}
				</Text>
			</View>
			<LegacyScrollView
				alwaysBounceVertical
				refreshControl={<RefreshControl {...pull} tintColor={colors.accent} colors={[colors.accent]} />}
				contentContainerStyle={{ padding: space.s3, paddingTop: space.s2, gap: space.s3 }}
			>
				{stage.category === "closed" && !stage.closedReason && applications.length === 0 ? (
					<Text variant="callout" color="ink3">{t`Drop here to close with a reason.`}</Text>
				) : null}
				{shown.map((application, index) => (
					<Animated.View key={application.id} {...listItemMotion(index, firstAppearance)} layout={listLayout}>
						<DraggableCard
							application={application}
							width={cardWidth}
							dragging={application.id === draggingId}
							handlers={handlers}
							onMove={() => onMove(application)}
						/>
					</Animated.View>
				))}
				{remaining > 0 ? (
					<Button
						variant="ghost"
						size="sm"
						label={t`Show ${Math.min(remaining, COLUMN_PAGE_SIZE)} more`}
						onPress={() => setVisible((count) => count + COLUMN_PAGE_SIZE)}
					/>
				) : null}
			</LegacyScrollView>
		</View>
	);
}

type DraggableCardProps = {
	application: Application;
	width: number;
	dragging: boolean;
	handlers: DragHandlers;
	onMove: () => void;
};

function DraggableCard({ application, width, dragging, handlers, onMove }: DraggableCardProps) {
	const { start, end, motion } = handlers;
	const pan = useMemo(() => {
		const liftCard = (event: DragEvent) => start(application, event, width);
		return (
			Gesture.Pan()
				.activateAfterLongPress(LONG_PRESS_MS)
				.onStart((event) => {
					motion.x.set(0);
					motion.y.set(0);
					motion.finger.set(event.absoluteX);
					motion.active.set(true);
					scheduleOnRN(liftCard, { absoluteX: event.absoluteX, absoluteY: event.absoluteY, x: event.x, y: event.y });
				})
				.onUpdate((event) => {
					motion.x.set(event.translationX);
					motion.y.set(event.translationY);
					motion.finger.set(event.absoluteX);
				})
				// `success` is true only for a drag that was active and ended normally (not cancelled).
				.onFinalize((event, success) => {
					motion.active.set(false);
					scheduleOnRN(end, success, event.absoluteX);
				})
		);
	}, [application, width, start, end, motion]);

	return (
		<GestureDetector gesture={pan}>
			<View style={{ opacity: dragging ? 0.4 : 1 }}>
				<BoardCard application={application} onMove={onMove} />
			</View>
		</GestureDetector>
	);
}

type BoardCardProps = { application: Application; onMove?: (() => void) | undefined };

/** Role, company and next step; Open and Move to… (mockup `boardCard`). Without `onMove` it is the drag preview. */
function BoardCard({ application, onMove }: BoardCardProps) {
	const router = useRouter();
	const { t, i18n } = useLingui();
	const { space } = useTheme();
	const { timeZone } = useUserTime();
	const lanes = useApplicationLanes();
	const next = describeNextStep(
		getNextStep(application, undefined, lanes.lanes, timeZone),
		application,
		i18n.locale,
		timeZone,
	);

	return (
		<Card>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${application.role}, ${application.company}. ${next.title}`}
				accessibilityHint={t`Open application`}
				accessibilityActions={onMove ? [{ name: "move", label: t`Move to…` }] : undefined}
				onAccessibilityAction={(event) => {
					if (event.nativeEvent.actionName === "move") onMove?.();
				}}
				disabled={!onMove}
				onPress={() => router.push(routes.applicationDetails(application.id))}
				style={{ gap: space.s1 }}
			>
				<Text variant="label" numberOfLines={2}>
					{application.role}
				</Text>
				<Text variant="callout" color="ink2" numberOfLines={1}>
					{application.company}
					{application.location ? ` · ${application.location}` : ""}
				</Text>
				<Text variant="caption" color={next.tone === "warn" ? "warnText" : "ink3"} numberOfLines={2}>
					{next.sub ? `${next.title} · ${next.sub}` : next.title}
				</Text>
			</Pressable>
		</Card>
	);
}

type MoveSheetProps = {
	application: Application | null;
	current: string | null;
	open: boolean;
	onClose: () => void;
	onPick: (stage: string) => void;
};

/** The accessible alternative to dragging (mockup `app-move`). */
function MoveSheet({ application, current, open, onClose, onPick }: MoveSheetProps) {
	const lanes = useApplicationLanes();
	const { t } = useLingui();
	const { space } = useTheme();
	return (
		<Sheet open={open} onClose={onClose} title={t`Move to stage`}>
			{application ? (
				<View style={{ paddingBottom: space.s4 }}>
					<Text color="ink2" style={{ paddingHorizontal: space.s4, paddingBottom: space.s2 }}>
						{application.role} · {application.company}
					</Text>
					{lanes.active.map((stage) => (
						<ListRow
							key={stage.id}
							title={getLaneLabel(stage)}
							subtitle={stage.category === "closed" && !stage.closedReason ? t`Choose outcome` : undefined}
							trailing={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: stage.color }} />}
							leading={stage.id === current ? "check-circle" : "circle"}
							selected={stage.id === current}
							disabled={!lanes.ready || stage.id === current}
							onPress={() => onPick(stage.id)}
						/>
					))}
					{application.status === "saved" ? (
						<Text variant="callout" color="ink3" style={{ paddingHorizontal: space.s4, paddingTop: space.s2 }}>
							{t`Moving to Applied asks what you actually sent.`}
						</Text>
					) : null}
				</View>
			) : null}
		</Sheet>
	);
}
