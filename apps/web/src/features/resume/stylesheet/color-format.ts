import { hexToRgba, hslaStringToHsva, hsvaToRgbaString, rgbaStringToHsva } from "@uiw/color-convert";
import { parseColorString } from "@reactive-resume/utils/color";

// Literal names exposed by compiler-confirmed editor swatches. currentcolor stays contextual.
const namedColors: Readonly<Record<string, string>> = {
	aqua: "#00ffff",
	black: "#000000",
	blue: "#0000ff",
	fuchsia: "#ff00ff",
	gray: "#808080",
	green: "#008000",
	lime: "#00ff00",
	maroon: "#800000",
	navy: "#000080",
	olive: "#808000",
	orange: "#ffa500",
	purple: "#800080",
	red: "#ff0000",
	silver: "#c0c0c0",
	teal: "#008080",
	white: "#ffffff",
	yellow: "#ffff00",
};

// The shared picker consumes RGBA; keep stylesheet hex/HSL source intact until an edit.
export function toStylesheetPickerColor(value: string): string {
	const literal = value.replaceAll(/\/\*[\s\S]*?\*\//g, " ").trim();
	const normalized = namedColors[literal.toLowerCase()] ?? literal;
	if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(normalized)) {
		const hex =
			normalized.length <= 5
				? `#${Array.from(normalized.slice(1))
						.map((digit) => digit + digit)
						.join("")}`
				: normalized;
		const { r, g, b, a } = hexToRgba(hex);
		return `rgba(${r}, ${g}, ${b}, ${a})`;
	}
	if (/^hsla?\(/i.test(normalized)) return hsvaToRgbaString(hslaStringToHsva(normalized));
	if (/^rgba?\(/i.test(normalized)) return hsvaToRgbaString(rgbaStringToHsva(normalized));
	if (normalized.toLowerCase() === "transparent") return "rgba(0, 0, 0, 0)";
	return normalized;
}

export function serializeStylesheetColor(value: string): string | null {
	const color = parseColorString(value);
	if (!color) return null;
	const { r, g, b, a } = color;
	if (
		![r, g, b, a].every(Number.isFinite) ||
		[r, g, b].some((channel) => channel < 0 || channel > 255) ||
		a < 0 ||
		a > 1
	)
		return null;
	const byte = (channel: number) =>
		Math.round(Math.max(0, Math.min(255, channel)))
			.toString(16)
			.padStart(2, "0");
	return `#${byte(r)}${byte(g)}${byte(b)}${a < 1 ? byte(a * 255) : ""}`;
}
