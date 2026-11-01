import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { WritableDraft } from "immer";
import { msg } from "@lingui/core/macro";
import { contrastOnWhite } from "@reactive-resume/utils/color";

type Data = ResumeData | WritableDraft<ResumeData>;
/** The design a resume and a letter share. */
type Metadata = Pick<Data["metadata"], "typography" | "design" | "page">;

/**
 * Five traditional resume faces, set in Regular and Bold. Families that aren't a pairing leave the control with no
 * selection; any other font is chosen in Advanced.
 */
export const FONT_PAIRINGS = [
	{ id: "classic", label: msg`Classic`, heading: "EB Garamond", body: "EB Garamond", headingWeight: "600" },
	{ id: "traditional", label: msg`Traditional`, heading: "Tinos", body: "Tinos", headingWeight: "700" },
	{ id: "balanced", label: msg`Balanced`, heading: "Source Serif 4", body: "Source Sans 3", headingWeight: "600" },
	{ id: "professional", label: msg`Professional`, heading: "Carlito", body: "Carlito", headingWeight: "700" },
	{ id: "clean", label: msg`Clean`, heading: "Lato", body: "Lato", headingWeight: "700" },
] as const;

export type FontPairingId = (typeof FONT_PAIRINGS)[number]["id"];

export function matchFontPairing(metadata: Pick<Metadata, "typography">): FontPairingId | null {
	const { heading, body } = metadata.typography;
	return (
		FONT_PAIRINGS.find((pairing) => pairing.heading === heading.fontFamily && pairing.body === body.fontFamily)?.id ??
		null
	);
}

export function applyFontPairing(metadata: WritableDraft<Metadata>, id: FontPairingId) {
	const pairing = FONT_PAIRINGS.find((candidate) => candidate.id === id);
	if (!pairing) return;
	metadata.typography.heading.fontFamily = pairing.heading;
	metadata.typography.heading.fontWeights = [pairing.headingWeight];
	metadata.typography.body.fontFamily = pairing.body;
	metadata.typography.body.fontWeights = ["400", "700"];
}

/**
 * Density sets the body line height and the gap between entries. "Normal" is today's default, so resumes
 * saved before the redesign show as Normal; the others follow the spec's proportions around it.
 */
const DENSITIES = {
	compact: { lineHeight: 1.35, gapY: 4 },
	normal: { lineHeight: 1.5, gapY: 6 },
	roomy: { lineHeight: 1.65, gapY: 8 },
} as const;

export type DensityId = keyof typeof DENSITIES;

export function matchDensity(metadata: Metadata): DensityId | null {
	const lineHeight = metadata.typography.body.lineHeight;
	const gapY = metadata.page.gapY;
	const match = Object.entries(DENSITIES).find(([, value]) => value.lineHeight === lineHeight && value.gapY === gapY);
	return (match?.[0] as DensityId | undefined) ?? null;
}

export function applyDensity(metadata: WritableDraft<Metadata>, id: DensityId) {
	metadata.typography.body.lineHeight = DENSITIES[id].lineHeight;
	metadata.page.gapY = DENSITIES[id].gapY;
}

/** Page margins in points. "Normal" is today's default; Narrow and Wide scale it by the spec's 30/44/60. */
const MARGINS = {
	narrow: { marginX: 10, marginY: 8 },
	normal: { marginX: 14, marginY: 12 },
	wide: { marginX: 19, marginY: 16 },
} as const;

export type MarginId = keyof typeof MARGINS;

export function matchMargins(metadata: Metadata): MarginId | null {
	const { marginX, marginY } = metadata.page;
	const match = Object.entries(MARGINS).find(([, value]) => value.marginX === marginX && value.marginY === marginY);
	return (match?.[0] as MarginId | undefined) ?? null;
}

export function applyMargins(metadata: WritableDraft<Metadata>, id: MarginId) {
	metadata.page.marginX = MARGINS[id].marginX;
	metadata.page.marginY = MARGINS[id].marginY;
}

export const TEXT_SIZE = { min: 9, max: 12.5, step: 0.5 } as const;

/** Sets the body size and scales the heading with it, keeping their ratio. */
export function applyTextSize(metadata: WritableDraft<Metadata>, size: number) {
	const { body, heading } = metadata.typography;
	const ratio = body.fontSize > 0 ? heading.fontSize / body.fontSize : 1.4;
	body.fontSize = size;
	heading.fontSize = Math.round(size * ratio * 2) / 2;
}

/** Eight accents, all readable on white. */
export const ACCENTS = [
	{ label: msg`Moss`, hex: "#3E6B4F" },
	{ label: msg`Ink blue`, hex: "#2F5A8A" },
	{ label: msg`Teal`, hex: "#1F6E73" },
	{ label: msg`Plum`, hex: "#6B3E6E" },
	{ label: msg`Rust`, hex: "#A0442A" },
	{ label: msg`Burgundy`, hex: "#8A2C3F" },
	{ label: msg`Ochre`, hex: "#7A5A12" },
	{ label: msg`Graphite`, hex: "#3B3F45" },
] as const;

const HEX = /^#?([0-9a-f]{6})$/i;

export const hexToRgba = (hex: string) => {
	const value = Number.parseInt(HEX.exec(hex)?.[1] ?? "000000", 16);
	return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, 1)`;
};

/** The hex of an `rgba(r, g, b, a)` colour (alpha ignored), or null if it isn't one. */
export function rgbaToHex(color: string): string | null {
	const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
	if (!match) return HEX.test(color) ? `#${HEX.exec(color)?.[1]?.toUpperCase()}` : null;
	return `#${match
		.slice(1, 4)
		.map((channel) => Number(channel).toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase()}`;
}

export const isValidHex = (hex: string) => HEX.test(hex.trim());

/** The same hue, darkened step by step until it reads on white (at least 4.6:1). */
export function darkenForWhite(hex: string): string {
	const value = Number.parseInt(HEX.exec(hex)?.[1] ?? "000000", 16);
	let channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
	for (let step = 0; step < 40; step++) {
		const candidate =
			`#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
		if (contrastOnWhite(candidate) >= 4.6) return candidate;
		channels = channels.map((channel) => channel * 0.93);
	}
	return "#333333";
}

export type FitState = { density: DensityId | null; margins: MarginId | null; size: number };
export type FitStep = { density: DensityId } | { margins: MarginId } | { size: number };

const tighter = <T extends string>(order: readonly T[], current: T | null): T | null => {
	const index = current === null ? -1 : order.indexOf(current);
	const next = index === -1 ? order.at(-1) : order[index + 1];
	return next && next !== current ? next : null;
};

/**
 * The next step of Fit to one page: density first, then margins, then the text size in 0.5 pt steps, never
 * below 9 pt. Null means there is nothing left to tighten.
 */
export function nextFitStep(state: FitState): FitStep | null {
	const density = tighter(["roomy", "normal", "compact"] as const, state.density);
	if (density) return { density };
	const margins = tighter(["wide", "normal", "narrow"] as const, state.margins);
	if (margins) return { margins };
	if (state.size > TEXT_SIZE.min) return { size: Math.max(TEXT_SIZE.min, Math.round((state.size - 0.5) * 2) / 2) };
	return null;
}

/**
 * Runs Fit: applies steps until `measure` says the pages fit or nothing is left to tighten. `apply` sets a
 * step on the resume and `measure` resolves after the page has re-rendered.
 */
export async function fitToPages(
	initial: FitState,
	apply: (step: FitStep) => void,
	measure: () => Promise<boolean>,
): Promise<{ fits: boolean; state: FitState }> {
	let state = initial;
	for (let guard = 0; guard < 16; guard++) {
		if (await measure()) return { fits: true, state };
		const step = nextFitStep(state);
		if (!step) return { fits: false, state };
		apply(step);
		state = { ...state, ...step };
	}
	return { fits: false, state };
}
