// Dialog (COMPONENTS.md §17, MOTION.md §6.5): S8, D6, S2 Delete account, Discard changes?. The `scrim` fades in d2;
// the dialog fades in while scaling 0.98 → 1, d2 `ease`; exit: fade 140 ms. 20 dp from the sides, vertically centred,
// `raised`, 20 dp corners, `sh3`, padding 24, gap 12. Buttons stack full width in order of safety (primary on top).
// Plays no haptic: Delete permanently plays `warning` when the delete lands, S8 plays it when it opens (its screen).
import { t } from "@lingui/core/macro";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, BackHandler, findNodeHandle, type HostInstance, StyleSheet, View } from "react-native";
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Touch } from "./base";
import { Icon, type IconName } from "./Icon";
import { enter, leave, useMotionPolicy } from "./motion";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { type ColorToken, motion, radius } from "./tokens";
import { useDesignTag } from "@/dev/storyboard/harness";

export type DialogAction = {
	label: string;
	tone: "primary" | "secondary" | "danger" | "ghostDanger";
	onPress: () => void;
};

export type DialogProps = {
	open: boolean;
	/** Scrim tap and Android back. Omit to make the dialog answerable only by its buttons. */
	onClose?: () => void;
	/** After the exit animation. */
	onClosed?: () => void;
	title: string;
	message?: string;
	/** The quiet count line ("3 items, 2 versions"). */
	count?: { icon: IconName; text: string };
	actions: DialogAction[];
	children?: ReactNode;
	/** Motion lab only: a literal surface colour; hides the text. */
	labMarker?: string;
};

/**
 * Mount state for an overlay that animates out before unmounting: `visible` stays true until `onExited` runs.
 */
export function useOverlayPresence(open: boolean) {
	const [visible, setVisible] = useState(open);
	// Opening shows it at once (state adjusted during render); closing waits for onExited.
	if (open && !visible) setVisible(true);
	return { visible, onExited: () => setVisible(false) };
}

export function Dialog(props: DialogProps) {
	const { visible, onExited } = useOverlayPresence(props.open);
	if (!visible) return null;
	return (
		<DialogView
			{...props}
			onExited={() => {
				onExited();
				props.onClosed?.();
			}}
		/>
	);
}

function DialogView({
	open,
	onClose,
	title,
	message,
	count,
	actions,
	children,
	labMarker,
	onExited,
}: DialogProps & { onExited: () => void }) {
	const { colors, shadows } = useTheme();
	const { reduced, overlayFade } = useMotionPolicy();
	const scrimRef = useDesignTag({ kind: "component", component: "Scrim", bg: "scrim" });
	const ref = useDesignTag({ kind: "component", component: "Dialog", radius: radius.dialog, bg: "raised" });
	const titleRef = useRef<HostInstance>(null);
	const p = useSharedValue(0);

	useEffect(() => {
		if (open) {
			p.set(withTiming(1, enter(overlayFade(motion.d2))));
			const node = findNodeHandle(titleRef.current);
			if (node) setTimeout(() => AccessibilityInfo.setAccessibilityFocus(node), 50);
		} else {
			p.set(
				withTiming(0, leave(overlayFade(motion.d2)), (done) => {
					if (done) runOnJS(onExited)();
				}),
			);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const sub = BackHandler.addEventListener("hardwareBackPress", () => {
			onClose?.();
			return true;
		});
		return () => sub.remove();
	}, [open, onClose]);

	const scrim = useAnimatedStyle(() => ({ opacity: p.value }));
	// The scale only rises on entry; the exit is a plain fade.
	const box = useAnimatedStyle(() => ({
		opacity: p.value,
		transform: [{ scale: reduced || !open ? 1 : interpolate(p.value, [0, 1], [motion.popupStartScale, 1]) }],
	}));

	const hide = labMarker ? { opacity: 0 } : null;
	return (
		<View style={StyleSheet.absoluteFill} pointerEvents={open ? "auto" : "none"}>
			<Animated.View
				ref={scrimRef as never}
				style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, scrim]}
				importantForAccessibility="no"
				accessibilityElementsHidden
				onTouchEnd={onClose}
			/>
			<View style={styles.center} pointerEvents="box-none">
				<Animated.View
					ref={ref as never}
					role="alertdialog"
					accessibilityViewIsModal
					style={[styles.dialog, { backgroundColor: labMarker ?? colors.raised, boxShadow: shadows.sh3 }, box]}
				>
					<View ref={titleRef} accessible accessibilityRole="header" style={hide}>
						<Text variant="sheetTitle">{title}</Text>
					</View>
					{message ? (
						<View style={hide}>
							<Text variant="bubble" color="ink2">
								{message}
							</Text>
						</View>
					) : null}
					{count ? (
						<View style={[styles.count, hide]}>
							<Icon name={count.icon} size={16} color="ink3" />
							<Text variant="ui" color="ink3">
								{count.text}
							</Text>
						</View>
					) : null}
					{children}
					<View style={[styles.actions, hide]}>
						{actions.map((a) => (
							<DialogButton key={a.label} action={a} />
						))}
					</View>
				</Animated.View>
			</View>
		</View>
	);
}

const tones: Record<DialogAction["tone"], { bg?: ColorToken; text: ColorToken; ring?: ColorToken }> = {
	primary: { bg: "accent", text: "onAccent" },
	secondary: { bg: "surface", text: "ink", ring: "line2" },
	danger: { bg: "dangerFill", text: "paper" }, // white in both themes
	ghostDanger: { text: "dangerText" },
};

// ponytail: a private Large button so dialogs work before the design-system Button exists; swap to <Button size="lg">.
function DialogButton({ action }: { action: DialogAction }) {
	const { colors } = useTheme();
	const tone = tones[action.tone];
	return (
		<Touch
			feedback="scale"
			onPress={action.onPress}
			accessibilityLabel={action.label}
			style={[
				styles.button,
				tone.bg ? { backgroundColor: colors[tone.bg] } : null,
				tone.ring ? { boxShadow: `inset 0 0 0 1px ${colors[tone.ring]}` } : null,
			]}
		>
			<Text variant="buttonLg" color={tone.text}>
				{action.label}
			</Text>
		</Touch>
	);
}

/** "Discard changes?" for dirty sheets and forms (MOTION.md §6.1, §6.4). */
export function DiscardDialog({
	open,
	onKeep,
	onDiscard,
}: {
	open: boolean;
	onKeep: () => void;
	onDiscard: () => void;
}) {
	return (
		<Dialog
			open={open}
			onClose={onKeep}
			title={t`Discard changes?`}
			actions={[
				{ label: t`Keep editing`, tone: "primary", onPress: onKeep },
				{ label: t`Discard`, tone: "ghostDanger", onPress: onDiscard },
			]}
		/>
	);
}

const styles = StyleSheet.create({
	center: { ...StyleSheet.absoluteFill, justifyContent: "center", paddingHorizontal: 20 },
	dialog: { borderRadius: radius.dialog, padding: 24, gap: 12 },
	count: { flexDirection: "row", alignItems: "center", gap: 8 },
	actions: { gap: 8, marginTop: 8 },
	button: {
		height: 44,
		paddingHorizontal: 16,
		borderRadius: radius.lg,
		alignItems: "center",
		justifyContent: "center",
	},
});
