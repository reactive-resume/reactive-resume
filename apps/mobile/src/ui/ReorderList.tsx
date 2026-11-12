// Reorder (MOTION.md §7): B2 entries, B8 sections, C5 priorities. Lift on long-press (500 ms) or at once from a drag
// handle: scale 1.02 and `sh2` fade in, d1 `ease`, `medium`. The item follows the finger 1:1; neighbours slide out of
// the way with d2 `ease-in-out-strong` as its centre crosses their midpoint, `selection` per slot. The list
// auto-scrolls only while the finger is in the outer 8% of the scroll view (faster deeper in). Drop: settles with
// `release()`, scale and shadow return d1, `rigid` as it lands. Move up / Move down are accessibility actions and
// `moveBy` for the visible taps (B21, B2's ···, B8's menu), `selection` per step.
import { t } from "@lingui/core/macro";
import { type ReactElement, type ReactNode, type Ref, useEffect, useImperativeHandle } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
	type AnimatedRef,
	runOnJS,
	scrollTo,
	type SharedValue,
	useAnimatedReaction,
	useAnimatedStyle,
	useFrameCallback,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { curve, enter, haptic, hapticOnUI, release } from "./motion";
import { useTheme } from "./theme";
import { motion } from "./tokens";

export type ReorderHandle = {
	/** What the gestures do, for the motion lab and tests: lift an item, drag it by dy, drop it. */
	lift: (key: string) => void;
	dragBy: (key: string, dy: number) => void;
	drop: (key: string) => void;
	/** Move up (-1) / Move down (+1), animated. */
	moveBy: (key: string, step: -1 | 1) => void;
};

export type ReorderListProps<T> = {
	data: readonly T[];
	keyOf: (item: T) => string;
	/** Every row has this height (rows are 64 dp). */
	itemHeight: number;
	/** `handle` wraps a drag handle: dragging it lifts at once. */
	renderItem: (item: T, ctx: { index: number; handle: (children: ReactNode) => ReactNode }) => ReactNode;
	/** The item moved from one index to another (after the drop or a Move up / Move down). */
	onReorder: (from: number, to: number) => void;
	/** The scroll view the list sits in, for auto-scroll: its ref, live offset and window top and height. */
	scroll?: { ref: AnimatedRef<Animated.ScrollView>; offset: SharedValue<number>; top: number; height: number };
	label?: (item: T) => string;
	/** A hold released without moving (B2: the entry's actions, B21). `light` plays as it fires. */
	onHold?: (item: T) => void;
	ref?: Ref<ReorderHandle>;
};

/**
 * Move `key` to the slot under `top` (its dragged top edge): every slot passed shifts one neighbour back. Returns the
 * new slots and how many slots were passed (one `selection` each).
 */
export function reorderSlots(
	slots: Record<string, number>,
	key: string,
	top: number,
	itemHeight: number,
	count: number,
) {
	"worklet";
	const current = slots[key] ?? 0;
	const target = Math.max(0, Math.min(count - 1, Math.round(top / itemHeight)));
	if (target === current) return { next: slots, passed: 0 };
	const next = { ...slots };
	const dir = target > current ? 1 : -1;
	for (const [k, s] of Object.entries(next)) {
		if (k !== key && (dir > 0 ? s > current && s <= target : s < current && s >= target)) next[k] = s - dir;
	}
	next[key] = target;
	return { next, passed: Math.abs(target - current) };
}

// `by`: the gesture that lifted the row (the handle's or the row's hold); only it moves and drops it.
type Drag = {
	key: string;
	by: string;
	startSlot: number;
	startTop: number;
	dy: number;
	scrolled: number;
	fingerY: number;
} | null;

const MAX_SCROLL = 14; // dp per frame at the very edge

export function ReorderList<T>({
	data,
	keyOf,
	itemHeight,
	renderItem,
	onReorder,
	scroll,
	label,
	onHold,
	ref,
}: ReorderListProps<T>) {
	const keys = data.map(keyOf);
	const slots = useSharedValue<Record<string, number>>(Object.fromEntries(keys.map((k, i) => [k, i])));
	const drag = useSharedValue<Drag>(null);
	// Lift scale and shadow (0..1) of the row in `lifted`: started in lift() and drop() themselves, in the frame the
	// gesture lands (a reaction in the row would start it a frame later). Only one row is lifted at a time.
	const liftedKey = useSharedValue<string | null>(null);
	const liftProgress = useSharedValue(0);
	// The row whose hold just ended without a move: it settles back without `rigid`.
	const quiet = useSharedValue<string | null>(null);
	const n = keys.length;
	const hold = (key: string) => {
		const item = data[keys.indexOf(key)];
		if (item !== undefined) onHold?.(item);
	};

	// A new order from the parent (after onReorder) already matches the slots; anything else resets them.
	const signature = keys.join("|");
	useEffect(() => {
		slots.set(Object.fromEntries(signature.split("|").map((k, i) => [k, i])));
	}, [signature, slots]);

	const lift = (key: string, by = "api") => {
		"worklet";
		if (drag.value) return;
		const slot = slots.value[key] ?? 0;
		drag.set({ key, by, startSlot: slot, startTop: slot * itemHeight, dy: 0, scrolled: 0, fingerY: -1 });
		liftedKey.set(key);
		liftProgress.set(withTiming(1, enter(motion.d1)));
		hapticOnUI("medium");
	};

	const moveTo = (key: string, top: number) => {
		"worklet";
		const { next, passed } = reorderSlots(slots.value, key, top, itemHeight, n);
		if (passed === 0) return;
		slots.set(next);
		for (let i = 0; i < passed; i++) hapticOnUI("selection");
	};

	const dragBy = (key: string, dy: number, by = "api") => {
		"worklet";
		const d = drag.value;
		if (!d || d.key !== key || d.by !== by) return;
		drag.set({ ...d, dy });
		moveTo(key, d.startTop + dy + d.scrolled);
	};

	const drop = (key: string, by = "api", still = false) => {
		"worklet";
		const d = drag.value;
		if (!d || d.key !== key || d.by !== by) return;
		if (still && by === "hold" && onHold) {
			quiet.set(key);
			hapticOnUI("light");
			runOnJS(hold)(key);
		}
		drag.set(null);
		liftProgress.set(withTiming(0, enter(motion.d1)));
		const to = slots.value[key] ?? d.startSlot;
		if (to !== d.startSlot) runOnJS(onReorder)(d.startSlot, to);
	};

	const moveBy = (key: string, step: -1 | 1) => {
		const from = slots.value[key] ?? 0;
		const to = from + step;
		if (to < 0 || to >= n) return;
		haptic("selection");
		const next = { ...slots.value };
		for (const k in next) if (next[k] === to) next[k] = from;
		next[key] = to;
		slots.set(next);
		onReorder(from, to);
	};

	useImperativeHandle(ref, () => ({
		lift: (key) => lift(key),
		dragBy: (key, dy) => dragBy(key, dy),
		drop: (key) => drop(key),
		moveBy,
	}));

	// Auto-scroll while the finger is in the outer 8% of the scroll view.
	useFrameCallback(() => {
		const d = drag.value;
		if (!d || !scroll || d.fingerY < 0) return;
		const edge = scroll.height * motion.autoScrollEdge;
		const y = d.fingerY - scroll.top;
		let speed = 0;
		if (y < edge) speed = -MAX_SCROLL * Math.min(1, (edge - y) / edge);
		else if (y > scroll.height - edge) speed = MAX_SCROLL * Math.min(1, (y - (scroll.height - edge)) / edge);
		if (speed === 0) return;
		const to = Math.max(0, scroll.offset.value + speed);
		const moved = to - scroll.offset.value;
		if (moved === 0) return;
		scrollTo(scroll.ref, 0, to, false);
		drag.set({ ...d, scrolled: d.scrolled + moved });
		moveTo(d.key, d.startTop + d.dy + d.scrolled + moved);
	});

	return (
		<View style={{ height: n * itemHeight }}>
			{data.map((item, index) => {
				const key = keyOf(item);
				return (
					<Row
						key={key}
						id={key}
						index={index}
						count={n}
						itemHeight={itemHeight}
						slots={slots}
						drag={drag}
						liftedKey={liftedKey}
						liftProgress={liftProgress}
						lift={lift}
						dragBy={dragBy}
						drop={drop}
						moveBy={moveBy}
						quiet={quiet}
						onHold={onHold ? hold : undefined}
						label={label?.(item)}
						render={(handle) => renderItem(item, { index, handle })}
					/>
				);
			})}
		</View>
	);
}

function Row({
	id,
	index,
	count,
	itemHeight,
	slots,
	drag,
	liftedKey,
	liftProgress,
	lift,
	dragBy,
	drop,
	moveBy,
	quiet,
	onHold,
	label,
	render,
}: {
	id: string;
	index: number;
	count: number;
	itemHeight: number;
	slots: SharedValue<Record<string, number>>;
	drag: SharedValue<Drag>;
	liftedKey: SharedValue<string | null>;
	liftProgress: SharedValue<number>;
	lift: (key: string, by?: string) => void;
	dragBy: (key: string, dy: number, by?: string) => void;
	drop: (key: string, by?: string, still?: boolean) => void;
	moveBy: (key: string, step: -1 | 1) => void;
	quiet: SharedValue<string | null>;
	onHold: ((key: string) => void) | undefined;
	label: string | undefined;
	render: (handle: (children: ReactNode) => ReactNode) => ReactNode;
}) {
	const { colors, shadows } = useTheme();
	const top = useSharedValue(index * itemHeight);

	// Neighbours slide to their new slot; the dragged row follows the finger instead.
	useAnimatedReaction(
		() => slots.value[id] ?? index,
		(slot, before) => {
			if (before === null || slot === before) return;
			if (drag.value?.key === id) return;
			top.set(withTiming(slot * itemHeight, enter(motion.d2, curve.easeInOutStrong)));
		},
	);
	// Drop: settle into the slot (the lift itself animates in the list's lift() and drop()).
	useAnimatedReaction(
		() => drag.value?.key === id,
		(isDragged, was) => {
			if (isDragged === was || was === null || isDragged) return;
			const target = (slots.value[id] ?? index) * itemHeight;
			const remaining = target - top.value;
			top.set(
				withTiming(target, release(remaining, itemHeight), (done) => {
					if (quiet.value === id) quiet.set(null);
					else if (done) hapticOnUI("rigid");
				}),
			);
		},
	);
	// While dragged: 1:1 with the finger.
	useAnimatedReaction(
		() => (drag.value?.key === id ? drag.value.startTop + drag.value.dy + drag.value.scrolled : null),
		(y) => {
			if (y !== null) top.set(y);
		},
	);

	const pan = (immediate: boolean) => {
		const by = immediate ? "handle" : "hold";
		const g = Gesture.Pan()
			.onStart(() => lift(id, by))
			.onUpdate((e) => {
				const d = drag.value;
				if (d?.by !== by) return;
				drag.set({ ...d, fingerY: e.absoluteY });
				dragBy(id, e.translationY, by);
			})
			.onFinalize((e) => drop(id, by, Math.hypot(e.translationX, e.translationY) < 10));
		return immediate ? g.minDistance(0) : g.activateAfterLongPress(500);
	};

	const style = useAnimatedStyle(() => ({
		top: top.value,
		zIndex: drag.value?.key === id ? 10 : 0,
		transform: [{ scale: 1 + (motion.liftScale - 1) * (liftedKey.value === id ? liftProgress.value : 0) }],
	}));
	const shadow = useAnimatedStyle(() => ({ opacity: liftedKey.value === id ? liftProgress.value : 0 }));

	const slot = index; // accessibility actions use the data order
	// One lift per drag: a slow drag by the handle also sets off the row's 500 ms hold, which lift() ignores.
	const hold = pan(false);
	const byHandle = pan(true);
	return (
		<GestureDetector gesture={hold}>
			<Animated.View
				style={[styles.row, { height: itemHeight }, style]}
				accessible={!!label}
				accessibilityLabel={label}
				accessibilityActions={[
					...(slot > 0 ? [{ name: "moveUp", label: t`Move up` }] : []),
					...(slot < count - 1 ? [{ name: "moveDown", label: t`Move down` }] : []),
					...(onHold ? [{ name: "longpress" }] : []),
				]}
				onAccessibilityAction={(e) => {
					const name = e.nativeEvent.actionName;
					if (name === "longpress") onHold?.(id);
					else moveBy(id, name === "moveUp" ? -1 : 1);
				}}
			>
				<Animated.View
					pointerEvents="none"
					style={[StyleSheet.absoluteFill, { boxShadow: shadows.sh2, backgroundColor: colors.bg }, shadow]}
				/>
				<View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
					{render((children) => (
						<GestureDetector gesture={byHandle}>{children as ReactElement}</GestureDetector>
					))}
				</View>
			</Animated.View>
		</GestureDetector>
	);
}

const styles = StyleSheet.create({ row: { position: "absolute", left: 0, right: 0 } });
