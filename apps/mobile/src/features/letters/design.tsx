import type { FontPairingId, MarginId } from "./design-presets";
import type { LetterDocument } from "@/draft/types";
import type { WritableDraft } from "immer";
import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { templateSchema } from "@reactive-resume/schema/templates";
import {
	ACCENTS,
	FONT_PAIRINGS,
	MARGINS,
	TEXT_SIZE,
	applyFontPairing,
	hexToRgba,
	isValidHex,
	matchFontPairing,
	matchMargins,
	rgbaToHex,
	templateName,
} from "./design-presets";
import { useResumes } from "./queries";
import { relinkLetter } from "./save";
import { relinked } from "./write";
import { useLetterStore } from "@/draft";
import { applyTextSize } from "@/features/design/presets";
import { routes } from "@/routes";
import { Button, IconButton, ListRow, Segmented, SelectSheet, Switch, Text, TextField, useTheme } from "@/ui";

type Metadata = WritableDraft<LetterDocument["style"]["metadata"]>;

/** The letter's own type, colours and page; editing any of them ends the design link, as on the server. */
const design = (key: string, recipe: (metadata: Metadata) => void) =>
	useLetterStore.getState().update(
		(letter) => {
			letter.designLinked = false;
			recipe(letter.style.metadata);
		},
		{ coalesceKey: `design.${key}` },
	);

function Group({ title, children }: { title: string; children: ReactNode }) {
	const { colors, space } = useTheme();
	return (
		<View style={{ gap: space.s3, padding: space.s4, borderBottomWidth: 1, borderBottomColor: colors.line }}>
			<Text accessibilityRole="header" variant="title">
				{title}
			</Text>
			{children}
		</View>
	);
}

/**
 * Design for letters (builder.html L6): by default a letter matches its resume's design, changed on the resume.
 * Turned off, the letter keeps a design of its own: template, type, colour and page. Ported from web's
 * `design-panel.tsx`.
 */
export function LetterDesign({ id }: { id: string }) {
	const router = useRouter();
	const { t } = useLingui();
	const letter = useLetterStore((state) => (state.document?.id === id ? state.document : null));
	const resumes = useResumes();
	if (!letter) return null;

	const resume = resumes.data?.find((item) => item.id === letter.sourceResumeId);
	const resumeName = resume?.name;
	const matchLabel = resumeName ? t`Match “${resumeName}”` : t`Match the resume`;
	const disabled = letter.isLocked;

	const setLinked = (designLinked: boolean) => {
		void relinkLetter((draft) => void (draft.designLinked = designLinked)).then((result) =>
			relinked(
				result,
				designLinked ? t`The letter matches the resume's design again` : t`The letter keeps this design as its own`,
			),
		);
	};

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Group title={t`Matching the resume`}>
				{letter.sourceResumeId ? (
					<>
						<ListRow
							title={matchLabel}
							subtitle={
								letter.designLinked
									? t`Template, type and colors follow the resume, so the pair always matches.`
									: t`The letter keeps a design of its own.`
							}
							trailing={
								<Switch label={matchLabel} value={letter.designLinked} disabled={disabled} onValueChange={setLinked} />
							}
						/>
						{letter.designLinked ? (
							<Button
								variant="secondary"
								icon="palette"
								label={t`Change the resume's design`}
								onPress={() => router.push(routes.builder(letter.sourceResumeId ?? "", "design"))}
							/>
						) : null}
					</>
				) : (
					<Text color="ink2">{t`Choose a resume in Write to match its design. Until then, the letter has its own.`}</Text>
				)}
			</Group>
			{letter.designLinked ? null : <OwnDesign letter={letter} disabled={disabled} />}
		</ScrollView>
	);
}

function OwnDesign({ letter, disabled }: { letter: LetterDocument; disabled: boolean }) {
	const { t, i18n } = useLingui();
	const { colors, radius, size, space } = useTheme();
	const metadata = letter.style.metadata;
	const primary = rgbaToHex(metadata.design.colors.primary);
	const [hex, setHex] = useState(primary ?? "");
	const textSize = metadata.typography.body.fontSize;
	const step = (delta: number) =>
		design("size", (value) =>
			applyTextSize(value, Math.min(TEXT_SIZE.max, Math.max(TEXT_SIZE.min, textSize + delta * TEXT_SIZE.step))),
		);
	const marginLabels: Record<MarginId, string> = { narrow: t`Narrow`, normal: t`Normal`, wide: t`Wide` };

	return (
		<View pointerEvents={disabled ? "none" : "auto"} style={{ opacity: disabled ? 0.6 : 1 }}>
			<Group title={t`Template`}>
				<SelectSheet
					label={t`Template`}
					value={metadata.template}
					options={templateSchema.options.map((id) => ({ value: id, label: templateName(id) }))}
					onChange={(template) =>
						useLetterStore.getState().update(
							(draft) => {
								draft.designLinked = false;
								draft.style.metadata.template = template;
							},
							{ newStep: true },
						)
					}
				/>
			</Group>
			<Group title={t`Type`}>
				<SelectSheet<FontPairingId>
					label={t`Font pairing`}
					value={matchFontPairing(metadata)?.id ?? null}
					placeholder={t`Custom`}
					options={FONT_PAIRINGS.map((pairing) => ({
						value: pairing.id,
						label: i18n._(pairing.label),
						description: pairing.heading === pairing.body ? pairing.body : `${pairing.heading} · ${pairing.body}`,
					}))}
					onChange={(id) => design("pairing", (value) => applyFontPairing(value, id))}
				/>
				<View style={{ flexDirection: "row", alignItems: "center", gap: space.s2 }}>
					<Text style={{ flex: 1 }}>{t`Text size`}</Text>
					<IconButton
						icon="minus"
						variant="secondary"
						label={t`Smaller text`}
						disabled={textSize <= TEXT_SIZE.min}
						onPress={() => step(-1)}
					/>
					<Text variant="mono" accessibilityLiveRegion="polite">{t`${textSize} pt`}</Text>
					<IconButton
						icon="plus"
						variant="secondary"
						label={t`Larger text`}
						disabled={textSize >= TEXT_SIZE.max}
						onPress={() => step(1)}
					/>
				</View>
			</Group>
			<Group title={t`Color`}>
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
					{ACCENTS.map((accent) => {
						const selected = accent.hex === primary;
						return (
							<Pressable
								key={accent.hex}
								accessibilityRole="radio"
								accessibilityLabel={i18n._(accent.label)}
								accessibilityState={{ checked: selected }}
								onPress={() => {
									setHex(accent.hex);
									design("color", (value) => void (value.design.colors.primary = hexToRgba(accent.hex)));
								}}
								style={{
									width: size.hit,
									height: size.hit,
									borderRadius: radius.rLg,
									borderWidth: 2,
									borderColor: selected ? colors.ink : "transparent",
									padding: space.s0,
								}}
							>
								{/* A document colour from the letter's own palette, so it isn't a theme token. */}
								<View style={{ flex: 1, borderRadius: radius.rLg, backgroundColor: accent.hex }} />
							</Pressable>
						);
					})}
				</View>
				<TextField
					label={t`Hex`}
					value={hex}
					mono
					autoCapitalize="characters"
					autoCorrect={false}
					maxLength={7}
					error={hex && !isValidHex(hex) ? t`Use six hex digits, like #3E6B4F.` : undefined}
					onChangeText={(value) => {
						setHex(value);
						if (isValidHex(value)) design("color", (draft) => void (draft.design.colors.primary = hexToRgba(value)));
					}}
				/>
			</Group>
			<Group title={t`Page`}>
				<Segmented
					label={t`Page format`}
					value={metadata.page.format}
					options={[
						{ value: "a4", label: "A4" },
						{
							value: "letter",
							label: t({ message: "Letter", context: "US Letter paper size (8.5 × 11 in), shown beside A4" }),
						},
						{ value: "free-form", label: t`Free-form` },
					]}
					onChange={(format) => design("format", (value) => void (value.page.format = format))}
				/>
				<Segmented<MarginId | "custom">
					label={t`Margins`}
					value={matchMargins(metadata) ?? "custom"}
					options={(Object.keys(MARGINS) as MarginId[]).map((id) => ({ value: id, label: marginLabels[id] }))}
					onChange={(id) => {
						if (id === "custom") return;
						design("margins", (value) => {
							value.page.marginX = MARGINS[id].marginX;
							value.page.marginY = MARGINS[id].marginY;
						});
					}}
				/>
			</Group>
		</View>
	);
}
