import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { I18nManager, TextInput, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { IconButton, Switch, Text, haptics, useTheme } from "@/ui";

type FieldProps = { label: string; value?: string | undefined; helper?: string | undefined; children: ReactNode };

/** A labelled control: label (and its current value) above, helper text below. */
export function Field({ label, value, helper, children }: FieldProps) {
	const { fonts, space } = useTheme();
	return (
		<View style={{ gap: space.s2 }}>
			<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
				<Text variant="callout" style={{ fontFamily: fonts.ui[600] }}>
					{label}
				</Text>
				{value ? (
					<Text variant="mono" color="ink2">
						{value}
					</Text>
				) : null}
			</View>
			{children}
			{helper ? (
				<Text variant="caption" color="ink3">
					{helper}
				</Text>
			) : null}
		</View>
	);
}

function snap(value: number, min: number, max: number, step: number) {
	"worklet";
	return Math.min(max, Math.max(min, Math.round((value - min) / step) * step + min));
}

type SliderProps = {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	/** Spoken with the value, for example "10 pt". */
	format: (value: number) => string;
	onChange: (value: number) => void;
	disabled?: boolean | undefined;
};

/**
 * A horizontal slider. The thumb tracks on the UI thread; release commits one edit instead of rerendering the
 * resume for every pointer move. Screen readers adjust it by one step with swipe up/down.
 */
export function Slider({ label, value, min, max, step, format, onChange, disabled }: SliderProps) {
	const { colors, radius, size, space, shadows } = useTheme();
	const [width, setWidth] = useState(0);
	const clamped = Math.min(max, Math.max(min, value));
	const current = useSharedValue(clamped);
	const thumb = space.s6;
	const rtl = I18nManager.isRTL;
	useEffect(() => current.set(clamped), [clamped, current]);
	const gesture = useMemo(() => {
		const at = (x: number) => {
			"worklet";
			const ratio = (rtl ? width - x : x) / width;
			current.set(snap(min + ratio * (max - min), min, max, step));
		};
		const commit = (next: number) => {
			if (next === clamped) return;
			haptics.selection();
			onChange(next);
		};
		const pan = Gesture.Pan()
			.enabled(!disabled && width > 0)
			.activeOffsetX([-4, 4])
			.failOffsetY([-12, 12])
			.onStart((event) => at(event.x))
			.onUpdate((event) => at(event.x))
			.onFinalize((_event, success) => {
				if (success) scheduleOnRN(commit, current.get());
				else current.set(clamped);
			});
		const tap = Gesture.Tap()
			.enabled(!disabled && width > 0)
			.onEnd((event, success) => {
				if (!success) return;
				at(event.x);
				scheduleOnRN(commit, current.get());
			});
		return Gesture.Race(pan, tap);
	}, [clamped, current, disabled, max, min, onChange, rtl, step, width]);
	const fillStyle = useAnimatedStyle(() => ({ width: `${((current.get() - min) / (max - min)) * 100}%` }));
	const thumbStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: ((current.get() - min) / (max - min)) * Math.max(0, width - thumb) * (rtl ? -1 : 1) }],
	}));

	return (
		<GestureDetector gesture={gesture}>
			<View
				accessible
				accessibilityRole="adjustable"
				accessibilityLabel={label}
				accessibilityValue={{ text: format(clamped) }}
				accessibilityState={{ disabled: !!disabled }}
				accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
				onAccessibilityAction={(event) => {
					if (disabled) return;
					const next = snap(clamped + (event.nativeEvent.actionName === "increment" ? step : -step), min, max, step);
					if (next !== clamped) {
						haptics.selection();
						onChange(next);
					}
				}}
				onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
				style={{ height: size.hit, justifyContent: "center", opacity: disabled ? 0.45 : 1 }}
			>
				<View style={{ height: space.s1, borderRadius: radius.rLg, backgroundColor: colors.line }}>
					<Animated.View
						style={[
							{
								position: "absolute",
								start: 0,
								height: space.s1,
								borderRadius: radius.rLg,
								backgroundColor: colors.accent,
							},
							fillStyle,
						]}
					/>
				</View>
				<Animated.View
					pointerEvents="none"
					style={[
						{
							position: "absolute",
							start: 0,
							width: thumb,
							height: thumb,
							borderRadius: radius.rSm,
							backgroundColor: colors.raised,
							borderWidth: 1,
							borderColor: colors.line2,
							boxShadow: shadows.e1.boxShadow,
						},
						thumbStyle,
					]}
				/>
			</View>
		</GestureDetector>
	);
}

type StepperProps = {
	label: string;
	value: number;
	unit: string;
	min: number;
	max?: number | undefined;
	step: number;
	onChange: (value: number) => void;
	disabled?: boolean | undefined;
};

const decimals = (step: number) => (String(step).split(".")[1] ?? "").length;

/** − value + with the value typeable (mockup "tap the value to type"). Out-of-range typing is clamped on commit. */
export function Stepper({
	label,
	value,
	unit,
	min,
	max = Number.POSITIVE_INFINITY,
	step,
	onChange,
	disabled,
}: StepperProps) {
	const { t } = useLingui();
	const { colors, radius, space, size, type } = useTheme();
	const [typed, setTyped] = useState<string | null>(null);
	const round = (next: number) => Number(Math.min(max, Math.max(min, next)).toFixed(decimals(step)));
	const commit = () => {
		const parsed = Number.parseFloat((typed ?? "").replace(",", "."));
		setTyped(null);
		if (Number.isFinite(parsed) && round(parsed) !== value) onChange(round(parsed));
	};
	return (
		<View style={{ flexDirection: "row", alignItems: "center", minHeight: size.hit, gap: space.s2 }}>
			<Text variant="body" style={{ flex: 1 }}>
				{label}
			</Text>
			<IconButton
				icon="minus"
				label={t`Decrease ${label}`}
				disabled={disabled || value <= min}
				onPress={() => onChange(round(value - step))}
			/>
			<TextInput
				accessibilityLabel={label}
				editable={!disabled}
				keyboardType="decimal-pad"
				selectTextOnFocus
				value={typed ?? String(value)}
				onChangeText={setTyped}
				onBlur={commit}
				onSubmitEditing={commit}
				style={{
					...type.mono,
					minWidth: size.hit + space.s4,
					minHeight: size.hit - space.s1,
					textAlign: "center",
					color: colors.ink,
					backgroundColor: colors.raised,
					borderColor: colors.line2,
					borderWidth: 1,
					borderRadius: radius.rMd,
				}}
			/>
			<Text variant="caption" color="ink3">
				{unit}
			</Text>
			<IconButton
				icon="plus"
				label={t`Increase ${label}`}
				disabled={disabled || value >= max}
				onPress={() => onChange(round(value + step))}
			/>
		</View>
	);
}

type SwitchRowProps = {
	label: string;
	description?: string | undefined;
	value: boolean;
	onChange: (value: boolean) => void;
	disabled?: boolean | undefined;
};

export function SwitchRow({ label, description, value, onChange, disabled }: SwitchRowProps) {
	const { space, size } = useTheme();
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space.s3, minHeight: size.hit }}>
			<View style={{ flex: 1, gap: space.s0 }}>
				<Text variant="body">{label}</Text>
				{description ? (
					<Text variant="caption" color="ink3">
						{description}
					</Text>
				) : null}
			</View>
			<Switch label={label} value={value} onValueChange={onChange} disabled={disabled} />
		</View>
	);
}
