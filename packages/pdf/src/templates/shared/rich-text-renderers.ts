import type { Style } from "../../forme/style-types";
import type { ReactElement, ReactNode } from "react";
import { cloneElement, createElement } from "react";
import { Text as PdfText, View } from "#react-pdf-renderer";
import {
	getRichTextEdgeTrimStyle,
	isRichTextElementInsideListItem,
	stripRichTextVerticalMargins,
} from "./rich-text-spacing";
import { safeTextStyle } from "./safe-text-style";
import { composeStyles, mergeStyles } from "./styles";

export const toRichTextStyleArray = (style: Style | Style[] | undefined): Style[] => {
	if (!style) return [];
	if (Array.isArray(style)) return style.filter(Boolean);

	return [style];
};

type RichTextParagraphRendererProps = {
	children: ReactNode;
	element: Parameters<typeof isRichTextElementInsideListItem>[0];
	style: Style | Style[] | undefined;
	semanticStyle?: Style | Style[] | undefined;
	rtl?: boolean;
	indent?: number;
	rtlTextWrapStyle?: Style | undefined;
	applyRtlDirection?: (node: ReactNode) => ReactNode;
	textProps?: Record<string, unknown>;
};

export const renderRichTextParagraph = ({
	element,
	style,
	semanticStyle,
	children,
	rtl,
	indent,
	rtlTextWrapStyle,
	applyRtlDirection,
	textProps,
}: RichTextParagraphRendererProps) => {
	const paragraphStyles = isRichTextElementInsideListItem(element)
		? toRichTextStyleArray(style).map(stripRichTextVerticalMargins)
		: style;

	const composedStyle = composeStyles(
		paragraphStyles,
		getRichTextEdgeTrimStyle(element),
		rtl ? rtlTextWrapStyle : undefined,
		semanticStyle,
		safeTextStyle,
	);

	const content = rtl && applyRtlDirection ? applyRtlDirection(children) : children;

	// Renderer Text also accepts SVG props; this instance uses paragraph styles.
	const paragraph = createElement(PdfText, { ...textProps, style: composedStyle }, content) as ReactElement<{
		style: Style[];
	}>;
	return indent && !isRichTextElementInsideListItem(element) ? renderWithBoundedIndent(paragraph, rtl) : paragraph;
};

/** Keep at least half the available width for text, even inside narrow sidebars.
 * Flex resolves the inset against its actual parent rather than the page width. */
export const renderWithBoundedIndent = (node: ReactElement<{ style?: Style | Style[] | undefined }>, rtl = false) => {
	const side = rtl ? "marginRight" : "marginLeft";
	const rawOffset = mergeStyles(node.props.style)[side];
	const offset =
		typeof rawOffset === "string" && /^\d+(?:\.\d+)?pt$/.test(rawOffset) ? Number.parseFloat(rawOffset) : rawOffset;
	if (typeof offset !== "number" || !Number.isFinite(offset) || offset <= 0) return node;

	// Forme 0.25 ignores `maxWidth` along a row, so the inset shrinks instead, down to what half the width leaves
	// it; and it lays `row-reverse` out as `row`, so RTL puts the inset last.
	const inset = createElement(View, { key: "inset", style: { flexBasis: offset, flexShrink: 1 } });
	const content = cloneElement(node, {
		key: "content",
		style: composeStyles(node.props.style, { [side]: 0, flexBasis: "50%", flexGrow: 1, flexShrink: 0 }),
	});
	return createElement(
		View,
		{ style: { flexDirection: "row", alignSelf: "stretch" } },
		...(rtl ? [content, inset] : [inset, content]),
	);
};
