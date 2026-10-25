// Port of apps/web/src/features/resume/editor/design/presets.ts and the Advanced option lists. Pure: no React.
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { DateFormat } from "@reactive-resume/schema/resume/dates";
import type { Template } from "@reactive-resume/schema/templates";
import type { WritableDraft } from "immer";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { templateLayouts, templateSchema } from "@reactive-resume/schema/templates";
import { contrastOnWhite } from "@reactive-resume/utils/color";

type Metadata = ResumeData["metadata"];

/** Five traditional resume faces. Families that aren't a pairing leave the control with no selection. */
export const FONT_PAIRINGS = [
	{ id: "classic", heading: "EB Garamond", body: "EB Garamond", headingWeight: "600" },
	{ id: "traditional", heading: "Tinos", body: "Tinos", headingWeight: "700" },
	{ id: "balanced", heading: "Source Serif 4", body: "Source Sans 3", headingWeight: "600" },
	{ id: "professional", heading: "Carlito", body: "Carlito", headingWeight: "700" },
	{ id: "clean", heading: "Lato", body: "Lato", headingWeight: "700" },
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

/** Density sets the body line height and the gap between entries. Same values as web and the page's Fit. */
const DENSITIES = {
	compact: { lineHeight: 1.35, gapY: 4 },
	normal: { lineHeight: 1.5, gapY: 6 },
	roomy: { lineHeight: 1.65, gapY: 8 },
} as const;

export type DensityId = keyof typeof DENSITIES;

export function matchDensity(metadata: Metadata): DensityId | null {
	const { lineHeight } = metadata.typography.body;
	const { gapY } = metadata.page;
	const match = Object.entries(DENSITIES).find(([, value]) => value.lineHeight === lineHeight && value.gapY === gapY);
	return (match?.[0] as DensityId | undefined) ?? null;
}

export function applyDensity(metadata: WritableDraft<Metadata>, id: DensityId) {
	metadata.typography.body.lineHeight = DENSITIES[id].lineHeight;
	metadata.page.gapY = DENSITIES[id].gapY;
}

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

/** Sets the body size and scales the heading with it, keeping their ratio within the schema's 6–24pt bounds. */
export function applyTextSize(metadata: WritableDraft<Pick<Metadata, "typography">>, size: number) {
	const { body, heading } = metadata.typography;
	const ratio = body.fontSize > 0 ? heading.fontSize / body.fontSize : 1.4;
	body.fontSize = size;
	heading.fontSize = Math.min(24, Math.max(6, Math.round(size * ratio * 2) / 2));
}

/** Eight accents, all readable on white. Hex values are resume colours, not app tokens; names live with the UI. */
export const ACCENTS = [
	"#3E6B4F",
	"#2F5A8A",
	"#1F6E73",
	"#6B3E6E",
	"#A0442A",
	"#8A2C3F",
	"#7A5A12",
	"#3B3F45",
] as const;

const HEX = /^#?([0-9a-f]{6})$/i;

export const hexToRgba = (hex: string) => {
	const value = Number.parseInt(HEX.exec(hex.trim())?.[1] ?? "000000", 16);
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

type Rgba = { r: number; g: number; b: number; a: number };

/** `rgb(a)(…)` with channels 0–255 and alpha 0–1, else null. */
function parseRgba(value: string): Rgba | null {
	const match = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i.exec(value.trim());
	if (!match) return null;
	const [r, g, b] = match.slice(1, 4).map(Number) as [number, number, number];
	const a = match[4] === undefined ? 1 : Number(match[4]);
	return [r, g, b].every((channel) => channel <= 255) && a <= 1 ? { r, g, b, a } : null;
}

const toRgba = ({ r, g, b, a }: Rgba) => `rgba(${r}, ${g}, ${b}, ${a})`;

/** Typed colour text as a canonical `rgba(r, g, b, a)`: hex with or without #, or rgb(a) in range. Else null. */
export function parseColorInput(text: string): string | null {
	const value = text.trim();
	if (isValidHex(value)) return hexToRgba(value);
	const rgba = parseRgba(value);
	return rgba ? toRgba(rgba) : null;
}

const toRgb = (color: string): Rgba | null =>
	parseRgba(color) ?? (isValidHex(color) ? parseRgba(hexToRgba(color)) : null);
const over = (top: Rgba, bottom: Rgba): Rgba => ({
	r: top.r * top.a + bottom.r * (1 - top.a),
	g: top.g * top.a + bottom.g * (1 - top.a),
	b: top.b * top.a + bottom.b * (1 - top.a),
	a: 1,
});
const linear = (channel: number) => {
	const value = channel / 255;
	return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const luminance = ({ r, g, b }: Rgba) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/**
 * WCAG contrast of `color` as it prints on `background`: the background is laid over white paper and the colour
 * over the background, so transparency counts. 1 when either can't be read.
 */
export function contrastOver(color: string, background = "#FFFFFF"): number {
	const white = { r: 255, g: 255, b: 255, a: 1 };
	const top = toRgb(color);
	const bottom = toRgb(background);
	if (!top || !bottom) return 1;
	const paper = over(bottom, white);
	const [light, dark] = [luminance(paper), luminance(over(top, paper))].sort((x, y) => y - x) as [number, number];
	return (light + 0.05) / (dark + 0.05);
}

/** Below this the Color group warns (WCAG AA for normal text). */
export const MIN_CONTRAST = 4.5;

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

/** Example labels are dates, not words, so they need no translation. */
export const DATE_FORMATS: { value: DateFormat; label: string }[] = [
	{ value: "short", label: "Mar 2022" },
	{ value: "long", label: "March 2022" },
	{ value: "numeric", label: "03/2022" },
	{ value: "iso", label: "2022-03" },
];

/**
 * Reset design defaults: typography, design, sidebar width and the look's page values. Paper, language, date
 * format, section placement and custom CSS are the user's, not the look's; they stay.
 */
export function resetDesign(metadata: WritableDraft<Metadata>) {
	const defaults = defaultResumeData.metadata;
	metadata.typography = structuredClone(defaults.typography);
	metadata.design = structuredClone(defaults.design);
	metadata.layout.sidebarWidth = defaults.layout.sidebarWidth;
	const { gapX, gapY, marginX, marginY, hideIcons, hideLinkUnderline, hideSectionIcons } = defaults.page;
	Object.assign(metadata.page, { gapX, gapY, marginX, marginY, hideIcons, hideLinkUnderline, hideSectionIcons });
}

export type TemplateFilter = "all" | "one" | "two" | "ats";

export const TEMPLATES: readonly Template[] = templateSchema.options;

export const templateName = (id: Template) => id.charAt(0).toUpperCase() + id.slice(1);

export function matchesFilter(id: Template, filter: TemplateFilter) {
	const layout = templateLayouts[id];
	if (filter === "one") return layout.columns === 1;
	if (filter === "two") return layout.columns === 2;
	if (filter === "ats") return layout.atsSafe;
	return true;
}
