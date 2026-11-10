// Toasts (COMPONENTS.md §17, MOTION.md §6.6). Mount <ToastHost /> once at the root, above the navigator; call
// showToast() from anywhere. 12 dp from the sides, above the dock or footer (they register their height with
// useToastOffset). Enter: rise 8 dp with a fade, d3 `ease`. A 2 dp `accent` fuse runs linearly for the lifetime
// (toastLifetime: 5 s, 8 s with an action; null with a screen reader and an action) and pauses while touched.
// Exit: fade and drop 8 dp over d2. A new toast replaces the old one with a d2 crossfade. Every toast is announced.
// With a screen reader running (also when it starts while the toast is up), a toast with an action stays until used
// or dismissed (the escape gesture dismisses it); pauseToast()/resumeToast() hold the fuse as a touch does.
// Nothing exists only in a toast: every action is also where its item lives.
import { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import Animated, {
	cancelAnimation,
	runOnJS,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { Touch } from "./base";
import { enter, startFuse, toastLifetime, useMotionPolicy } from "./motion";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { motion, radius, space } from "./tokens";
import { useDesignTag } from "@/dev/storyboard/harness";

export type ToastSpec = {
	message: string;
	action?: { label: string; onPress: () => void };
	/** Overrides toastLifetime() (motion lab only). */
	lifetime?: number;
	/**
	 * Motion lab only: literal colours for the fill and the fuse, a taller fuse, hidden text, a fixed height, and a
	 * 12 × 12 `centre` square in a layer that rises with the toast but is not faded by it (position probes).
	 */
	labMarker?: {
		fill?: string;
		fuse?: string;
		fuseHeight?: number;
		hideText?: boolean;
		height?: number;
		centre?: string;
	};
};

type Shown = ToastSpec & { id: number };

type ToastState = {
	current: Shown | null;
	/** The fuse is held (pauseToast); a new toast starts unheld. */
	held: boolean;
	offsets: { id: number; bottom: number }[];
	show: (t: ToastSpec) => number;
	dismiss: (id?: number) => void;
};

let nextId = 1;
const useToasts = create<ToastState>((set, get) => ({
	current: null,
	held: false,
	offsets: [],
	show: (t) => {
		const id = nextId++;
		set({ current: { ...t, id }, held: false });
		return id;
	},
	dismiss: (id) => {
		const c = get().current;
		if (c && (id === undefined || c.id === id)) set({ current: null });
	},
}));

/** Show a toast; it replaces the one on screen. Returns its id for dismissToast(). */
export function showToast(t: ToastSpec): number {
	return useToasts.getState().show(t);
}
export function dismissToast(id?: number) {
	useToasts.getState().dismiss(id);
}
/** Hold the current toast's fuse, as touching it does; resumeToast() lets it run out the rest of its lifetime. */
export function pauseToast() {
	useToasts.setState({ held: true });
}
export function resumeToast() {
	useToasts.setState({ held: false });
}

/** Docks and footers register the height they cover at the bottom of the screen, safe area included. */
export function useToastOffset(bottom: number) {
	useEffect(() => {
		const id = nextId++;
		useToasts.setState((s) => ({ offsets: [...s.offsets, { id, bottom }] }));
		return () => useToasts.setState((s) => ({ offsets: s.offsets.filter((o) => o.id !== id) }));
	}, [bottom]);
}

export function ToastHost() {
	const current = useToasts((s) => s.current);
	const offsets = useToasts((s) => s.offsets);
	const insets = useSafeAreaInsets();
	const bottom = (offsets.at(-1)?.bottom ?? insets.bottom) + space.s3;
	// The leaving toast stays mounted for its exit or crossfade.
	const [layers, setLayers] = useState<{ toast: Shown; leaving: boolean; replaced: boolean }[]>([]);
	const [last, setLast] = useState<Shown | null>(null);
	if (current !== last) {
		// A new or dismissed toast (state adjusted during render): the one on screen starts leaving.
		setLast(current);
		const kept = layers.filter((l) => !l.leaving).map((l) => ({ ...l, leaving: true, replaced: !!current }));
		setLayers(current ? [...kept, { toast: current, leaving: false, replaced: kept.length > 0 }] : kept);
	}
	return (
		<View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
			{layers.map((l) => (
				<ToastView
					key={l.toast.id}
					toast={l.toast}
					leaving={l.leaving}
					crossfade={l.replaced}
					bottom={bottom}
					onGone={() => setLayers((ls) => ls.filter((x) => x.toast.id !== l.toast.id))}
				/>
			))}
		</View>
	);
}

function ToastView({
	toast,
	leaving,
	crossfade,
	bottom,
	onGone,
}: {
	toast: Shown;
	leaving: boolean;
	crossfade: boolean;
	bottom: number;
	onGone: () => void;
}) {
	const { colors, shadows } = useTheme();
	const { distance, overlayFade } = useMotionPolicy();
	const ref = useDesignTag({ kind: "component", component: "Toast", radius: radius.lg, bg: "ink" });
	const shown = useSharedValue(0);
	const fuse = useSharedValue(1);
	const held = useToasts((s) => s.held);
	const [touched, setTouched] = useState(false);
	const [screenReader, setScreenReader] = useState<boolean | null>(null);
	/** undefined while it is being worked out; null: stays until used or dismissed. */
	const [lifetime, setLifetime] = useState<number | null | undefined>(undefined);
	const lab = toast.labMarker;
	const rise = crossfade ? 0 : distance(motion.fadeUpFirstRun);

	useEffect(() => {
		if (leaving) {
			cancelAnimation(fuse);
			shown.set(
				withTiming(0, enter(overlayFade(motion.d2)), (done) => {
					if (done) runOnJS(onGone)();
				}),
			);
			return;
		}
		shown.set(withTiming(1, enter(overlayFade(crossfade ? motion.d2 : motion.d3))));
		AccessibilityInfo.announceForAccessibility(toast.action ? `${toast.message} ${toast.action.label}` : toast.message);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [leaving]);

	// A screen reader starting or stopping while the toast is up changes its lifetime.
	useEffect(() => {
		const sub = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReader);
		return () => sub.remove();
	}, []);
	useEffect(() => {
		let live = true;
		(toast.lifetime != null ? Promise.resolve(toast.lifetime) : toastLifetime(!!toast.action)).then((ms) => {
			if (live) setLifetime(ms);
		});
		return () => {
			live = false;
		};
	}, [toast.lifetime, toast.action, screenReader]);

	// The fuse runs while nothing holds it, from where it stopped.
	useEffect(() => {
		if (leaving || lifetime === undefined) return;
		if (lifetime === null || held || touched) {
			cancelAnimation(fuse);
			return;
		}
		startFuse(fuse, lifetime, () => dismissToast(toast.id));
	}, [leaving, lifetime, held, touched, fuse, toast.id]);

	const style = useAnimatedStyle(() => ({
		opacity: shown.value,
		transform: [{ translateY: toastRise(shown.value, rise) }],
	}));
	const riseOnly = useAnimatedStyle(() => ({ transform: [{ translateY: toastRise(shown.value, rise) }] }));
	const fuseStyle = useAnimatedStyle(() => ({ width: `${fuse.value * 100}%` }));
	const place = [{ bottom }, lab?.height ? { height: lab.height } : null];

	return (
		<>
			<Animated.View
				ref={ref as never}
				accessibilityLiveRegion="polite"
				onTouchStart={() => setTouched(true)}
				onTouchEnd={() => setTouched(false)}
				onTouchCancel={() => setTouched(false)}
				onAccessibilityEscape={() => dismissToast(toast.id)}
				pointerEvents={leaving ? "none" : "auto"}
				style={[styles.toast, ...place, { backgroundColor: lab?.fill ?? colors.ink, boxShadow: shadows.sh3 }, style]}
			>
				<View style={[styles.message, lab?.hideText ? { opacity: 0 } : null]}>
					<Text variant="ui" color="bg">
						{toast.message}
					</Text>
				</View>
				{toast.action && (
					<Touch
						feedback="scale"
						style={[styles.action, lab?.hideText ? { opacity: 0 } : null]}
						accessibilityLabel={toast.action.label}
						onPress={() => {
							toast.action?.onPress();
							dismissToast(toast.id);
						}}
					>
						<Text variant="ui" color="bg" weight={600}>
							{toast.action.label}
						</Text>
					</Touch>
				)}
				<Animated.View
					pointerEvents="none"
					style={[
						styles.fuse,
						{ backgroundColor: lab?.fuse ?? colors.accent, height: lab?.fuseHeight ?? 2 },
						fuseStyle,
					]}
				/>
			</Animated.View>
			{lab?.centre ? (
				<Animated.View pointerEvents="none" style={[styles.labCentre, ...place, riseOnly]}>
					<View style={{ width: 12, height: 12, backgroundColor: lab.centre }} />
				</Animated.View>
			) : null}
		</>
	);
}

/** How far below its place the toast is at entry progress `shown` (0 → 1): the rise, and the drop on exit. */
export function toastRise(shown: number, distance: number) {
	"worklet";
	return (1 - shown) * distance;
}

const styles = StyleSheet.create({
	toast: {
		position: "absolute",
		left: space.s3,
		right: space.s3,
		borderRadius: radius.lg,
		paddingTop: 12,
		paddingBottom: 12,
		paddingEnd: 8,
		paddingStart: 14,
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		overflow: "hidden",
	},
	message: { flex: 1 },
	action: { height: 44, marginVertical: -12, paddingHorizontal: 12, justifyContent: "center" },
	fuse: { position: "absolute", start: 0, bottom: 0 },
	labCentre: { position: "absolute", left: space.s3, right: space.s3, alignItems: "center", justifyContent: "center" },
});
