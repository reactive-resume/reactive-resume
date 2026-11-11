// Text fields and forms (COMPONENTS.md §10), the composer and chat pieces (§13), the formatting toolbar (§6).
import type { ComponentRef, ReactNode, Ref } from "react";
import type { TextInputProps } from "react-native";
import { useState } from "react";
import { Platform, TextInput, View } from "react-native";
import { Box, Ring, Touch } from "./base";
import { IconButton } from "./buttons";
import { FocusRing } from "./FocusRing";
import { Icon, type IconName } from "./Icon";
import { Stacked, useLargeText, useStacked } from "./large-text";
import { hitSlopFor } from "./motion";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { fonts, layout, radius, type as typeScale } from "./tokens";
import { STORYBOARD, useDesignTag } from "@/dev/storyboard/harness";

/** A 24 dp form column: 20 dp between fields. */
export function Form({ children }: { children: ReactNode }) {
	return <View style={{ paddingTop: 24, paddingHorizontal: layout.screenMargin, gap: 20 }}>{children}</View>;
}

/** Two fields side by side, 12 dp apart; they stack 20 dp apart at large text (Reach board). */
export function FieldRow({ children }: { children: ReactNode }) {
	const stacked = useLargeText();
	return (
		<Stacked.Provider value={stacked}>
			<View style={{ flexDirection: stacked ? "column" : "row", gap: stacked ? 20 : 12 }}>{children}</View>
		</Stacked.Provider>
	);
}

/**
 * A one-line UITextField draws a line height's extra leading above the glyphs, so values and placeholders sat 3 to 4 dp
 * under the boards' centred text. On iOS the one-line input drops its line height and takes it as its height instead
 * (UITextField centres its text); Android centres the line box itself.
 */
const singleLine = ({ lineHeight, ...style }: { lineHeight: number } & Record<string, unknown>) =>
	Platform.OS === "ios" ? { ...style, height: lineHeight } : { ...style, lineHeight };

/**
 * A multi-line UITextView puts each line's extra leading above its glyphs too; CSS splits it above and below. Figtree's
 * own line is 1.2 em, so the text moves up by half the extra (the composer's 15/24 by 3 dp); the box doesn't move.
 */
const multiLine = (style: { fontSize: number; lineHeight: number }) => {
	const shift = Platform.OS === "ios" ? (style.lineHeight - style.fontSize * 1.2) / 2 : 0;
	return shift > 0 ? [style, { marginTop: -shift, marginBottom: shift }] : style;
};

/** The field text: `input` 16/22, or Geist Mono 14/22 for URLs and keys (J5). */
const monoInput = { fontFamily: fonts.mono, fontSize: 14, lineHeight: 22, fontWeight: "400" as const };

export type TextFieldProps = Omit<TextInputProps, "style"> & {
	label?: string | undefined;
	error?: string | undefined;
	leadingIcon?: IconName | undefined;
	trailingIcon?: IconName | undefined;
	onTrailingPress?: (() => void) | undefined;
	trailingLabel?: string | undefined;
	/** A mono suffix inside the field (".pdf"). */
	suffix?: string | undefined;
	/** A fixed mono `ink-3` prefix before the value (B12's "rxresu.me/alex/"); mono text then sits at 14/20. */
	prefix?: string | undefined;
	/** Picker fields: the field is a button showing its value (dates, zones, choices). */
	onPress?: (() => void) | undefined;
	/** Draw the focus rings without focus (storyboard captures of a focused field). */
	forceFocus?: boolean | undefined;
	/** In a FieldRow: share the width. */
	grow?: boolean | undefined;
	/** Minimum height; multi-line fields default to 96 (`.ta`). */
	minHeight?: number | undefined;
	/** Geist Mono 14/22 text (links, keys). */
	mono?: boolean | undefined;
	/**
	 * Tag the placeholder as an HTML input's (B20): across the input's width in the input's `ink`, like a value. The
	 * default tags it hugging its words in `ink-3`, as the boards' placeholder spans (S6 "Optional").
	 */
	inputPlaceholder?: boolean | undefined;
	/** A saved secret's preview ("sk-•••4f2a"), drawn in `ink` like a value while the field is empty (S6). */
	savedValue?: string | undefined;
	ref?: Ref<ComponentRef<typeof TextInput>> | undefined;
};

export function TextField({
	label,
	error,
	leadingIcon,
	trailingIcon,
	onTrailingPress,
	trailingLabel,
	suffix,
	prefix,
	onPress,
	forceFocus = false,
	grow = false,
	minHeight,
	mono = false,
	savedValue,
	inputPlaceholder = false,
	ref,
	value,
	placeholder,
	onFocus,
	onBlur,
	multiline,
	...input
}: TextFieldProps) {
	const { colors } = useTheme();
	const [focused, setFocused] = useState(false);
	const stacked = useStacked();
	const active = focused || forceFocus;
	// The dumps list the drawn value (masked for passwords) across the input's width, or a placeholder hugging its
	// words (S6 "Optional"), in its line box.
	const textStyle = mono
		? prefix
			? { ...monoInput, lineHeight: 20 }
			: monoInput
		: { ...typeScale.input, ...(multiline ? { lineHeight: 24 } : null) };
	const hint = savedValue ?? placeholder;
	const shown = value
		? input.secureTextEntry
			? "\u2022".repeat(value.length)
			: value
		: (savedValue ?? (inputPlaceholder ? (placeholder ?? "") : ""));
	const textRef = useDesignTag(
		{
			kind: "text",
			text: shown,
			style: textStyle,
			color: "ink",
		},
		{ hidden: !shown || !!onPress },
	);
	const placeholderTag = !value && !savedValue && placeholder && !onPress && !inputPlaceholder;
	const field = (
		<Box
			component="TextField"
			bg="raised"
			radius={radius.md}
			style={{
				minHeight: minHeight ?? (multiline ? 96 : 44),
				paddingHorizontal: 12,
				paddingVertical: multiline ? 10 : 0,
				flexDirection: "row",
				alignItems: multiline ? "flex-start" : "center",
				gap: 8,
			}}
		>
			<Ring color="controlBorder" radius={radius.md} />
			<FocusRing focused={active} error={!!error} radius={radius.md} />
			{leadingIcon ? <Icon name={leadingIcon} size={20} color="ink3" /> : null}
			{prefix ? (
				<Text variant="monoUi" color="ink3" numberOfLines={1} style={{ fontWeight: "400" }}>
					{prefix}
				</Text>
			) : null}
			{onPress ? (
				<Text
					variant="input"
					color={value ? "ink" : "ink3"}
					numberOfLines={1}
					style={[{ flex: 1 }, mono ? monoInput : null]}
				>
					{value || placeholder || ""}
				</Text>
			) : (
				<View
					ref={textRef}
					collapsable={false}
					style={{ flex: 1, minWidth: 0, minHeight: textStyle.lineHeight, justifyContent: "center" }}
				>
					<TextInput
						{...input}
						ref={ref}
						value={value}
						placeholder={hint}
						placeholderTextColor={savedValue ? colors.ink : colors.ink3}
						multiline={multiline}
						caretHidden={STORYBOARD}
						selectionColor={colors.accent}
						maxFontSizeMultiplier={2}
						accessibilityLabel={label}
						onFocus={(e) => {
							setFocused(true);
							onFocus?.(e);
						}}
						onBlur={(e) => {
							setFocused(false);
							onBlur?.(e);
						}}
						style={[
							multiline ? (mono ? textStyle : multiLine(textStyle)) : singleLine(textStyle),
							{ padding: 0, color: colors.ink, includeFontPadding: false },
							multiline ? { textAlignVertical: "top" } : null,
						]}
					/>
					{placeholderTag ? (
						// Measures the placeholder TextInput draws at this spot; draws nothing itself.
						<Text
							variant="input"
							color="ink3"
							numberOfLines={multiline ? undefined : 1}
							accessible={false}
							importantForAccessibility="no-hide-descendants"
							pointerEvents="none"
							style={[{ position: "absolute", top: 0, left: 0, opacity: 0 }, textStyle]}
						>
							{placeholder}
						</Text>
					) : null}
				</View>
			)}
			{suffix ? (
				<Text variant="mono" color="ink3">
					{suffix}
				</Text>
			) : null}
			{trailingIcon ? (
				onTrailingPress ? (
					<Touch onPress={onTrailingPress} accessibilityLabel={trailingLabel ?? ""} hitSlop={hitSlopFor(20, 20)}>
						<Icon name={trailingIcon} size={20} color="ink3" />
					</Touch>
				) : (
					<Icon name={trailingIcon} size={20} color="ink3" />
				)
			) : null}
		</Box>
	);
	return (
		<View style={[{ gap: 8 }, grow && !stacked ? { flex: 1, minWidth: 0 } : null]}>
			{label ? (
				<Text variant="formLabel" color="ink2">
					{label}
				</Text>
			) : null}
			{onPress ? (
				<Touch onPress={onPress} feedback="none" accessibilityLabel={label ?? ""} accessibilityHint={value ?? ""}>
					{field}
				</Touch>
			) : (
				field
			)}
			{error ? (
				<View accessibilityRole="alert" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
					<Icon name="warning-circle" size={14} color="dangerText" />
					<Text variant="caption" weight={400} color="dangerText" style={{ flex: 1 }}>
						{error}
					</Text>
				</View>
			) : null}
		</View>
	);
}

/** A3's six code boxes: 56 dp tall, mono 26/30, 8 dp apart; the focused box carries the focus rings. */
export function CodeBoxes({
	value,
	length = 6,
	focusedIndex,
	error = false,
}: {
	value: string;
	length?: number | undefined;
	focusedIndex?: number | undefined;
	error?: boolean | undefined;
}) {
	return (
		<View
			style={{ flexDirection: "row", gap: 8 }}
			accessibilityLabel="Verification code"
			accessibilityValue={{ text: value }}
		>
			{Array.from({ length }, (_, i) => {
				const focus = i === focusedIndex;
				return (
					<Box
						key={i}
						component="CodeBox"
						hidden
						bg="raised"
						radius={radius.md}
						style={{ flex: 1, height: 56, alignItems: "center", justifyContent: "center" }}
					>
						<Ring color="controlBorder" radius={radius.md} />
						<FocusRing focused={focus} error={error} radius={radius.md} />
						<Text
							variant="mono"
							style={{ fontFamily: fonts.mono, fontSize: 26, lineHeight: 30, fontWeight: "400" }}
							// Geist Mono's own line (1.3 em) is taller than 30, and iOS draws the digits 1.5 dp high (A3).
							inkShift={Platform.OS === "ios" ? 1.5 : undefined}
							maxFontSizeMultiplier={1.3}
						>
							{value[i] ?? ""}
						</Text>
					</Box>
				);
			})}
		</View>
	);
}

/** The 40 × 40 send button (48 hit). `stop` while a reply streams. */
export function SendButton({
	onPress,
	disabled = false,
	stop = false,
}: {
	onPress?: (() => void) | undefined;
	disabled?: boolean | undefined;
	stop?: boolean | undefined;
}) {
	return (
		<Touch
			onPress={onPress}
			disabled={disabled}
			accessibilityLabel={stop ? "Stop" : "Send"}
			hitSlop={hitSlopFor(40, 40)}
			style={disabled ? { opacity: 0.45 } : null}
			testID="composer-send"
		>
			<Box
				component="IconButton"
				bg="accent"
				radius={radius.md}
				style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
			>
				<Icon name={stop ? "stop" : "arrow-up"} size={20} color="onAccent" fill={stop} />
			</Box>
		</Touch>
	);
}

/**
 * The AI composer: the input, then context chips, a spacer and the send button. A status line under it appears only
 * while sending is blocked (BUILD.md §3.6).
 */
export function Composer({
	value,
	onChangeText,
	placeholder,
	chips,
	onSend,
	onStop,
	sending = false,
	blocked,
	autoFocus,
}: {
	value: string;
	onChangeText?: (text: string) => void;
	placeholder: string;
	chips?: ReactNode | undefined;
	onSend?: (() => void) | undefined;
	onStop?: (() => void) | undefined;
	sending?: boolean | undefined;
	blocked?: string | undefined;
	autoFocus?: boolean | undefined;
}) {
	const { colors } = useTheme();
	// Like TextField: the dump lists the drawn value or the placeholder, in its line box.
	const textRef = useDesignTag(
		{ kind: "text", text: value || placeholder, style: typeScale.body, color: value ? "ink" : "ink3" },
		{ hidden: !(value || placeholder) },
	);
	return (
		<View style={{ paddingTop: 12, paddingBottom: 8, paddingHorizontal: layout.screenMargin, gap: 8 }}>
			<Box
				component="Composer"
				bg="raised"
				radius={radius.xl}
				style={{ paddingTop: 10, paddingEnd: 8, paddingBottom: 8, paddingStart: 12, gap: 8 }}
			>
				<Ring color="controlBorder" radius={radius.xl} />
				<View ref={textRef} collapsable={false}>
					{/* The placeholder is drawn here, not by the input: iOS appends an input's placeholder to its label, which
					    named the composer "Ask about this resume… Ask about this resume…" and nothing could find it. */}
					{value ? null : (
						<View
							pointerEvents="none"
							style={{ position: "absolute", top: 0, left: 0, right: 0 }}
							importantForAccessibility="no-hide-descendants"
							accessibilityElementsHidden
						>
							<Text variant="body" color="ink3" tag={false} accessible={false}>
								{placeholder}
							</Text>
						</View>
					)}
					<TextInput
						value={value}
						onChangeText={onChangeText}
						accessibilityLabel={placeholder}
						multiline
						autoFocus={!!autoFocus}
						caretHidden={STORYBOARD}
						selectionColor={colors.accent}
						testID="composer-input"
						style={[
							multiLine(typeScale.body),
							{ padding: 0, color: colors.ink, maxHeight: 120, includeFontPadding: false },
						]}
					/>
				</View>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
					<View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{chips}</View>
					{/* B16 and C2 draw the send button 1 dp into the composer's end padding (x 319 to 319.5). */}
					<View style={{ marginEnd: -1 }}>
						{/* B16 and C2 draw it in full colour over an empty composer: empty sends nothing, only "blocked" dims it. */}
						<SendButton
							onPress={sending ? onStop : value.trim() ? onSend : undefined}
							stop={sending}
							disabled={!sending && !!blocked}
						/>
					</View>
				</View>
			</Box>
			{blocked ? (
				<View accessibilityRole="alert" style={{ flexDirection: "row", gap: 6 }}>
					<Icon name="warning-circle" size={14} color="ink3" style={{ marginTop: 1 }} />
					<Text variant="caption" weight={400} color="ink3" style={{ flex: 1 }}>
						{blocked}
					</Text>
				</View>
			) : null}
		</View>
	);
}

/** The user's chat bubble: sunken, small corner at the bottom end, at most 84% wide. */
export function Bubble({ children }: { children: string }) {
	return (
		<Box
			component="Bubble"
			bg="sunken"
			style={{
				alignSelf: "flex-end",
				maxWidth: "84%",
				paddingVertical: 10,
				paddingHorizontal: 12,
				borderTopStartRadius: radius.xl,
				borderTopEndRadius: radius.xl,
				borderBottomEndRadius: radius.xs,
				borderBottomStartRadius: radius.xl,
			}}
		>
			<Text variant="bubble">{children}</Text>
		</Box>
	);
}

/** The connection chip in B16 and C2's top bar: names the connection that receives the message. */
export function ConnectionChip({ label, onPress }: { label: string; onPress?: (() => void) | undefined }) {
	return (
		<Touch
			onPress={onPress}
			accessibilityLabel={`Connection: ${label}`}
			accessibilityHint="Change the connection"
			hitSlop={hitSlopFor(48, 32)}
		>
			<Box
				component="Chip"
				bg="sunken"
				radius={radius.sm}
				style={{ height: 32, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6 }}
			>
				<Icon name="sparkle" size={16} color="accentText" />
				<Text variant="chip" color="ink2" numberOfLines={1}>
					{label}
				</Text>
				<Icon name="caret-down" size={16} color="ink2" />
			</Box>
		</Touch>
	);
}

/** The formatting toolbar above the keyboard (B4, L1): 52 dp, 44 dp icon buttons on a 52 dp pitch. */
export function FormattingToolbar({
	items,
	end,
}: {
	items: { icon: IconName; label: string; onPress?: (() => void) | undefined; on?: boolean | undefined }[];
	/** Pushed to the trailing edge (B4's Improve button). */
	end?: ReactNode | undefined;
}) {
	const { colors } = useTheme();
	return (
		<View
			accessibilityRole="toolbar"
			style={{
				height: 52,
				paddingHorizontal: 12,
				flexDirection: "row",
				alignItems: "center",
				gap: 8,
				backgroundColor: colors.raised,
				borderTopWidth: 1,
				borderTopColor: colors.line,
			}}
		>
			{items.map((item) => (
				// B4 draws the toolbar's glyphs at 20 dp in 44 dp buttons.
				<IconButton
					key={item.label}
					icon={item.icon}
					label={item.label}
					onPress={item.onPress}
					on={!!item.on}
					iconSize={20}
				/>
			))}
			{end ? <View style={{ marginStart: "auto" }}>{end}</View> : null}
		</View>
	);
}
