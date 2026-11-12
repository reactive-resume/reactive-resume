// Menu / popover (MOTION.md §6.5): opens 8 dp from its trigger, starting 4 dp toward it at 98% scale and settling
// outward with a fade, d2 `ease`; exit fade 140 ms. Reduced motion: a d1 fade in place. Tapping outside closes it.
import { type ReactNode, useEffect } from "react";
import { BackHandler, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Touch } from "./base";
import { useOverlayPresence } from "./Dialog";
import { Icon, type IconName } from "./Icon";
import { enter, leave, useMotionPolicy } from "./motion";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { motion, radius, space } from "./tokens";
import { useDesignTag } from "@/dev/storyboard/harness";

export type Rect = { x: number; y: number; width: number; height: number };

export type MenuProps = {
	open: boolean;
	onClose: () => void;
	/** The trigger's window rect (measureInWindow). */
	anchor: Rect;
	/** Which trigger edge the menu lines up with. */
	align?: "start" | "end";
	width?: number;
	/** The menu's height when known: decides whether it fits below the trigger. */
	height?: number;
	children: ReactNode;
	/**
	 * Motion lab only: a literal surface colour, plus a 24 × 24 square of it at the menu's centre in a layer that
	 * travels and scales with the menu but is not faded by it (position probes).
	 */
	labMarker?: string;
};

const GAP = 8;

export function Menu(props: MenuProps) {
	const { visible, onExited } = useOverlayPresence(props.open);
	return visible ? <MenuView {...props} onExited={onExited} /> : null;
}

function MenuView({
	open,
	onClose,
	anchor,
	align = "end",
	width = 240,
	height = 0,
	children,
	labMarker,
	onExited,
}: MenuProps & { onExited: () => void }) {
	const { colors, shadows } = useTheme();
	const { reduced, overlayFade } = useMotionPolicy();
	const ref = useDesignTag({ kind: "component", component: "Menu", radius: radius.lg, bg: "raised" });
	const win = useWindowDimensions();
	const below = anchor.y + anchor.height + GAP + height <= win.height - space.s6;
	const toward = below ? -motion.popupStartOffset : motion.popupStartOffset;
	const p = useSharedValue(0);

	useEffect(() => {
		if (open) p.set(withTiming(1, enter(overlayFade(motion.d2))));
		else
			p.set(
				withTiming(0, leave(overlayFade(motion.d2)), (done) => {
					if (done) runOnJS(onExited)();
				}),
			);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const sub = BackHandler.addEventListener("hardwareBackPress", () => {
			onClose();
			return true;
		});
		return () => sub.remove();
	}, [open, onClose]);

	// Entry travels and scales; the exit only fades. Each style reads p.value itself: Reanimated re-runs a style only
	// for the shared values its own worklet reads, not those read inside a helper it calls.
	const travel = (v: number) => {
		"worklet";
		const move = !reduced && open;
		return [
			{ translateY: move ? interpolate(v, [0, 1], [toward, 0]) : 0 },
			{ scale: move ? interpolate(v, [0, 1], [motion.popupStartScale, 1]) : 1 },
		];
	};
	const style = useAnimatedStyle(() => ({ opacity: p.value, transform: travel(p.value) }));
	const travelOnly = useAnimatedStyle(() => ({ transform: travel(p.value) }));

	const left = align === "start" ? anchor.x : anchor.x + anchor.width - width;
	const position = below ? { top: anchor.y + anchor.height + GAP } : { bottom: win.height - anchor.y + GAP };
	const frame = [styles.menu, position, { left: Math.max(space.s3, left), width }, height ? { height } : null];
	return (
		<View style={StyleSheet.absoluteFill} pointerEvents={open ? "box-none" : "none"}>
			<View
				style={StyleSheet.absoluteFill}
				onTouchEnd={onClose}
				accessibilityElementsHidden
				importantForAccessibility="no"
			/>
			<Animated.View
				ref={ref as never}
				accessibilityViewIsModal
				accessibilityRole="menu"
				testID="menu"
				style={[...frame, { backgroundColor: labMarker ?? colors.raised, boxShadow: shadows.sh2 }, style]}
			>
				<View style={labMarker ? { opacity: 0 } : null}>{children}</View>
			</Animated.View>
			{labMarker ? (
				<Animated.View pointerEvents="none" style={[...frame, styles.labCentre, travelOnly]}>
					<View style={{ width: 24, height: 24, backgroundColor: labMarker }} />
				</Animated.View>
			) : null}
		</View>
	);
}

export function MenuItem({
	label,
	icon,
	danger = false,
	onPress,
}: {
	label: string;
	icon?: IconName;
	danger?: boolean;
	onPress: () => void;
}) {
	return (
		<Touch
			feedback="wash"
			onPress={onPress}
			accessibilityRole="menuitem"
			accessibilityLabel={label}
			style={styles.item}
		>
			{icon ? <Icon name={icon} size={20} color={danger ? "dangerText" : "ink2"} /> : null}
			<Text variant="ui" color={danger ? "dangerText" : "ink"} numberOfLines={1}>
				{label}
			</Text>
		</Touch>
	);
}

const styles = StyleSheet.create({
	menu: { position: "absolute", borderRadius: radius.lg, paddingVertical: 4 },
	labCentre: { alignItems: "center", justifyContent: "center" },
	item: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
});
