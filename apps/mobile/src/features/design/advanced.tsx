import type { GroupProps } from "./style-groups";
import type { FontWeight } from "@reactive-resume/fonts";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { DateFormat } from "@reactive-resume/schema/resume/dates";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { fontList, getFont, getFontDisplayName, sortFontWeights } from "@reactive-resume/fonts";
import { compileStylesheet, isFatalStylesheetDiagnostic } from "@reactive-resume/resume/stylesheet";
import { icons } from "@reactive-resume/schema/icons";
import { Field, Stepper, SwitchRow } from "./controls";
import { DATE_FORMATS, parseColorInput, resetDesign, rgbaToHex } from "./presets";
import { useResumeStore } from "@/draft";
import { Button, Chip, Icon, ListRow, SelectSheet, Text, showToast, useTheme, type IconName } from "@/ui";

export type AdvancedId = "typography" | "colours" | "page" | "layout" | "styles";

type AdvancedGroupProps = GroupProps & {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onPush: (id: AdvancedId) => void;
};

/** Every exact value, the date format, custom CSS and Reset design defaults, collapsed until asked for. */
export function AdvancedGroup({ data, write, disabled, open, onOpenChange, onPush }: AdvancedGroupProps) {
	const { t } = useLingui();
	const { colors, space, size } = useTheme();
	const { metadata } = data;
	const css = metadata.stylesheet?.source.text.trim() ?? "";
	const rows: { id: AdvancedId; icon: IconName; title: string; value: string }[] = [
		{
			id: "typography",
			icon: "text-aa",
			title: t`Typography`,
			value: `${getFontDisplayName(metadata.typography.body.fontFamily)} · ${metadata.typography.body.fontSize} pt`,
		},
		{ id: "colours", icon: "palette", title: t`Design`, value: t`Colors and level` },
		{ id: "page", icon: "file-text", title: t`Page`, value: `${metadata.page.marginX} × ${metadata.page.marginY} pt` },
		{
			id: "layout",
			icon: "square-split-horizontal",
			title: t`Layout`,
			value: plural(metadata.layout.pages.length, { one: "# page", other: "# pages" }),
		},
		{ id: "styles", icon: "code", title: t`Custom styles`, value: css ? t`Custom` : t`None` },
	];

	const reset = () => {
		write("reset", (draft) => resetDesign(draft.metadata), true);
		showToast({
			message: t`Design reset to defaults`,
			action: { label: t`Undo`, onPress: () => useResumeStore.getState().undo() },
		});
	};

	return (
		<View style={{ gap: space.s3 }}>
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ expanded: open }}
				onPress={() => onOpenChange(!open)}
				style={{ minHeight: size.hit, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
			>
				<Text variant="title">{t`Advanced`}</Text>
				<View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
					<Icon name="caret-down" size={size.icon.row} color={colors.ink2} />
				</View>
			</Pressable>
			{open ? (
				<View style={{ gap: space.s3 }}>
					<SelectSheet<DateFormat>
						label={t`Date format`}
						value={metadata.page.dateFormat ?? "short"}
						disabled={disabled}
						options={DATE_FORMATS}
						onChange={(value) =>
							write(
								"dateFormat",
								(draft) => {
									draft.metadata.page.dateFormat = value;
								},
								true,
							)
						}
					/>
					<View>
						{rows.map((row) => (
							<ListRow
								key={row.id}
								title={row.title}
								subtitle={row.value}
								leading={row.icon}
								chevron
								onPress={() => onPush(row.id)}
							/>
						))}
					</View>
					<View style={{ alignSelf: "flex-start" }}>
						<Button
							label={t`Reset design defaults`}
							icon="arrow-counter-clockwise"
							variant="secondary"
							disabled={disabled}
							onPress={reset}
						/>
					</View>
				</View>
			) : null}
		</View>
	);
}

type FontPrefix = "body" | "heading";

/** Web get-next-weights: body gets a regular and a bold weight, the heading one weight (600 when available). */
function nextWeights(family: string, single: boolean): FontWeight[] | null {
	const weights = [...new Set(getFont(family)?.weights ?? [])];
	if (weights.length === 0) return null;
	if (single) return [weights.includes("600") ? "600" : (weights.at(-1) ?? "400")];
	const chosen = (["400", "700"] as const).filter((weight) => weights.includes(weight)) as FontWeight[];
	for (const candidate of [weights[0], weights.at(-1)]) {
		if (chosen.length >= 2) break;
		if (candidate && !chosen.includes(candidate)) chosen.push(candidate);
	}
	return chosen.length > 0 ? chosen : null;
}

const FONT_OPTIONS = fontList.map((font) => ({ value: font.family, label: getFontDisplayName(font.family) }));

/** Advanced → Typography: family, weights, size and line height for body and heading, and hyphenation. */
export function TypographyScreen({ data, write, disabled, pick }: GroupProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { typography } = data.metadata;
	const set = (key: string, mutate: (value: ResumeData["metadata"]["typography"]) => void, discrete = false) =>
		write(`typography.${key}`, (draft) => mutate(draft.metadata.typography), discrete);

	const group = (prefix: FontPrefix) => {
		const item = typography[prefix];
		const available = sortFontWeights([...new Set(getFont(item.fontFamily)?.weights ?? item.fontWeights)]);
		return (
			<View style={{ gap: space.s3 }}>
				<Text variant="label" color="ink2">
					{prefix === "body"
						? t({ message: "Body", context: "Body Text (paragraphs, lists, etc.)" })
						: t({ message: "Heading", context: "Headings or Titles (H1, H2, H3, H4, H5, H6)" })}
				</Text>
				<ListRow
					title={t`Font family`}
					subtitle={getFontDisplayName(item.fontFamily)}
					chevron
					disabled={disabled}
					onPress={() =>
						pick({
							title: t`Font family`,
							value: item.fontFamily,
							options: FONT_OPTIONS,
							onPick: (family) =>
								set(
									`${prefix}.family`,
									(draft) => {
										draft[prefix].fontFamily = family;
										const weights = nextWeights(family, prefix === "heading");
										if (weights) draft[prefix].fontWeights = weights;
									},
									true,
								),
						})
					}
				/>
				<Field label={prefix === "body" ? t`Font weights` : t`Font weight`}>
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
						{available.map((weight) => {
							const selected = item.fontWeights.includes(weight);
							return (
								<Chip
									key={weight}
									label={weight}
									selected={selected}
									onPress={() => {
										if (disabled) return;
										const next =
											prefix === "heading"
												? [weight]
												: selected
													? item.fontWeights.filter((value) => value !== weight)
													: sortFontWeights([...item.fontWeights, weight]);
										if (next.length > 0)
											set(
												`${prefix}.weights`,
												(draft) => {
													draft[prefix].fontWeights = next;
												},
												true,
											);
									}}
								/>
							);
						})}
					</View>
				</Field>
				<Stepper
					label={t`Font size`}
					value={item.fontSize}
					unit="pt"
					min={6}
					max={24}
					step={0.1}
					disabled={disabled}
					onChange={(value) =>
						set(
							`${prefix}.size`,
							(draft) => {
								draft[prefix].fontSize = value;
							},
							true,
						)
					}
				/>
				<Stepper
					label={t`Line height`}
					value={item.lineHeight}
					unit="x"
					min={0.5}
					max={4}
					step={0.05}
					disabled={disabled}
					onChange={(value) =>
						set(
							`${prefix}.lineHeight`,
							(draft) => {
								draft[prefix].lineHeight = value;
							},
							true,
						)
					}
				/>
			</View>
		);
	};

	return (
		<View style={{ gap: space.s6 }}>
			{group("body")}
			{group("heading")}
			<SwitchRow
				label={t`Hyphenation`}
				description={t`Breaks long words between syllables, using the language set in Page.`}
				value={typography.hyphenation === true}
				disabled={disabled}
				onChange={(value) =>
					set(
						"hyphenation",
						(draft) => {
							draft.hyphenation = value;
						},
						true,
					)
				}
			/>
		</View>
	);
}

type ColorFieldProps = { label: string; value: string; disabled: boolean; onChange: (rgba: string) => void };

/** A colour as rgba or hex text, with its swatch. Applies while typing once the value parses. */
function ColorField({ label, value, disabled, onChange }: ColorFieldProps) {
	const { t } = useLingui();
	const { colors, radius, space, size, type } = useTheme();
	const [typed, setTyped] = useState<string | null>(null);
	const invalid = typed !== null && parseColorInput(typed) === null;
	return (
		<Field label={label} helper={invalid ? t`Use a hex value like #3E6B4F or rgba(62, 107, 79, 1).` : undefined}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.s2 }}>
				<View
					style={{
						width: size.hit - space.s2,
						height: size.hit - space.s2,
						borderRadius: radius.rLg,
						borderWidth: 1,
						borderColor: colors.line2,
						backgroundColor: rgbaToHex(value) ?? colors.paper,
					}}
				/>
				<TextInput
					accessibilityLabel={label}
					editable={!disabled}
					value={typed ?? value}
					autoCapitalize="none"
					autoCorrect={false}
					spellCheck={false}
					keyboardType="ascii-capable"
					onChangeText={(text) => {
						setTyped(text);
						const parsed = parseColorInput(text);
						if (parsed) onChange(parsed);
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
						borderColor: invalid ? colors.dangerText : colors.lineStrong,
					}}
				/>
			</View>
		</Field>
	);
}

const LEVEL_TYPES = ["hidden", "circle", "square", "rectangle", "rectangle-full", "progress-bar", "icon"] as const;
type LevelType = (typeof LEVEL_TYPES)[number];
const ICON_OPTIONS = icons.filter(Boolean).map((name) => ({ value: name, label: name }));

/** Advanced → Design: primary, text and background colours, and how skill and language levels draw. */
export function ColoursScreen({ data, write, disabled, pick }: GroupProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { design } = data.metadata;
	const setColor = (name: "primary" | "text" | "background", value: string) =>
		write(`colors.${name}`, (draft) => {
			draft.metadata.design.colors[name] = value;
		});
	const levelNames: Record<LevelType, string> = {
		hidden: t`Hidden`,
		circle: t`Circle`,
		square: t`Square`,
		rectangle: t`Rectangle`,
		"rectangle-full": t`Rectangle (full width)`,
		"progress-bar": t`Progress bar`,
		icon: t`Icon`,
	};

	return (
		<View style={{ gap: space.s4 }}>
			<ColorField
				label={t`Primary color`}
				value={design.colors.primary}
				disabled={disabled}
				onChange={(value) => setColor("primary", value)}
			/>
			<ColorField
				label={t`Text color`}
				value={design.colors.text}
				disabled={disabled}
				onChange={(value) => setColor("text", value)}
			/>
			<ColorField
				label={t`Background color`}
				value={design.colors.background}
				disabled={disabled}
				onChange={(value) => setColor("background", value)}
			/>

			<Text variant="title">{t`Level`}</Text>
			<ListRow
				title={t`Icon`}
				subtitle={design.level.icon || t`None`}
				chevron
				disabled={disabled}
				onPress={() =>
					pick({
						title: t`Icon`,
						value: design.level.icon,
						options: ICON_OPTIONS,
						onPick: (icon) =>
							write(
								"level.icon",
								(draft) => {
									draft.metadata.design.level.icon = icon;
								},
								true,
							),
					})
				}
			/>
			<SelectSheet<LevelType>
				label={t`Type`}
				value={design.level.type}
				disabled={disabled}
				options={LEVEL_TYPES.map((value) => ({ value, label: levelNames[value] }))}
				onChange={(value) =>
					write(
						"level.type",
						(draft) => {
							draft.metadata.design.level.type = value;
						},
						true,
					)
				}
			/>
		</View>
	);
}

/** Advanced → Page: exact margins and spacing, and the three hide switches. */
export function AdvancedPageScreen({ data, write, disabled }: GroupProps) {
	const { t } = useLingui();
	const { space } = useTheme();
	const { page } = data.metadata;
	type NumberKey = "marginX" | "marginY" | "gapX" | "gapY";
	type SwitchKey = "hideLinkUnderline" | "hideIcons" | "hideSectionIcons";
	const numbers: { key: NumberKey; label: string; max?: number }[] = [
		{ key: "marginX", label: t`Horizontal margin`, max: 100 },
		{ key: "marginY", label: t`Vertical margin`, max: 100 },
		{ key: "gapX", label: t`Horizontal spacing` },
		{ key: "gapY", label: t`Vertical spacing` },
	];
	const switches: { key: SwitchKey; label: string }[] = [
		{ key: "hideLinkUnderline", label: t`Underline links` },
		{ key: "hideIcons", label: t`Show icons` },
		{ key: "hideSectionIcons", label: t`Show section icons` },
	];
	return (
		<View style={{ gap: space.s2 }}>
			{numbers.map(({ key, label, max }) => (
				<Stepper
					key={key}
					label={label}
					value={page[key]}
					unit="pt"
					min={0}
					max={max}
					step={1}
					disabled={disabled}
					onChange={(value) =>
						write(
							`page.${key}`,
							(draft) => {
								draft.metadata.page[key] = value;
							},
							true,
						)
					}
				/>
			))}
			{switches.map(({ key, label }) => (
				<SwitchRow
					key={key}
					label={label}
					// Labels describe the ON state; the stored flags are hide*, so the switch is inverted.
					value={!page[key]}
					disabled={disabled}
					onChange={(value) =>
						write(
							`page.${key}`,
							(draft) => {
								draft.metadata.page[key] = !value;
							},
							true,
						)
					}
				/>
			))}
		</View>
	);
}

/** Errors list once typing pauses (mockup: 500 ms). */
const COMPILE_DELAY_MS = 500;

/** Advanced → Custom styles: the semantic CSS stylesheet in a monospace field, with its errors and Copy. */
export function StylesScreen({ data, write, disabled }: GroupProps) {
	const { t } = useLingui();
	const { colors, radius, space, type } = useTheme();
	const source = data.metadata.stylesheet?.source ?? { languageVersion: 1, text: "" };
	const { languageVersion, text: raw } = source;
	// Stylesheets saved before the version moved out of the text start with `@version 1;`; it isn't shown (web).
	const text = source.text.replace(/^\s*@version\s+\d+\s*;[ \t]*\r?\n?/, "");
	const [errors, setErrors] = useState<string[]>([]);
	useEffect(() => {
		const timer = setTimeout(() => {
			try {
				setErrors(
					compileStylesheet({ languageVersion, text: raw })
						.diagnostics.filter(isFatalStylesheetDiagnostic)
						.map((diagnostic) => diagnostic.message),
				);
			} catch {
				setErrors([]);
			}
		}, COMPILE_DELAY_MS);
		return () => clearTimeout(timer);
	}, [languageVersion, raw]);

	return (
		<View style={{ gap: space.s3 }}>
			<TextInput
				accessibilityLabel={t`Semantic CSS stylesheet`}
				editable={!disabled}
				multiline
				value={text}
				autoCapitalize="none"
				autoCorrect={false}
				spellCheck={false}
				smartInsertDelete={false}
				keyboardType="ascii-capable"
				textAlignVertical="top"
				onChangeText={(next) => {
					if (next === text) return;
					write("stylesheet", (draft) => {
						draft.metadata.stylesheet = { mode: "semantic", source: { ...source, text: next } };
					});
				}}
				style={{
					...type.mono,
					minHeight: space.s12 * 6,
					padding: space.s3,
					color: colors.ink,
					backgroundColor: colors.raised,
					borderRadius: radius.rLg,
					borderWidth: 1,
					borderColor: errors.length > 0 ? colors.dangerText : colors.lineStrong,
				}}
			/>
			{errors.length > 0 ? (
				<View accessibilityRole="alert" style={{ gap: space.s1 }}>
					<Text variant="callout" color="dangerText">
						{t`Custom styles aren't applied. Fix these errors to apply them:`}
					</Text>
					{errors.map((message, index) => (
						<Text key={`${index}-${message}`} variant="caption" color="dangerText">
							{`• ${message}`}
						</Text>
					))}
				</View>
			) : null}
			<View style={{ alignSelf: "flex-start" }}>
				<Button
					label={t`Copy stylesheet`}
					icon="copy"
					variant="secondary"
					size="sm"
					disabled={!text}
					onPress={() => {
						void Clipboard.setStringAsync(text).then(() => showToast({ message: t`Copied to clipboard` }));
					}}
				/>
			</View>
			<Text variant="caption" color="ink3">
				{t`PDF styles support a subset of CSS. Rotation, dashed and dotted borders, and some layout properties are ignored.`}
			</Text>
		</View>
	);
}
