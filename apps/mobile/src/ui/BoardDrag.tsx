import type { SnapCarouselHandle } from "./SnapCarousel";
// J2 board drag (MOTION.md §7). Wrap the board's SnapCarousel in <BoardDrag> and each card in <BoardDragCard>.
//   Lift (long-press 500 ms): the card rises into an overlay above the columns, scales to 1.02, rotates −2°, gains
//   `sh3` and a 2 dp `accent` ring, d1 `ease`, `medium`. It follows the finger 1:1.
//   Held near the board's start or end edge, the board pages one column (SnapCarousel: d3 `ease-out-strong`,
//   `selection`), again after each further hold.
//   Drop over a new column: onDrop(key, from, to). Returning false (or a promise of false: J7's "What did you
//   send?" cancelled) puts the card back with release(); otherwise `rigid` plays and the card settles into the new
//   column's x with release(), scale, rotation, shadow and ring returning d1. Dropping in its own column settles
//   back silently.
//   The visible alternative is the stage button above the board ("Interviewing · 4 of 6") and J6's stage control;
//   the card's own Touch carries its accessibility actions.
import {
	createContext,
	type ReactNode,
	type Ref,
	type RefObject,
	useContext,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { type HostInstance, I18nManager, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
	runOnJS,
	type SharedValue,
	useAnimatedStyle,
	useFrameCallback,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { enter, haptic, release } from "./motion";
import { useTheme } from "./theme";
import { motion, radius as radii } from "./tokens";

/** How close to the board's edge (dp) a held card has to be to page, and for how long (ms). */
export const PAGE_EDGE = 48;
export const PAGE_HOLD = 500;

/** −1 near the start edge, 1 near the end edge, 0 elsewhere (x from the board's left edge, screen coordinates). */
export function edgeZone(x: number, width: number, rtl = false) {
	"worklet";
	const zone = x < PAGE_EDGE ? -1 : x > width - PAGE_EDGE ? 1 : 0;
	return rtl ? -zone : zone;
}

export type BoardDragHandle = {
	/** What the gestures do, for the motion lab and tests: lift a card, drag it by (dx, dy), drop it. */
	lift: (key: string) => void;
	dragBy: (key: string, dx: number, dy: number) => void;
	drop: (key: string) => void;
};

export type BoardDragProps = {
	/** The board's carousel; it must span the BoardDrag horizontally. */
	carousel: RefObject<SnapCarouselHandle | null>;
	/** The column a card sits in now. */
	columnOf: (key: string) => number;
	/** A card dropped over another column. Return false (or resolve to false) to put it back. */
	onDrop: (key: string, from: number, to: number) => boolean | void | Promise<boolean | void>;
	children: ReactNode;
	/** The cards' corner radius (board cards: 16). */
	radius?: number;
	ref?: Ref<BoardDragHandle>;
};

type Rect = { x: number; y: number; width: number; height: number };
type Lifted = { key: string; element: ReactNode; rect: Rect; columnOffset: number; from: number };

type Ctx = {
	element: (key: string, element: ReactNode) => void;
	view: (key: string, view: HostInstance | null, previous: HostInstance | null) => void;
	lift: (key: string, fingerX?: number) => void;
	drop: (key: string) => void;
	hidden: SharedValue<string | null>;
	dragging: SharedValue<string | null>;
	originX: SharedValue<number>;
	tx: SharedValue<number>;
	ty: SharedValue<number>;
	fingerX: SharedValue<number>;
};
const BoardCtx = createContext<Ctx | null>(null);

export function BoardDrag({ carousel, columnOf, onDrop, children, radius = radii.xl, ref }: BoardDragProps) {
	const { colors, shadows } = useTheme();
	const rtl = I18nManager.isRTL;
	const root = useRef<HostInstance>(null);
	const cards = useRef(new Map<string, { view: HostInstance | null; element: ReactNode }>());
	const [lifted, setLifted] = useState<Lifted | null>(null);
	const liftedRef = useRef<Lifted | null>(null);
	const tx = useSharedValue(0);
	const ty = useSharedValue(0);
	const up = useSharedValue(0);
	const fingerX = useSharedValue(-1);
	const originX = useSharedValue(0);
	const width = useSharedValue(0);
	const dragging = useSharedValue<string | null>(null);
	const hidden = useSharedValue<string | null>(null);
	const holdSince = useSharedValue(-1);
	const holdZone = useSharedValue(0);

	const clear = () => {
		hidden.set(null);
		liftedRef.current = null;
		setLifted(null);
	};

	const lift = (key: string, finger?: number) => {
		const card = cards.current.get(key);
		if (!card?.view || !root.current || liftedRef.current) {
			dragging.set(null);
			return;
		}
		dragging.set(key);
		tx.set(0);
		ty.set(0);
		haptic("medium");
		up.set(withTiming(1, enter(motion.d1)));
		root.current.measureInWindow((rx, ry, rw) => {
			originX.set(rx);
			width.set(rw);
			card.view?.measureInWindow((x, y, w, h) => {
				if (dragging.value !== key) {
					up.set(withTiming(0, enter(motion.d1)));
					return; // dropped before it could be measured: nothing moved
				}
				const from = columnOf(key);
				const rect = { x: x - rx, y: y - ry, width: w, height: h };
				const l: Lifted = {
					key,
					element: card.element,
					rect,
					from,
					columnOffset: rect.x - (carousel.current?.itemX(from) ?? rect.x),
				};
				fingerX.set(finger ?? rect.x + w / 2);
				liftedRef.current = l;
				setLifted(l);
			});
		});
	};

	/** Settle the overlay at (dx, dy) from where it was lifted: release() by the distance left, then `done`. */
	const settle = (dx: number, dy: number, done: () => void) => {
		const span = liftedRef.current?.rect.width ?? 1;
		const config = release(Math.hypot(dx - tx.value, dy - ty.value), span);
		up.set(withTiming(0, enter(motion.d1)));
		ty.set(withTiming(dy, config));
		tx.set(
			withTiming(dx, config, (finished) => {
				if (finished) runOnJS(done)();
			}),
		);
	};

	/** After an accepted drop the card re-renders in its new column: settle the overlay onto it. */
	const settleOnNewCard = (l: Lifted, fallbackX: number) => {
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				const view = cards.current.get(l.key)?.view;
				if (!view || !root.current) return settle(fallbackX, ty.value, clear);
				root.current.measureInWindow((rx, ry) =>
					view.measureInWindow((x, y) => settle(x - rx - l.rect.x, y - ry - l.rect.y, clear)),
				);
			}),
		);
	};

	const drop = (key: string) => {
		const l = liftedRef.current;
		const finger = fingerX.value;
		dragging.set(null);
		fingerX.set(-1);
		if (!l || l.key !== key) {
			up.set(withTiming(0, enter(motion.d1)));
			return;
		}
		const c = carousel.current;
		const x = finger >= 0 ? finger : l.rect.x + l.rect.width / 2 + tx.value;
		const to = c ? c.indexAt(rtl ? width.value - x : x) : l.from;
		const back = () => settle(0, 0, clear);
		if (to === l.from) return back();
		Promise.resolve(onDrop(key, l.from, to)).then((ok) => {
			if (ok === false) return back();
			haptic("rigid");
			settleOnNewCard(l, (c?.itemX(to) ?? l.rect.x) + l.columnOffset - l.rect.x);
		});
	};

	useImperativeHandle(ref, () => ({
		lift: (key) => lift(key),
		dragBy: (key, dx, dy) => {
			const l = liftedRef.current;
			if (dragging.value !== key) return;
			tx.set(dx);
			ty.set(dy);
			if (l) fingerX.set(l.rect.x + l.rect.width / 2 + dx);
		},
		drop,
	}));

	const page = (zone: number) => {
		const c = carousel.current;
		if (c) c.scrollToIndex(c.index() + zone);
	};

	// Held at an edge: page one column, then wait for another full hold (plus the page itself).
	useFrameCallback((frame) => {
		if (dragging.value === null || fingerX.value < 0) {
			holdSince.set(-1);
			return;
		}
		const zone = edgeZone(fingerX.value, width.value, rtl);
		if (zone === 0 || zone !== holdZone.value) {
			holdZone.set(zone);
			holdSince.set(zone === 0 ? -1 : frame.timestamp);
			return;
		}
		if (holdSince.value >= 0 && frame.timestamp - holdSince.value >= PAGE_HOLD) {
			holdSince.set(frame.timestamp + motion.d3);
			runOnJS(page)(zone);
		}
	});

	const overlay = useAnimatedStyle(() => ({
		transform: [
			{ translateX: tx.value },
			{ translateY: ty.value },
			{ scale: 1 + (motion.liftScaleCard - 1) * up.value },
			{ rotate: `${motion.liftRotateCard * up.value}deg` },
		],
	}));
	const decoration = useAnimatedStyle(() => ({ opacity: up.value }));

	const ctx: Ctx = {
		element: (key, element) => {
			cards.current.set(key, { view: cards.current.get(key)?.view ?? null, element });
		},
		view: (key, view, previous) => {
			const card = cards.current.get(key);
			if (view) cards.current.set(key, { view, element: card?.element });
			else if (card && card.view === previous) card.view = null;
		},
		lift,
		drop,
		hidden,
		dragging,
		originX,
		tx,
		ty,
		fingerX,
	};

	return (
		<BoardCtx.Provider value={ctx}>
			<View ref={root} collapsable={false}>
				{children}
				{lifted ? (
					<Animated.View
						pointerEvents="none"
						onLayout={() => hidden.set(lifted.key)}
						style={[
							styles.overlay,
							{ left: lifted.rect.x, top: lifted.rect.y, width: lifted.rect.width, height: lifted.rect.height },
							overlay,
						]}
					>
						<Animated.View
							style={[StyleSheet.absoluteFill, { borderRadius: radius, boxShadow: shadows.sh3 }, decoration]}
						/>
						{lifted.element}
						<Animated.View
							style={[styles.ring, { borderRadius: radius + 2, borderColor: colors.accent }, decoration]}
						/>
					</Animated.View>
				) : null}
			</View>
		</BoardCtx.Provider>
	);
}

/** One card on the board. Long-press lifts it; everything else (taps, accessibility actions) is the card's own. */
export function BoardDragCard({ id, children }: { id: string; children: ReactNode }) {
	const ctx = useContext(BoardCtx);
	if (!ctx) throw new Error("BoardDragCard outside BoardDrag");
	const { hidden, lift, drop, dragging, originX, tx, ty, fingerX } = ctx;
	const view = useRef<HostInstance | null>(null);
	ctx.element(id, children);

	// The card follows the finger on the UI thread; only lift and drop cross to JS.
	const pan = Gesture.Pan()
		.activateAfterLongPress(500)
		.onStart((e) => {
			dragging.set(id);
			runOnJS(lift)(id, e.absoluteX - originX.value);
		})
		.onUpdate((e) => {
			tx.set(e.translationX);
			ty.set(e.translationY);
			fingerX.set(e.absoluteX - originX.value);
		})
		.onFinalize(() => {
			if (dragging.value === id) runOnJS(drop)(id);
		});

	const style = useAnimatedStyle(() => ({ opacity: hidden.value === id ? 0 : 1 }));
	return (
		<GestureDetector gesture={pan}>
			<Animated.View
				ref={(v: HostInstance | null) => {
					ctx.view(id, v, view.current);
					view.current = v;
				}}
				collapsable={false}
				style={style}
			>
				{children}
			</Animated.View>
		</GestureDetector>
	);
}

const styles = StyleSheet.create({
	overlay: { position: "absolute", zIndex: 100 },
	ring: { position: "absolute", top: -2, left: -2, right: -2, bottom: -2, borderWidth: 2 },
});
