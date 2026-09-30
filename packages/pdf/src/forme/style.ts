import type { Style, StyleProp } from "./style-types";
import type { Style as FormeStyle } from "@formepdf/react";

/**
 * react-pdf-style objects (what templates and Semantic CSS produce) → Forme style objects.
 *
 * Forme's style model is close to react-pdf's; the differences handled here: numeric strings with units, absolute
 * line heights (Forme only takes a multiplier), font-weight keywords, font fallback arrays, named colours, and
 * properties Forme can't draw, which are dropped and reported.
 */

export type ConvertedStyle = {
	style: FormeStyle;
	/** Properties dropped because Forme has no equivalent. */
	dropped: string[];
	/** `display: none` — the element isn't drawn. */
	hidden: boolean;
};

export const flattenStyle = (style: StyleProp | undefined | null | false): Style => {
	if (!style) return {};
	if (!Array.isArray(style)) return style as Style;
	return (style as unknown[]).reduce<Style>((merged, entry) => {
		const flat = flattenStyle(entry as StyleProp);
		return Object.assign(merged, flat);
	}, {});
};

const DPI = 72;
const UNIT = /^(-?\d*\.?\d+)(pt|px|in|mm|cm|em|rem|vw|vh)?$/;

type Context = { fontSize: number; pageWidth?: number | undefined; pageHeight?: number | undefined };

/** A length in points, or the percentage string as is. `undefined` when it isn't a length. */
export function toPoints(value: unknown, context: Context): number | string | undefined {
	if (typeof value === "number") return value;
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed.endsWith("%")) return trimmed;
	const match = UNIT.exec(trimmed);
	if (!match) return undefined;
	const number = Number(match[1]);
	switch (match[2]) {
		case "in":
			return number * DPI;
		case "mm":
			return number * (DPI / 25.4);
		case "cm":
			return number * (DPI / 2.54);
		case "em":
		case "rem":
			return number * context.fontSize;
		case "vw":
			return context.pageWidth === undefined ? undefined : number * (context.pageWidth / 100);
		case "vh":
			return context.pageHeight === undefined ? undefined : number * (context.pageHeight / 100);
		default:
			return number;
	}
}

const FONT_WEIGHTS: Record<string, number> = {
	thin: 100,
	hairline: 100,
	ultralight: 200,
	extralight: 200,
	light: 300,
	normal: 400,
	regular: 400,
	medium: 500,
	semibold: 600,
	demibold: 600,
	bold: 700,
	ultrabold: 800,
	extrabold: 800,
	heavy: 900,
	black: 900,
};

const toFontWeight = (value: unknown): number | undefined => {
	if (typeof value === "number") return value;
	if (typeof value !== "string") return undefined;
	const numeric = Number(value);
	if (Number.isFinite(numeric)) return numeric;
	return FONT_WEIGHTS[value.toLowerCase()];
};

// CSS named colours Forme's parser doesn't know. Kept short: the ones templates and stylesheets use in practice.
const NAMED_COLORS: Record<string, string> = {
	transparent: "rgba(0, 0, 0, 0)",
	black: "#000000",
	white: "#ffffff",
	gray: "#808080",
	grey: "#808080",
	silver: "#c0c0c0",
	red: "#ff0000",
	maroon: "#800000",
	orange: "#ffa500",
	yellow: "#ffff00",
	olive: "#808000",
	lime: "#00ff00",
	green: "#008000",
	teal: "#008080",
	aqua: "#00ffff",
	cyan: "#00ffff",
	blue: "#0000ff",
	navy: "#000080",
	fuchsia: "#ff00ff",
	magenta: "#ff00ff",
	purple: "#800080",
	pink: "#ffc0cb",
	brown: "#a52a2a",
	gold: "#ffd700",
	indigo: "#4b0082",
	violet: "#ee82ee",
	crimson: "#dc143c",
	coral: "#ff7f50",
	salmon: "#fa8072",
	tomato: "#ff6347",
	khaki: "#f0e68c",
	beige: "#f5f5dc",
	ivory: "#fffff0",
	lavender: "#e6e6fa",
	turquoise: "#40e0d0",
	tan: "#d2b48c",
	chocolate: "#d2691e",
	darkgray: "#a9a9a9",
	darkgrey: "#a9a9a9",
	lightgray: "#d3d3d3",
	lightgrey: "#d3d3d3",
	dimgray: "#696969",
	dimgrey: "#696969",
	whitesmoke: "#f5f5f5",
	gainsboro: "#dcdcdc",
	darkblue: "#00008b",
	darkgreen: "#006400",
	darkred: "#8b0000",
	slategray: "#708090",
	slategrey: "#708090",
	steelblue: "#4682b4",
	royalblue: "#4169e1",
	skyblue: "#87ceeb",
	lightblue: "#add8e6",
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(/i;

/** A colour Forme can parse (hex or rgb/rgba), or `undefined` when it can't be read. */
export function toColor(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (HEX.test(trimmed)) {
		// Forme reads 3, 6 and 8 digits; spell out the 4-digit form.
		if (trimmed.length === 5) {
			const [r, g, b, a] = trimmed.slice(1);
			return `#${r}${r}${g}${g}${b}${b}${a}${a}`;
		}
		return trimmed;
	}
	if (RGB.test(trimmed)) {
		// Forme's parser wants rgba() to carry four numbers and rgb() three; normalise commas and percentages.
		const parts = trimmed
			.replace(/^rgba?\(|\)$/gi, "")
			.split(/[\s,/]+/)
			.filter(Boolean)
			.map((part, index) => {
				if (!part.endsWith("%")) return part;
				const percent = Number(part.slice(0, -1));
				return String(index < 3 ? (percent * 255) / 100 : percent / 100);
			});
		if (parts.length === 3) return `rgb(${parts.join(", ")})`;
		if (parts.length === 4) return `rgba(${parts.join(", ")})`;
		return undefined;
	}
	return NAMED_COLORS[trimmed.toLowerCase()];
}

export type Rgb = readonly [number, number, number];

export const WHITE: Rgb = [255, 255, 255];

/** Channels and alpha of a colour in a form `toColor` returns. */
export function parseColor(color: string): { rgb: Rgb; alpha: number } | undefined {
	if (HEX.test(color)) {
		const digits = color.slice(1);
		const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join("") : digits;
		const channel = (index: number) => Number.parseInt(full.slice(index * 2, index * 2 + 2), 16);
		return { rgb: [channel(0), channel(1), channel(2)], alpha: full.length === 8 ? channel(3) / 255 : 1 };
	}
	const match = /^rgba?\(([^)]*)\)$/i.exec(color);
	if (!match?.[1]) return undefined;
	const [r = 0, g = 0, b = 0, a = 1] = match[1].split(/\s*,\s*/).map(Number);
	return { rgb: [r, g, b], alpha: a };
}

const hex = (rgb: Rgb) =>
	`#${rgb
		.map((channel) =>
			Math.round(Math.min(255, Math.max(0, channel)))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

/**
 * Forme 0.25 paints translucent colours opaque, so each is mixed with what it's drawn over: its own background, the
 * nearest opaque background behind it, or the page. Exact on solid backdrops, which is where templates use them.
 * Returns the style and the backdrop its children are drawn over.
 */
export function flattenAlpha(style: FormeStyle, backdrop: Rgb): { style: FormeStyle; backdrop: Rgb } {
	const next: Record<string, unknown> = { ...style };
	const mix = (color: unknown, behind: Rgb) => {
		const parsed = typeof color === "string" ? parseColor(color) : undefined;
		if (!parsed || parsed.alpha >= 1) return { color, rgb: parsed?.rgb };
		const blend = (i: 0 | 1 | 2) => parsed.rgb[i] * parsed.alpha + behind[i] * (1 - parsed.alpha);
		const rgb: Rgb = [blend(0), blend(1), blend(2)];
		return { color: parsed.alpha <= 0 ? undefined : hex(rgb), rgb: parsed.alpha <= 0 ? undefined : rgb };
	};
	let own = backdrop;
	if (next.backgroundColor !== undefined) {
		const { color, rgb } = mix(next.backgroundColor, backdrop);
		if (color === undefined) delete next.backgroundColor;
		else next.backgroundColor = color;
		if (rgb) own = rgb;
	}
	for (const key of COLOR_KEYS) {
		if (key === "backgroundColor" || next[key] === undefined) continue;
		const { color } = mix(next[key], own);
		if (color === undefined) delete next[key];
		else next[key] = color;
	}
	return { style: next as FormeStyle, backdrop: own };
}

const COLOR_KEYS = new Set([
	"color",
	"backgroundColor",
	"borderColor",
	"borderTopColor",
	"borderRightColor",
	"borderBottomColor",
	"borderLeftColor",
]);

const LENGTH_KEYS = new Set([
	"width",
	"height",
	"minWidth",
	"minHeight",
	"maxWidth",
	"maxHeight",
	"flexBasis",
	"top",
	"right",
	"bottom",
	"left",
	"gap",
	"rowGap",
	"columnGap",
	"padding",
	"paddingTop",
	"paddingRight",
	"paddingBottom",
	"paddingLeft",
	"paddingHorizontal",
	"paddingVertical",
	"margin",
	"marginTop",
	"marginRight",
	"marginBottom",
	"marginLeft",
	"marginHorizontal",
	"marginVertical",
	"borderWidth",
	"borderTopWidth",
	"borderRightWidth",
	"borderBottomWidth",
	"borderLeftWidth",
	"borderRadius",
	"borderTopLeftRadius",
	"borderTopRightRadius",
	"borderBottomRightRadius",
	"borderBottomLeftRadius",
	"letterSpacing",
	"wordSpacing",
]);

const RADIUS_KEYS = new Set([
	"borderRadius",
	"borderTopLeftRadius",
	"borderTopRightRadius",
	"borderBottomRightRadius",
	"borderBottomLeftRadius",
]);

// Offsets in percent are placed by `to-forme.tsx`, which knows the element's parent.
const PERCENT_KEYS = new Set([
	"width",
	"height",
	"minWidth",
	"minHeight",
	"maxWidth",
	"maxHeight",
	"flexBasis",
	"left",
	"right",
]);

// Numbers Forme reads as react-pdf does.
// `aspectRatio` is read by `to-forme.tsx` for pictures, like `objectFit`.
const NUMBER_KEYS = new Set([
	"flex",
	"flexGrow",
	"flexShrink",
	"opacity",
	"minWidowLines",
	"minOrphanLines",
	"aspectRatio",
]);

// Keywords Forme reads as react-pdf does; anything else is reported.
const KEYWORD_KEYS: Record<string, ReadonlySet<string>> = {
	display: new Set(["flex", "grid"]),
	flexDirection: new Set(["row", "column", "row-reverse", "column-reverse"]),
	flexWrap: new Set(["nowrap", "wrap", "wrap-reverse"]),
	justifyContent: new Set(["flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly"]),
	alignItems: new Set(["flex-start", "flex-end", "center", "stretch", "baseline"]),
	alignSelf: new Set(["flex-start", "flex-end", "center", "stretch", "baseline"]),
	alignContent: new Set([
		"flex-start",
		"flex-end",
		"center",
		"space-between",
		"space-around",
		"space-evenly",
		"stretch",
	]),
	position: new Set(["relative", "absolute"]),
	fontStyle: new Set(["normal", "italic", "oblique"]),
	textAlign: new Set(["left", "center", "right", "justify"]),
	overflow: new Set(["visible", "hidden"]),
	direction: new Set(["ltr", "rtl", "auto"]),
	textOverflow: new Set(["wrap", "ellipsis", "clip"]),
	hyphens: new Set(["none", "manual", "auto"]),
	lineBreaking: new Set(["optimal", "greedy"]),
};

// Free-form strings Forme parses itself.
const STRING_KEYS = new Set(["transform", "transformOrigin", "lang", "objectFit"]);

// CSS-wide keywords: each asks for the default, which is what leaving the property out gives.
const CSS_WIDE = new Set(["initial", "inherit", "unset", "revert", "revert-layer"]);

// Keywords CSS allows that Forme spells differently.
const KEYWORD_ALIASES: Record<string, string> = { start: "flex-start", end: "flex-end", block: "flex" };

// Accepted without effect; they're layout hints Forme handles its own way.
const IGNORED = new Set([
	"shadowColor",
	"shadowWidth",
	"borderStyle",
	"borderTopStyle",
	"borderRightStyle",
	"borderBottomStyle",
	"borderLeftStyle",
]);

const TEXT_DECORATIONS = new Set(["none", "underline", "line-through"]);
const TEXT_TRANSFORMS = new Set(["none", "uppercase", "lowercase", "capitalize"]);

/** Converts one flattened react-pdf style for Forme. `context.fontSize` is the inherited size, for em and line height. */
export function toFormeStyle(input: Style, context: Context): ConvertedStyle {
	const style: Record<string, unknown> = {};
	const dropped: string[] = [];
	const source = input as Record<string, unknown>;
	const fontSize = toPoints(source.fontSize, context);
	const ownFontSize = typeof fontSize === "number" ? fontSize : context.fontSize;
	const local = { ...context, fontSize: ownFontSize };

	for (const [key, value] of Object.entries(source)) {
		if (value === undefined || value === null || value === "" || key.startsWith("@media")) continue;

		if (key === "display" && value === "none") continue;
		if (typeof value === "string" && CSS_WIDE.has(value.trim())) continue;
		if (key === "fontSize") {
			if (typeof fontSize === "number") style.fontSize = fontSize;
			continue;
		}
		if (key === "fontFamily") {
			const families = (Array.isArray(value) ? value : [value]).filter(
				(family): family is string => typeof family === "string" && family.length > 0,
			);
			// Forme names the standard serif "Times" where react-pdf and the font list say "Times-Roman".
			if (families.length > 0)
				style.fontFamily = families.map((family) => (family === "Times-Roman" ? "Times" : family)).join(", ");
			continue;
		}
		if (key === "fontWeight") {
			const weight = toFontWeight(value);
			if (weight === undefined) dropped.push(key);
			else style.fontWeight = weight;
			continue;
		}
		if (key === "lineHeight") {
			// Unitless is a multiplier, as in react-pdf; a length is absolute, and Forme wants the multiplier.
			if (typeof value === "number" || (typeof value === "string" && /^-?\d*\.?\d+$/.test(value.trim()))) {
				style.lineHeight = Number(value);
			} else if (typeof value === "string" && value.trim().endsWith("%")) {
				style.lineHeight = Number(value.trim().slice(0, -1)) / 100;
			} else {
				const points = toPoints(value, local);
				if (typeof points === "number" && ownFontSize > 0) style.lineHeight = points / ownFontSize;
				else dropped.push(key);
			}
			continue;
		}
		if (COLOR_KEYS.has(key)) {
			const color = toColor(value);
			if (color === undefined) dropped.push(key);
			else style[key] = color;
			continue;
		}
		if (LENGTH_KEYS.has(key)) {
			if (value === "auto") {
				// Auto margins push boxes apart; any other auto length is the default.
				if (key.startsWith("margin")) style[key] = "auto";
				continue;
			}
			// Shorthands with several values ("4 8") are expanded by Forme itself.
			if (typeof value === "string" && /\s/.test(value.trim())) {
				style[key] = value
					.trim()
					.split(/\s+/)
					.map((part) => toPoints(part, local))
					.join(" ");
				continue;
			}
			const points = toPoints(value, local);
			// Forme takes corner radii in points: a percentage one resolves against the box, when its size is known.
			if (typeof points === "string" && RADIUS_KEYS.has(key)) {
				const width = toPoints(source.width, local);
				const height = toPoints(source.height, local);
				if (typeof width === "number" && typeof height === "number") {
					style[key] = (Number.parseFloat(points) / 100) * Math.min(width, height);
					continue;
				}
			}
			// Forme takes percentages for box sizes only.
			if (points === undefined || (typeof points === "string" && !PERCENT_KEYS.has(key))) dropped.push(key);
			else style[key] = points;
			continue;
		}
		if (
			key === "border" ||
			key === "borderTop" ||
			key === "borderRight" ||
			key === "borderBottom" ||
			key === "borderLeft"
		) {
			style[key] = value;
			continue;
		}
		if (key === "textDecoration") {
			const decoration = String(value)
				.split(/\s+/)
				.find((part) => TEXT_DECORATIONS.has(part));
			if (decoration) style.textDecoration = decoration;
			continue;
		}
		if (key === "textTransform") {
			// react-pdf's `upperfirst` is closest to `capitalize` on a single word.
			const transform = value === "upperfirst" ? "capitalize" : value;
			if (TEXT_TRANSFORMS.has(String(transform))) style.textTransform = transform;
			else dropped.push(key);
			continue;
		}
		if (NUMBER_KEYS.has(key)) {
			const number = Number(value);
			if (Number.isFinite(number)) style[key] = number;
			else dropped.push(key);
			continue;
		}
		if (key === "alignSelf" && value === "auto") continue;
		const keywords = KEYWORD_KEYS[key];
		if (keywords) {
			const keyword = String(value).trim();
			const spelled = KEYWORD_ALIASES[keyword] ?? keyword;
			if (keywords.has(spelled)) style[key] = spelled;
			else dropped.push(key);
			continue;
		}
		if (key === "transform" && /rotate\(/.test(String(value))) {
			// Forme 0.25 moves a rotated box far from where CSS puts it (3° shifts it some 60pt), so rotation is left
			// out; a zero rotation is the default anyway.
			if (!/^\s*rotate\(\s*-?0*\.?0*(?:deg|rad|turn)?\s*\)\s*$/.test(String(value))) dropped.push(key);
			continue;
		}
		if (STRING_KEYS.has(key)) {
			style[key] = String(value);
			continue;
		}
		// Only solid borders are drawn; a dashed or dotted one is drawn solid, and said so.
		if (/^border(?:Top|Right|Bottom|Left)?Style$/.test(key) && value !== "solid") dropped.push(key);
		if (IGNORED.has(key)) continue;
		dropped.push(key);
	}

	return { style: style as FormeStyle, dropped, hidden: source.display === "none" };
}
