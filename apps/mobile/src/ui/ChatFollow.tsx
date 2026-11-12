import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollViewProps } from "react-native";
// A conversation's scroll behaviour (B16, C2): follow a streaming reply only at the bottom, "Latest" after scrolling
// away, and (C2) settle each new question near the top. The rules are pure in `chat-follow.ts`; this wires them to a
// scroll view and draws the Latest button, which fades in and out over `d2` (`d1` with reduced motion, like the
// overlays). Following never animates per token; only Latest's own scroll animates, and not with reduced motion.
import { t } from "@lingui/core/macro";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Button } from "./buttons";
import {
	type FollowEvent,
	type FollowState,
	follow,
	initialFollow,
	type ScrollMetrics,
	settleRoom,
} from "./chat-follow";
import { enter, leave, useMotionPolicy } from "./motion";
import { motion } from "./tokens";

type Scroller = { scrollToEnd: (options?: { animated?: boolean }) => void };

export type ChatFollow = {
	/** Set as the scroll view's ref. */
	attach: (node: Scroller | null) => void;
	/** Spread on the scroll view. */
	scrollProps: Pick<
		ScrollViewProps,
		"onScrollBeginDrag" | "onScrollEndDrag" | "onMomentumScrollEnd" | "onContentSizeChange" | "onLayout"
	>;
	/** Extra bottom padding for the content: the room that lets the newest question settle near the top. */
	room: number;
	/** `onLayout` of the newest question, when questions settle. Its parent must be the content container. */
	anchor: (event: LayoutChangeEvent) => void;
	/** The Latest button, absolutely placed: render it as a sibling over the scroll view. */
	latest: ReactNode;
};

/**
 * `question` names the newest question sent (or the last one of a saved thread once it loads); a new value brings it
 * into view and resumes following. `settle` (C2) lands it near the top instead of at the end.
 */
export function useChatFollow({
	question,
	settle = false,
}: {
	question?: string | undefined;
	settle?: boolean | undefined;
}) {
	const { reduced } = useMotionPolicy();
	const scroller = useRef<Scroller | null>(null);
	const metrics = useRef<ScrollMetrics>({ offset: 0, viewport: 0, content: 0 });
	const state = useRef<FollowState>(initialFollow);
	const anchorY = useRef<number | undefined>(undefined);
	const [latest, setLatest] = useState(false);
	const [room, setRoom] = useState(0);
	const applied = useRef(0);
	// The room the content was laid out with, so its size without the room is known.
	useLayoutEffect(() => {
		applied.current = room;
	}, [room]);

	const dispatch = useCallback(
		(event: FollowEvent) => {
			const next = follow(state.current, event);
			state.current = next.state;
			setLatest(next.state.latest);
			if (next.scroll === "end") scroller.current?.scrollToEnd({ animated: event.type === "latest" && !reduced });
		},
		[reduced],
	);
	const fit = useCallback(() => {
		const y = anchorY.current;
		if (!settle || y === undefined) return;
		const { content, viewport } = metrics.current;
		setRoom(settleRoom(y, content - applied.current, viewport));
	}, [settle]);

	const seen = useRef(question);
	useEffect(() => {
		if (question === undefined || question === seen.current) return;
		seen.current = question;
		anchorY.current = undefined;
		dispatch({ type: "send" });
	}, [question, dispatch]);

	const measure = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
		const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
		metrics.current = { offset: contentOffset.y, viewport: layoutMeasurement.height, content: contentSize.height };
		return metrics.current;
	};
	return {
		attach: useCallback((node: Scroller | null) => {
			scroller.current = node;
		}, []),
		scrollProps: {
			onScrollBeginDrag: (event) => {
				measure(event);
				dispatch({ type: "drag" });
			},
			onScrollEndDrag: (event) =>
				dispatch({ type: "rest", metrics: measure(event), moving: (event.nativeEvent.velocity?.y ?? 0) !== 0 }),
			onMomentumScrollEnd: (event) => dispatch({ type: "rest", metrics: measure(event) }),
			onContentSizeChange: (_width, height) => {
				metrics.current = { ...metrics.current, content: height };
				fit();
				dispatch({ type: "grow" });
			},
			onLayout: (event) => {
				metrics.current = { ...metrics.current, viewport: event.nativeEvent.layout.height };
				fit();
				dispatch({ type: "grow" });
			},
		},
		room,
		anchor: (event) => {
			anchorY.current = event.nativeEvent.layout.y;
			fit();
			dispatch({ type: "grow" });
		},
		latest: <LatestButton shown={latest} onPress={() => dispatch({ type: "latest" })} />,
	} satisfies ChatFollow;
}

function LatestButton({ shown, onPress }: { shown: boolean; onPress: () => void }) {
	const { overlayFade } = useMotionPolicy();
	const opacity = useSharedValue(0);
	// Nothing is drawn until the first time it shows: a conversation at rest has no Latest (the storyboard captures).
	const [drawn, setDrawn] = useState(shown);
	if (shown && !drawn) setDrawn(true);
	useEffect(() => {
		const ms = overlayFade(motion.d2);
		opacity.set(
			withTiming(shown ? 1 : 0, shown ? enter(ms) : leave(ms), (finished) => {
				if (finished && !shown) runOnJS(setDrawn)(false);
			}),
		);
	}, [shown, opacity, overlayFade]);
	const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
	if (!drawn) return null;
	return (
		<Animated.View
			pointerEvents={shown ? "box-none" : "none"}
			accessibilityElementsHidden={!shown}
			importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
			style={[{ position: "absolute", start: 0, end: 0, bottom: 12, alignItems: "center" }, style]}
		>
			<Button
				label={t`Latest`}
				accessibilityHint={t`Scrolls to the newest message`}
				icon="arrow-down"
				size="sm"
				onPress={onPress}
				testID="chat-latest"
			/>
		</Animated.View>
	);
}
