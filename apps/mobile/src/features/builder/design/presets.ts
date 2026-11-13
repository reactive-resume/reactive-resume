// Design presets, ported from apps/web/src/features/resume/editor/design/presets.ts (logic only): font pairings,
// density, margins, text size, accents, and Fit to one page's steps.
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { WritableDraft } from "immer";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { contrastOnWhite } from "@reactive-resume/utils/color";

type Data = ResumeData | WritableDraft<ResumeData>;
type Metadata = Data["metadata"];

export const FONT_PAIRINGS = [
	{ id: "classic", label: () => t`Classic`, heading: "EB Garamond", body: "EB Garamond", headingWeight: "600" },
	{ id: "traditional", label: () => t`Traditional`, heading: "Tinos", body: "Tinos", headingWeight: "700" },
	{ id: "balanced", label: () => t`Balanced`, heading: "Source Serif 4", body: "Source Sans 3", headingWeight: "600" },
	{ id: "professional", label: () => t`Professional`, heading: "Carlito", body: "Carlito", headingWeight: "700" },
	{ id: "clean", label: () => t`Clean`, heading: "Lato", body: "Lato", headingWeight: "700" },
] as const;
export type FontPairingId = (typeof FONT_PAIRINGS)[number]["id"];

export const matchFontPairing = (m: Pick<Metadata, "typography">) =>
	FONT_PAIRINGS.find((p) => p.heading === m.typography.heading.fontFamily && p.body === m.typography.body.fontFamily) ??
	null;

export function applyFontPairing(m: WritableDraft<Metadata>, id: FontPairingId) {
	const pairing = FONT_PAIRINGS.find((p) => p.id === id);
	if (!pairing) return;
	m.typography.heading.fontFamily = pairing.heading;
	m.typography.heading.fontWeights = [pairing.headingWeight];
	m.typography.body.fontFamily = pairing.body;
	m.typography.body.fontWeights = ["400", "700"];
}

export const DENSITIES = {
	compact: { lineHeight: 1.35, gapY: 4, label: () => t`Compact` },
	normal: { lineHeight: 1.5, gapY: 6, label: () => t`Normal` },
	roomy: { lineHeight: 1.65, gapY: 8, label: () => t`Roomy` },
} as const;
export type DensityId = keyof typeof DENSITIES;
export const matchDensity = (m: Metadata): DensityId | null =>
	(Object.entries(DENSITIES).find(
		([, v]) => v.lineHeight === m.typography.body.lineHeight && v.gapY === m.page.gapY,
	)?.[0] as DensityId | undefined) ?? null;
export function applyDensity(m: WritableDraft<Metadata>, id: DensityId) {
	m.typography.body.lineHeight = DENSITIES[id].lineHeight;
	m.page.gapY = DENSITIES[id].gapY;
}

export const MARGINS = {
	narrow: { marginX: 10, marginY: 8, label: () => t`Narrow`, value: () => t`narrow margins` },
	normal: { marginX: 14, marginY: 12, label: () => t`Normal`, value: () => t`normal margins` },
	wide: { marginX: 19, marginY: 16, label: () => t`Wide`, value: () => t`wide margins` },
} as const;
export type MarginId = keyof typeof MARGINS;
export const matchMargins = (m: Metadata): MarginId | null =>
	(Object.entries(MARGINS).find(([, v]) => v.marginX === m.page.marginX && v.marginY === m.page.marginY)?.[0] as
		| MarginId
		| undefined) ?? null;
export function applyMargins(m: WritableDraft<Metadata>, id: MarginId) {
	m.page.marginX = MARGINS[id].marginX;
	m.page.marginY = MARGINS[id].marginY;
}

export const TEXT_SIZE = { min: 9, max: 12.5, step: 0.5 } as const;
export function applyTextSize(m: WritableDraft<Metadata>, size: number) {
	const { body, heading } = m.typography;
	const ratio = body.fontSize > 0 ? heading.fontSize / body.fontSize : 1.4;
	body.fontSize = size;
	heading.fontSize = Math.round(size * ratio * 2) / 2;
}

export const PAPER = {
	a4: () => t`A4`,
	letter: () => t`Letter`,
	"free-form": () => t`Free-form`,
} as const;

/** Eight accents, all readable on white. Names are the swatches' accessibility labels. */
export const ACCENTS = [
	{ label: () => t`Moss`, hex: "#3E6B4F" },
	{ label: () => t`Ink blue`, hex: "#2F5A8A" },
	{ label: () => t`Teal`, hex: "#1F6E73" },
	{ label: () => t`Plum`, hex: "#6B3E6E" },
	{ label: () => t`Rust`, hex: "#A0442A" },
	{ label: () => t`Burgundy`, hex: "#8A2C3F" },
	{ label: () => t`Ochre`, hex: "#7A5A12" },
	{ label: () => t`Graphite`, hex: "#3B3F45" },
] as const;

const HEX = /^#?([0-9a-f]{6})$/i;
export const hexToRgba = (hex: string) => {
	const value = Number.parseInt(HEX.exec(hex)?.[1] ?? "000000", 16);
	return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, 1)`;
};
export function rgbaToHex(color: string): string | null {
	const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
	if (!match) return HEX.test(color) ? `#${HEX.exec(color)?.[1]?.toUpperCase()}` : null;
	return `#${match
		.slice(1, 4)
		.map((c) => Number(c).toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase()}`;
}
export function normalizeHex(hex: string): string | null {
	const value = hex.trim().replace(/^#/, "");
	if (/^[0-9a-f]{6}$/i.test(value)) return `#${value.toUpperCase()}`;
	if (/^[0-9a-f]{3}$/i.test(value))
		return `#${[...value]
			.map((d) => d + d)
			.join("")
			.toUpperCase()}`;
	return null;
}
export function darkenForWhite(hex: string): string {
	const value = Number.parseInt(HEX.exec(hex)?.[1] ?? "000000", 16);
	let channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
	for (let step = 0; step < 40; step++) {
		const candidate = `#${channels.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
		if (contrastOnWhite(candidate) >= 4.6) return candidate;
		channels = channels.map((c) => c * 0.93);
	}
	return "#333333";
}
export { contrastOnWhite };

/** The accent's name, or its hex for a custom colour. */
export function accentName(primary: string): { name: string; hex: string | null } {
	const hex = rgbaToHex(primary);
	const preset = ACCENTS.find((a) => a.hex === hex);
	return { name: preset ? preset.label() : (hex ?? primary), hex };
}

export type FitState = { density: DensityId | null; margins: MarginId | null; size: number };
export type FitStep = { density: DensityId } | { margins: MarginId } | { size: number };
const tighter = <T extends string>(order: readonly T[], current: T | null): T | null => {
	const index = current === null ? -1 : order.indexOf(current);
	const next = index === -1 ? order.at(-1) : order[index + 1];
	return next && next !== current ? next : null;
};
/** Density first, then margins, then the text size in 0.5 pt steps, never below 9 pt. */
export function nextFitStep(state: FitState): FitStep | null {
	const density = tighter(["roomy", "normal", "compact"] as const, state.density);
	if (density) return { density };
	const margins = tighter(["wide", "normal", "narrow"] as const, state.margins);
	if (margins) return { margins };
	if (state.size > TEXT_SIZE.min) return { size: Math.max(TEXT_SIZE.min, Math.round((state.size - 0.5) * 2) / 2) };
	return null;
}
export function applyFitStep(m: WritableDraft<Metadata>, step: FitStep) {
	if ("density" in step) applyDensity(m, step.density);
	else if ("margins" in step) applyMargins(m, step.margins);
	else applyTextSize(m, step.size);
}

/** "10.5 pt" in the app's number format. */
export const points = (size: number) => t`${i18n.number(size)} pt`;
