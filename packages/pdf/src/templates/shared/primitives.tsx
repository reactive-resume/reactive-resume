import type { Style } from "../../forme/style-types";
import type { StyleInput } from "./styles";
import type { ComponentProps, ReactNode } from "react";
import { Children, isValidElement } from "react";
import { Image, View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { PhosphorIcon } from "../../forme/icons";
import { resolvedPdfFlowProps, resolvedPdfTextProps } from "../../semantic/adapter";
import {
	projectRenderedChildren,
	SemanticNodeKeyProvider,
	useRenderedChildKeys,
	useResolvedNode,
	useSemanticNodeExists,
	useSemanticNodeKey,
	useSemanticNodeVisible,
} from "../../semantic/context";
import { semanticNodeKeys } from "../../semantic/node-keys";
import { Link as PdfLink, Text as PdfText } from "../../text";
import { useTemplateIconSlot, useTemplatePageNodeKey, useTemplateStyle } from "./context";
import { resolveIconSize } from "./icon-size";
import { getPictureShadow } from "./picture-shadow";
import { safeTextStyle } from "./safe-text-style";
import { composeLinkStyles, composeStyles, mergeStyles } from "./styles";

const asStyleInput = (style: unknown): StyleInput => style as StyleInput;

type SemanticProps = {
	nodeKey?: string | undefined;
	semanticField?: string | undefined;
	bindSemanticNode?: boolean | undefined;
	bindCurrentNode?: boolean | undefined;
};

type SemanticLinkProps = SemanticProps & {
	semanticRole?: string | undefined;
};

const getChildren = (props: object): ReactNode =>
	"children" in props ? (props as { children?: ReactNode }).children : undefined;

const contactChildNodeKey = (contactListNodeKey: string, child: ReactNode): string | undefined => {
	if (!isValidElement(child)) return;
	const props = child.props as Record<string, unknown>;
	if (typeof props.primitiveNodeKey === "string") return props.primitiveNodeKey;
	if (typeof props.nodeKey === "string") return props.nodeKey;
	if (typeof props.partKey === "string") return semanticTemplatePartNodeKey(contactListNodeKey, props.partKey);
	if ("email" in props) return semanticNodeKeys.contactItem(contactListNodeKey, "email");
	if ("phone" in props) return semanticNodeKeys.contactItem(contactListNodeKey, "phone");
	if ("location" in props) return semanticNodeKeys.contactItem(contactListNodeKey, "location");
	if ("website" in props) return semanticNodeKeys.contactItem(contactListNodeKey, "website");
	if (typeof props.field === "object" && props.field !== null && "id" in props.field) {
		return semanticNodeKeys.contactItem(contactListNodeKey, "custom", String(props.field.id));
	}
};

const projectContactChildren = (
	children: ReactNode,
	contactListNodeKey: string,
	renderedChildKeys: readonly string[],
): ReactNode => {
	const authored = Children.toArray(children);
	const entries = authored.flatMap((child) => {
		const nodeKey = contactChildNodeKey(contactListNodeKey, child);
		return nodeKey ? [{ nodeKey, value: child }] : [];
	});

	return entries.length === authored.length ? projectRenderedChildren(renderedChildKeys, entries) : authored;
};

const usePrimitiveNodeKey = ({
	nodeKey,
	semanticField,
	bindSemanticNode = true,
	bindCurrentNode = false,
	children,
	heading = false,
}: SemanticProps & { children?: ReactNode; heading?: boolean }) => {
	const data = useRender();
	const parentKey = useSemanticNodeKey();
	if (!bindSemanticNode) return undefined;
	if (bindCurrentNode) return parentKey;
	if (nodeKey) return nodeKey;
	if (semanticField && parentKey) return semanticNodeKeys.field(parentKey, semanticField);
	if (!parentKey) return undefined;

	if (parentKey.endsWith("/header")) {
		if (heading && children === data.basics.name) return semanticNodeKeys.headerPart(parentKey, "name");
		if (!heading && children === data.basics.headline) return semanticNodeKeys.headerPart(parentKey, "headline");
	}

	if (heading && parentKey.includes("/section-") && !parentKey.includes("/section-items")) {
		return semanticNodeKeys.sectionHeading(parentKey);
	}

	return undefined;
};

export const Div = ({
	style,
	nodeKey,
	semanticField,
	bindSemanticNode,
	bindCurrentNode,
	...props
}: ComponentProps<typeof View> & SemanticProps) => {
	const divStyle = useTemplateStyle("div");
	const resolvedNodeKey = usePrimitiveNodeKey({
		nodeKey,
		semanticField,
		bindSemanticNode,
		bindCurrentNode,
		children: getChildren(props),
	});
	const resolved = useResolvedNode(resolvedNodeKey);
	const visible = useSemanticNodeVisible(resolvedNodeKey);
	if (!visible) return null;

	return (
		<View
			{...props}
			data-resume-node={resolvedNodeKey}
			{...resolvedPdfFlowProps(resolved)}
			style={composeStyles(divStyle, style as Style | Style[] | undefined, resolved.style)}
		/>
	);
};

export const Text = ({
	style,
	nodeKey,
	semanticField,
	bindSemanticNode,
	bindCurrentNode: _bindCurrentNode,
	...props
}: ComponentProps<typeof PdfText> & SemanticProps) => {
	const textStyle = useTemplateStyle("text");
	const resolvedNodeKey = usePrimitiveNodeKey({
		nodeKey,
		semanticField,
		bindSemanticNode,
		children: getChildren(props),
	});
	const resolved = useResolvedNode(resolvedNodeKey);
	const visible = useSemanticNodeVisible(resolvedNodeKey);
	if (!visible) return null;

	return (
		<PdfText
			{...props}
			{...resolvedPdfTextProps(resolved)}
			style={composeStyles(textStyle, asStyleInput(style), resolved.style, safeTextStyle)}
		/>
	);
};

export const Heading = ({
	style,
	nodeKey,
	semanticField,
	bindSemanticNode,
	bindCurrentNode: _bindCurrentNode,
	...props
}: ComponentProps<typeof PdfText> & SemanticProps) => {
	const headingStyle = useTemplateStyle("heading");
	const resolvedNodeKey = usePrimitiveNodeKey({
		nodeKey,
		semanticField,
		bindSemanticNode,
		children: getChildren(props),
		heading: true,
	});
	const resolved = useResolvedNode(resolvedNodeKey);
	const visible = useSemanticNodeVisible(resolvedNodeKey);
	if (!visible) return null;

	return (
		<PdfText
			{...props}
			{...resolvedPdfTextProps(resolved)}
			style={composeStyles(headingStyle, asStyleInput(style), resolved.style, safeTextStyle)}
		/>
	);
};

export const Link = ({
	style,
	nodeKey,
	semanticField,
	semanticRole,
	bindSemanticNode: _bindSemanticNode,
	bindCurrentNode: _bindCurrentNode,
	...props
}: ComponentProps<typeof PdfLink> & SemanticLinkProps) => {
	const { metadata } = useRender();
	const linkStyle = useTemplateStyle("link");
	const parentKey = useSemanticNodeKey();
	const resolvedNodeKey =
		nodeKey ??
		(semanticRole && parentKey ? semanticNodeKeys.link(parentKey, semanticRole) : undefined) ??
		(semanticField && parentKey ? semanticNodeKeys.field(parentKey, semanticField) : undefined);
	const resolved = useResolvedNode(resolvedNodeKey);
	const visible = useSemanticNodeVisible(resolvedNodeKey);
	if (!visible) return null;

	return (
		<PdfLink
			{...props}
			{...resolvedPdfTextProps(resolved)}
			style={composeStyles(
				composeLinkStyles({ hideUnderline: metadata.page.hideLinkUnderline }, linkStyle, asStyleInput(style)),
				resolved.style,
				safeTextStyle,
			)}
		/>
	);
};

export const Small = ({
	style,
	nodeKey,
	semanticField,
	bindSemanticNode,
	bindCurrentNode: _bindCurrentNode,
	...props
}: ComponentProps<typeof PdfText> & SemanticProps) => {
	const textStyle = useTemplateStyle("text");
	const smallStyle = useTemplateStyle("small");
	const resolvedNodeKey = usePrimitiveNodeKey({
		nodeKey,
		semanticField,
		bindSemanticNode,
		children: getChildren(props),
	});
	const resolved = useResolvedNode(resolvedNodeKey);
	const visible = useSemanticNodeVisible(resolvedNodeKey);
	if (!visible) return null;

	return (
		<PdfText
			{...props}
			{...resolvedPdfTextProps(resolved)}
			style={composeStyles(textStyle, smallStyle, asStyleInput(style), resolved.style, safeTextStyle)}
		/>
	);
};

export const Bold = ({
	style,
	nodeKey,
	semanticField,
	bindSemanticNode,
	bindCurrentNode: _bindCurrentNode,
	...props
}: ComponentProps<typeof PdfText> & SemanticProps) => {
	const textStyle = useTemplateStyle("text");
	const boldStyle = useTemplateStyle("bold");
	const resolvedNodeKey = usePrimitiveNodeKey({
		nodeKey,
		semanticField,
		bindSemanticNode,
		children: getChildren(props),
	});
	const resolved = useResolvedNode(resolvedNodeKey);
	const visible = useSemanticNodeVisible(resolvedNodeKey);
	if (!visible) return null;

	return (
		<PdfText
			{...props}
			{...resolvedPdfTextProps(resolved)}
			style={composeStyles(textStyle, boldStyle, asStyleInput(style), resolved.style, safeTextStyle)}
		/>
	);
};

export const Icon = ({
	style,
	size: sizeProp,
	nodeKey,
	...props
}: ComponentProps<typeof PhosphorIcon> & { nodeKey?: string | undefined }) => {
	const { style: iconStyle, size: templateSize, ...iconProps } = useTemplateIconSlot("icon");
	const composedStyle = composeStyles(asStyleInput(iconStyle), asStyleInput(style));
	const templateIconSize =
		typeof templateSize === "number" || typeof templateSize === "string" ? templateSize : undefined;
	const parentKey = useSemanticNodeKey();
	const resolvedNodeKey = nodeKey ?? (parentKey ? semanticNodeKeys.icon(parentKey, "item") : undefined);
	const resolved = useResolvedNode(resolvedNodeKey);
	const visible = useSemanticNodeVisible(resolvedNodeKey);
	const resolvedStyle = composeStyles(composedStyle, resolved.style);
	// React PDF inherits SVG opacity from props, not the root SVG style.
	const { opacity } = mergeStyles(resolvedStyle);
	const resolvedSize =
		resolveIconSize({
			size: sizeProp,
			styles: [asStyleInput(style), resolved.style],
		}) ?? templateIconSize;

	if (iconProps.display === "none" || !visible) return null;

	return (
		<PhosphorIcon
			{...iconProps}
			{...props}
			{...(resolvedSize === undefined ? {} : { size: resolvedSize })}
			{...(opacity === undefined ? {} : { opacity })}
			style={resolvedStyle}
		/>
	);
};

export const SemanticHeaderView = ({ style, ...props }: ComponentProps<typeof View>) => {
	const pageNodeKey = useTemplatePageNodeKey();
	const regionNodeKey = semanticNodeKeys.region(pageNodeKey, "header");
	const nodeKey = semanticNodeKeys.header(regionNodeKey);
	const regionResolved = useResolvedNode(regionNodeKey);
	const resolved = useResolvedNode(nodeKey);
	const regionVisible = useSemanticNodeVisible(regionNodeKey);
	const headerVisible = useSemanticNodeVisible(nodeKey);
	if (!regionVisible || !headerVisible) return null;

	return (
		<SemanticNodeKeyProvider nodeKey={nodeKey}>
			<View
				{...props}
				data-resume-node={nodeKey}
				{...resolvedPdfFlowProps(regionResolved)}
				{...resolvedPdfFlowProps(resolved)}
				style={composeStyles(asStyleInput(style), regionResolved.style, resolved.style)}
			/>
		</SemanticNodeKeyProvider>
	);
};

export const SemanticRegionView = ({ region, style, ...props }: ComponentProps<typeof View> & { region: string }) => {
	const pageNodeKey = useTemplatePageNodeKey();
	const nodeKey = semanticNodeKeys.region(pageNodeKey, region);
	const resolved = useResolvedNode(nodeKey);
	const exists = useSemanticNodeExists(nodeKey);
	const visible = useSemanticNodeVisible(nodeKey);
	if (exists && !visible) return null;

	return (
		<View {...props} {...resolvedPdfFlowProps(resolved)} style={composeStyles(asStyleInput(style), resolved.style)} />
	);
};

export const SemanticRegionTemplatePartView = ({
	region,
	partKeys,
	style,
	...props
}: ComponentProps<typeof View> & { region: string; partKeys: readonly string[] }) => {
	const pageNodeKey = useTemplatePageNodeKey();
	const regionNodeKey = semanticNodeKeys.region(pageNodeKey, region);
	const partNodeKey = semanticTemplatePartNodeKey(regionNodeKey, ...partKeys);
	const regionResolved = useResolvedNode(regionNodeKey);
	const partResolved = useResolvedNode(partNodeKey);
	const regionVisible = useSemanticNodeVisible(regionNodeKey);
	const partVisible = useSemanticNodeVisible(partNodeKey);
	if (!regionVisible || !partVisible) return null;

	return (
		<View
			{...props}
			{...resolvedPdfFlowProps(regionResolved)}
			{...resolvedPdfFlowProps(partResolved)}
			style={composeStyles(asStyleInput(style), regionResolved.style, partResolved.style)}
		/>
	);
};

export const SemanticContactListView = ({ style, ...props }: ComponentProps<typeof View>) => {
	const headerNodeKey = useSemanticNodeKey();
	const nodeKey = headerNodeKey ? semanticNodeKeys.contactList(headerNodeKey) : undefined;
	const resolved = useResolvedNode(nodeKey);
	const renderedChildKeys = useRenderedChildKeys(nodeKey);
	const visible = useSemanticNodeVisible(nodeKey);
	if (!visible) return null;
	const children =
		nodeKey && renderedChildKeys ? projectContactChildren(props.children, nodeKey, renderedChildKeys) : props.children;

	return (
		<View {...props} {...resolvedPdfFlowProps(resolved)} style={composeStyles(asStyleInput(style), resolved.style)}>
			{children}
		</View>
	);
};

export const SemanticContactRowView = ({
	partKey,
	style,
	...props
}: ComponentProps<typeof View> & { partKey: string }) => {
	const headerNodeKey = useSemanticNodeKey();
	const contactListNodeKey = headerNodeKey ? semanticNodeKeys.contactList(headerNodeKey) : undefined;
	const nodeKey = semanticTemplatePartNodeKey(contactListNodeKey, partKey);
	const resolved = useResolvedNode(nodeKey);
	const renderedChildKeys = useRenderedChildKeys(nodeKey);
	const visible = useSemanticNodeVisible(nodeKey);
	if (!visible) return null;
	const children =
		contactListNodeKey && renderedChildKeys
			? projectContactChildren(props.children, contactListNodeKey, renderedChildKeys)
			: props.children;

	return (
		<View {...props} {...resolvedPdfFlowProps(resolved)} style={composeStyles(asStyleInput(style), resolved.style)}>
			{children}
		</View>
	);
};

export function semanticTemplatePartNodeKey(ownerNodeKey: string | undefined, ...partKeys: string[]) {
	return ownerNodeKey ? partKeys.reduce((key, part) => `${key}/template-part-${part}`, ownerNodeKey) : undefined;
}

export const SemanticTemplatePartView = ({
	ownerNodeKey,
	partKeys,
	style,
	...props
}: ComponentProps<typeof View> & { ownerNodeKey?: string | undefined; partKeys: readonly string[] }) => {
	const contextualOwnerNodeKey = useSemanticNodeKey();
	const nodeKey = semanticTemplatePartNodeKey(ownerNodeKey ?? contextualOwnerNodeKey, ...partKeys);
	const resolved = useResolvedNode(nodeKey);
	const visible = useSemanticNodeVisible(nodeKey);
	if (!visible) return null;

	return (
		<View {...props} {...resolvedPdfFlowProps(resolved)} style={composeStyles(asStyleInput(style), resolved.style)} />
	);
};

export const SemanticHeaderPicture = ({ style, ...props }: ComponentProps<typeof Image>) => {
	const pageNodeKey = useTemplatePageNodeKey();
	const headerNodeKey = useSemanticNodeKey() ?? semanticNodeKeys.header(semanticNodeKeys.region(pageNodeKey, "header"));
	const nodeKey = headerNodeKey ? semanticNodeKeys.headerPart(headerNodeKey, "picture") : undefined;
	const resolved = useResolvedNode(nodeKey);
	const visible = useSemanticNodeVisible(nodeKey);
	if (!visible) return null;

	const pictureStyle = mergeStyles(asStyleInput(style), resolved.style);
	const shadow = getPictureShadow(pictureStyle);
	const borderWidth = (value: Style["borderWidth"]) => (typeof value === "number" ? value : 0);
	const borderInsets = {
		top: borderWidth(pictureStyle.borderTopWidth ?? pictureStyle.borderWidth),
		right: borderWidth(pictureStyle.borderRightWidth ?? pictureStyle.borderWidth),
		bottom: borderWidth(pictureStyle.borderBottomWidth ?? pictureStyle.borderWidth),
		left: borderWidth(pictureStyle.borderLeftWidth ?? pictureStyle.borderWidth),
	};
	const hasBorder = Object.values(borderInsets).some((width) => width > 0);
	// the frame's padding also comes out of the bitmap's box; a percentage one is only known to the engine.
	const padding = (side: "Top" | "Right" | "Bottom" | "Left") =>
		pictureStyle[`padding${side}`] ??
		(side === "Top" || side === "Bottom" ? pictureStyle.paddingVertical : pictureStyle.paddingHorizontal) ??
		pictureStyle.padding ??
		0;
	const paddings = { top: padding("Top"), right: padding("Right"), bottom: padding("Bottom"), left: padding("Left") };
	const num = (value: unknown) => (typeof value === "number" ? value : 0);
	const inner = (size: unknown, a: number, b: number, pa: unknown, pb: unknown) =>
		typeof size === "number" ? size - a - b - num(pa) - num(pb) : "100%";
	if (!shadow && !hasBorder) return <Image {...props} style={pictureStyle} />;
	// The frame owns the border and authored padding. Yoga places the bitmap in
	// its content box, including when padding or picture dimensions are percentages.
	const { overflow: _overflow, ...frameStyle } = pictureStyle;

	return (
		<View wrap={false} style={frameStyle}>
			{shadow && (
				<Image
					src={shadow.src}
					style={{
						position: "absolute",
						left: -shadow.extent - borderInsets.left,
						top: -shadow.extent - borderInsets.top,
						// The engine sizes an image by its width and height, not by opposite offsets.
						...(typeof pictureStyle.width === "number" ? { width: pictureStyle.width + shadow.extent * 2 } : {}),
						...(typeof pictureStyle.height === "number" ? { height: pictureStyle.height + shadow.extent * 2 } : {}),
						opacity: pictureStyle.opacity ?? 1,
					}}
				/>
			)}
			<Image
				{...props}
				style={composeStyles(pictureStyle, {
					padding: 0,
					paddingTop: 0,
					paddingRight: 0,
					paddingBottom: 0,
					paddingLeft: 0,
					borderWidth: 0,
					borderTopWidth: 0,
					borderRightWidth: 0,
					borderBottomWidth: 0,
					borderLeftWidth: 0,
					backgroundColor: "transparent",
					position: "relative",
					top: 0,
					right: 0,
					bottom: 0,
					left: 0,
					// The bitmap's corners follow the inside of the frame's border.
					...(typeof pictureStyle.borderRadius === "number"
						? { borderRadius: Math.max(0, pictureStyle.borderRadius - Math.max(...Object.values(borderInsets))) }
						: {}),
					// In points when the frame's size is known, so the engine can fit the bitmap (`objectFit`) itself.
					width: inner(pictureStyle.width, borderInsets.left, borderInsets.right, paddings.left, paddings.right),
					height: inner(pictureStyle.height, borderInsets.top, borderInsets.bottom, paddings.top, paddings.bottom),
					margin: 0,
					marginTop: 0,
					marginRight: 0,
					marginBottom: 0,
					marginLeft: 0,
					transform: "rotate(0deg)",
					// Forme paints absolute boxes over in-flow ones; the photo joins that layer after its shadow.
					...(shadow ? { position: "absolute", left: num(paddings.left), top: num(paddings.top) } : {}),
				})}
			/>
		</View>
	);
};

export const SectionHeadingIcon = ({
	style,
	size: sizeProp,
	nodeKey,
	titleLineHeight,
	...props
}: ComponentProps<typeof PhosphorIcon> & {
	nodeKey?: string | undefined;
	/** Height in points of a line of the title beside the icon, which the icon is centred on. */
	titleLineHeight?: number | undefined;
}) => {
	const data = useRender();
	const { style: sectionIconStyle, ...sectionIconProps } = useTemplateIconSlot("sectionHeadingIcon");
	const { style: fallbackIconStyle, ...fallbackIconProps } = useTemplateIconSlot("icon");

	// Fall back to the item icon slot if no section heading icon slot is defined
	const hasSlot = sectionIconStyle !== undefined || Object.keys(sectionIconProps).length > 0;
	const iconStyle = hasSlot ? sectionIconStyle : fallbackIconStyle;
	const iconProps = hasSlot ? sectionIconProps : fallbackIconProps;

	// Section heading icon visibility is controlled by hideSectionIcons (in SectionShell),
	// NOT by the item-level hideIcons toggle. Ignore the "display: none" from item icon slot.
	const { display: _, size: templateSize, ...iconPropsWithoutDisplay } = iconProps;
	const templateIconSize =
		hasSlot && (typeof templateSize === "number" || typeof templateSize === "string") ? templateSize : undefined;

	// Icon size follows heading fontSize so they scale together
	const headingFontSize = data.metadata.typography.heading.fontSize;
	let resolvedSize =
		resolveIconSize({
			size: sizeProp,
			styles: [asStyleInput(iconStyle), asStyleInput(style)],
		}) ??
		templateIconSize ??
		headingFontSize;
	// The row lines its children up at the top, and a line's text sits in the middle of its line height: the icon
	// moves down by half what's left of the line, and never grows past the line, so it stays level with the title.
	let lineStyle: Style | undefined;
	if (typeof resolvedSize === "number" && titleLineHeight !== undefined) {
		resolvedSize = Math.min(resolvedSize, titleLineHeight);
		lineStyle = { marginTop: (titleLineHeight - resolvedSize) / 2 };
	}
	const resolved = useResolvedNode(nodeKey);
	const visible = useSemanticNodeVisible(nodeKey);
	if (!visible) return null;

	return (
		<PhosphorIcon
			{...iconPropsWithoutDisplay}
			{...props}
			size={resolvedSize}
			{...(resolved.style?.color === undefined ? {} : { color: resolved.style.color })}
			style={composeStyles(lineStyle, asStyleInput(iconStyle), asStyleInput(style), resolved.style)}
		/>
	);
};
