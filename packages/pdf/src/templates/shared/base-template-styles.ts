import type { Style } from "../../forme/style-types";
import type { getTemplateMetrics } from "./metrics";
import type { createRtlStyleHelpers } from "./rtl";
import type { Picture, ResumeData } from "@reactive-resume/schema/resume/data";
import { resolveBoldFontWeight } from "@reactive-resume/fonts";
import { rgbaStringToHex } from "@reactive-resume/utils/color";

type BaseTemplateStylesInput = {
	metadata: ResumeData["metadata"];
	foreground: string;
	background: string;
	r: ReturnType<typeof createRtlStyleHelpers>;
	metrics: ReturnType<typeof getTemplateMetrics>;
	picture: Picture;
};

/**
 * Returns the ~20 byte-identical style slots shared by every template as plain objects.
 * Each template spreads the result into its own StyleSheet.create() call and overrides only
 * the slots that differ (heading fontWeight, bold fallback, inline gap, picture extras, etc.).
 *
 * ponytail: factory returns plain objects, not StyleSheet.create'd; each template does one
 * StyleSheet.create pass so the final resolved styles are identical to before.
 */
export function createBaseTemplateStyles({
	metadata,
	foreground,
	background,
	r,
	metrics,
	picture,
}: BaseTemplateStylesInput) {
	const bodyText = {
		fontFamily: metadata.typography.body.fontFamily,
		fontSize: metadata.typography.body.fontSize,
		fontWeight: metadata.typography.body.fontWeights[0] ?? "400",
		lineHeight: metadata.typography.body.lineHeight,
		color: foreground,
		...r.text,
	} satisfies Style;

	return {
		page: {
			color: foreground,
			backgroundColor: background,
			fontFamily: metadata.typography.body.fontFamily,
			fontSize: metadata.typography.body.fontSize,
			lineHeight: metadata.typography.body.lineHeight,
			direction: r.pageDirection,
		} satisfies Style,

		/** The canonical body text style; alias for `text` in StyleSheet slots. */
		text: bodyText,

		heading: {
			fontFamily: metadata.typography.heading.fontFamily,
			fontSize: metadata.typography.heading.fontSize,
			/** Default fallback "600". bronzor uses fontWeights[0]??"500"; scizor uses .at(-1)??"700". */
			fontWeight: metadata.typography.heading.fontWeights.at(-1) ?? "600",
			lineHeight: metadata.typography.heading.lineHeight,
			color: foreground,
			...r.text,
		} satisfies Style,

		div: {
			rowGap: metrics.gapY(0.125),
			columnGap: metrics.gapX(1 / 3),
		} satisfies Style,

		/** Default gap = gapX(1/3). chikorita overrides to gapX(0.25). */
		inline: {
			flexDirection: r.row,
			alignItems: "center",
			columnGap: metrics.gapX(1 / 3),
		} satisfies Style,

		link: {
			textDecoration: "none",
			color: foreground,
		} satisfies Style,

		small: {
			fontSize: metadata.typography.body.fontSize * 0.875,
		} satisfies Style,

		/** True Bold face when the family has one (#3310); falls back to the last stored weight. scizor overrides color only. */
		bold: {
			fontWeight:
				resolveBoldFontWeight(metadata.typography.body.fontFamily, metadata.typography.body.fontWeights) ??
				metadata.typography.body.fontWeights.at(-1) ??
				"600",
		} satisfies Style,

		richParagraph: {
			margin: 0,
			...bodyText,
		} satisfies Style,

		richListItemRow: {
			// Stays `row` for both LTR and RTL; the <li> renderer swaps DOM order for RTL.
			flexDirection: "row",
			columnGap: metrics.gapX(1 / 3),
			alignItems: "flex-start",
		} satisfies Style,

		richListItemMarker: {
			// bodyText spread first so `textAlign` below isn't clobbered by bodyText.textAlign.
			...bodyText,
			width: metadata.typography.body.fontSize,
			textAlign: r.listMarkerTextAlign,
			alignSelf: "stretch",
			flex: "initial",
		} satisfies Style,

		richListItemContent: {
			...bodyText,
			flex: 1,
			minWidth: 0,
		} satisfies Style,

		splitRow: {
			flexDirection: r.row,
			flexWrap: "wrap",
			alignItems: "flex-start",
			justifyContent: "space-between",
			columnGap: metrics.gapX(2 / 3),
		} satisfies Style,

		alignEnd: { ...r.alignEnd } satisfies Style,

		/**
		 * Standard picture style shared by every template but ditto.
		 * ditto overrides: spread this and add `position: "absolute"`, `top`, `left`, `marginLeft`.
		 */
		picture: {
			width: picture.size,
			height: picture.size / picture.aspectRatio,
			objectFit: picture.fit,
			aspectRatio: picture.aspectRatio,
			borderRadius: picture.borderRadius,
			borderColor: rgbaStringToHex(picture.borderColor),
			borderWidth: picture.borderWidth,
			shadowColor: rgbaStringToHex(picture.shadowColor),
			shadowWidth: picture.shadowWidth,
			transform: `rotate(${picture.rotation}deg)`,
		},
	};
}
