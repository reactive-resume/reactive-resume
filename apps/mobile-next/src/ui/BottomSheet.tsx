import type { StackNavigationOptions } from "expo-router/js-stack";
// Bottom sheet (COMPONENTS.md §17, MOTION.md §6.4). Mount it where it should appear (usually as the whole screen of
// a transparent modal route, `sheetRouteOptions`); it rises on mount and calls onClose after it has left.
//   Open: rises from below d3 `ease`; the `scrim-sheet` scrim fades in d2.
//   Drag: grabber, header and the sheet body follow the finger 1:1 down; up it resists (rubber band, ~24 dp).
//   Release: dismiss past 25% of the height or faster than 1000 dp/s down, else settle; both `release()`.
//   Close (button, scrim, Android back, ref.close()): slides down 224 ms, scrim out 140 ms. Dirty: "Discard changes?".
//   Keyboard (`keyboard`): rises with the keyboard frame by frame. Steps (`step`): a new step slides in from the
//   trailing edge in d2 and the sheet grows to the new `height` with `ease`.
//   Focus moves to the title on open and back to `returnFocusTo` on close; accessibilityViewIsModal on iOS.
import { t } from "@lingui/core/macro";
import {
	createContext,
	type ReactNode,
	type Ref,
	type RefObject,
	useContext,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import {
	AccessibilityInfo,
	BackHandler,
	findNodeHandle,
	type HostInstance,
	I18nManager,
	StyleSheet,
	View,
} from "react-native";
import { Gesture, GestureDetector, type GestureType } from "react-native-gesture-handler";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
	type EntryAnimationsValues,
	LayoutAnimationConfig,
	runOnJS,
	type SharedValue,
	useAnimatedReaction,
	useAnimatedScrollHandler,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Touch } from "./base";
import { DiscardDialog } from "./Dialog";
import { Icon } from "./Icon";
import {
	enter,
	hitSlopFor,
	leave,
	release,
	rubberBand,
	sheetShouldDismiss,
	timeScale,
	useMotionPolicy,
} from "./motion";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { motion, radius } from "./tokens";
import { useDesignTag } from "@/dev/storyboard/harness";

/** Options for a route that presents a BottomSheet or Dialog: the route is transparent and the overlay animates itself. */
export const sheetRouteOptions: StackNavigationOptions = {
	presentation: "transparentModal",
	animation: "none",
	headerShown: false,
	cardStyle: { backgroundColor: "transparent" },
	cardOverlayEnabled: false,
	gestureEnabled: false,
};

const UP_LIMIT = 24; // how far the sheet gives when pulled up

export type BottomSheetHandle = {
	/** Close as the close button does (asks first when dirty). */
	close: () => void;
	/** Fade the sheet out in d2 while a pushed screen covers it (D3), then call onClose. */
	fadeAway: () => void;
	/** What the pan does: set the drag translation (dp, down positive)… */
	drag: (translationY: number) => void;
	/** …and release it with a velocity (dp/s). */
	release: (velocityY: number) => void;
};

export type BottomSheetProps = {
	title: string;
	/** Fixed height as drawn, bottom safe area included. Changing it (a second step) grows the sheet in d2. */
	height: number;
	onClose: () => void;
	children: ReactNode;
	footer?: ReactNode;
	/** Unsaved input: closing asks "Discard changes?" first. */
	dirty?: boolean;
	/** Sheets with fields: follow the keyboard (needs KeyboardProvider at the root). */
	keyboard?: boolean;
	/** Key of the current step; a new key slides its content in from the trailing edge. */
	step?: string;
	returnFocusTo?: RefObject<HostInstance | null>;
	ref?: Ref<BottomSheetHandle>;
	/**
	 * Start open, held at this drag translation (dp, 0 = fully open), with no rise: a sheet restored on screen, and
	 * the motion lab's close and release scenes (a pan holding it 188 dp down).
	 */
	startOpenAt?: number;
	/**
	 * Motion lab only: the scrim's colour over the part of the screen the open sheet never covers (the rest keeps
	 * the token), and a 24 × 24 marker 4 dp below the sheet's top edge.
	 */
	labMarker?: { scrim?: string; top?: string };
};

type SheetContext = { scrollY: SharedValue<number>; pan: GestureType };
const Ctx = createContext<SheetContext | null>(null);

export function BottomSheet({
	title,
	height,
	onClose,
	children,
	footer,
	dirty = false,
	keyboard = false,
	step,
	returnFocusTo,
	ref,
	labMarker,
	startOpenAt,
}: BottomSheetProps) {
	const { colors, shadows } = useTheme();
	const { reduced, overlayFade } = useMotionPolicy();
	const insets = useSafeAreaInsets();
	const sheetRef = useDesignTag({ kind: "component", component: "BottomSheet", radius: radius.sheetTop, bg: "raised" });
	const scrimRef = useDesignTag({ kind: "component", component: "Scrim", bg: "scrimSheet" });
	const grabRef = useDesignTag({ kind: "component", component: "SheetGrabber", radius: 2, bg: "line2" });
	const titleRef = useRef<HostInstance>(null);
	const [asking, setAsking] = useState(false);

	const h = useSharedValue(height);
	// With timeScale 0 (storyboard captures) or startOpenAt the sheet is open from its first frame.
	const instant = timeScale.value === 0 || startOpenAt !== undefined;
	const ty = useSharedValue(startOpenAt ?? (reduced || instant ? 0 : height)); // 0 = open, h = below the screen
	const fade = useSharedValue(reduced && !instant ? 0 : 1); // the sheet's own opacity (reduced motion, fadeAway)
	const scrim = useSharedValue(instant ? 1 : 0);
	const kb = useSharedValue(0);
	const scrollY = useSharedValue(0);
	const dragStart = useSharedValue(0);
	const dirtySv = useSharedValue(dirty);
	useEffect(() => {
		dirtySv.set(dirty);
	}, [dirty, dirtySv]);
	const closing = useRef(false);
	const scrimMs = overlayFade(motion.d2); // a number, so worklets can use it

	const finish = () => {
		const node = returnFocusTo?.current ? findNodeHandle(returnFocusTo.current) : null;
		if (node) AccessibilityInfo.setAccessibilityFocus(node);
		onClose();
	};

	// Open.
	useEffect(() => {
		if (startOpenAt === undefined) {
			scrim.set(withTiming(1, enter(scrimMs)));
			if (reduced) fade.set(withTiming(1, enter(motion.d1)));
			else ty.set(withTiming(0, enter(motion.d3)));
		}
		const node = findNodeHandle(titleRef.current);
		if (node) setTimeout(() => AccessibilityInfo.setAccessibilityFocus(node), 50);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// A second step: grow or shrink to the new height.
	useEffect(() => {
		if (h.value !== height) h.set(withTiming(height, enter(motion.d2)));
	}, [height, h]);

	const slideOut = () => {
		"worklet";
		scrim.set(withTiming(0, leave(scrimMs)));
		if (reduced) {
			fade.set(
				withTiming(0, leave(motion.d1), (done) => {
					if (done) runOnJS(finish)();
				}),
			);
		} else {
			ty.set(
				withTiming(h.value, leave(motion.d3), (done) => {
					if (done) runOnJS(finish)();
				}),
			);
		}
	};

	const requestClose = () => {
		if (closing.current) return;
		if (dirty) {
			setAsking(true);
			return;
		}
		closing.current = true;
		slideOut();
	};

	const releaseAt = (velocityY: number) => {
		"worklet";
		const y = ty.value;
		if (sheetShouldDismiss(y, h.value, velocityY)) {
			if (dirtySv.value) {
				ty.set(withTiming(0, release(y, h.value)));
				runOnJS(setAsking)(true);
				return;
			}
			scrim.set(withTiming(0, leave(scrimMs)));
			ty.set(
				withTiming(h.value, release(h.value - y, h.value), (done) => {
					if (done) runOnJS(finish)();
				}),
			);
		} else {
			ty.set(withTiming(0, release(y, h.value)));
		}
	};

	const dragTo = (translation: number) => {
		"worklet";
		ty.set(translation >= 0 ? translation : -rubberBand(-translation, UP_LIMIT));
	};

	useImperativeHandle(ref, () => ({
		close: requestClose,
		fadeAway: () => {
			closing.current = true;
			scrim.set(withTiming(0, enter(motion.d2)));
			fade.set(
				withTiming(0, enter(motion.d2), (done) => {
					if (done) runOnJS(finish)();
				}),
			);
		},
		drag: (y) => dragTo(y),
		release: (v) => releaseAt(v),
	}));

	useEffect(() => {
		const sub = BackHandler.addEventListener("hardwareBackPress", () => {
			requestClose();
			return true;
		});
		return () => sub.remove();
	});

	const pan = Gesture.Pan()
		.activeOffsetY([-8, 8])
		.failOffsetX([-24, 24])
		.onStart(() => {
			dragStart.set(0);
		})
		.onUpdate((e) => {
			// Content scrolled away from its top keeps the drag for itself.
			if (scrollY.value > 0) {
				dragStart.set(e.translationY);
				return;
			}
			dragTo(e.translationY - dragStart.value);
		})
		.onEnd((e) => releaseAt(e.velocityY));

	const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
	const sheetStyle = useAnimatedStyle(() => ({
		height: h.value,
		opacity: fade.value,
		transform: [{ translateY: ty.value - kb.value }],
	}));

	return (
		<View style={StyleSheet.absoluteFill}>
			{keyboard && <KeyboardFollower into={kb} bottomInset={insets.bottom} />}
			<Animated.View
				ref={scrimRef as never}
				style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrimSheet }, scrimStyle]}
				accessibilityElementsHidden
				importantForAccessibility="no"
				onTouchEnd={requestClose}
			>
				{labMarker?.scrim ? (
					<View
						style={{
							position: "absolute",
							top: 0,
							left: 0,
							right: 0,
							bottom: height,
							backgroundColor: labMarker.scrim,
						}}
					/>
				) : null}
			</Animated.View>
			<GestureDetector gesture={pan}>
				<Animated.View
					ref={sheetRef as never}
					accessibilityViewIsModal
					style={[
						styles.sheet,
						{ backgroundColor: colors.raised, boxShadow: shadows.sh3, paddingBottom: insets.bottom },
						sheetStyle,
					]}
				>
					<View ref={grabRef} collapsable={false} style={[styles.grabber, { backgroundColor: colors.line2 }]} />
					<View style={styles.header}>
						<View ref={titleRef} accessible accessibilityRole="header" style={styles.title}>
							<Text variant="sheetTitle">{title}</Text>
						</View>
						<Touch
							feedback="scale"
							onPress={requestClose}
							accessibilityLabel={t`Close`}
							hitSlop={hitSlopFor(44, 44)}
							style={styles.close}
						>
							<Icon name="x" size={20} color="ink2" />
						</Touch>
					</View>
					<Ctx.Provider value={{ scrollY, pan }}>
						<View style={styles.content}>
							{step === undefined ? (
								children
							) : (
								<LayoutAnimationConfig skipEntering>
									<Animated.View key={step} style={styles.content} entering={slideInTrailing} exiting={fadeOutStep}>
										{children}
									</Animated.View>
								</LayoutAnimationConfig>
							)}
						</View>
					</Ctx.Provider>
					{footer}
					{labMarker?.top ? (
						<View pointerEvents="none" style={[styles.labTop, { backgroundColor: labMarker.top }]} />
					) : null}
				</Animated.View>
			</GestureDetector>
			<DiscardDialog
				open={asking}
				onKeep={() => setAsking(false)}
				onDiscard={() => {
					setAsking(false);
					closing.current = true;
					slideOut();
				}}
			/>
		</View>
	);
}

/** A scrolling body inside a sheet: the sheet drags only while this is scrolled to its top. */
export function SheetScrollView({
	children,
	contentContainerStyle,
}: {
	children: ReactNode;
	contentContainerStyle?: object;
}) {
	const ctx = useContext(Ctx);
	const onScroll = useAnimatedScrollHandler((e) => {
		if (ctx) ctx.scrollY.set(e.contentOffset.y);
	});
	const native = Gesture.Native();
	if (ctx) native.simultaneousWithExternalGesture(ctx.pan);
	return (
		<GestureDetector gesture={native}>
			<Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={contentContainerStyle}>
				{children}
			</Animated.ScrollView>
		</GestureDetector>
	);
}

function KeyboardFollower({ into, bottomInset }: { into: SharedValue<number>; bottomInset: number }) {
	const { height } = useReanimatedKeyboardAnimation(); // 0 → −keyboard height
	useAnimatedReaction(
		() => height.value,
		(v) => {
			into.set(Math.max(0, -v - bottomInset));
		},
	);
	return null;
}

const slideInTrailing = (v: EntryAnimationsValues) => {
	"worklet";
	const from = I18nManager.isRTL ? -v.windowWidth : v.windowWidth;
	return {
		initialValues: { transform: [{ translateX: from }] },
		animations: { transform: [{ translateX: withTiming(0, enter(motion.d2)) }] },
	};
};

const fadeOutStep = () => {
	"worklet";
	return { initialValues: { opacity: 1 }, animations: { opacity: withTiming(0, leave(motion.d2)) } };
};

const styles = StyleSheet.create({
	sheet: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: 0,
		borderTopLeftRadius: radius.sheetTop,
		borderTopRightRadius: radius.sheetTop,
	},
	grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginTop: 8, marginBottom: 4 },
	header: {
		flexDirection: "row",
		alignItems: "center",
		paddingTop: 8,
		paddingEnd: 12,
		paddingBottom: 4,
		paddingStart: 24,
	},
	title: { flex: 1 },
	close: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
	content: { flex: 1, overflow: "hidden" },
	labTop: { position: "absolute", top: 4, left: 183, width: 24, height: 24 },
});
