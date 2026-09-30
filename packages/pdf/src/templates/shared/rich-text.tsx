import type { Style } from "../../forme/style-types";
import type { ReactElement, ReactNode } from "react";
import { cloneElement, isValidElement } from "react";
import { View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { resolvedPdfFlowProps, resolvedPdfTextProps } from "../../semantic/adapter";
import {
	projectRenderedChildren,
	useResolvedNode,
	useSemanticNodeBindings,
	useSemanticNodeKey,
	useSemanticNodeVisible,
} from "../../semantic/context";
import { semanticNodeKeys } from "../../semantic/node-keys";
import { getRichTextSemanticNodeKey } from "../../semantic/rich-text-keys";
import { Html, Link as PdfLink, Text as PdfText } from "../../text";
import { useTemplateStyle } from "./context";
import {
	normalizeRichTextHtml,
	projectNormalizedRichTextHtml,
	richTextMarkClassName,
	richTextSemanticNodeKeyAttribute,
} from "./rich-text-html";
import { renderRichTextParagraph, renderWithBoundedIndent, toRichTextStyleArray } from "./rich-text-renderers";
import {
	createRichTextProseSpacing,
	getRichTextEdgeTrimStyle,
	isRichTextElementInsideOrderedList,
	resolveRichTextBodyLineHeight,
	stripRichTextVerticalMargins,
} from "./rich-text-spacing";
import { createRichTextStylesheet } from "./rich-text-stylesheet";
import { safeTextStyle } from "./safe-text-style";
import { composeStyles } from "./styles";

const richListItemContentStackStyle = {
	flexDirection: "column",
} satisfies Style;

type RichTextProps = {
	children: string;
	semanticField?: string | undefined;
};

// react-pdf textkit reads BiDi base direction from each run's own `direction` attribute
// (default "ltr"), and react-pdf-html buckets inline content into styleless inner <Text>
// frames — so the rtl style has to be injected onto every descendant, not just a wrapper.
const applyRtlDirectionRecursively = (node: ReactNode): ReactNode => {
	if (Array.isArray(node)) {
		return node.map((child, i) => {
			const cloned = applyRtlDirectionRecursively(child);
			if (isValidElement(cloned) && cloned.key == null) {
				return cloneElement(cloned as ReactElement<{ key?: string }>, {
					key: `rtl-${i}`,
				});
			}
			return cloned;
		});
	}
	if (!isValidElement(node)) return node;
	const element = node as ReactElement<{
		style?: Style | Style[];
		children?: ReactNode;
	}>;
	const existingStyle = element.props.style;
	const rtlPatch: Style = { direction: "rtl", textAlign: "right" };
	const nextStyle: Style | Style[] = Array.isArray(existingStyle)
		? [...existingStyle, rtlPatch]
		: existingStyle
			? [existingStyle, rtlPatch]
			: rtlPatch;
	const nextChildren = applyRtlDirectionRecursively(element.props.children);
	return cloneElement(element, { style: nextStyle }, nextChildren);
};

export const RichText = ({ children, semanticField }: RichTextProps) => {
	const { metadata, rtl } = useRender();
	const parentNodeKey = useSemanticNodeKey();
	const fieldNodeKey =
		parentNodeKey && semanticField ? semanticNodeKeys.field(parentNodeKey, semanticField) : undefined;
	const richTextNodeKey =
		fieldNodeKey && semanticField ? semanticNodeKeys.richText(fieldNodeKey, semanticField) : undefined;
	const fieldResolved = useResolvedNode(fieldNodeKey);
	const fieldVisible = useSemanticNodeVisible(fieldNodeKey);
	const richTextResolved = useResolvedNode(richTextNodeKey);
	const richTextVisible = useSemanticNodeVisible(richTextNodeKey);
	const { resolveNode, isNodeVisible, renderedChildKeysFor } = useSemanticNodeBindings();
	const rtlTextWrapStyle: Style | undefined = rtl ? { direction: "rtl", textAlign: "right" } : undefined;

	const boldStyle = useTemplateStyle("bold");
	const linkStyle = useTemplateStyle("link");
	const richParagraphStyle = useTemplateStyle("richParagraph");
	const richListItemRowStyle = useTemplateStyle("richListItemRow");
	const richListItemMarkerStyle = useTemplateStyle("richListItemMarker");
	const richListItemContentStyle = useTemplateStyle("richListItemContent");
	const bodyLineHeight = resolveRichTextBodyLineHeight(richParagraphStyle, richListItemContentStyle);
	const proseSpacing = createRichTextProseSpacing(bodyLineHeight);

	const normalizedHtml = normalizeRichTextHtml(children, {
		direction: rtl ? "rtl" : "ltr",
		softHyphens: metadata.typography.hyphenation === true,
	});
	const html = richTextNodeKey
		? projectNormalizedRichTextHtml(normalizedHtml, richTextNodeKey, renderedChildKeysFor)
		: normalizedHtml;

	if (!html || !fieldVisible || !richTextVisible) return null;

	const keyFor = (element: Parameters<typeof getRichTextSemanticNodeKey>[1]) =>
		element.getAttribute(richTextSemanticNodeKeyAttribute) ??
		(richTextNodeKey ? getRichTextSemanticNodeKey(richTextNodeKey, element, richTextMarkClassName) : undefined);
	const resolvedFor = (element: Parameters<typeof getRichTextSemanticNodeKey>[1]) => resolveNode(keyFor(element));
	const listLengths = new WeakMap<object, number>();
	const renderText = ({
		element,
		style,
		children: textChildren,
	}: {
		element: Parameters<typeof getRichTextSemanticNodeKey>[1];
		style: Style[];
		children: ReactNode;
	}) => {
		const nodeKey = keyFor(element);
		const resolved = resolveNode(nodeKey);
		const visible = isNodeVisible(nodeKey);
		if (!visible) return null;
		const text = (
			<PdfText
				{...resolvedPdfTextProps(resolved)}
				data-resume-whitespace={element.getAttribute("data-resume-whitespace")}
				style={composeStyles(style, resolved.style, safeTextStyle)}
			>
				{textChildren}
			</PdfText>
		);
		return /^h[1-6]$/i.test(element.rawTagName) && Number(element.getAttribute("data-indent")) > 0
			? renderWithBoundedIndent(text, rtl)
			: text;
	};
	const renderView = ({
		element,
		style,
		children: viewChildren,
	}: {
		element: Parameters<typeof getRichTextSemanticNodeKey>[1];
		style: Style[];
		children: ReactNode;
	}) => {
		const nodeKey = keyFor(element);
		const resolved = resolveNode(nodeKey);
		const visible = isNodeVisible(nodeKey);
		if (!visible) return null;
		const view = (
			<View {...resolvedPdfFlowProps(resolved)} style={composeStyles(style, resolved.style)}>
				{viewChildren}
			</View>
		);
		return Number(element.getAttribute("data-paragraph-indent")) > 0 ? renderWithBoundedIndent(view, rtl) : view;
	};

	return (
		<Html
			{...resolvedPdfFlowProps(richTextResolved)}
			style={composeStyles(fieldResolved.style, richTextResolved.style)}
			renderers={{
				h1: renderText,
				h2: renderText,
				h3: renderText,
				h4: renderText,
				h5: renderText,
				h6: renderText,
				blockquote: renderView,
				ul: renderView,
				ol: renderView,
				b: renderText,
				strong: renderText,
				em: renderText,
				i: renderText,
				u: renderText,
				s: renderText,
				strike: renderText,
				code: renderText,
				span: renderText,
				mark: renderText,
				a: ({ element, style, children: linkChildren }) => {
					const nodeKey = keyFor(element);
					const resolved = resolvedFor(element);
					if (!isNodeVisible(nodeKey)) return null;
					return (
						<PdfLink
							{...resolvedPdfTextProps(resolved)}
							src={element.attributes.href ?? ""}
							style={composeStyles(style, resolved.style, safeTextStyle)}
						>
							{linkChildren}
						</PdfLink>
					);
				},
				br: ({ element, style }) => {
					const resolved = resolvedFor(element);
					return (
						<PdfText
							{...resolvedPdfTextProps(resolved)}
							wrap={false}
							style={composeStyles(style, resolved.style, safeTextStyle)}
						>
							{"\n"}
						</PdfText>
					);
				},
				hr: ({ element, style }) => {
					const nodeKey = keyFor(element);
					const resolved = resolvedFor(element);
					if (!isNodeVisible(nodeKey)) return null;
					return <View {...resolvedPdfFlowProps(resolved)} style={composeStyles(style, resolved.style)} />;
				},
				p: (props) => {
					const resolved = resolvedFor(props.element);
					const paragraphProps = {
						...props,
						style: props.style,
						indent: Number(props.element.getAttribute("data-indent")),
						semanticStyle: resolved.style,
						textProps: {
							...resolvedPdfTextProps(resolved),
							"data-resume-whitespace": props.element.getAttribute("data-resume-whitespace"),
						},
						rtl,
						...(rtlTextWrapStyle ? { rtlTextWrapStyle } : {}),
						...(rtl ? { applyRtlDirection: applyRtlDirectionRecursively } : {}),
					};

					return renderRichTextParagraph(paragraphProps);
				},
				li: ({ element, style, children }) => {
					const nodeKey = keyFor(element);
					const itemResolved = resolvedFor(element);
					if (!isNodeVisible(nodeKey)) return null;
					const itemNodeKey = nodeKey;
					const markerNodeKey = itemNodeKey ? semanticNodeKeys.richTextNode(itemNodeKey, "list-marker", 0) : undefined;
					const contentNodeKey = itemNodeKey
						? semanticNodeKeys.richTextNode(itemNodeKey, "list-item-content", 0)
						: undefined;
					const markerResolved = resolveNode(markerNodeKey);
					const contentResolved = resolveNode(contentNodeKey);
					const isOrderedList = isRichTextElementInsideOrderedList(element);
					// Forme 0.25 doesn't reorder neutral characters in RTL text, so the RTL marker is written in visual order.
					const number = element.indexOfType + 1;
					const marker = isOrderedList ? (rtl ? `.${number}` : `${number}.`) : "•";
					// Reserve the same gutter throughout a list, then let Yoga measure wider
					// glyphs. An explicit authored width keeps its ordinary CSS geometry.
					let orderedMarkerStyle: Style | undefined;
					if (
						isOrderedList &&
						markerResolved.style?.width === undefined &&
						markerResolved.style?.flexBasis === undefined
					) {
						const parent = element.parentNode;
						const listLength = parent
							? (listLengths.get(parent) ??
								parent.childNodes.filter((child) => child.rawTagName?.toLowerCase() === "li").length)
							: 1;
						if (parent) listLengths.set(parent, listLength);
						const markerFontSize =
							typeof markerResolved.style?.fontSize === "number"
								? markerResolved.style.fontSize
								: metadata.typography.body.fontSize;
						const markerLetterSpacing =
							typeof markerResolved.style?.letterSpacing === "number"
								? Math.max(0, markerResolved.style.letterSpacing)
								: 0;
						const markerDigits = String(listLength).length;
						orderedMarkerStyle = {
							width: "auto",
							minWidth: markerDigits * markerFontSize + (markerDigits + 1) * markerLetterSpacing,
							flexShrink: 0,
						};
					}
					const itemStyles = toRichTextStyleArray(style);
					const contentItemStyles = itemStyles.map(stripRichTextVerticalMargins);

					// The scoped @react-pdf/layout patch keeps these companions together using
					// actual text fragments, including authored orphan counts and fallback fonts.
					const markerNode = (
						<PdfText
							key="marker"
							data-resume-list-marker
							{...resolvedPdfTextProps(markerResolved)}
							style={composeStyles(
								richListItemMarkerStyle,
								orderedMarkerStyle,
								{ alignSelf: "flex-start" },
								markerResolved.style,
							)}
						>
							{marker}
						</PdfText>
					);

					// Same BiDi-injection trick as the <p> renderer — see applyRtlDirectionRecursively.
					const contentNode = rtl ? (
						<PdfText
							key="content"
							data-resume-list-content
							{...resolvedPdfTextProps(contentResolved)}
							style={composeStyles(
								richListItemContentStyle,
								contentItemStyles,
								contentResolved.style,
								safeTextStyle,
								rtlTextWrapStyle,
							)}
						>
							{applyRtlDirectionRecursively(children)}
						</PdfText>
					) : (
						<View
							key="content"
							data-resume-list-content
							{...resolvedPdfFlowProps(contentResolved)}
							style={composeStyles(
								richListItemContentStyle,
								contentItemStyles,
								contentResolved.style,
								richListItemContentStackStyle,
								safeTextStyle,
							)}
						>
							{children}
						</View>
					);
					const authoredChildren = rtl
						? [
								{ nodeKey: contentNodeKey ?? "content", value: contentNode },
								{ nodeKey: markerNodeKey ?? "marker", value: markerNode },
							]
						: [
								{ nodeKey: markerNodeKey ?? "marker", value: markerNode },
								{ nodeKey: contentNodeKey ?? "content", value: contentNode },
							];
					const renderedChildren = projectRenderedChildren(
						renderedChildKeysFor(itemNodeKey),
						authoredChildren.filter(({ nodeKey }) => isNodeVisible(nodeKey)),
					);

					// Yoga ignores `flexDirection`/`direction` on rows inside react-pdf-html's <ul>
					// (works fine for split-row/contact-list). Swap DOM order to position the marker.
					return (
						<View
							data-resume-list-item
							{...resolvedPdfFlowProps(itemResolved)}
							style={composeStyles(
								richListItemRowStyle,
								itemStyles,
								getRichTextEdgeTrimStyle(element),
								itemResolved.style,
							)}
						>
							{/* React PDF only honors an authored presence hint after a preceding sibling. */}
							{markerResolved.minPresenceAhead ? (
								<View key="presence-spacer" style={{ position: "absolute", width: 0, height: 0 }} />
							) : null}
							{renderedChildren}
						</View>
					);
				},
			}}
			stylesheet={createRichTextStylesheet({
				boldStyle,
				hideLinkUnderline: metadata.page.hideLinkUnderline,
				linkStyle,
				richParagraphStyle,
				proseSpacing,
			})}
		>
			{html}
		</Html>
	);
};
