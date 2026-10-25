import type { DesignWrite } from "./draft";
import type { PickerSpec } from "./picker";
import type { DensityId, FontPairingId, MarginId } from "./presets";
import type { MessageDescriptor } from "@lingui/core";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Locale } from "@reactive-resume/utils/locale";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { localeSchema } from "@reactive-resume/utils/locale";
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
import { Button, Icon, Segmented, Text, useTheme } from "@/ui";

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
							options: localeSchema.options.map((code) => ({ value: code, label: languageName(code), detail: code })),
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
