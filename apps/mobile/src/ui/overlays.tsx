import type { ColorToken } from "./tokens";
import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { TrueSheet } from "@lodev09/react-native-true-sheet";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
	AccessibilityInfo,
	I18nManager,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	useWindowDimensions,
	View,
} from "react-native";
import Animated, {
	cancelAnimation,
	Easing,
	FadeIn,
	FadeInDown,
	FadeOut,
	FadeOutDown,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Button } from "./button";
import { haptics, useIsWide, useReducedMotion } from "./motion";
import { useWindowSafeAreaInsets } from "./safe-area";
import { Text } from "./text";
import { useTheme } from "./theme";

const android = Platform.OS === "android";

export type SheetProps = {
	open: boolean;
	onClose: () => void;
	/** Block incidental dismissal while an explicit save is in flight. */
	dismissible?: boolean | undefined;
	title?: string | undefined;
	/**
	 * Heights as fractions of the screen (`0.5`) or `"content"` to fit. Defaults to `["content"]`. A content-sized
	 * sheet stops at 90% of the screen and scrolls past that.
	 */
	detents?: ("content" | number)[] | undefined;
	children?: ReactNode;
	/** Pinned under the scrolling content, for example the sheet's primary button. */
	footer?: ReactNode;
	/** The start of the header bar, for example a Cancel text button. */
	headerStart?: ReactNode;
	/** The end of the header bar, for example a Save text button. */
	headerEnd?: ReactNode;
	/** Pads the content with `s4`. Defaults to true; full-width rows pass false. */
	padded?: boolean | undefined;
	/** Lists that own scrolling pass false to avoid nesting inside a ScrollView. */
	scroll?: boolean | undefined;
};

type SheetHeaderProps = Pick<SheetProps, "title" | "headerStart" | "headerEnd">;

function SheetHeader({ title, headerStart, headerEnd }: SheetHeaderProps) {
	const { size, space } = useTheme();
	if (!headerStart && !headerEnd) return null;

	// Equal side slots keep the title centred.
	const slot = { flex: 1, flexDirection: "row", alignItems: "center" } as const;

	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				minHeight: size.topBar,
				paddingHorizontal: space.s2,
				paddingTop: space.s6,
			}}
		>
			<View style={slot}>{headerStart}</View>
			{title ? (
				<Text accessibilityRole="header" variant="title" align="center" style={{ flexShrink: 1, maxWidth: "60%" }}>
					{title}
				</Text>
			) : null}
			<View style={[slot, { justifyContent: "flex-end" }]}>{headerEnd}</View>
		</View>
	);
}

/** Native sheets share one lifecycle on phones, tablets and web. Form owners remain mounted after dismissal. */
export function Sheet({
	open,
	onClose,
	title,
	detents = ["content"],
	children,
	footer,
	headerStart,
	headerEnd,
	padded = true,
	scroll = true,
	dismissible = true,
}: SheetProps) {
	const { t } = useLingui();
	const { colors, radius, size, space } = useTheme();
	const wide = useIsWide();
	const reduced = useReducedMotion();
	const insets = useWindowSafeAreaInsets();
	const { height } = useWindowDimensions();
	const ref = useRef<TrueSheet>(null);
	const [footerHeight, setFooterHeight] = useState(0);
	const detentIndex = useRef(-1);
	const wantsOpen = useRef(false);
	const presented = useRef(false);
	const closing = useRef(false);
	const opening = useRef<Promise<void>>(Promise.resolve());

	const present = useCallback(() => {
		presented.current = true;
		opening.current = (ref.current?.present(0, !reduced) ?? Promise.resolve()).catch(() => {
			presented.current = false;
			showToast({ message: t`Couldn't complete this action. Try again.` });
			if (dismissible) onClose();
		});
	}, [reduced, t, dismissible, onClose]);
	useEffect(() => {
		wantsOpen.current = open;
		if (open) {
			if (!closing.current && !presented.current) present();
		} else if (presented.current && !closing.current) {
			closing.current = true;
			// TrueSheet presents asynchronously; a fast close must wait for the native view to exist.
			void opening.current
				.then(() => {
					if (wantsOpen.current || !presented.current) {
						closing.current = false;
						return;
					}
					return ref.current?.dismiss(!reduced);
				})
				.catch(() => {
					closing.current = false;
					showToast({ message: t`Couldn't complete this action. Try again.` });
				});
		}
	}, [open, reduced, present, t]);

	const onDismiss = () => {
		presented.current = false;
		detentIndex.current = -1;
		// Wait for a parent-initiated close before reopening; a late native callback must not close the new panel.
		if (closing.current) {
			closing.current = false;
			if (wantsOpen.current) present();
		} else if (wantsOpen.current) {
			if (dismissible) onClose();
			else present();
		}
	};

	return (
		<TrueSheet
			ref={ref}
			detents={detents.map((detent) => (detent === "content" ? "auto" : detent))}
			dismissible={dismissible}
			draggable={dismissible}
			onDidDismiss={onDismiss}
			onDetentChange={({ nativeEvent: { index } }) => {
				if (detentIndex.current >= 0 && index !== detentIndex.current) haptics.selection();
				detentIndex.current = index;
			}}
			presentation={wide ? "form" : "page"}
			maxContentWidth={size.formSheet}
			maxContentHeight={Math.round((height - insets.top) * 0.9)}
			backgroundColor={colors.raised}
			cornerRadius={radius.rLg}
			grabber={!wide}
			accessibilityOptions={title ? { paneTitle: title } : {}}
			scrollable
			insetAdjustment="never"
			{...(headerStart || headerEnd
				? { header: <SheetHeader title={title} headerStart={headerStart} headerEnd={headerEnd} /> }
				: {})}
			{...(footer
				? {
						footer: (
							<View
								onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
								style={{
									paddingTop: space.s3,
									paddingHorizontal: space.s4,
									paddingBottom: insets.bottom + space.s3,
									borderTopWidth: StyleSheet.hairlineWidth,
									borderTopColor: colors.line,
									backgroundColor: colors.raised,
								}}
							>
								{footer}
							</View>
						),
					}
				: {})}
			footerOptions={{ keyboardOffset: -insets.bottom }}
		>
			{scroll ? (
				<ScrollView
					nestedScrollEnabled
					accessibilityViewIsModal
					onAccessibilityEscape={dismissible ? onClose : undefined}
					keyboardShouldPersistTaps="handled"
					keyboardDismissMode="interactive"
					contentContainerStyle={{
						gap: space.s3,
						paddingTop: headerStart || headerEnd ? space.s2 : space.s6,
						paddingHorizontal: padded ? space.s4 : 0,
						paddingBottom: footer ? footerHeight + space.s4 : insets.bottom + space.s4,
					}}
				>
					{children}
				</ScrollView>
			) : (
				<View
					accessibilityViewIsModal
					onAccessibilityEscape={dismissible ? onClose : undefined}
					style={{
						flex: 1,
						paddingTop: space.s6,
						paddingHorizontal: padded ? space.s4 : 0,
						paddingBottom: insets.bottom + space.s4,
					}}
				>
					{children}
				</View>
			)}
		</TrueSheet>
	);
}

type EditorSheetProps = Omit<SheetProps, "open" | "dismissible"> & { dirty: boolean; pending: boolean };

/** Keep the form owner mounted while a native dismissal asks whether to discard its edits. */
export function EditorSheet({
	dirty,
	pending,
	onClose,
	children,
	footer,
	detents = [0.9],
	...props
}: EditorSheetProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const [visible, setVisible] = useState(true);
	const [confirm, setConfirm] = useState(false);
	const reopen = () => {
		setConfirm(false);
		setVisible(true);
	};
	const close = () => {
		if (pending) return;
		if (!dirty) return onClose();
		setVisible(false);
		setConfirm(true);
	};
	return (
		<>
			<Sheet
				{...props}
				open={visible || pending}
				onClose={close}
				dismissible={!pending}
				detents={detents}
				footer={
					<View style={{ gap: space.s2 }}>
						{footer}
						<Button label={t`Cancel`} variant="ghost" disabled={pending} onPress={close} />
					</View>
				}
			>
				{children}
			</Sheet>
			<ConfirmDialog
				open={confirm && !pending}
				title={t`Discard changes?`}
				message={t`You have unsaved changes.`}
				confirmLabel={t`Discard changes`}
				cancelLabel={t`Keep editing`}
				destructive
				onConfirm={() => {
					if (!pending) onClose();
				}}
				onCancel={reopen}
			/>
		</>
	);
}

export type ConfirmDialogProps = {
	open: boolean;
	title: string;
	message?: string | undefined;
	confirmLabel: string;
	/** Defaults to "Cancel". */
	cancelLabel?: string | undefined;
	/** Styles the confirm button as destructive. */
	destructive?: boolean | undefined;
	/** The confirm button must be held, for actions that can't be undone. */
	hold?: boolean | undefined;
	onConfirm: () => void;
	onCancel: () => void;
};

type DialogActionProps = {
	label: string;
	onPress: () => void;
	color: ColorToken;
	bold?: boolean;
	/** iOS: share the row with the other button. */
	fill?: boolean;
	/** iOS: a hairline before the button; `stacked` puts it above instead of at the start. */
	separator?: "start" | "top" | undefined;
	/** Acts only after a HOLD_MS hold, while a fill rises behind the label. */
	hold?: boolean | undefined;
};

const HOLD_MS = 1200;

function DialogAction({ label, onPress, color, bold, fill, separator, hold }: DialogActionProps) {
	const { t } = useLingui();
	const { colors, motion, radius, size, space } = useTheme();
	const progress = useSharedValue(0);
	const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.get() }] }));

	const startHold = () => {
		if (!hold) return;
		haptics.light();
		progress.set(
			withTiming(1, { duration: HOLD_MS, easing: Easing.linear }, (finished) => {
				if (finished) scheduleOnRN(onPress);
			}),
		);
	};
	const endHold = () => {
		if (!hold) return;
		cancelAnimation(progress);
		progress.set(withTiming(0, { duration: motion.d1 }));
	};

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityHint={hold ? t`Press and hold` : undefined}
			// A screen reader activates with a tap, and the dialog has already asked.
			onPress={hold ? () => screenReader && onPress() : onPress}
			onPressIn={startHold}
			onPressOut={endHold}
			android_ripple={{ color: colors.press }}
			style={({ pressed }) =>
				android
					? {
							minHeight: size.hit,
							justifyContent: "center",
							paddingHorizontal: space.s3,
							borderRadius: radius.rMd,
							overflow: "hidden",
						}
					: {
							flex: fill ? 1 : undefined,
							minHeight: size.input,
							justifyContent: "center",
							paddingHorizontal: space.s2,
							backgroundColor: pressed ? colors.press : "transparent",
							borderStartWidth: separator === "start" ? StyleSheet.hairlineWidth : 0,
							borderTopWidth: separator === "top" ? StyleSheet.hairlineWidth : 0,
							borderColor: colors.line,
						}
			}
		>
			{hold ? (
				<Animated.View
					pointerEvents="none"
					style={[
						{
							position: "absolute",
							top: 0,
							bottom: 0,
							start: 0,
							end: 0,
							backgroundColor: colors[color],
							opacity: 0.16,
							transformOrigin: I18nManager.isRTL ? "right" : "left",
						},
						fillStyle,
					]}
				/>
			) : null}
			<Text variant={android ? "label" : "title"} weight={android || bold ? 600 : 400} color={color} align="center">
				{label}
			</Text>
		</Pressable>
	);
}

// The mockups' alert widths: 290 pt on iOS, 320 pt (Material dialog) on Android.
const alertWidth = android ? 320 : 290;

/** The platform alert: a centred iOS alert, or a Material dialog with text buttons at the end. */
export function ConfirmDialog({
	open,
	title,
	message,
	confirmLabel,
	cancelLabel,
	destructive,
	hold,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	const { t } = useLingui();
	const { colors, radius, shadows, space } = useTheme();
	const { width, height, fontScale } = useWindowDimensions();
	const cancel = cancelLabel ?? t`Cancel`;
	const confirmColor: ColorToken = destructive ? "dangerText" : "accentText";
	// Long labels or large text stack the iOS buttons instead of squeezing them side by side.
	const stacked = !android && (fontScale > 1.3 || cancel.length + confirmLabel.length > 24);
	const confirm = () => {
		if (destructive) haptics.warning();
		onConfirm();
	};
	return (
		<Modal
			visible={open}
			transparent
			animationType="fade"
			onRequestClose={onCancel}
			statusBarTranslucent
			navigationBarTranslucent
			supportedOrientations={["portrait", "landscape"]}
		>
			<View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.scrim }}>
				{/* Material dialogs close on an outside tap; iOS alerts do not. */}
				{android ? <Pressable accessible={false} onPress={onCancel} style={StyleSheet.absoluteFill} /> : null}
				<View
					accessibilityViewIsModal
					accessibilityRole="alert"
					onAccessibilityEscape={onCancel}
					style={{
						width: Math.min(alertWidth, width - space.s10 * 2),
						maxHeight: height - space.s12 * 2,
						borderRadius: radius.rLg,
						backgroundColor: colors.raised,
						boxShadow: shadows.e3.boxShadow,
						overflow: "hidden",
					}}
				>
					{/* The text scrolls when large type makes it taller than the screen; the buttons stay visible. */}
					<ScrollView
						style={{ flexGrow: 0, flexShrink: 1 }}
						contentContainerStyle={
							android
								? { gap: space.s3, paddingTop: space.s6, paddingHorizontal: space.s6, paddingBottom: space.s3 }
								: { gap: space.s1 + space.s0, padding: space.s4, paddingTop: space.s5 }
						}
					>
						<Text
							accessibilityRole="header"
							variant={android ? "heading" : "title"}
							align={android ? "auto" : "center"}
						>
							{title}
						</Text>
						{message ? (
							<Text variant={android ? "body" : "callout"} color="ink2" align={android ? "auto" : "center"}>
								{message}
							</Text>
						) : null}
					</ScrollView>
					{android ? (
						<View
							style={{
								flexDirection: "row",
								justifyContent: "flex-end",
								flexWrap: "wrap",
								gap: space.s1,
								paddingHorizontal: space.s4,
								paddingBottom: space.s4,
							}}
						>
							<DialogAction label={cancel} onPress={onCancel} color="accentText" />
							<DialogAction label={confirmLabel} onPress={confirm} color={confirmColor} hold={hold} />
						</View>
					) : (
						<View
							style={{
								flexDirection: stacked ? "column" : "row",
								borderTopWidth: StyleSheet.hairlineWidth,
								borderTopColor: colors.line,
							}}
						>
							{stacked ? (
								<>
									<DialogAction label={confirmLabel} onPress={confirm} color={confirmColor} bold hold={hold} />
									<DialogAction label={cancel} onPress={onCancel} color="accentText" separator="top" />
								</>
							) : (
								<>
									<DialogAction label={cancel} onPress={onCancel} color="accentText" fill />
									<DialogAction
										label={confirmLabel}
										onPress={confirm}
										color={confirmColor}
										bold
										fill
										separator="start"
										hold={hold}
									/>
								</>
							)}
						</View>
					)}
				</View>
			</View>
		</Modal>
	);
}

export type ToastOptions = {
	message: string;
	/** For example Undo. Pressing it dismisses the toast. */
	action?: { label: string; onPress: () => void } | undefined;
	/** Shorthand for an "Undo" action. */
	undo?: (() => void) | undefined;
	/** Milliseconds on screen. Defaults to 4000; toasts with an action stay 6000. Doubled for screen readers. */
	duration?: number | undefined;
};

type ActiveToast = ToastOptions & { id: number; lifetime: number };

/** Toasts whose action has run: a second tap that reaches the same render (before it re-renders) does nothing. */
const actedToasts = new WeakSet<ActiveToast>();

let toasts: ActiveToast[] = [];
let nextToastId = 1;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
const clearToastTimer = (id: number) => {
	clearTimeout(toastTimers.get(id));
	toastTimers.delete(id);
};
const toastListeners = new Set<() => void>();
const emitToasts = (next: ActiveToast[]) => {
	toasts = next;
	for (const listener of toastListeners) listener();
};

let screenReader = false;
void AccessibilityInfo.isScreenReaderEnabled().then((value) => (screenReader = value));
AccessibilityInfo.addEventListener("screenReaderChanged", (value) => (screenReader = value));

/** How long a toast with this requested duration actually stays: screen readers get twice as long. */
export const toastLifetime = (ms: number) => ms * (screenReader ? 2 : 1);

export function dismissToast(id: number) {
	clearToastTimer(id);
	emitToasts(toasts.filter((toast) => toast.id !== id));
}

/**
 * Shows a toast above the tab bar and returns its id. One toast shows at a time; a new one replaces the current.
 * `toast({ message: t\`Moved to trash\`, undo: restore })`.
 */
export function showToast(options: ToastOptions): number {
	const id = nextToastId++;
	const hasAction = !!options.action || !!options.undo;
	// The new toast replaces the current one, and its timer with it.
	for (const toast of toasts) clearToastTimer(toast.id);
	const duration = toastLifetime(options.duration ?? (hasAction ? 6000 : 4000));
	emitToasts([{ ...options, id, lifetime: duration }]);
	AccessibilityInfo.announceForAccessibility(options.message);
	toastTimers.set(
		id,
		setTimeout(() => dismissToast(id), duration),
	);
	return id;
}

/** The imperative toast API (alias of `showToast`). */
export const toast = showToast;

/** A toast with an action burns a thin fuse along its bottom edge for the time it has left. */
function ToastFuse({ duration }: { duration: number }) {
	const { colors, radius } = useTheme();
	const left = useSharedValue(1);
	const style = useAnimatedStyle(() => ({ transform: [{ scaleX: left.get() }] }));

	useEffect(() => {
		left.set(withTiming(0, { duration, easing: Easing.linear }));
	}, [left, duration]);

	// Inset by the corner radius so the fuse stays on the straight part of the edge.
	const inset = android ? radius.rSm : radius.rLg;
	return (
		<Animated.View
			pointerEvents="none"
			style={[
				{
					position: "absolute",
					bottom: 0,
					start: inset,
					end: inset,
					height: 2,
					backgroundColor: colors.bg,
					opacity: 0.4,
					transformOrigin: I18nManager.isRTL ? "right" : "left",
				},
				style,
			]}
		/>
	);
}

/** Renders the active toast. Mounted once, in app/_layout.tsx. */
export function Toaster() {
	const { t } = useLingui();
	const { colors, motion, radius, shadows, size, space } = useTheme();
	const insets = useWindowSafeAreaInsets();
	const wide = useIsWide();
	const reduced = useReducedMotion();
	const active = useSyncExternalStore(
		(listener) => {
			toastListeners.add(listener);
			return () => toastListeners.delete(listener);
		},
		() => toasts,
	);

	// Without a host nothing shows the toasts, so they and their timers go with it.
	useEffect(
		() => () => {
			for (const toast of toasts) clearToastTimer(toast.id);
			toasts = [];
		},
		[],
	);

	return (
		<View
			pointerEvents="box-none"
			style={{
				position: "absolute",
				start: space.s2,
				end: space.s2,
				bottom: insets.bottom + (wide ? space.s8 : size.tabBar + space.s3),
				alignItems: android ? "stretch" : "center",
			}}
		>
			{active.map((item) => {
				const action = item.action ?? (item.undo ? { label: t`Undo`, onPress: item.undo } : undefined);
				return (
					<Animated.View
						key={item.id}
						entering={reduced ? FadeIn.duration(motion.d1) : FadeInDown.duration(motion.d2)}
						exiting={reduced ? FadeOut.duration(motion.d1) : FadeOutDown.duration(motion.d2)}
						accessibilityLiveRegion="polite"
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: space.s1 + space.s0,
							minHeight: size.button,
							maxWidth: size.formSheet,
							paddingStart: space.s4,
							paddingEnd: action ? space.s1 + space.s0 : space.s4,
							borderRadius: android ? radius.rSm : radius.rLg,
							backgroundColor: colors.ink,
							boxShadow: (wide ? shadows.e2 : shadows.e3).boxShadow,
						}}
					>
						<Text color="bg" style={{ flexShrink: 1, flexGrow: android ? 1 : 0, paddingVertical: space.s3 }}>
							{item.message}
						</Text>
						{action ? (
							<Pressable
								accessibilityRole="button"
								onPress={() => {
									if (actedToasts.has(item)) return;
									actedToasts.add(item);
									try {
										action.onPress();
									} catch (error) {
										actedToasts.delete(item);
										throw error;
									}
									dismissToast(item.id);
								}}
								style={({ pressed }) => ({
									minHeight: size.hit,
									justifyContent: "center",
									paddingHorizontal: space.s2 + space.s0,
									opacity: pressed ? 0.6 : 1,
								})}
							>
								<Text weight={700} color="accentSoft">
									{action.label}
								</Text>
							</Pressable>
						) : null}
						{action && !reduced ? <ToastFuse duration={item.lifetime} /> : null}
					</Animated.View>
				);
			})}
		</View>
	);
}
