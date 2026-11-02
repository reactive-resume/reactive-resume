import type { IconName } from "../../forme/icons";
import type { Style } from "../../forme/style-types";
import type { CombinedTextName } from "../../semantic/node-keys";
import type { StyleInput, TemplatePlacement } from "./styles";
import type { CustomItemSection, ItemSection } from "./types";
import type {
	AwardItem,
	CertificationItem,
	CoverLetterItem,
	CustomSectionType,
	EducationItem,
	ExperienceItem,
	InterestItem,
	LanguageItem,
	ProfileItem,
	ProjectItem,
	PublicationItem,
	ReferenceItem,
	SkillItem,
	SummaryItem,
	VolunteerItem,
} from "@reactive-resume/schema/resume/data";
import type { ReactNode } from "react";
import { Children, createContext, Fragment, isValidElement, use } from "react";
import { entryHeaderOf } from "@reactive-resume/schema/resume/data";
import { View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { HEADING_NODE_PROP } from "../../page-map";
import { getResumeSectionIcon } from "../../section-icon";
import { findSection, getResumeSectionTitle } from "../../section-title";
import { resolvedPdfFlowProps, resolvedPdfTextProps } from "../../semantic/adapter";
import {
	projectRenderedChildren,
	SemanticItemNodeKeyProvider,
	SemanticNodeKeyProvider,
	useRenderedChildKeys,
	useResolvedNode,
	useSemanticNodeBindings,
	useSemanticNodeExists,
	useSemanticNodeKey,
	useSemanticNodeVisible,
	useSemanticSectionNodeKey,
} from "../../semantic/context";
import { semanticNodeKeys } from "../../semantic/node-keys";
import { ITEM_HEADER_ROW_PART_KEYS } from "../../semantic/shared-parts";
import { getPrimaryTint } from "./color-helpers";
import { getSectionItemRows, getSectionItemsLayout, shouldUseSectionTimeline } from "./columns";
import { getWebsiteDisplayText } from "./contact";
import {
	TemplatePlacementProvider,
	useTemplateColors,
	useTemplateFeature,
	useTemplateFeatureStyle,
	useTemplatePageNodeKey,
	useTemplatePlacement,
	useTemplateStyle,
} from "./context";
import { entryLayoutOf, leadsWithRole } from "./entry-header";
import { filterItems, hasVisibleItems, isSectionVisible, isVisibleSummary } from "./filtering";
import { parseStyleFontSize } from "./icon-size";
import { LevelDisplay } from "./level-display";
import { getTemplateMetrics } from "./metrics";
import {
	Bold,
	Div,
	Heading,
	Icon,
	Link,
	SectionHeadingIcon,
	SemanticTemplatePartView,
	Small,
	semanticTemplatePartNodeKey,
	Text,
} from "./primitives";
import { RichText } from "./rich-text";
import { createRtlStyleHelpers } from "./rtl";
import { getInlineItemWebsiteUrl, shouldRenderSeparateItemWebsite } from "./section-links";
import { hasSplitRowText } from "./split-row";
import { composeStyles, mergeStyles } from "./styles";

type SectionItemsContextValue = {
	itemStyle: StyleInput;
	useTimeline: boolean;
};

type SectionShellProps = {
	sectionId: string;
	title: string;
	showHeading?: boolean;
	children: ReactNode;
};

type SectionItemsProps = {
	children: ReactNode;
	columns?: number;
};

type SectionItemProps = {
	itemId: string;
	children: ReactNode;
	style?: StyleInput;
	/** Room added at the item's start on top of its own padding: the date column's dates sit there. */
	indent?: number | undefined;
};

type InlineItemHeaderProps = {
	leading?: ReactNode;
	middle?: ReactNode;
	trailing?: ReactNode;
	/** The role (leading) goes before the organization (middle) when the entry leads with it. */
	roleFirst?: boolean;
};

type SectionItemHeaderProps = {
	children: ReactNode;
	style?: StyleInput;
};

type ItemWebsite = {
	url: string;
	label: string;
	inlineLink?: boolean | undefined;
};

type ItemTitleProps = {
	children: ReactNode;
	website?: ItemWebsite | undefined;
	field: string;
	bold?: boolean | undefined;
	style?: StyleInput;
};

type ItemWebsiteLinkProps = {
	website: ItemWebsite;
};

type SummarySectionProps = {
	showHeading?: boolean;
};

type CustomSummarySectionProps = {
	section: CustomItemSection<SummaryItem>;
	showHeading?: boolean;
};

type ItemSectionProps<T> = {
	sectionId?: string;
	sectionData?: ItemSection<T>;
};

type CoverLetterSectionProps = {
	section: CustomItemSection<CoverLetterItem>;
};

type SectionProps = {
	section: string;
	placement: TemplatePlacement;
	showHeading?: boolean;
};

type SemanticTextRun = {
	field: string;
	value: string;
	prefix?: string;
	suffix?: string;
	bold?: boolean;
	/** Draws the run as the entry's inline website link, as the title does. */
	website?: ItemWebsite | undefined;
};

type SemanticTextRunsProps = {
	runs: readonly SemanticTextRun[];
	separator: string;
	/** The combined-text node the stacked and one-line headers draw these runs as; other layouts have none. */
	host?: CombinedTextName | undefined;
	style?: StyleInput;
	/** For every run: a run's text takes the template's text style, so the outer style doesn't reach it. */
	runStyle?: StyleInput;
	nodeKey?: string | undefined;
	fieldOwnerNodeKey?: string | undefined;
};

const SectionItemsContext = createContext<SectionItemsContextValue>({ itemStyle: undefined, useTimeline: false });
const SECTION_ITEM_PLACEHOLDER_KEYS = [
	"placeholder-1",
	"placeholder-2",
	"placeholder-3",
	"placeholder-4",
	"placeholder-5",
	"placeholder-6",
] as const;

const defaultSectionHeadingContainerStyle = {
	alignItems: "flex-start",
	columnGap: 4,
} satisfies Style;

const sectionHeadingTextProperties = new Set<string>([
	"color",
	"direction",
	"fontSize",
	"fontStyle",
	"fontWeight",
	"letterSpacing",
	"lineHeight",
	"textAlign",
	"textDecoration",
	"textDecorationColor",
	"textDecorationStyle",
	"textIndent",
	"textTransform",
]);

/**
 * With an icon, the heading node is the icon row and its title is a separate text that carries the template's own
 * heading font, so the heading's text styles have to be handed to that text or they never reach it.
 */
const sectionHeadingTextOf = (style: Style | undefined): Style | undefined =>
	style &&
	(Object.fromEntries(
		Object.entries(style).filter(
			([property, value]) => value !== undefined && sectionHeadingTextProperties.has(property),
		),
	) as Style);

const getSectionHeadingTextStyle = (...styles: StyleInput[]): Style[] => {
	const textStyles = composeStyles(...styles).map(
		({
			borderBottomWidth: _borderBottomWidth,
			borderLeftWidth: _borderLeftWidth,
			borderRightWidth: _borderRightWidth,
			borderTopWidth: _borderTopWidth,
			borderWidth: _borderWidth,
			flexGrow: _flexGrow,
			flexShrink: _flexShrink,
			marginBottom: _marginBottom,
			marginLeft: _marginLeft,
			marginRight: _marginRight,
			marginTop: _marginTop,
			paddingBottom: _paddingBottom,
			paddingLeft: _paddingLeft,
			paddingRight: _paddingRight,
			paddingTop: _paddingTop,
			width: _width,
			// The container is the one placed; its text flows inside it.
			position: _position,
			top: _top,
			right: _right,
			bottom: _bottom,
			left: _left,
			...textStyle
		}) => textStyle,
	);

	if (textStyles.length === 0) return [{ paddingLeft: 1 }];

	const lastIndex = textStyles.length - 1;
	const lastTextStyle: Style = { ...textStyles[lastIndex], paddingLeft: 1 };
	return [...textStyles.slice(0, lastIndex), lastTextStyle];
};

const useSectionItemsContext = () => use(SectionItemsContext);

const SemanticTextRuns = ({
	runs,
	separator,
	host,
	style,
	runStyle,
	nodeKey,
	fieldOwnerNodeKey,
}: SemanticTextRunsProps) => {
	const contextualNodeKey = useSemanticNodeKey();
	const fieldParentNodeKey = fieldOwnerNodeKey ?? contextualNodeKey;
	const boldStyle = useTemplateStyle("bold");
	const combinedTextOwnerNodeKey =
		host === "experience-position-location" || host === "education-area-degree"
			? semanticTemplatePartNodeKey(fieldParentNodeKey, "inline-item-header-leading")
			: (nodeKey ?? fieldParentNodeKey);
	const combinedTextNodeKey =
		host && combinedTextOwnerNodeKey ? semanticNodeKeys.combinedText(combinedTextOwnerNodeKey, host) : undefined;
	const ownerResolved = useResolvedNode(nodeKey);
	const combinedTextResolved = useResolvedNode(combinedTextNodeKey);
	const ownerVisible = useSemanticNodeVisible(nodeKey);
	const combinedTextVisible = useSemanticNodeVisible(combinedTextNodeKey);
	const renderedChildKeys = useRenderedChildKeys(combinedTextNodeKey);
	const { isNodeVisible } = useSemanticNodeBindings();
	const entries = runs.flatMap((run) => {
		if (!hasSplitRowText(run.value)) return [];
		const fieldNodeKey = fieldParentNodeKey ? semanticNodeKeys.field(fieldParentNodeKey, run.field) : run.field;
		return isNodeVisible(fieldNodeKey) ? [{ nodeKey: fieldNodeKey, value: run }] : [];
	});
	const visibleRuns = projectRenderedChildren(renderedChildKeys, entries);
	if (!ownerVisible || !combinedTextVisible || visibleRuns.length === 0) return null;
	return (
		<SemanticNodeKeyProvider nodeKey={fieldParentNodeKey}>
			<Text
				bindSemanticNode={false}
				{...resolvedPdfTextProps(ownerResolved)}
				{...resolvedPdfTextProps(combinedTextResolved)}
				style={composeStyles(style, ownerResolved.style, combinedTextResolved.style)}
			>
				{visibleRuns.map(({ field, value, prefix = "", suffix = "", bold, website }, index) => {
					const run = (
						<Text semanticField={field} style={composeStyles(runStyle, bold ? boldStyle : undefined)}>
							{prefix}
							{value}
							{suffix}
						</Text>
					);
					const url = website && getInlineItemWebsiteUrl(website);
					return (
						<Fragment key={field}>
							{index === 0 ? "" : separator}
							{url ? (
								<Link semanticRole="inline-website" src={url}>
									{run}
								</Link>
							) : (
								run
							)}
						</Fragment>
					);
				})}
			</Text>
		</SemanticNodeKeyProvider>
	);
};

const getChildKey = (child: ReactNode, fallbackIndex: number) => {
	return isValidElement(child) && child.key !== null ? String(child.key) : `child-${fallbackIndex}`;
};

const getRowKey = (row: ReactNode[], rowIndex: number) => {
	const childKeys = row.map(getChildKey).join("|");
	return childKeys || `row-${rowIndex}`;
};

const getVisibleItems = <T extends { hidden: boolean }>(section: ItemSection<T>, sectionType?: string): T[] => {
	if (!hasVisibleItems(section, sectionType)) return [];

	return filterItems(section.items, sectionType);
};

const SectionShell = ({ sectionId, title, showHeading = true, children }: SectionShellProps) => {
	const data = useRender();
	const pageNodeKey = useTemplatePageNodeKey();
	const sectionNodeKey = useSemanticSectionNodeKey(pageNodeKey, sectionId);
	const resolved = useResolvedNode(sectionNodeKey);
	const visible = useSemanticNodeVisible(sectionNodeKey);
	const sectionStyle = useTemplateStyle("section");
	const headingStyle = useTemplateStyle("heading");
	const sectionHeadingStyle = useTemplateStyle("sectionHeading");
	const sectionHeadingContainerStyle = useTemplateStyle("sectionHeadingContainer");
	const sectionTitle = getResumeSectionTitle(data, sectionId, title);
	const section = findSection(data, sectionId);
	const sectionHeadingEnabled = section?.showHeading !== false;
	const sectionHeadingNodeKey = semanticNodeKeys.sectionHeading(sectionNodeKey);
	const sectionHeadingResolved = useResolvedNode(sectionHeadingNodeKey);
	const sectionHeadingVisible = useSemanticNodeVisible(sectionHeadingNodeKey);
	const sectionIcon = getResumeSectionIcon(data, sectionId);
	const showIcon = Boolean(sectionIcon) && !data.metadata.page.hideSectionIcons;
	const sectionHeadingTextStyle = getSectionHeadingTextStyle(
		sectionHeadingStyle,
		sectionHeadingTextOf(sectionHeadingResolved.style),
	);
	// The title as `Heading` draws it; a line height in other units than a multiplier falls back to the typography's.
	const { fontSize: titleFontSize, lineHeight: titleLineHeight } = mergeStyles(headingStyle, sectionHeadingTextStyle);
	const titleLineBox =
		(parseStyleFontSize(titleFontSize) ?? data.metadata.typography.heading.fontSize) *
		(typeof titleLineHeight === "number" ? titleLineHeight : data.metadata.typography.heading.lineHeight);
	// wrap={false} keeps the whole section on one page; break forces it onto a fresh page.
	// Only set the props when enabled so we never pass undefined (exactOptionalPropertyTypes).
	const breakProps: { wrap?: false; break?: true } = {};
	// ponytail: react-pdf ceiling — wrap={false} keeps a section together only if it fits on
	// one page; a section taller than a full page is clipped, not split. No upgrade path in
	// react-pdf, so the layout UI warns users this only works for sections that fit one page.
	if (section?.keepTogether) breakProps.wrap = false;
	if (section?.startOnNewPage) breakProps.break = true;
	const flowProps = { ...breakProps, ...resolvedPdfFlowProps(resolved) };
	const resolvedSectionStyle = composeStyles(sectionStyle, resolved.style);
	if (!visible) return null;

	if (!showIcon) {
		// No icon: render heading exactly as before (no structural change)
		return (
			<SemanticNodeKeyProvider nodeKey={sectionNodeKey}>
				<View style={resolvedSectionStyle} {...flowProps} data-resume-node={sectionNodeKey}>
					{showHeading && sectionHeadingEnabled && (
						<Heading style={composeStyles(sectionHeadingStyle)}>{sectionTitle}</Heading>
					)}
					{children}
				</View>
			</SemanticNodeKeyProvider>
		);
	}

	// With icon: wrap in a flex row container that inherits the heading's border/decoration
	return (
		<SemanticNodeKeyProvider nodeKey={sectionNodeKey}>
			<View style={resolvedSectionStyle} {...flowProps} data-resume-node={sectionNodeKey}>
				{showHeading && sectionHeadingEnabled && sectionHeadingVisible && (
					<View
						{...resolvedPdfFlowProps(sectionHeadingResolved)}
						{...{ [HEADING_NODE_PROP]: sectionHeadingNodeKey }}
						style={composeStyles(
							sectionHeadingStyle,
							{ ...defaultSectionHeadingContainerStyle, flexDirection: createRtlStyleHelpers(data.rtl).row },
							sectionHeadingContainerStyle,
							sectionHeadingResolved.style,
						)}
					>
						<SectionHeadingIcon
							nodeKey={semanticNodeKeys.icon(sectionHeadingNodeKey, "section")}
							name={sectionIcon as IconName}
							titleLineHeight={titleLineBox}
						/>
						<Heading bindSemanticNode={false} style={sectionHeadingTextStyle}>
							{sectionTitle}
						</Heading>
					</View>
				)}
				{children}
			</View>
		</SemanticNodeKeyProvider>
	);
};

const SectionItems = ({ children, columns = 1 }: SectionItemsProps) => {
	const data = useRender();
	const sectionNodeKey = useSemanticNodeKey();
	const sectionItemsNodeKey = sectionNodeKey ? semanticNodeKeys.sectionItems(sectionNodeKey) : undefined;
	const resolved = useResolvedNode(sectionItemsNodeKey);
	const visible = useSemanticNodeVisible(sectionItemsNodeKey);
	const renderedChildKeys = useRenderedChildKeys(sectionItemsNodeKey);
	const placement = useTemplatePlacement();
	const sectionTimeline = useTemplateFeature("sectionTimeline");
	const sectionItemsStyle = useTemplateStyle("sectionItems");
	const timelineItemsStyle = useTemplateFeatureStyle("sectionTimeline", "items");
	const timelineLineStyle = useTemplateFeatureStyle("sectionTimeline", "line");
	const metrics = getTemplateMetrics(data.metadata.page);
	const layout = getSectionItemsLayout({
		columns,
		rowGap: metrics.itemGapY,
		columnGap: metrics.itemGapX,
	});
	const useTimeline = shouldUseSectionTimeline({
		sectionTimeline,
		placement,
		columns: layout.columns,
	});
	const context = { itemStyle: layout.itemStyle, useTimeline };
	const authoredChildren = Children.toArray(children);
	const childrenByNodeKey = new Map(
		authoredChildren.flatMap((child) => {
			if (!isValidElement<{ itemId?: string }>(child) || !child.props.itemId || !sectionItemsNodeKey) return [];
			return [[semanticNodeKeys.item(sectionItemsNodeKey, child.props.itemId), child] as const];
		}),
	);
	const resolvedChildren = renderedChildKeys
		? renderedChildKeys.flatMap((nodeKey) => {
				const child = childrenByNodeKey.get(nodeKey);
				return child ? [child] : [];
			})
		: authoredChildren;
	const rtlRowStyle = createRtlStyleHelpers(data.rtl).gridRowStyle;
	if (!visible) return null;

	if (!useTimeline) {
		if (layout.isGrid) {
			const rows = getSectionItemRows(resolvedChildren, layout.columns);

			return (
				<SemanticNodeKeyProvider nodeKey={sectionItemsNodeKey}>
					<SectionItemsContext.Provider value={context}>
						<View
							{...resolvedPdfFlowProps(resolved)}
							style={composeStyles(layout.containerStyle, sectionItemsStyle, resolved.style)}
						>
							{rows.map((row, rowIndex) => (
								<View key={getRowKey(row, rowIndex)} style={composeStyles(layout.rowStyle, rtlRowStyle)}>
									{row}
									{SECTION_ITEM_PLACEHOLDER_KEYS.slice(0, layout.columns - row.length).map((placeholderKey) => (
										<View key={placeholderKey} style={composeStyles(layout.itemStyle)} />
									))}
								</View>
							))}
						</View>
					</SectionItemsContext.Provider>
				</SemanticNodeKeyProvider>
			);
		}

		return (
			<SemanticNodeKeyProvider nodeKey={sectionItemsNodeKey}>
				<SectionItemsContext.Provider value={context}>
					<View
						{...resolvedPdfFlowProps(resolved)}
						style={composeStyles(layout.containerStyle, sectionItemsStyle, resolved.style)}
					>
						{resolvedChildren}
					</View>
				</SectionItemsContext.Provider>
			</SemanticNodeKeyProvider>
		);
	}

	return (
		<SemanticNodeKeyProvider nodeKey={sectionItemsNodeKey}>
			<SectionItemsContext.Provider value={context}>
				<View
					{...resolvedPdfFlowProps(resolved)}
					style={composeStyles(layout.containerStyle, sectionItemsStyle, timelineItemsStyle, resolved.style)}
				>
					<SemanticTemplatePartView
						ownerNodeKey={sectionItemsNodeKey}
						partKeys={["timeline-line"]}
						style={composeStyles(timelineLineStyle)}
					/>
					{resolvedChildren}
				</View>
			</SectionItemsContext.Provider>
		</SemanticNodeKeyProvider>
	);
};

const SectionItem = ({ itemId, children, style, indent }: SectionItemProps) => {
	const { rtl } = useRender();
	const sectionItemsNodeKey = useSemanticNodeKey();
	const itemNodeKey = sectionItemsNodeKey ? semanticNodeKeys.item(sectionItemsNodeKey, itemId) : undefined;
	const visible = useSemanticNodeVisible(itemNodeKey);
	const { itemStyle: sectionItemStyle, useTimeline } = useSectionItemsContext();
	const itemStyle = useTemplateStyle("item");
	const timelineItemStyle = useTemplateFeatureStyle("sectionTimeline", "item");
	const timelineMarkerStyle = useTemplateFeatureStyle("sectionTimeline", "marker");
	const timelineDotStyle = useTemplateFeatureStyle("sectionTimeline", "dot");
	const timelineContentStyle = useTemplateFeatureStyle("sectionTimeline", "content");
	const timelineContentNodeKey = semanticTemplatePartNodeKey(itemNodeKey, "timeline-content");
	const timelineContentResolved = useResolvedNode(timelineContentNodeKey);
	if (!visible) return null;

	const withIndent = (...styles: StyleInput[]) => {
		if (!indent) return composeStyles(...styles);
		const side = rtl ? "paddingRight" : "paddingLeft";
		const merged = mergeStyles(...styles);
		const start = merged[side] ?? merged.paddingHorizontal ?? merged.padding;
		return composeStyles(...styles, { [side]: (typeof start === "number" ? start : 0) + indent });
	};

	if (!useTimeline) {
		return (
			<SemanticNodeKeyProvider nodeKey={itemNodeKey}>
				<Div nodeKey={itemNodeKey} style={withIndent(itemStyle, sectionItemStyle, style)}>
					{children}
				</Div>
			</SemanticNodeKeyProvider>
		);
	}

	return (
		<SemanticNodeKeyProvider nodeKey={itemNodeKey}>
			<View style={composeStyles(timelineItemStyle)}>
				<SemanticTemplatePartView
					ownerNodeKey={itemNodeKey}
					partKeys={["timeline-marker"]}
					style={composeStyles(timelineMarkerStyle)}
				>
					{/* When the item breaks across pages, Forme 0.25 stretches the marker's last box down to the page's end:
					    this plain box takes the stretch, so the dot keeps its size. */}
					<View style={{ alignSelf: "stretch", alignItems: "center" }}>
						<SemanticTemplatePartView
							ownerNodeKey={itemNodeKey}
							partKeys={["timeline-marker", "timeline-dot"]}
							style={composeStyles(timelineDotStyle)}
						/>
					</View>
				</SemanticTemplatePartView>
				<Div
					nodeKey={itemNodeKey}
					{...resolvedPdfFlowProps(timelineContentResolved)}
					style={composeStyles(withIndent(itemStyle, timelineContentStyle, style), timelineContentResolved.style)}
				>
					{children}
				</Div>
			</View>
		</SemanticNodeKeyProvider>
	);
};

/**
 * The single-line variant of an item header. `SectionItemHeader` owns the `item-header` node and
 * its resolved style, so this only lays the three slots out and addresses their template parts
 * against the surrounding item-header key.
 */
const InlineItemHeader = ({ leading, middle, trailing, roleFirst = false }: InlineItemHeaderProps) => {
	const inlineItemHeaderStyle = useTemplateStyle("inlineItemHeader");
	const leadingStyle = useTemplateStyle("inlineItemHeaderLeading");
	const middleStyle = useTemplateStyle("inlineItemHeaderMiddle");
	const trailingStyle = useTemplateStyle("inlineItemHeaderTrailing");

	const nodeKey = useSemanticNodeKey();
	const renderedChildKeys = useRenderedChildKeys(nodeKey);
	const [leadingPart, middlePart, trailingPart] = [
		{
			nodeKey: semanticTemplatePartNodeKey(nodeKey, "inline-item-header-leading") ?? "inline-item-header-leading",
			value: (
				<SemanticTemplatePartView
					key="inline-item-header-leading"
					ownerNodeKey={nodeKey}
					partKeys={["inline-item-header-leading"]}
					style={composeStyles(leadingStyle)}
				>
					{leading}
				</SemanticTemplatePartView>
			),
		},
		{
			nodeKey: semanticTemplatePartNodeKey(nodeKey, "inline-item-header-middle") ?? "inline-item-header-middle",
			value: (
				<SemanticTemplatePartView
					key="inline-item-header-middle"
					ownerNodeKey={nodeKey}
					partKeys={["inline-item-header-middle"]}
					style={composeStyles(middleStyle)}
				>
					{middle}
				</SemanticTemplatePartView>
			),
		},
		{
			nodeKey: semanticTemplatePartNodeKey(nodeKey, "inline-item-header-trailing") ?? "inline-item-header-trailing",
			value: (
				<SemanticTemplatePartView
					key="inline-item-header-trailing"
					ownerNodeKey={nodeKey}
					partKeys={["inline-item-header-trailing"]}
					style={composeStyles(trailingStyle)}
				>
					{trailing}
				</SemanticTemplatePartView>
			),
		},
	] as const;
	// Same order as the Semantic CSS tree, so a stylesheet's `order` and `display` project onto it.
	const parts = roleFirst ? [leadingPart, middlePart, trailingPart] : [middlePart, leadingPart, trailingPart];

	return <View style={composeStyles(inlineItemHeaderStyle)}>{projectRenderedChildren(renderedChildKeys, parts)}</View>;
};

const stackedSidebarSplitRowStyle = {
	flexDirection: "column",
	alignItems: "flex-start",
} satisfies Style;

// The date stays beside the title in every template, even where `splitRow` stacks; right to left, it's mirrored.
const awardTitleDateRowStyle = (rtl: boolean) =>
	({
		flexDirection: rtl ? "row-reverse" : "row",
		alignItems: "baseline",
		justifyContent: "space-between",
	}) satisfies Style;

const useSectionSplitRowStyle = () => {
	const placement = useTemplatePlacement();
	const splitRowStyle = useTemplateStyle("splitRow");
	const stackSidebarItemHeader = useTemplateFeature("stackSidebarItemHeader");

	return composeStyles(
		splitRowStyle,
		stackSidebarItemHeader && placement === "sidebar" ? stackedSidebarSplitRowStyle : undefined,
	);
};

/**
 * The trailing text of a title row (a date, a location). In a row it takes the rest of its line, so it keeps to the
 * row's end even when a long title pushes it onto a line of its own (Forme ignores auto margins there); stacked rows
 * (a sidebar's column) leave it alone.
 */
const useRowEndStyle = (rowStyle: StyleInput) => {
	const alignEndStyle = useTemplateStyle("alignEnd");
	const { flexDirection } = mergeStyles(rowStyle);
	const isRow = flexDirection === "row" || flexDirection === "row-reverse";
	return composeStyles(alignEndStyle, isRow ? { flexGrow: 1 } : undefined);
};

// A single child in a space-between row otherwise falls back to the leading edge.
// Only adjust horizontal split rows; sidebar templates may intentionally stack the cells.
const getTrailingOnlySplitRowStyle = (style: StyleInput) => {
	const { flexDirection, justifyContent } = mergeStyles(style);
	const isSplitRow = (flexDirection === "row" || flexDirection === "row-reverse") && justifyContent === "space-between";
	return composeStyles(style, isSplitRow ? { justifyContent: "flex-end" } : undefined);
};

type ItemHeaderRowProps = {
	children: ReactNode;
	style: StyleInput;
};

/**
 * React PDF lays a `Text` out once, at the width it is first measured at, and reuses those lines
 * afterwards. `flex-wrap: nowrap` asks Yoga to shrink the title so the date fits beside it, and the
 * cached lines keep the wider layout, so the title's glyphs run over the date. A zero flex basis
 * makes the title's first measurement its final width, so it wraps inside its own box instead.
 */
const nowrapItemTitleStyle = { flexGrow: 1, flexBasis: 0 } satisfies Style;
const wrappingItemTitleStyle = {} satisfies Style;

/** True while rendering inside an item header row a stylesheet turned into a single line. */
const ItemHeaderRowNowrapContext = createContext(false);

/**
 * The title/date row inside a section item header, exposed to Semantic CSS as
 * `template-part[name="item-header-row"]`.
 *
 * It has to be addressable on its own: the row carries `flex-wrap: wrap`, so a long title pushes
 * the trailing date onto its own line, and `item-header` selects the box around the row rather than
 * the row itself. The owning item-header key comes from the surrounding provider.
 */
const ItemHeaderRow = ({ children, style }: ItemHeaderRowProps) => {
	const ownerNodeKey = useSemanticNodeKey();
	const resolved = useResolvedNode(semanticTemplatePartNodeKey(ownerNodeKey, ...ITEM_HEADER_ROW_PART_KEYS));
	// Same order the rendered row composes in, so a template that ships `nowrap` counts too.
	const { flexWrap } = mergeStyles(style, resolved.style);

	return (
		<SemanticTemplatePartView partKeys={ITEM_HEADER_ROW_PART_KEYS} style={composeStyles(style)}>
			<ItemHeaderRowNowrapContext.Provider value={flexWrap === "nowrap"}>
				{children}
			</ItemHeaderRowNowrapContext.Provider>
		</SemanticTemplatePartView>
	);
};

/**
 * The box around an item's header rows, exposed to Semantic CSS as `item-header`.
 *
 * It always renders its own `Div`, whatever shape the section's header markup has, so a resolved
 * `item-header` style covers every header row of every section on every template. `Div` rather than
 * `View` because the header rows keep the row gap they used to get from the item box around them.
 */
const SectionItemHeader = ({ children, style }: SectionItemHeaderProps) => {
	const itemNodeKey = useSemanticNodeKey();
	const itemHeaderNodeKey = itemNodeKey ? semanticNodeKeys.itemHeader(itemNodeKey) : undefined;
	const sectionItemHeaderStyle = useTemplateStyle("sectionItemHeader");
	const exists = useSemanticNodeExists(itemHeaderNodeKey);
	if (!exists) return <>{children}</>;

	return (
		<SemanticNodeKeyProvider nodeKey={itemHeaderNodeKey}>
			<Div nodeKey={itemHeaderNodeKey} style={composeStyles(sectionItemHeaderStyle, style)}>
				{children}
			</Div>
		</SemanticNodeKeyProvider>
	);
};

type RowEndTextProps = {
	semanticField: string;
	style: StyleInput;
	children: ReactNode;
};

/** An `item-header-row`'s date: when a stylesheet sets the row to `nowrap`, the title takes the room and the date its own width. */
const RowEndText = ({ semanticField, style, children }: RowEndTextProps) => {
	const nowrap = use(ItemHeaderRowNowrapContext);
	return (
		<Text semanticField={semanticField} style={composeStyles(style, nowrap ? { flexGrow: 0 } : undefined)}>
			{children}
		</Text>
	);
};

const ItemTitle = ({ children, website, field, bold = true, style }: ItemTitleProps) => {
	const inlineWebsiteUrl = website && getInlineItemWebsiteUrl(website);
	const rowStyle = use(ItemHeaderRowNowrapContext) ? nowrapItemTitleStyle : wrappingItemTitleStyle;
	const title = bold ? (
		<Bold style={composeStyles(rowStyle, style)} semanticField={field}>
			{children}
		</Bold>
	) : (
		<Text style={composeStyles(rowStyle, style)} semanticField={field}>
			{children}
		</Text>
	);

	if (!inlineWebsiteUrl) return title;

	return (
		<Link style={rowStyle} semanticRole="inline-website" src={inlineWebsiteUrl}>
			{title}
		</Link>
	);
};

const ItemWebsiteLink = ({ website }: ItemWebsiteLinkProps) => {
	if (!shouldRenderSeparateItemWebsite(website)) return null;

	return (
		<Link semanticRole="website" src={website.url}>
			{getWebsiteDisplayText(website)}
		</Link>
	);
};

/** How a section's entry headers are drawn (Design → Entries), and the styles that go with it. */
const useEntryHeader = (sectionType: string, columns: number) => {
	const data = useRender();
	const placement = useTemplatePlacement();
	const colors = useTemplateColors();
	const templateHeaderStyle = useTemplateStyle("sectionItemHeader");
	const entry = entryHeaderOf(data.metadata.design);
	const layout = entryLayoutOf(entry.layout, sectionType, placement, columns);
	const metrics = getTemplateMetrics(data.metadata.page);
	const { rtl, row } = createRtlStyleHelpers(data.rtl);
	const side = rtl ? "Right" : "Left";
	const startPadding = (value: number): Style => (rtl ? { paddingRight: value } : { paddingLeft: value });
	// No accent on an accent background: a coloured sidebar's entries take its text colour.
	const color =
		placement === "sidebar" && colors.sidebarBackground
			? (colors.sidebarForeground ?? colors.foreground)
			: colors.primary;
	const accentStyle = {
		none: undefined,
		rule: { borderBottomWidth: 1, borderBottomColor: color, paddingBottom: metrics.gapY(0.25) },
		bar: {
			...(rtl ? { borderRightWidth: 2, borderRightColor: color } : { borderLeftWidth: 2, borderLeftColor: color }),
			...startPadding(metrics.gapX(1)),
		},
		band: {
			// Forme flattens the tint over the colour behind it.
			backgroundColor: getPrimaryTint(color, 0.1),
			paddingHorizontal: metrics.gapX(1),
			paddingVertical: metrics.gapY(0.25),
		},
	}[entry.accent] satisfies Style | undefined;

	// Date column: the item makes room at its start for the dates, and its header reaches back over that room as a
	// row of the date and the rest. The header's own start edge (a template's outdent, an accent's bar or band) widens
	// the room rather than narrowing the date, so the rest still lines up with the item's body.
	const header = mergeStyles(templateHeaderStyle, accentStyle);
	const length = (value: unknown) => (typeof value === "number" ? value : 0);
	const startBorder = (style: Style) => length(style[`border${side}Width`] ?? style.borderWidth);
	const startInset =
		startBorder(header) + length(header[`padding${side}`] ?? header.paddingHorizontal ?? header.padding);
	const startMargin = length(header[`margin${side}`] ?? header.marginHorizontal ?? header.margin);
	const dateWidth = data.metadata.typography.body.fontSize * 11;
	const dateGap = metrics.gapX(2);
	const room = dateWidth + dateGap + startMargin + startInset;
	const dateColumn = layout === "date-column";
	const dateRowStyle: Style = {
		flexDirection: row,
		columnGap: dateGap,
		...(rtl ? { marginRight: startMargin - room } : { marginLeft: startMargin - room }),
	};

	return {
		layout,
		lead: entry.lead,
		color,
		itemIndent: dateColumn ? room : undefined,
		headerStyle: composeStyles(accentStyle, dateColumn ? dateRowStyle : undefined),
		// A nested role's period lines up with its entry's date.
		roleHeaderStyle: dateColumn
			? { ...dateRowStyle, ...startPadding(startInset - startBorder(mergeStyles(templateHeaderStyle))) }
			: undefined,
		dateCellStyle: { width: dateWidth, flexShrink: 0 } satisfies Style,
	};
};

type EntryHeaderStyles = ReturnType<typeof useEntryHeader>;

type EntryHeaderLayoutProps = {
	entry: EntryHeaderStyles;
	lead: SemanticTextRun;
	/** Everything but the lead and the date, drawn as one line of text. */
	runs: readonly SemanticTextRun[];
	date: SemanticTextRun;
};

/** The compact, date-column and eyebrow headers; the stacked and one-line ones stay with their sections. */
const EntryHeaderLayout = ({ entry, lead, runs, date }: EntryHeaderLayoutProps) => {
	const data = useRender();
	const splitRowStyle = useSectionSplitRowStyle();
	const alignEndStyle = useRowEndStyle(splitRowStyle);
	const boldStyle = useTemplateStyle("bold");
	const { fontSize } = data.metadata.typography.body;
	const title = (
		<ItemTitle
			field={lead.field}
			website={lead.website}
			bold={lead.bold}
			style={entry.layout === "eyebrow" ? { fontSize: fontSize * 1.15 } : undefined}
		>
			{lead.value}
		</ItemTitle>
	);
	const details = <SemanticTextRuns separator=" · " runs={runs} />;

	if (entry.layout === "date-column") {
		return (
			<>
				{/* The cell stays when the date is empty, so the title keeps to its column. */}
				<View style={entry.dateCellStyle}>
					<Text semanticField={date.field}>{date.value}</Text>
				</View>
				<Div bindSemanticNode={false} style={{ flex: 1 }}>
					{title}
					{details}
				</Div>
			</>
		);
	}

	const titleRow = (
		<View style={hasSplitRowText(lead.value) ? splitRowStyle : getTrailingOnlySplitRowStyle(splitRowStyle)}>
			{title}
			{hasSplitRowText(date.value) && (
				<Text semanticField={date.field} style={composeStyles(alignEndStyle)}>
					{date.value}
				</Text>
			)}
		</View>
	);

	if (entry.layout === "eyebrow") {
		const eyebrowStyle = composeStyles(boldStyle, {
			fontSize: fontSize * 0.8,
			textTransform: "uppercase",
			color: entry.color,
			// Letter-spacing breaks the joins of Arabic script.
			...(data.rtl ? {} : { letterSpacing: 0.6 }),
		});
		return (
			<>
				<SemanticTextRuns separator=" · " runs={runs} style={eyebrowStyle} runStyle={eyebrowStyle} />
				{titleRow}
			</>
		);
	}

	return (
		<>
			{titleRow}
			{details}
		</>
	);
};

const SummarySection = ({ showHeading = true }: SummarySectionProps = {}) => {
	const data = useRender();
	const { summary } = data;

	if (!isVisibleSummary(summary)) return null;

	return (
		<SectionShell sectionId="summary" title={summary.title} showHeading={showHeading}>
			<SectionItems>
				<SectionItem itemId="content">
					<RichText semanticField="content">{summary.content}</RichText>
				</SectionItem>
			</SectionItems>
		</SectionShell>
	);
};

const CustomSummarySection = ({ section, showHeading = true }: CustomSummarySectionProps) => {
	const items = getVisibleItems(section);

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={section.id} title={section.title} showHeading={showHeading}>
			<SectionItems columns={section.columns}>
				{items.map((item) => (
					<SectionItem key={item.id} itemId={item.id}>
						<RichText semanticField="content">{item.content}</RichText>
					</SectionItem>
				))}
			</SectionItems>
		</SectionShell>
	);
};

const ProfileSection = ({ sectionId = "profiles", sectionData }: ItemSectionProps<ProfileItem> = {}) => {
	const data = useRender();
	const profiles = sectionData ?? data.sections.profiles;
	const items = getVisibleItems(profiles, "profiles");
	const inlineStyle = useTemplateStyle("inline");

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={sectionId} title={profiles.title}>
			<SectionItems columns={profiles.columns}>
				{items.map((item) => (
					<SectionItem key={item.id} itemId={item.id}>
						<SectionItemHeader>
							<View style={composeStyles(inlineStyle)}>
								<Icon name={item.icon as IconName} />
								<Bold semanticField="network">{item.network}</Bold>
							</View>
						</SectionItemHeader>
						<Link semanticRole="profile" src={item.website.url}>
							<Text semanticField="username">{item.username}</Text>
						</Link>
					</SectionItem>
				))}
			</SectionItems>
		</SectionShell>
	);
};

type ExperienceItemContentProps = {
	item: ExperienceItem;
	header: ReactNode;
	entry: EntryHeaderStyles;
	splitRowStyle: StyleInput;
	alignEndStyle: StyleInput;
};

const ExperienceItemContent = ({ item, header, entry, splitRowStyle, alignEndStyle }: ExperienceItemContentProps) => {
	const itemNodeKey = useSemanticNodeKey();
	const renderedChildKeys = useRenderedChildKeys(itemNodeKey);
	const headerNodeKey = itemNodeKey ? semanticNodeKeys.itemHeader(itemNodeKey) : undefined;
	const descriptionNodeKey = itemNodeKey ? semanticNodeKeys.field(itemNodeKey, "description") : undefined;
	const websiteNodeKey = itemNodeKey ? semanticNodeKeys.link(itemNodeKey, "website") : undefined;
	const headerExists = useSemanticNodeExists(headerNodeKey);
	const descriptionExists = useSemanticNodeExists(descriptionNodeKey);
	const websiteExists = useSemanticNodeExists(websiteNodeKey);
	const roleEntries = item.roles.map((role) => ({
		nodeKey: itemNodeKey ? semanticNodeKeys.item(itemNodeKey, role.id) : role.id,
		value: (
			<SemanticItemNodeKeyProvider key={role.id} itemId={role.id}>
				<Div bindCurrentNode>
					<SectionItemHeader style={entry.roleHeaderStyle}>
						{entry.layout === "date-column" ? (
							<>
								<View style={entry.dateCellStyle}>
									<Text semanticField="period">{role.period}</Text>
								</View>
								<Text semanticField="position" style={{ flex: 1 }}>
									{role.position}
								</Text>
							</>
						) : (
							<View style={composeStyles(splitRowStyle)}>
								<Text semanticField="position">{role.position}</Text>
								<Text semanticField="period" style={composeStyles(alignEndStyle)}>
									{role.period}
								</Text>
							</View>
						)}
					</SectionItemHeader>
					<RichText semanticField="description">{role.description}</RichText>
				</Div>
			</SemanticItemNodeKeyProvider>
		),
	}));
	const entries = [
		...(headerExists && headerNodeKey
			? [{ nodeKey: headerNodeKey, value: <Fragment key={headerNodeKey}>{header}</Fragment> }]
			: []),
		...roleEntries,
		...(descriptionExists && descriptionNodeKey
			? [
					{
						nodeKey: descriptionNodeKey,
						value: (
							<Fragment key={descriptionNodeKey}>
								<RichText semanticField="description">{item.description}</RichText>
							</Fragment>
						),
					},
				]
			: []),
		...(websiteExists && websiteNodeKey
			? [
					{
						nodeKey: websiteNodeKey,
						value: (
							<Fragment key={websiteNodeKey}>
								<ItemWebsiteLink website={item.website} />
							</Fragment>
						),
					},
				]
			: []),
	];

	return <>{projectRenderedChildren(renderedChildKeys, entries)}</>;
};

const ExperienceSection = ({ sectionId = "experience", sectionData }: ItemSectionProps<ExperienceItem> = {}) => {
	const data = useRender();
	const experience = sectionData ?? data.sections.experience;
	const items = getVisibleItems(experience, "experience");
	const splitRowStyle = useSectionSplitRowStyle();
	const alignEndStyle = useRowEndStyle(splitRowStyle);
	const entry = useEntryHeader("experience", experience.columns);

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={sectionId} title={experience.title}>
			<SectionItems columns={experience.columns}>
				{items.map((item) => {
					const roleFirst = leadsWithRole(entry.lead, "experience", item);
					const hasPosition = Boolean(item.position.trim());
					const hasLocation = Boolean(item.location.trim());
					const company = { field: "company", value: item.company, website: item.website };
					const position = { field: "position", value: item.position };

					const renderInlineHeader = () => (
						<InlineItemHeader
							roleFirst={roleFirst}
							leading={
								hasPosition || hasLocation ? (
									<SemanticTextRuns
										host="experience-position-location"
										separator=" "
										runs={[
											{ ...position, bold: roleFirst },
											{ field: "location", value: item.location, prefix: "(", suffix: ")" },
										]}
									/>
								) : null
							}
							middle={
								<ItemTitle field="company" website={item.website} bold={!roleFirst}>
									{item.company}
								</ItemTitle>
							}
							trailing={
								<Text semanticField="period" style={composeStyles(alignEndStyle)}>
									{item.period}
								</Text>
							}
						/>
					);

					// Each row's trailing text moves up a row when the first row has none; role-first swaps the rows.
					const renderSplitHeader = () => {
						const [firstTrailing, secondTrailing] = roleFirst
							? (["period", "location"] as const)
							: (["location", "period"] as const);
						const hasFirstTrailing = hasSplitRowText(item[firstTrailing]);
						const headerTrailingField = hasFirstTrailing ? firstTrailing : secondTrailing;
						const headerTrailing = item[headerTrailingField];
						const secondRowTrailing = hasFirstTrailing ? item[secondTrailing] : "";
						const hasSecond = Boolean((roleFirst ? item.company : item.position).trim());
						const trailingRuns = (field: "location" | "period", value: string) => (
							<SemanticTextRuns
								host={field === "location" ? "experience-location" : "experience-period"}
								separator=""
								runs={[{ field, value }]}
								style={composeStyles(alignEndStyle)}
							/>
						);

						return (
							<>
								<View style={composeStyles(splitRowStyle)}>
									{roleFirst ? (
										<ItemTitle field="position">{item.position}</ItemTitle>
									) : (
										<ItemTitle field="company" website={item.website}>
											{item.company}
										</ItemTitle>
									)}
									{hasSplitRowText(headerTrailing) && trailingRuns(headerTrailingField, headerTrailing)}
								</View>

								{(hasSecond || hasSplitRowText(secondRowTrailing)) && (
									<View style={hasSecond ? splitRowStyle : getTrailingOnlySplitRowStyle(splitRowStyle)}>
										{hasSecond &&
											(roleFirst ? (
												<ItemTitle field="company" website={item.website} bold={false}>
													{item.company}
												</ItemTitle>
											) : (
												<Text semanticField="position">{item.position}</Text>
											))}
										{hasSplitRowText(secondRowTrailing) && trailingRuns(secondTrailing, secondRowTrailing)}
									</View>
								)}
							</>
						);
					};

					const renderHeader = () => {
						if (entry.layout === "stacked") return renderSplitHeader();
						if (entry.layout === "inline") return renderInlineHeader();
						return (
							<EntryHeaderLayout
								entry={entry}
								lead={roleFirst ? position : company}
								runs={[roleFirst ? company : position, { field: "location", value: item.location }]}
								date={{ field: "period", value: item.period }}
							/>
						);
					};

					return (
						<SectionItem key={item.id} itemId={item.id} indent={entry.itemIndent}>
							<ExperienceItemContent
								item={item}
								header={<SectionItemHeader style={entry.headerStyle}>{renderHeader()}</SectionItemHeader>}
								entry={entry}
								splitRowStyle={splitRowStyle}
								alignEndStyle={alignEndStyle}
							/>
						</SectionItem>
					);
				})}
			</SectionItems>
		</SectionShell>
	);
};

type EducationItemContentProps = {
	item: EducationItem;
	header: ReactNode;
};

const EducationItemContent = ({ item, header }: EducationItemContentProps) => {
	const itemNodeKey = useSemanticNodeKey();
	const renderedChildKeys = useRenderedChildKeys(itemNodeKey);
	const headerNodeKey = itemNodeKey ? semanticNodeKeys.itemHeader(itemNodeKey) : undefined;
	const gradeRowNodeKey = semanticTemplatePartNodeKey(itemNodeKey, "education-grade-row");
	const descriptionNodeKey = itemNodeKey ? semanticNodeKeys.field(itemNodeKey, "description") : undefined;
	const websiteNodeKey = itemNodeKey ? semanticNodeKeys.link(itemNodeKey, "website") : undefined;
	const headerExists = useSemanticNodeExists(headerNodeKey);
	const gradeRowExists = useSemanticNodeExists(gradeRowNodeKey);
	const descriptionExists = useSemanticNodeExists(descriptionNodeKey);
	const websiteExists = useSemanticNodeExists(websiteNodeKey);
	const entries = [
		...(headerExists && headerNodeKey
			? [{ nodeKey: headerNodeKey, value: <Fragment key={headerNodeKey}>{header}</Fragment> }]
			: []),
		...(gradeRowExists && gradeRowNodeKey
			? [
					{
						nodeKey: gradeRowNodeKey,
						value: (
							<Fragment key={gradeRowNodeKey}>
								<SemanticTextRuns
									host="education-grade-location"
									nodeKey={gradeRowNodeKey}
									fieldOwnerNodeKey={headerNodeKey}
									separator=" • "
									runs={[
										{ field: "grade", value: item.grade },
										{ field: "location", value: item.location },
									]}
								/>
							</Fragment>
						),
					},
				]
			: []),
		...(descriptionExists && descriptionNodeKey
			? [
					{
						nodeKey: descriptionNodeKey,
						value: (
							<Fragment key={descriptionNodeKey}>
								<RichText semanticField="description">{item.description}</RichText>
							</Fragment>
						),
					},
				]
			: []),
		...(websiteExists && websiteNodeKey
			? [
					{
						nodeKey: websiteNodeKey,
						value: (
							<Fragment key={websiteNodeKey}>
								<ItemWebsiteLink website={item.website} />
							</Fragment>
						),
					},
				]
			: []),
	];

	return <>{projectRenderedChildren(renderedChildKeys, entries)}</>;
};

const EducationSection = ({ sectionId = "education", sectionData }: ItemSectionProps<EducationItem> = {}) => {
	const data = useRender();
	const education = sectionData ?? data.sections.education;
	const items = getVisibleItems(education, "education");
	const splitRowStyle = useSectionSplitRowStyle();
	const alignEndStyle = useRowEndStyle(splitRowStyle);
	const entry = useEntryHeader("education", education.columns);

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={sectionId} title={education.title}>
			<SectionItems columns={education.columns}>
				{items.map((item) => {
					const roleFirst = leadsWithRole(entry.lead, "education", item);
					const hasArea = Boolean(item.area.trim());
					const hasDegree = Boolean(item.degree.trim());
					const school = { field: "school", value: item.school, website: item.website };
					const area = { field: "area", value: item.area };

					const renderInlineHeader = () => (
						<InlineItemHeader
							roleFirst={roleFirst}
							leading={
								hasArea || hasDegree ? (
									<SemanticTextRuns
										host="education-area-degree"
										separator=" "
										runs={[
											{ ...area, bold: roleFirst },
											{ field: "degree", value: item.degree, prefix: "(", suffix: ")" },
										]}
									/>
								) : null
							}
							middle={
								<ItemTitle field="school" website={item.website} bold={!roleFirst}>
									{item.school}
								</ItemTitle>
							}
							trailing={
								<Text semanticField="period" style={composeStyles(alignEndStyle)}>
									{item.period}
								</Text>
							}
						/>
					);

					// The first row's pair moves up a row when it's empty; role-first swaps the rows.
					const renderSplitHeader = () => {
						const pairs = {
							"education-degree-grade": [
								{ field: "degree", value: item.degree },
								{ field: "grade", value: item.grade },
							],
							"education-location-period": [
								{ field: "location", value: item.location },
								{ field: "period", value: item.period },
							],
						} as const;
						const [firstHost, secondHost] = roleFirst
							? (["education-location-period", "education-degree-grade"] as const)
							: (["education-degree-grade", "education-location-period"] as const);
						const hasPair = (host: keyof typeof pairs) => pairs[host].some(({ value }) => hasSplitRowText(value));
						const hasFirst = hasPair(firstHost);
						const hasSecondPair = hasPair(secondHost);
						const hasSecond = Boolean((roleFirst ? item.school : item.area).trim());
						const pairRuns = (host: keyof typeof pairs) => (
							<SemanticTextRuns host={host} separator=" • " runs={pairs[host]} style={composeStyles(alignEndStyle)} />
						);

						return (
							<>
								<View style={composeStyles(splitRowStyle)}>
									{roleFirst ? (
										<ItemTitle field="area">{item.area}</ItemTitle>
									) : (
										<ItemTitle field="school" website={item.website}>
											{item.school}
										</ItemTitle>
									)}
									{(hasFirst || hasSecondPair) && pairRuns(hasFirst ? firstHost : secondHost)}
								</View>

								{(hasSecond || (hasFirst && hasSecondPair)) && (
									<View style={hasSecond ? splitRowStyle : getTrailingOnlySplitRowStyle(splitRowStyle)}>
										{hasSecond &&
											(roleFirst ? (
												<ItemTitle field="school" website={item.website} bold={false}>
													{item.school}
												</ItemTitle>
											) : (
												<Text semanticField="area">{item.area}</Text>
											))}
										{hasFirst && hasSecondPair && pairRuns(secondHost)}
									</View>
								)}
							</>
						);
					};

					const renderHeader = () => {
						if (entry.layout === "stacked") return renderSplitHeader();
						if (entry.layout === "inline") return renderInlineHeader();
						return (
							<EntryHeaderLayout
								entry={entry}
								lead={roleFirst ? area : school}
								runs={[
									roleFirst ? school : area,
									{ field: "degree", value: item.degree },
									{ field: "location", value: item.location },
									{ field: "grade", value: item.grade },
								]}
								date={{ field: "period", value: item.period }}
							/>
						);
					};

					return (
						<SectionItem key={item.id} itemId={item.id} indent={entry.itemIndent}>
							<EducationItemContent
								item={item}
								header={<SectionItemHeader style={entry.headerStyle}>{renderHeader()}</SectionItemHeader>}
							/>
						</SectionItem>
					);
				})}
			</SectionItems>
		</SectionShell>
	);
};

type DatedItemSectionProps = {
	sectionId: string;
	sectionData: ItemSection<ProjectItem | CertificationItem | PublicationItem> | undefined;
	sectionType: "projects" | "certifications" | "publications";
	titleField: string;
	dateField: string;
	subtitleField?: string;
};

// Projects, certifications and publications: a title and date row, an optional subtitle, a description and a link.
const DatedItemSection = ({
	sectionId,
	sectionData,
	sectionType,
	titleField,
	dateField,
	subtitleField,
}: DatedItemSectionProps) => {
	const data = useRender();
	const section = sectionData ?? data.sections[sectionType];
	const items = getVisibleItems<ProjectItem | CertificationItem | PublicationItem>(section, sectionType);
	const splitRowStyle = useSectionSplitRowStyle();
	const alignEndStyle = useRowEndStyle(splitRowStyle);
	const entry = useEntryHeader(sectionType, section.columns);

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={sectionId} title={section.title}>
			<SectionItems columns={section.columns}>
				{items.map((item) => {
					const fields = item as unknown as Record<string, string>;
					return (
						<SectionItem key={item.id} itemId={item.id} indent={entry.itemIndent}>
							<SectionItemHeader style={entry.headerStyle}>
								{entry.layout === "date-column" ? (
									<EntryHeaderLayout
										entry={entry}
										lead={{ field: titleField, value: fields[titleField] ?? "", website: item.website }}
										runs={subtitleField ? [{ field: subtitleField, value: fields[subtitleField] ?? "" }] : []}
										date={{ field: dateField, value: fields[dateField] ?? "" }}
									/>
								) : (
									<>
										<ItemHeaderRow style={composeStyles(splitRowStyle)}>
											<ItemTitle field={titleField} website={item.website}>
												{fields[titleField]}
											</ItemTitle>
											<RowEndText semanticField={dateField} style={composeStyles(alignEndStyle)}>
												{fields[dateField]}
											</RowEndText>
										</ItemHeaderRow>
										{subtitleField && <Text semanticField={subtitleField}>{fields[subtitleField]}</Text>}
									</>
								)}
							</SectionItemHeader>

							<RichText semanticField="description">{item.description}</RichText>

							<ItemWebsiteLink website={item.website} />
						</SectionItem>
					);
				})}
			</SectionItems>
		</SectionShell>
	);
};

const ProjectsSection = ({ sectionId = "projects", sectionData }: ItemSectionProps<ProjectItem> = {}) => (
	<DatedItemSection
		sectionId={sectionId}
		sectionData={sectionData}
		sectionType="projects"
		titleField="name"
		dateField="period"
	/>
);

const inlineSkillsItemStyle = {
	flexDirection: "row",
	alignItems: "flex-start",
	columnGap: 4,
} satisfies Style;

const getSkillsItemStyle = (isInline: boolean, item: SkillItem, metrics: ReturnType<typeof getTemplateMetrics>) => {
	if (isInline) {
		return composeStyles(
			inlineSkillsItemStyle,
			[hasSplitRowText(item.proficiency), Boolean(item.level), item.keywords.length > 0].filter(Boolean).length === 1
				? { alignItems: "center" }
				: undefined,
		);
	}
	return { rowGap: metrics.gapY(0.25) };
};

const SkillsSection = ({ sectionId = "skills", sectionData }: ItemSectionProps<SkillItem> = {}) => {
	const data = useRender();
	const skills = sectionData ?? data.sections.skills;
	const items = getVisibleItems(skills, "skills");
	const inlineStyle = useTemplateStyle("inline");
	const metrics = getTemplateMetrics(data.metadata.page);
	const skillLevelAfterName = useTemplateFeature("skillLevelAfterName");

	if (items.length === 0) return null;

	const isInlineSkillsItem = "layout" in skills && skills.layout === "inline";

	return (
		<SectionShell sectionId={sectionId} title={skills.title}>
			<SectionItems columns={skills.columns}>
				{items.map((item) => (
					<SectionItem key={item.id} itemId={item.id} style={getSkillsItemStyle(isInlineSkillsItem, item, metrics)}>
						<SectionItemHeader>
							<View style={composeStyles(inlineStyle)}>
								<Icon name={item.icon as IconName} />
								<Bold semanticField="name" style={composeStyles(isInlineSkillsItem ? undefined : { flex: 1 })}>
									{item.name}
								</Bold>
							</View>
						</SectionItemHeader>

						{skillLevelAfterName && <LevelDisplay level={item.level} />}
						<View style={{ flexGrow: skills.columns > 1 ? 1 : 0 }}>
							{hasSplitRowText(item.proficiency) && <Text semanticField="proficiency">{item.proficiency}</Text>}
							{"keywordLayout" in skills && skills.keywordLayout === "list" ? (
								item.keywords.map((keyword, index) => (
									<Small key={index} semanticField="keywords">{`• ${keyword}`}</Small>
								))
							) : (
								<Small semanticField="keywords">{item.keywords.join(", ")}</Small>
							)}
							{!skillLevelAfterName && isInlineSkillsItem && <LevelDisplay level={item.level} />}
						</View>
						{!skillLevelAfterName && !isInlineSkillsItem && <LevelDisplay level={item.level} />}
					</SectionItem>
				))}
			</SectionItems>
		</SectionShell>
	);
};

const LanguagesSection = ({ sectionId = "languages", sectionData }: ItemSectionProps<LanguageItem> = {}) => {
	const data = useRender();
	const languages = sectionData ?? data.sections.languages;
	const items = getVisibleItems(languages, "languages");

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={sectionId} title={languages.title}>
			<SectionItems columns={languages.columns}>
				{items.map((item) => (
					<SectionItem key={item.id} itemId={item.id}>
						<View style={{ flexGrow: languages.columns > 1 ? 1 : 0 }}>
							<SectionItemHeader>
								<Bold semanticField="language">{item.language}</Bold>
								<Text semanticField="fluency">{item.fluency}</Text>
							</SectionItemHeader>
						</View>
						<LevelDisplay level={item.level} />
					</SectionItem>
				))}
			</SectionItems>
		</SectionShell>
	);
};

const InterestsSection = ({ sectionId = "interests", sectionData }: ItemSectionProps<InterestItem> = {}) => {
	const data = useRender();
	const interests = sectionData ?? data.sections.interests;
	const items = getVisibleItems(interests, "interests");
	const inlineStyle = useTemplateStyle("inline");

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={sectionId} title={interests.title}>
			<SectionItems columns={interests.columns}>
				{items.map((item) => (
					<SectionItem key={item.id} itemId={item.id}>
						<SectionItemHeader>
							<View style={composeStyles(inlineStyle)}>
								<Icon name={item.icon as IconName} />
								<Bold semanticField="name">{item.name}</Bold>
							</View>
						</SectionItemHeader>

						<Small semanticField="keywords">{item.keywords.join(", ")}</Small>
					</SectionItem>
				))}
			</SectionItems>
		</SectionShell>
	);
};

const AwardsSection = ({ sectionId = "awards", sectionData }: ItemSectionProps<AwardItem> = {}) => {
	const data = useRender();
	const awards = sectionData ?? data.sections.awards;
	const items = getVisibleItems(awards, "awards");
	const splitRowStyle = useTemplateStyle("splitRow");
	const alignEndStyle = useRowEndStyle(composeStyles(splitRowStyle, awardTitleDateRowStyle(data.rtl)));
	const entry = useEntryHeader("awards", awards.columns);

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={sectionId} title={awards.title}>
			<SectionItems columns={awards.columns}>
				{items.map((item) => (
					<SectionItem key={item.id} itemId={item.id} indent={entry.itemIndent}>
						<SectionItemHeader style={entry.headerStyle}>
							{entry.layout === "date-column" ? (
								<EntryHeaderLayout
									entry={entry}
									lead={{ field: "title", value: item.title, website: item.website, bold: false }}
									runs={[{ field: "awarder", value: item.awarder }]}
									date={{ field: "date", value: item.date }}
								/>
							) : (
								<>
									<ItemHeaderRow style={composeStyles(splitRowStyle, awardTitleDateRowStyle(data.rtl))}>
										<ItemTitle field="title" website={item.website} bold={false}>
											{item.title}
										</ItemTitle>
										<RowEndText semanticField="date" style={composeStyles(alignEndStyle)}>
											{item.date}
										</RowEndText>
									</ItemHeaderRow>
									<Text semanticField="awarder">{item.awarder}</Text>
								</>
							)}
						</SectionItemHeader>
						<RichText semanticField="description">{item.description}</RichText>

						<ItemWebsiteLink website={item.website} />
					</SectionItem>
				))}
			</SectionItems>
		</SectionShell>
	);
};

const CertificationsSection = ({
	sectionId = "certifications",
	sectionData,
}: ItemSectionProps<CertificationItem> = {}) => (
	<DatedItemSection
		sectionId={sectionId}
		sectionData={sectionData}
		sectionType="certifications"
		titleField="title"
		dateField="date"
		subtitleField="issuer"
	/>
);

const PublicationsSection = ({ sectionId = "publications", sectionData }: ItemSectionProps<PublicationItem> = {}) => (
	<DatedItemSection
		sectionId={sectionId}
		sectionData={sectionData}
		sectionType="publications"
		titleField="title"
		dateField="date"
		subtitleField="publisher"
	/>
);

const VolunteerSection = ({ sectionId = "volunteer", sectionData }: ItemSectionProps<VolunteerItem> = {}) => {
	const data = useRender();
	const volunteer = sectionData ?? data.sections.volunteer;
	const items = getVisibleItems(volunteer, "volunteer");
	const splitRowStyle = useSectionSplitRowStyle();
	const alignEndStyle = useRowEndStyle(splitRowStyle);
	const entry = useEntryHeader("volunteer", volunteer.columns);

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={sectionId} title={volunteer.title}>
			<SectionItems columns={volunteer.columns}>
				{items.map((item) => {
					return (
						<SectionItem key={item.id} itemId={item.id} indent={entry.itemIndent}>
							<SectionItemHeader style={entry.headerStyle}>
								{entry.layout === "inline" ? (
									<InlineItemHeader
										leading={
											hasSplitRowText(item.location) ? <Text semanticField="location">{item.location}</Text> : null
										}
										middle={
											<ItemTitle field="organization" website={item.website}>
												{item.organization}
											</ItemTitle>
										}
										trailing={
											<Text semanticField="period" style={composeStyles(alignEndStyle)}>
												{item.period}
											</Text>
										}
									/>
								) : entry.layout !== "stacked" ? (
									<EntryHeaderLayout
										entry={entry}
										lead={{ field: "organization", value: item.organization, website: item.website }}
										runs={[{ field: "location", value: item.location }]}
										date={{ field: "period", value: item.period }}
									/>
								) : (
									<>
										<View style={composeStyles(splitRowStyle)}>
											<ItemTitle field="organization" website={item.website}>
												{item.organization}
											</ItemTitle>
											{hasSplitRowText(item.period) && (
												<Text semanticField="period" style={composeStyles(alignEndStyle)}>
													{item.period}
												</Text>
											)}
										</View>

										<Text semanticField="location">{item.location}</Text>
									</>
								)}
							</SectionItemHeader>
							<RichText semanticField="description">{item.description}</RichText>

							<ItemWebsiteLink website={item.website} />
						</SectionItem>
					);
				})}
			</SectionItems>
		</SectionShell>
	);
};

const ReferencesSection = ({ sectionId = "references", sectionData }: ItemSectionProps<ReferenceItem> = {}) => {
	const data = useRender();
	const references = sectionData ?? data.sections.references;
	const items = getVisibleItems(references, "references");

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={sectionId} title={references.title}>
			<SectionItems columns={references.columns}>
				{items.map((item) => (
					<SectionItem key={item.id} itemId={item.id}>
						<SectionItemHeader>
							<ItemTitle field="name" website={item.website}>
								{item.name}
							</ItemTitle>
							{hasSplitRowText(item.position) && <Text semanticField="position">{item.position}</Text>}
							{hasSplitRowText(item.phone) && (
								<Text semanticField="phone" style={{ direction: "ltr" }}>
									{item.phone}
								</Text>
							)}
						</SectionItemHeader>
						<RichText semanticField="description">{item.description}</RichText>

						<ItemWebsiteLink website={item.website} />
					</SectionItem>
				))}
			</SectionItems>
		</SectionShell>
	);
};

const CoverLetterSection = ({ section }: CoverLetterSectionProps) => {
	const items = getVisibleItems(section);

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={section.id} title={section.title} showHeading={false}>
			<SectionItems>
				{items.map((item) => (
					<SectionItem key={item.id} itemId={item.id}>
						<RichText semanticField="recipient">{item.recipient}</RichText>
						<RichText semanticField="content">{item.content}</RichText>
					</SectionItem>
				))}
			</SectionItems>
		</SectionShell>
	);
};

export const Section = ({ section: sectionId, placement, showHeading = true }: SectionProps) => {
	const data = useRender();

	if (!isSectionVisible(sectionId, data)) return null;

	// A custom section renders from its own record; a built-in one falls back to data.sections[id].
	const custom = data.customSections.find((section) => section.id === sectionId);
	// ponytail: satisfies Record<CustomSectionType,...> gives compile-time exhaustiveness without ts-pattern
	const sectionMap = {
		summary: () =>
			custom ? (
				<CustomSummarySection section={custom as CustomItemSection<SummaryItem>} showHeading={showHeading} />
			) : (
				<SummarySection showHeading={showHeading} />
			),
		profiles: () => <ProfileSection sectionId={sectionId} sectionData={custom as CustomItemSection<ProfileItem>} />,
		experience: () => (
			<ExperienceSection sectionId={sectionId} sectionData={custom as CustomItemSection<ExperienceItem>} />
		),
		education: () => (
			<EducationSection sectionId={sectionId} sectionData={custom as CustomItemSection<EducationItem>} />
		),
		projects: () => <ProjectsSection sectionId={sectionId} sectionData={custom as CustomItemSection<ProjectItem>} />,
		skills: () => <SkillsSection sectionId={sectionId} sectionData={custom as CustomItemSection<SkillItem>} />,
		languages: () => <LanguagesSection sectionId={sectionId} sectionData={custom as CustomItemSection<LanguageItem>} />,
		interests: () => <InterestsSection sectionId={sectionId} sectionData={custom as CustomItemSection<InterestItem>} />,
		awards: () => <AwardsSection sectionId={sectionId} sectionData={custom as CustomItemSection<AwardItem>} />,
		certifications: () => (
			<CertificationsSection sectionId={sectionId} sectionData={custom as CustomItemSection<CertificationItem>} />
		),
		publications: () => (
			<PublicationsSection sectionId={sectionId} sectionData={custom as CustomItemSection<PublicationItem>} />
		),
		volunteer: () => (
			<VolunteerSection sectionId={sectionId} sectionData={custom as CustomItemSection<VolunteerItem>} />
		),
		references: () => (
			<ReferencesSection sectionId={sectionId} sectionData={custom as CustomItemSection<ReferenceItem>} />
		),
		"cover-letter": () => custom && <CoverLetterSection section={custom as CustomItemSection<CoverLetterItem>} />,
	} satisfies Record<CustomSectionType, () => ReactNode>;

	const render = (sectionMap as Record<string, (() => ReactNode) | undefined>)[custom?.type ?? sectionId];

	return <TemplatePlacementProvider placement={placement}>{render?.()}</TemplatePlacementProvider>;
};
