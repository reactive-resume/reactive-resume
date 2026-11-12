import type { DensityId, FontPairingId, MarginId } from "./presets";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { WritableDraft } from "immer";
import type { CSSProperties } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { createContext, useContext, useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Slider } from "@reactive-resume/ui/components/slider";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { contrastOnWhite, parseColorString } from "@reactive-resume/utils/color";
import { cn } from "@reactive-resume/utils/style";
import { Field, Help, wellClassName } from "./fields";
import {
	ACCENTS,
	applyDensity,
	applyFontPairing,
	applyMargins,
	applyTextSize,
	darkenForWhite,
	FONT_PAIRINGS,
	hexToRgba,
	normalizeHex,
	matchDensity,
	matchFontPairing,
	matchMargins,
	rgbaToHex,
	TEXT_SIZE,
} from "./presets";
import { ColorPicker } from "@/components/input/color-picker";
import { Combobox } from "@/components/ui/combobox";
import { getLocaleOptions } from "@/features/locale/locale-options";
import { useResumeData, useUpdateResumeData } from "@/features/resume/builder/draft";

type Metadata = Pick<ResumeData["metadata"], "typography" | "design" | "page">;

/** Edits the design; `key` names the control, so dragging a slider is one undo step. */
type DesignWriter = (key: string, mutate: (metadata: WritableDraft<Metadata>) => void, discrete?: boolean) => void;

export type DesignSource = { metadata: Metadata | undefined; write: DesignWriter };

const DesignSourceContext = createContext<DesignSource | null>(null);

/** Points the Type, Color and Page groups at another design than the open resume's (a letter's own). */
export const DesignSourceProvider = DesignSourceContext.Provider;

export function useDesign(): DesignSource {
	const source = useContext(DesignSourceContext);
	const data = useResumeData();
	const updateResumeData = useUpdateResumeData();
	if (source) return source;
	return {
		metadata: data?.metadata,
		write: (key, mutate, discrete = false) =>
			updateResumeData(
				(draft) => mutate(draft.metadata),
				discrete ? { newStep: true } : { coalesceKey: `design.${key}` },
			),
	};
}

const familiesLabel = (heading: string, body: string) => (heading === body ? heading : `${heading} + ${body}`);

type TypeGroupProps = {
	/** Brings the exact typography editor into view. Without it, the Custom row isn't offered. */
	onCustomFonts?: () => void;
};

/** Type: five font pairings (or any font, in Advanced), the text size (9–12.5 pt) and density. */
export function TypeGroup({ onCustomFonts }: TypeGroupProps) {
	const { i18n } = useLingui();
	const { metadata, write } = useDesign();
	const sizeLabelId = useId();
	if (!metadata) return null;

	const pairing = matchFontPairing(metadata);
	const density = matchDensity(metadata);
	const size = metadata.typography.body.fontSize;
	const { heading, body } = metadata.typography;

	return (
		<div className="grid gap-4">
			<div className="grid gap-1">
				<RadioGroup
					aria-label={t`Font pairing`}
					value={pairing ?? null}
					onValueChange={(value) => write("pairing", (draft) => applyFontPairing(draft, value as FontPairingId), true)}
					className="grid gap-1"
				>
					{FONT_PAIRINGS.map((option) => (
						<Radio.Root
							key={option.id}
							value={option.id}
							className="flex h-12 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 text-start transition-colors duration-quick hover:bg-hover data-checked:border-accent data-checked:bg-accent-soft data-checked:hover:bg-accent-soft"
						>
							<span className="text-sm font-medium">{i18n._(option.label)}</span>
							<span className="truncate text-xs text-ink-3">{familiesLabel(option.heading, option.body)}</span>
							{pairing === option.id && <Icon name="check" size={18} className="ms-auto text-accent-text" />}
						</Radio.Root>
					))}
				</RadioGroup>

				{onCustomFonts && (
					<button
						type="button"
						onClick={onCustomFonts}
						className="flex h-12 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line px-3 text-start transition-colors duration-quick hover:bg-hover"
					>
						<span className="text-sm font-medium">
							<Trans>Custom</Trans>
						</span>
						<span className="truncate text-xs text-ink-3">
							{pairing ? <Trans>Any font, in Advanced</Trans> : familiesLabel(heading.fontFamily, body.fontFamily)}
						</span>
						<Icon name="arrow-down" size={18} className="ms-auto text-ink-3" />
					</button>
				)}
			</div>

			<div className="grid gap-2">
				<div className="flex items-center justify-between text-[13px]">
					<span id={sizeLabelId} className="font-medium">
						<Trans>Text size</Trans>
					</span>
					<span className="font-mono text-xs text-ink-2">{i18n.number(size)} pt</span>
				</div>
				<Slider
					aria-labelledby={sizeLabelId}
					min={TEXT_SIZE.min}
					max={TEXT_SIZE.max}
					step={TEXT_SIZE.step}
					value={[Math.min(TEXT_SIZE.max, Math.max(TEXT_SIZE.min, size))]}
					onValueChange={(value) =>
						write("size", (draft) => applyTextSize(draft, Array.isArray(value) ? (value[0] ?? size) : value))
					}
				/>
				<span className="text-xs text-ink-3">
					<Trans>10–11 recommended</Trans>
				</span>
			</div>

			<div className="grid gap-2">
				<span className="text-[13px] font-medium">
					<Trans>Density</Trans>
				</span>
				<SegmentedControl
					aria-label={t`Density`}
					value={density ?? ""}
					onValueChange={(value) => write("density", (draft) => applyDensity(draft, value as DensityId), true)}
					className="w-full"
				>
					<SegmentedControlItem value="compact">
						<Trans>Compact</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="normal">
						<Trans>Normal</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="roomy">
						<Trans>Roomy</Trans>
					</SegmentedControlItem>
				</SegmentedControl>
			</div>
		</div>
	);
}

/** Color: eight accents or a custom hex, with its contrast on white and a darker shade when it's too light. */
export function ColorGroup() {
	const { i18n } = useLingui();
	const { metadata, write } = useDesign();
	const current = metadata ? (rgbaToHex(metadata.design.colors.primary) ?? "#000000") : "#000000";
	const [typed, setTyped] = useState<string | null>(null);
	const hexId = useId();
	if (!metadata) return null;

	const hex = typed ?? current;
	const typedHex = normalizeHex(hex);
	const valid = typedHex !== null;
	const normalized = typedHex ?? current;
	const opaque = parseColorString(metadata.design.colors.primary)?.a === 1;
	const selectedAccent = opaque ? ACCENTS.find((accent) => accent.hex === current) : undefined;
	const ratio = contrastOnWhite(typed === null ? metadata.design.colors.primary : normalized);
	const tooLight = valid && ratio < 4.5;

	const setAccent = (next: string, discrete = true) =>
		write(
			"accent",
			(draft) => {
				draft.design.colors.primary = hexToRgba(next);
			},
			discrete,
		);

	return (
		<div className="grid gap-3">
			<h3 className="-mb-3 flex items-baseline gap-3 pt-[18px] pb-2 t-section-title">
				<Trans>Accent</Trans>
				<span className="t-small text-ink-3">{selectedAccent ? i18n._(selectedAccent.label) : t`Custom`}</span>
			</h3>
			<RadioGroup
				aria-label={t`Accent color`}
				value={selectedAccent ? current : null}
				onValueChange={(value) => {
					setTyped(null);
					setAccent(value as string);
				}}
				// Touch: 48px swatches, four to a row.
				className="grid grid-cols-4 gap-x-2.5 gap-y-3.5"
			>
				{ACCENTS.map((accent) => (
					<Radio.Root
						key={accent.hex}
						value={accent.hex}
						aria-label={i18n._(accent.label)}
						title={i18n._(accent.label)}
						className="group/swatch grid cursor-pointer gap-1.5 text-start t-caption font-normal text-ink-2 data-checked:font-semibold data-checked:text-ink"
					>
						<span
							// The ring takes the swatch's own colour (ink-2 on dark, where a dark accent would vanish).
							className="grid h-10 place-items-center rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] group-data-checked/swatch:shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--c)] dark:shadow-[0_0_0_1px_var(--control-border)] dark:group-data-checked/swatch:shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--ink-2)]"
							style={{ backgroundColor: accent.hex, "--c": accent.hex } as CSSProperties}
						>
							{selectedAccent?.hex === accent.hex && <Icon name="check" size={18} className="text-paper" />}
						</span>
						{i18n._(accent.label)}
					</Radio.Root>
				))}
			</RadioGroup>

			<Field label={<Trans>Custom</Trans>} help={<Trans>Contrast on white</Trans>} className="mt-1">
				<div className="flex items-center gap-2">
					<ColorPicker
						compact
						popupLabel={t`Custom accent color`}
						className={wellClassName}
						aria-label={t`Open the color picker`}
						value={metadata.design.colors.primary}
						onChange={(color) => {
							setTyped(null);
							write("accent", (draft) => {
								draft.design.colors.primary = color;
							});
						}}
					/>
					<Input
						aria-label={t`Custom color (hex)`}
						value={hex}
						spellCheck={false}
						className="font-mono text-[13px]/4 font-medium"
						aria-invalid={!valid}
						aria-describedby={valid ? undefined : `${hexId}-error`}
						onChange={(event) => {
							setTyped(event.target.value);
							const next = normalizeHex(event.target.value);
							if (next) setAccent(next, false);
						}}
						onBlur={() => setTyped(null)}
					/>
					{/* An unreadable value has no ratio: the one shown would be the old colour's. */}
					{valid && (
						<span
							className={cn(
								"w-[52px] shrink-0 text-end font-mono text-xs/4 font-medium",
								tooLight ? "text-warn-text" : "text-ink-2",
							)}
						>
							{i18n.number(ratio, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}:{i18n.number(1)}
						</span>
					)}
				</div>
			</Field>
			{!valid && (
				<p id={`${hexId}-error`} className="text-xs text-danger-text">
					<Trans>Use a hex color such as #2F5A8A.</Trans>
				</p>
			)}

			{tooLight && (
				<div className="grid gap-2 rounded-lg bg-warn-soft p-3 text-[13px] leading-[19px] text-warn-text" role="status">
					<span className="flex gap-2">
						<Icon name="circle-half" size={20} />
						<Trans>Too light for headings on white. It may be hard to read and print faintly.</Trans>
					</span>
					<Button
						size="sm"
						variant="secondary"
						className="w-fit"
						onClick={() => {
							setTyped(null);
							setAccent(darkenForWhite(normalized));
						}}
					>
						<Trans>Use a darker shade</Trans>
					</Button>
				</div>
			)}

			<Help className="-mt-1">
				<Trans>Used for headings, icons and the header band.</Trans>
			</Help>
		</div>
	);
}

/** Page: paper, language (section titles and date words), margins, icons and link underlines. */
export function PageGroup({ showLanguage = true }: { showLanguage?: boolean } = {}) {
	const { metadata, write } = useDesign();
	const languageId = useId();
	if (!metadata) return null;

	const { page } = metadata;
	const margins = matchMargins(metadata);

	return (
		<div className="grid gap-4">
			<div className="grid gap-2">
				<span className="text-[13px] font-medium">
					<Trans>Paper</Trans>
				</span>
				<SegmentedControl
					aria-label={t`Paper`}
					value={page.format}
					onValueChange={(value) =>
						write(
							"format",
							(draft) => {
								draft.page.format = value as typeof page.format;
							},
							true,
						)
					}
					className="w-full"
				>
					<SegmentedControlItem value="letter">
						<Trans context="US Letter paper size (8.5 × 11 in), shown beside A4">Letter</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="a4">A4</SegmentedControlItem>
					<SegmentedControlItem value="free-form">
						<Trans>Free-form</Trans>
					</SegmentedControlItem>
				</SegmentedControl>
			</div>

			{showLanguage && (
				<div className="grid gap-2">
					<label htmlFor={languageId} className="text-[13px] font-medium">
						<Trans>Language</Trans>
					</label>
					<Combobox
						id={languageId}
						options={getLocaleOptions()}
						value={page.locale}
						onValueChange={(locale) =>
							write(
								"locale",
								(draft) => {
									draft.page.locale = (locale ?? "en-US") as string;
								},
								true,
							)
						}
					/>
					<span className="text-xs text-ink-3">
						<Trans>Sets section titles, date words and text direction. Your content isn't translated.</Trans>
					</span>
				</div>
			)}

			<div className="grid gap-2">
				<span className="text-[13px] font-medium">
					<Trans>Margins</Trans>
				</span>
				<SegmentedControl
					aria-label={t`Margins`}
					value={margins ?? ""}
					onValueChange={(value) => write("margins", (draft) => applyMargins(draft, value as MarginId), true)}
					className="w-full"
				>
					<SegmentedControlItem value="narrow">
						<Trans>Narrow</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="normal">
						<Trans>Normal</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="wide">
						<Trans>Wide</Trans>
					</SegmentedControlItem>
				</SegmentedControl>
			</div>

			<div className="grid">
				<SwitchRow
					label={t`Icons in contact line`}
					description={t`Also shows the icons on skills, profiles and interests.`}
					checked={!page.hideIcons}
					onCheckedChange={(checked) =>
						write(
							"icons",
							(draft) => {
								draft.page.hideIcons = !checked;
							},
							true,
						)
					}
				/>
				<SwitchRow
					label={t`Underline links`}
					checked={!page.hideLinkUnderline}
					onCheckedChange={(checked) =>
						write(
							"underline",
							(draft) => {
								draft.page.hideLinkUnderline = !checked;
							},
							true,
						)
					}
				/>
			</div>
		</div>
	);
}
