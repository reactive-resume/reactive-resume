import type { DesignWrite } from "./draft";
import type { PickerSpec } from "./picker";
import type { DensityId, FontPairingId, MarginId } from "./presets";
import type { MessageDescriptor } from "@lingui/core";
import type { EntryHeader, ResumeData } from "@reactive-resume/schema/resume/data";
import type { Locale } from "@reactive-resume/utils/locale";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { entryHeaderLayouts, entryHeaderOf } from "@reactive-resume/schema/resume/data";
import { Field, Slider, SwitchRow } from "./controls";
import {
	ACCENTS,
	FONT_PAIRINGS,
	MIN_CONTRAST,
	TEXT_SIZE,
	applyDensity,
	applyFontPairing,
	applyMargins,
	applyTextSize,
	contrastOver,
	darkenForWhite,
	hexToRgba,
	isValidHex,
	matchDensity,
	matchFontPairing,
	matchMargins,
	rgbaToHex,
} from "./presets";
import { localeMap } from "@/features/settings/locale-names";
import { selectableLocales } from "@/i18n";
import { Button, Icon, IconButton, Segmented, Text, haptics, listLayout, useTheme } from "@/ui";

export type GroupProps = {
	data: ResumeData;
	write: DesignWrite;
	disabled: boolean;
	/** Pushes a searchable list over the sheet. */
	pick: (spec: PickerSpec) => void;
};

const PAIRING_NAMES: Record<FontPairingId, MessageDescriptor> = {
	classic: msg`Classic`,
	traditional: msg`Traditional`,
	balanced: msg`Balanced`,
	professional: msg`Professional`,
	clean: msg`Clean`,
};

const ACCENT_NAMES: Record<(typeof ACCENTS)[number], MessageDescriptor> = {
	"#3E6B4F": msg`Moss`,
	"#2F5A8A": msg`Ink blue`,
	"#1F6E73": msg`Teal`,
	"#6B3E6E": msg`Plum`,
	"#A0442A": msg`Rust`,
	"#8A2C3F": msg`Burgundy`,
	"#7A5A12": msg`Ochre`,
	"#3B3F45": msg`Graphite`,
};

const familiesLabel = (heading: string, body: string) => (heading === body ? heading : `${heading} + ${body}`);

type Tone = "lead" | "light" | "accent" | "none";

/** Header layout sketches: rows of [width %, tone] bars, null a flexible gap. Dark is the lead, light the rest. */
const SKETCHES: Record<EntryHeader["layout"], ([number, Tone] | null)[][]> = {
	stacked: [
		[[45, "lead"], null, [20, "light"]],
		[[35, "light"], null, [25, "light"]],
	],
	inline: [[[30, "lead"], [25, "light"], null, [20, "light"]]],
	compact: [[[45, "lead"], null, [20, "light"]], [[60, "light"]]],
	"date-column": [
		[
			[18, "light"],
			[45, "lead"],
		],
		[
			[18, "none"],
			[55, "light"],
		],
	],
	eyebrow: [[[35, "accent"]], [[50, "lead"], null, [20, "light"]]],
};

/** Entries: the Experience, Education and Volunteer header layout, which of its two rows leads, and an accent. */
export function EntriesGroup({ data, write, disabled }: GroupProps) {
	const { t } = useLingui();
	const { colors, radius, space, size } = useTheme();
	const entry = entryHeaderOf(data.metadata.design);
	const set = (key: string, patch: Partial<EntryHeader>) =>
		write(
			key,
			(draft) => {
				draft.metadata.design.entry = { ...entryHeaderOf(draft.metadata.design), ...patch };
			},
			true,
		);
	const layoutNames: Record<EntryHeader["layout"], string> = {
		stacked: t({ message: "Stacked", context: "Entry header layout" }),
		inline: t({ message: "One line", context: "Entry header layout" }),
		compact: t({ message: "Compact", context: "Entry header layout" }),
		"date-column": t({ message: "Date column", context: "Entry header layout" }),
		eyebrow: t({ message: "Eyebrow", context: "Entry header layout" }),
	};
	const tones: Record<Tone, string> = {
		lead: colors.ink2,
		light: colors.line2,
		accent: colors.accent,
		none: "transparent",
	};
	const organization = { id: "organization", name: t`Company`, detail: t`Location` };
	const role = { id: "role", name: t`Position`, detail: t`Date` };
	const rows = entry.lead === "role" ? [role, organization] : [organization, role];

	const tile = (layout: EntryHeader["layout"]) => {
		const selected = entry.layout === layout;
		return (
			<Pressable
				key={layout}
				accessibilityRole="radio"
				accessibilityLabel={layoutNames[layout]}
				accessibilityState={{ checked: selected, disabled }}
				disabled={disabled}
				onPress={() => {
					if (selected) return;
					haptics.selection();
					set("entryLayout", { layout });
				}}
				style={{
					flex: 1,
					minHeight: size.hit,
					gap: space.s2,
					padding: space.s2,
					borderRadius: radius.rLg,
					borderWidth: 1,
					borderColor: selected ? colors.accent : colors.line,
					backgroundColor: selected ? colors.accentSoft : "transparent",
				}}
			>
				<View style={{ height: space.s6, justifyContent: "center", gap: space.s1 }}>
					{SKETCHES[layout].map((bars, row) => (
						<View key={row} style={{ flexDirection: "row", gap: space.s1 }}>
							{bars.map((bar, index) =>
								bar ? (
									<View
										key={index}
										style={{
											width: `${bar[0]}%`,
											height: bar[1] === "accent" ? space.s0 : space.s1,
											borderRadius: radius.rSm,
											backgroundColor: tones[bar[1]],
										}}
									/>
								) : (
									<View key={index} style={{ flex: 1 }} />
								),
							)}
						</View>
					))}
				</View>
				<Text variant="caption" weight={selected ? 600 : 400} color={selected ? "ink" : "ink2"} numberOfLines={1}>
					{layoutNames[layout]}
				</Text>
			</Pressable>
		);
	};

	return (
		<View style={{ gap: space.s4 }}>
			<Field label={t`Header layout`}>
				<View
					accessibilityRole="radiogroup"
					accessibilityLabel={t`Header layout`}
					style={{ gap: space.s2, opacity: disabled ? 0.45 : 1 }}
				>
					{[entryHeaderLayouts.slice(0, 3), entryHeaderLayouts.slice(3)].map((layouts) => (
						<View key={layouts.join()} style={{ flexDirection: "row", gap: space.s2 }}>
							{layouts.map(tile)}
							{/* Keeps the short last row's tiles a third wide. */}
							{layouts.length < 3 ? <View style={{ flex: 3 - layouts.length }} /> : null}
						</View>
					))}
				</View>
			</Field>

			<Field label={t`Row order`} helper={t`Education swaps school and field of study the same way.`}>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: space.s3,
						padding: space.s2,
						borderRadius: radius.rLg,
						borderWidth: 1,
						borderColor: colors.line,
					}}
				>
					<View style={{ flex: 1, gap: space.s1 }}>
						{rows.map((row, index) => (
							<Animated.View
								key={row.id}
								accessible
								layout={listLayout}
								style={{
									minHeight: size.chip,
									flexDirection: "row",
									alignItems: "center",
									justifyContent: "space-between",
									gap: space.s2,
									paddingHorizontal: space.s3,
									borderRadius: radius.rMd,
									borderWidth: 1,
									borderColor: colors.line,
									backgroundColor: colors.raised,
								}}
							>
								<Text variant="callout" weight={index === 0 ? 600 : 400}>
									{row.name}
								</Text>
								<Text variant="caption" color="ink3">
									{row.detail}
								</Text>
							</Animated.View>
						))}
					</View>
					<IconButton
						icon="arrows-down-up"
						variant="secondary"
						label={entry.lead === "role" ? t`Swap rows: lead with company` : t`Swap rows: lead with position`}
						disabled={disabled}
						onPress={() => {
							haptics.selection();
							set("entryLead", { lead: entry.lead === "role" ? "organization" : "role" });
						}}
					/>
				</View>
			</Field>

			<Field label={t`Accent`}>
				<Segmented<EntryHeader["accent"]>
					label={t`Accent`}
					value={entry.accent}
					options={[
						{ value: "none", label: t({ message: "None", context: "Entry header accent" }) },
						{ value: "rule", label: t({ message: "Rule", context: "Entry header accent: a line under the header" }) },
						{ value: "bar", label: t({ message: "Bar", context: "Entry header accent: a bar beside the header" }) },
						{
							value: "band",
							label: t({ message: "Band", context: "Entry header accent: a tinted background behind the header" }),
						},
					]}
					onChange={(accent) => {
						if (!disabled) set("entryAccent", { accent });
					}}
				/>
			</Field>
		</View>
	);
}

type TypeGroupProps = GroupProps & { onCustomFonts: () => void };

/** Type: five font pairings (or any font, in Advanced), the text size (9–12.5 pt) and density. */
export function TypeGroup({ data, write, disabled, onCustomFonts }: TypeGroupProps) {
	const { t, i18n } = useLingui();
	const { colors, radius, space, size } = useTheme();
	const { metadata } = data;
	const pairing = matchFontPairing(metadata);
	const density = matchDensity(metadata);
	const textSize = metadata.typography.body.fontSize;
	const { heading, body } = metadata.typography;
	const row = (selected: boolean, dashed = false) => ({
		minHeight: size.input + space.s0,
		flexDirection: "row" as const,
		alignItems: "center" as const,
		gap: space.s3,
		paddingHorizontal: space.s3,
		borderRadius: radius.rLg,
		borderWidth: 1,
		borderStyle: dashed ? ("dashed" as const) : ("solid" as const),
		borderColor: selected ? colors.accent : colors.line,
		backgroundColor: selected ? colors.accentSoft : "transparent",
	});

	return (
		<View style={{ gap: space.s4 }}>
			<View accessibilityRole="radiogroup" accessibilityLabel={t`Font pairing`} style={{ gap: space.s1 }}>
				{FONT_PAIRINGS.map((option) => {
					const selected = pairing === option.id;
					return (
						<Pressable
							key={option.id}
							accessibilityRole="radio"
							accessibilityState={{ checked: selected, disabled }}
							disabled={disabled}
							onPress={() => write("pairing", (draft) => applyFontPairing(draft.metadata, option.id), true)}
							style={row(selected)}
						>
							<Text variant="label">{i18n._(PAIRING_NAMES[option.id])}</Text>
							<Text variant="caption" color="ink3" numberOfLines={1} style={{ flex: 1 }}>
								{familiesLabel(option.heading, option.body)}
							</Text>
							{selected ? <Icon name="check" size={size.icon.row} color={colors.accentText} /> : null}
						</Pressable>
					);
				})}
				<Pressable accessibilityRole="button" disabled={disabled} onPress={onCustomFonts} style={row(false, true)}>
					<Text variant="label">{t`Custom`}</Text>
					<Text variant="caption" color="ink3" numberOfLines={1} style={{ flex: 1 }}>
						{pairing ? t`Any font, in Advanced` : familiesLabel(heading.fontFamily, body.fontFamily)}
					</Text>
					<Icon name="arrow-down" size={size.icon.row} color={colors.ink3} />
				</Pressable>
			</View>

			<Field label={t`Text size`} value={`${textSize} pt`} helper={t`10–11 recommended`}>
				<Slider
					label={t`Text size`}
					value={textSize}
					min={TEXT_SIZE.min}
					max={TEXT_SIZE.max}
					step={TEXT_SIZE.step}
					format={(value) => `${value} pt`}
					disabled={disabled}
					onChange={(value) => write("size", (draft) => applyTextSize(draft.metadata, value), true)}
				/>
			</Field>

			<Field label={t`Density`}>
				<Segmented<DensityId | "">
					label={t`Density`}
					value={density ?? ""}
					options={[
						{ value: "compact", label: t`Compact` },
						{ value: "normal", label: t`Normal` },
						{ value: "roomy", label: t`Roomy` },
					]}
					onChange={(value) => {
						if (!disabled && value) write("density", (draft) => applyDensity(draft.metadata, value), true);
					}}
				/>
			</Field>
		</View>
	);
}

/** Color: eight accents or a custom hex, with its contrast on white and a darker shade when it's too light. */
export function ColorGroup({ data, write, disabled }: GroupProps) {
	const { t, i18n } = useLingui();
	const { colors, fonts, radius, space, size, type } = useTheme();
	const current = rgbaToHex(data.metadata.design.colors.primary) ?? "#000000";
	const [typed, setTyped] = useState<string | null>(null);
	const hex = typed ?? current;
	const valid = isValidHex(hex);
	const normalized = valid ? `#${hex.trim().replace("#", "").toUpperCase()}` : current;
	const { primary, background } = data.metadata.design.colors;
	// A typed hex is opaque; the saved colour may carry alpha, which prints lighter over the page background.
	const ratio = contrastOver(typed !== null && valid ? normalized : primary, background);
	const tooLight = ratio < MIN_CONTRAST;
	const setAccent = (next: string, discrete = true) =>
		write(
			"accent",
			(draft) => {
				draft.metadata.design.colors.primary = hexToRgba(next);
			},
			discrete,
		);
	const swatch = size.button;

	return (
		<View style={{ gap: space.s3 }}>
			<Text variant="callout" style={{ fontFamily: fonts.ui[600] }}>
				{t`Accent color`}
			</Text>
			<View
				accessibilityRole="radiogroup"
				accessibilityLabel={t`Accent color`}
				style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: space.s3 }}
			>
				{ACCENTS.map((hex) => {
					const selected = hex === current;
					return (
						<Pressable
							key={hex}
							accessibilityRole="radio"
							accessibilityLabel={i18n._(ACCENT_NAMES[hex])}
							accessibilityState={{ checked: selected, disabled }}
							disabled={disabled}
							onPress={() => {
								setTyped(null);
								setAccent(hex);
							}}
							style={{
								width: swatch,
								height: swatch,
								borderRadius: radius.rSm,
								backgroundColor: hex,
								alignItems: "center",
								justifyContent: "center",
								borderWidth: selected ? 2 : 0,
								borderColor: colors.surface,
								outlineColor: hex,
								outlineWidth: selected ? 2 : 0,
							}}
						>
							{selected ? <Icon name="check" size={size.icon.row} color={colors.paper} /> : null}
						</Pressable>
					);
				})}
			</View>

			<View style={{ flexDirection: "row", alignItems: "center", gap: space.s2 }}>
				<View
					style={{
						width: size.hit - space.s2,
						height: size.hit - space.s2,
						borderRadius: radius.rLg,
						borderWidth: 1,
						borderColor: colors.line2,
						backgroundColor: normalized,
					}}
				/>
				<TextInput
					accessibilityLabel={t`Custom color (hex)`}
					editable={!disabled}
					value={hex}
					autoCapitalize="characters"
					autoCorrect={false}
					spellCheck={false}
					keyboardType="ascii-capable"
					maxLength={7}
					onChangeText={(text) => {
						setTyped(text);
						if (isValidHex(text)) setAccent(text, false);
					}}
					onBlur={() => setTyped(null)}
					style={{
						...type.mono,
						flex: 1,
						minHeight: size.input,
						paddingHorizontal: space.s3,
						color: colors.ink,
						backgroundColor: colors.raised,
						borderRadius: radius.rLg,
						borderWidth: 1,
						borderColor: colors.lineStrong,
					}}
				/>
				<Text variant="mono" color={tooLight ? "warnText" : "ink3"}>
					{`${ratio.toFixed(1)}:1`}
				</Text>
			</View>

			{tooLight ? (
				<View
					accessibilityRole="alert"
					style={{ gap: space.s2, padding: space.s3, borderRadius: radius.rLg, backgroundColor: colors.warnSoft }}
				>
					<View style={{ flexDirection: "row", gap: space.s2 }}>
						<Icon name="circle-half" size={size.icon.row} color={colors.warnText} />
						<Text variant="callout" color="warnText" style={{ flex: 1 }}>
							{t`Too light for headings on white. It may be hard to read and print faintly.`}
						</Text>
					</View>
					<View style={{ alignSelf: "flex-start" }}>
						<Button
							label={t`Use a darker shade`}
							variant="secondary"
							size="sm"
							disabled={disabled}
							onPress={() => {
								setTyped(null);
								setAccent(darkenForWhite(normalized));
							}}
						/>
					</View>
				</View>
			) : null}

			<Text variant="caption" color="ink3">
				{t`Accent is used for headings, icons and the header band. Body text stays near-black for print and ATS.`}
			</Text>
		</View>
	);
}

/** Page: paper, language (section titles and date words), margins, icons and link underlines. */
export function PageGroup({ data, write, disabled, pick }: GroupProps) {
	const { t, i18n } = useLingui();
	const { colors, radius, space, size } = useTheme();
	const { page } = data.metadata;
	const margins = matchMargins(data.metadata);
	const languageName = (code: string) => (code in localeMap ? i18n._(localeMap[code as Locale]) : code);
	const set = (key: string, mutate: (value: ResumeData["metadata"]["page"]) => void) =>
		write(key, (draft) => mutate(draft.metadata.page), true);

	return (
		<View style={{ gap: space.s4 }}>
			<Field label={t`Paper`}>
				<Segmented
					label={t`Paper`}
					value={page.format}
					options={[
						{
							value: "letter",
							label: t({ message: "Letter", context: "US Letter paper size (8.5 × 11 in), shown beside A4" }),
						},
						{ value: "a4", label: "A4" },
						{ value: "free-form", label: t`Free-form` },
					]}
					onChange={(value) => {
						if (!disabled)
							set("format", (draft) => {
								draft.format = value;
							});
					}}
				/>
			</Field>

			<Field label={t`Language`} helper={t`Changes section titles and date words only, not your content.`}>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={t`Language`}
					accessibilityValue={{ text: languageName(page.locale) }}
					disabled={disabled}
					onPress={() =>
						pick({
							title: t`Language`,
							value: page.locale,
							options: selectableLocales.map((code) => ({ value: code, label: languageName(code), detail: code })),
							onPick: (locale) =>
								set("locale", (draft) => {
									draft.locale = locale;
								}),
						})
					}
					style={{
						minHeight: size.input,
						flexDirection: "row",
						alignItems: "center",
						gap: space.s2,
						paddingHorizontal: space.s3,
						borderRadius: radius.rLg,
						borderWidth: 1,
						borderColor: colors.lineStrong,
						backgroundColor: colors.raised,
						opacity: disabled ? 0.45 : 1,
					}}
				>
					<Text variant="mono" color="ink3">
						{page.locale}
					</Text>
					<Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
						{languageName(page.locale)}
					</Text>
					<Icon name="caret-down" size={size.icon.meta} color={colors.ink3} />
				</Pressable>
			</Field>

			<Field label={t`Margins`}>
				<Segmented<MarginId | "">
					label={t`Margins`}
					value={margins ?? ""}
					options={[
						{ value: "narrow", label: t`Narrow` },
						{ value: "normal", label: t`Normal` },
						{ value: "wide", label: t`Wide` },
					]}
					onChange={(value) => {
						if (!disabled && value) write("margins", (draft) => applyMargins(draft.metadata, value), true);
					}}
				/>
			</Field>

			<View>
				<SwitchRow
					label={t`Icons in contact line`}
					description={t`Also shows the icons on skills, profiles and interests.`}
					value={!page.hideIcons}
					disabled={disabled}
					onChange={(checked) =>
						set("icons", (draft) => {
							draft.hideIcons = !checked;
						})
					}
				/>
				<SwitchRow
					label={t`Underline links`}
					value={!page.hideLinkUnderline}
					disabled={disabled}
					onChange={(checked) =>
						set("underline", (draft) => {
							draft.hideLinkUnderline = !checked;
						})
					}
				/>
			</View>
		</View>
	);
}
