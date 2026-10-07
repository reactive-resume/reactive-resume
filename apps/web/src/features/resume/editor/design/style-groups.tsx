import type { DensityId, FontPairingId, MarginId } from "./presets";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { WritableDraft } from "immer";
import type { CSSProperties } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { createContext, useContext, useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Slider } from "@reactive-resume/ui/components/slider";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { contrastOnWhite } from "@reactive-resume/utils/color";
import { cn } from "@reactive-resume/utils/style";
import {
	ACCENTS,
	applyDensity,
	applyFontPairing,
	applyMargins,
	applyTextSize,
	darkenForWhite,
	FONT_PAIRINGS,
	hexToRgba,
	isValidHex,
	matchDensity,
	matchFontPairing,
	matchMargins,
	rgbaToHex,
	TEXT_SIZE,
} from "./presets";
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

function useDesign(): DesignSource {
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
							<span className="text-sm font-medium">{option.label}</span>
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
						<Icon name="arrow_downward" size={18} className="ms-auto text-ink-3" />
					</button>
				)}
			</div>

			<div className="grid gap-2">
				<div className="flex items-center justify-between text-[13px]">
					<span id={sizeLabelId} className="font-medium">
						<Trans>Text size</Trans>
					</span>
					<span className="font-mono text-xs text-ink-2">{size} pt</span>
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
	const { metadata, write } = useDesign();
	const current = metadata ? (rgbaToHex(metadata.design.colors.primary) ?? "#000000") : "#000000";
	const [typed, setTyped] = useState<string | null>(null);
	if (!metadata) return null;

	const hex = typed ?? current;
	const valid = isValidHex(hex);
	const normalized = valid ? `#${hex.replace("#", "").toUpperCase()}` : current;
	const ratio = contrastOnWhite(normalized);
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
			<RadioGroup
				aria-label={t`Accent colour`}
				value={ACCENTS.some((accent) => accent.hex === current) ? current : null}
				onValueChange={(value) => {
					setTyped(null);
					setAccent(value as string);
				}}
				// Touch: 48px swatches, four to a row.
				className="grid grid-cols-8 gap-1.5 pointer-coarse:grid-cols-[repeat(4,3rem)] pointer-coarse:justify-between pointer-coarse:gap-y-3"
			>
				{ACCENTS.map((accent) => (
					<Radio.Root
						key={accent.hex}
						value={accent.hex}
						aria-label={accent.label}
						title={accent.label}
						className="aspect-square cursor-pointer rounded-full transition-[box-shadow,scale] duration-quick ease-enter active:scale-[0.97] data-checked:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--swatch)]"
						style={{ backgroundColor: accent.hex, "--swatch": accent.hex } as CSSProperties}
					/>
				))}
			</RadioGroup>

			<div className="flex items-center gap-2">
				<span className="size-9 shrink-0 rounded-lg border border-line-2" style={{ backgroundColor: normalized }} />
				<Input
					aria-label={t`Custom colour (hex)`}
					value={hex}
					spellCheck={false}
					className="font-mono uppercase"
					onChange={(event) => {
						setTyped(event.target.value);
						if (isValidHex(event.target.value)) setAccent(`#${event.target.value.replace("#", "")}`, false);
					}}
					onBlur={() => setTyped(null)}
				/>
				<span className={cn("shrink-0 font-mono text-xs", tooLight ? "text-warn-text" : "text-ink-3")}>
					{ratio.toFixed(1)}:1
				</span>
			</div>

			{tooLight && (
				<div className="grid gap-2 rounded-lg bg-warn-soft p-3 text-[13px] leading-[19px] text-warn-text" role="status">
					<span className="flex gap-2">
						<Icon name="contrast" size={20} />
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

			<p className="text-xs leading-4 text-ink-3">
				<Trans>
					Accent is used for headings, icons and the header band. Body text stays near-black for print and ATS.
				</Trans>
			</p>
		</div>
	);
}

/** Page: paper, language (section titles and date words), margins, icons and link underlines. */
export function PageGroup() {
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
						<Trans>Letter</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="a4">A4</SegmentedControlItem>
					<SegmentedControlItem value="free-form">
						<Trans>Free-form</Trans>
					</SegmentedControlItem>
				</SegmentedControl>
			</div>

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
					<Trans>Changes section titles and date words only, not your content.</Trans>
				</span>
			</div>

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
