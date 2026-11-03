import type { DocumentSummary } from "./filter";
import type { ComponentProps } from "react";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import Animated, {
	cancelAnimation,
	ReduceMotion,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useReducedMotion } from "@/ui/motion";
import { motion } from "@/ui/tokens";

type DocumentRef = Pick<DocumentSummary, "type" | "id">;
export type OnDocumentEffect = (
	effect: "trash" | "restore" | "purge",
	documents?: readonly DocumentRef[],
) => void | Promise<void>;
type Controls = { fade: () => Promise<void>; reset: () => void };
type Register = (key: string, controls: Controls) => () => void;

/** Only confirmed actions animate; recycled/unmounted rows never have an automatic exit. */
export function useDocumentRemovalMotion(scope: string, trashed: boolean, data: unknown, fetching: boolean) {
	const currentScope = useRef<string | null>(scope);
	const focused = useRef(false);
	const views = useRef(new Map<string, Controls>());
	const reset = useCallback(() => {
		for (const controls of views.current.values()) controls.reset();
	}, []);
	useFocusEffect(
		useCallback(() => {
			focused.current = true;
			return () => {
				focused.current = false;
				reset();
			};
		}, [reset]),
	);
	useLayoutEffect(() => {
		currentScope.current = scope;
		return () => {
			currentScope.current = null;
			reset();
		};
	}, [scope, reset]);
	useEffect(() => {
		if (!fetching) reset();
	}, [data, fetching, reset]);
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state !== "active") reset();
		});
		return () => subscription.remove();
	}, [reset]);
	const register = useCallback<Register>(
		(key, controls) => {
			const scoped = `${scope}:${key}`;
			views.current.set(scoped, controls);
			return () => {
				if (views.current.get(scoped) === controls) views.current.delete(scoped);
				controls.reset();
			};
		},
		[scope],
	);
	const onEffect = useCallback<OnDocumentEffect>(
		async (effect, documents) => {
			if (!focused.current || currentScope.current !== scope) return;
			if (!(trashed ? effect !== "trash" : effect === "trash")) return reset();
			if (AppState.currentState !== "active") return;
			const ids = documents && new Set(documents.map((item) => `${scope}:${item.type}:${item.id}`));
			try {
				await Promise.all(
					[...views.current]
						.filter(([key]) => key.startsWith(`${scope}:`) && (!ids || ids.has(key)))
						.map(([, controls]) => controls.fade()),
				);
			} catch {
				// Presentation failure must not turn an already-saved operation into a failed mutation.
				reset();
			}
		},
		[scope, trashed, reset],
	);
	return { register, onEffect };
}

type DocumentMotionFrameProps = ComponentProps<typeof Animated.View> & { itemKey: string; register: Register };

export function DocumentMotionFrame({ itemKey, register, style, ...props }: DocumentMotionFrameProps) {
	const reduced = useReducedMotion();
	const opacity = useSharedValue(1);
	const scale = useSharedValue(1);
	const pending = useRef<(() => void) | null>(null);
	const finish = useCallback(() => {
		pending.current?.();
		pending.current = null;
	}, []);
	const reset = useCallback(() => {
		cancelAnimation(opacity);
		cancelAnimation(scale);
		opacity.set(1);
		scale.set(1);
		finish();
	}, [opacity, scale, finish]);
	const controls = useMemo<Controls>(
		() => ({
			reset,
			fade: () =>
				new Promise<void>((resolve) => {
					pending.current = resolve;
					const duration = reduced ? motion.d1 : motion.d2 * 0.7;
					if (!reduced) scale.set(withTiming(0.98, { duration, reduceMotion: ReduceMotion.System }));
					opacity.set(
						withTiming(0, { duration, reduceMotion: ReduceMotion.Never }, (finished) => {
							"worklet";
							if (finished) scheduleOnRN(finish);
						}),
					);
				}),
		}),
		[opacity, scale, reduced, reset, finish],
	);
	useLayoutEffect(() => register(itemKey, controls), [itemKey, register, controls]);
	const animated = useAnimatedStyle(() => ({
		opacity: opacity.get(),
		transform: [{ scale: reduced ? 1 : scale.get() }],
	}));
	return <Animated.View {...props} style={[style, animated]} />;
}
