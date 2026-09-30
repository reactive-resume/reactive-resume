import type { Style } from "../../forme/style-types";
import type { ResumeData, StyleIntent, StyleSlot } from "@reactive-resume/schema/resume/data";
import type { SectionStyleRuleContext } from "@reactive-resume/schema/resume/style-rules";
import { resolveStyleIntentForSlot } from "@reactive-resume/schema/resume/style-rules";
import { rgbaStringToHex } from "@reactive-resume/utils/color";

export type ResolveStyleRuleSlotOptions = SectionStyleRuleContext & {
	slot: StyleSlot;
};

const spacingProperties = [
	"padding",
	"paddingTop",
	"paddingRight",
	"paddingBottom",
	"paddingLeft",
	"marginTop",
	"marginRight",
	"marginBottom",
	"marginLeft",
	"rowGap",
	"columnGap",
	"borderWidth",
	"borderRadius",
] as const;

const colorProperties = ["color", "backgroundColor", "borderColor", "textDecorationColor"] as const;

const spacingPropertyRange = (property: (typeof spacingProperties)[number]) => {
	if (property === "borderWidth" || property === "borderRadius")
		return { min: 0, max: property === "borderWidth" ? 24 : 72 };

	return { min: -72, max: 72 };
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toPdfColor = (value: string) => {
	try {
		return rgbaStringToHex(value);
	} catch {
		return value;
	}
};

const toStyle = (intent: StyleIntent | undefined): Style => {
	if (!intent) return {};

	const style: Style = {};

	for (const property of colorProperties) {
		const value = intent[property];
		if (value) style[property] = toPdfColor(value);
	}

	if (intent.opacity !== undefined) style.opacity = clamp(intent.opacity, 0, 1);
	if (intent.fontSize !== undefined) style.fontSize = clamp(intent.fontSize, 6, 48);
	if (intent.fontWeight !== undefined) style.fontWeight = intent.fontWeight;
	if (intent.fontStyle !== undefined) style.fontStyle = intent.fontStyle;
	if (intent.lineHeight !== undefined) style.lineHeight = clamp(intent.lineHeight, 0.5, 4);
	if (intent.letterSpacing !== undefined) style.letterSpacing = clamp(intent.letterSpacing, -16, 16);
	if (intent.textDecoration !== undefined) style.textDecoration = intent.textDecoration;
	if (intent.textDecorationStyle !== undefined) style.textDecorationStyle = intent.textDecorationStyle;
	if (intent.textAlign !== undefined) style.textAlign = intent.textAlign;
	if (intent.textTransform !== undefined) style.textTransform = intent.textTransform;
	if (intent.borderStyle !== undefined) style.borderStyle = intent.borderStyle;

	for (const property of spacingProperties) {
		const value = intent[property];
		const range = spacingPropertyRange(property);
		if (value !== undefined) style[property] = clamp(value, range.min, range.max);
	}

	return style;
};

export const resolveStyleRuleSlot = (data: ResumeData, options: ResolveStyleRuleSlotOptions): Style => {
	return toStyle(resolveStyleIntentForSlot(data, options));
};
