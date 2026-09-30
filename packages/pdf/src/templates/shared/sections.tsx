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
	ResumeData,
	SectionType,
	SkillItem,
	SummaryItem,
	VolunteerItem,
} from "@reactive-resume/schema/resume/data";
import type { ReactNode } from "react";
import { Children, createContext, Fragment, isValidElement, use } from "react";
import { View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { getResumeSectionIcon } from "../../section-icon";
import { getResumeSectionTitle } from "../../section-title";
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
import { getSectionItemRows, getSectionItemsLayout, shouldUseSectionTimeline } from "./columns";
import { getWebsiteDisplayText } from "./contact";
import {
	TemplatePlacementProvider,
	useTemplateFeature,
	useTemplateFeatureStyle,
	useTemplatePageNodeKey,
	useTemplatePlacement,
	useTemplateStyle,
} from "./context";
import { filterItems, hasVisibleItems, isSectionVisible, isVisibleSummary } from "./filtering";
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
};

type InlineItemHeaderProps = {
	leading?: ReactNode;
	middle?: ReactNode;
	trailing?: ReactNode;
};

type SectionItemHeaderProps = {
	children: ReactNode;
};

type ItemWebsite = {
	url: string;
	label: string;
	inlineLink?: boolean | undefined;
};

type ItemTitleProps = {
	children: ReactNode;
	website: ItemWebsite;
	field: string;
	bold?: boolean;
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

type CustomSectionProps = {
	sectionId: string;
	showHeading?: boolean;
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
};

type SemanticTextRunsProps = {
	runs: readonly SemanticTextRun[];
	separator: string;
	host: CombinedTextName;
	style?: StyleInput;
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
	flexDirection: "row",
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

const SemanticTextRuns = ({ runs, separator, host, style, nodeKey, fieldOwnerNodeKey }: SemanticTextRunsProps) => {
	const contextualNodeKey = useSemanticNodeKey();
	const fieldParentNodeKey = fieldOwnerNodeKey ?? contextualNodeKey;
	const combinedTextOwnerNodeKey =
		host === "experience-position-location" || host === "education-area-degree"
			? semanticTemplatePartNodeKey(fieldParentNodeKey, "inline-item-header-leading")
			: (nodeKey ?? fieldParentNodeKey);
	const combinedTextNodeKey = combinedTextOwnerNodeKey
		? semanticNodeKeys.combinedText(combinedTextOwnerNodeKey, host)
		: undefined;
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
				{visibleRuns.map(({ field, value, prefix = "", suffix = "" }, index) => (
					<Fragment key={field}>
						{index === 0 ? "" : separator}
						<Text semanticField={field}>
							{prefix}
							{value}
							{suffix}
						</Text>
					</Fragment>
				))}
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

// Resolve the per-section page-break constraints the same way section title/icon are resolved:
// standard sections live under data.sections[id], the summary under data.summary, and custom
// sections are matched by id. Missing flags default to false (older stored resumes lack them).
const getSectionBreaks = (data: ResumeData, sectionId: string): { keepTogether: boolean; startOnNewPage: boolean } => {
	if (sectionId === "summary") {
		return { keepTogether: data.summary.keepTogether, startOnNewPage: data.summary.startOnNewPage };
	}

	if (sectionId in data.sections) {
		const section = data.sections[sectionId as SectionType];
		return { keepTogether: section.keepTogether, startOnNewPage: section.startOnNewPage };
	}

	const customSection = data.customSections.find((section) => section.id === sectionId);
	return {
		keepTogether: customSection?.keepTogether ?? false,
		startOnNewPage: customSection?.startOnNewPage ?? false,
	};
};

const SectionShell = ({ sectionId, title, showHeading = true, children }: SectionShellProps) => {
	const data = useRender();
	const pageNodeKey = useTemplatePageNodeKey();
	const sectionNodeKey = useSemanticSectionNodeKey(pageNodeKey, sectionId);
	const resolved = useResolvedNode(sectionNodeKey);
	const visible = useSemanticNodeVisible(sectionNodeKey);
	const sectionStyle = useTemplateStyle("section");
	const sectionHeadingStyle = useTemplateStyle("sectionHeading");
	const sectionHeadingContainerStyle = useTemplateStyle("sectionHeadingContainer");
	const sectionTitle = getResumeSectionTitle(data, sectionId, title);
	const sectionHeadingEnabled = (() => {
		if (sectionId === "summary") return data.summary.showHeading !== false;
		if (sectionId in data.sections) return data.sections[sectionId as SectionType].showHeading !== false;
		return data.customSections.find((section) => section.id === sectionId)?.showHeading !== false;
	})();
	const sectionHeadingNodeKey = semanticNodeKeys.sectionHeading(sectionNodeKey);
	const sectionHeadingResolved = useResolvedNode(sectionHeadingNodeKey);
	const sectionHeadingVisible = useSemanticNodeVisible(sectionHeadingNodeKey);
	const sectionIcon = getResumeSectionIcon(data, sectionId);
	const showIcon = Boolean(sectionIcon) && !data.metadata.page.hideSectionIcons;
	const { keepTogether, startOnNewPage } = getSectionBreaks(data, sectionId);
	// wrap={false} keeps the whole section on one page; break forces it onto a fresh page.
	// Only set the props when enabled so we never pass undefined (exactOptionalPropertyTypes).
	const breakProps: { wrap?: false; break?: true } = {};
	// ponytail: react-pdf ceiling — wrap={false} keeps a section together only if it fits on
	// one page; a section taller than a full page is clipped, not split. No upgrade path in
	// react-pdf, so the layout UI warns users this only works for sections that fit one page.
	if (keepTogether) breakProps.wrap = false;
	if (startOnNewPage) breakProps.break = true;
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
						style={composeStyles(
							sectionHeadingStyle,
							defaultSectionHeadingContainerStyle,
							sectionHeadingContainerStyle,
							sectionHeadingResolved.style,
						)}
					>
						<SectionHeadingIcon
							nodeKey={semanticNodeKeys.icon(sectionHeadingNodeKey, "section")}
							name={sectionIcon as IconName}
						/>
						<Heading
							bindSemanticNode={false}
							style={getSectionHeadingTextStyle(
								sectionHeadingStyle,
								sectionHeadingTextOf(sectionHeadingResolved.style),
							)}
						>
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

const SectionItem = ({ itemId, children, style }: SectionItemProps) => {
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

	if (!useTimeline) {
		return (
			<SemanticNodeKeyProvider nodeKey={itemNodeKey}>
				<Div nodeKey={itemNodeKey} style={composeStyles(itemStyle, sectionItemStyle, style)}>
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
					style={composeStyles(itemStyle, timelineContentStyle, style, timelineContentResolved.style)}
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
const InlineItemHeader = ({ leading, middle, trailing }: InlineItemHeaderProps) => {
	const inlineItemHeaderStyle = useTemplateStyle("inlineItemHeader");
	const leadingStyle = useTemplateStyle("inlineItemHeaderLeading");
	const middleStyle = useTemplateStyle("inlineItemHeaderMiddle");
	const trailingStyle = useTemplateStyle("inlineItemHeaderTrailing");

	const nodeKey = useSemanticNodeKey();
	const renderedChildKeys = useRenderedChildKeys(nodeKey);
	const parts = [
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
	];

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
		alignItems: "flex-start",
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
const SectionItemHeader = ({ children }: SectionItemHeaderProps) => {
	const itemNodeKey = useSemanticNodeKey();
	const itemHeaderNodeKey = itemNodeKey ? semanticNodeKeys.itemHeader(itemNodeKey) : undefined;
	const sectionItemHeaderStyle = useTemplateStyle("sectionItemHeader");
	const exists = useSemanticNodeExists(itemHeaderNodeKey);
	if (!exists) return <>{children}</>;

	return (
		<SemanticNodeKeyProvider nodeKey={itemHeaderNodeKey}>
			<Div nodeKey={itemHeaderNodeKey} style={composeStyles(sectionItemHeaderStyle)}>
				{children}
			</Div>
		</SemanticNodeKeyProvider>
	);
};

const ItemTitle = ({ children, website, field, bold = true }: ItemTitleProps) => {
	const inlineWebsiteUrl = getInlineItemWebsiteUrl(website);
	const style = use(ItemHeaderRowNowrapContext) ? nowrapItemTitleStyle : wrappingItemTitleStyle;
	const title = bold ? (
		<Bold style={style} semanticField={field}>
			{children}
		</Bold>
	) : (
		<Text style={style} semanticField={field}>
			{children}
		</Text>
	);

	if (!inlineWebsiteUrl) return title;

	return (
		<Link style={style} semanticRole="inline-website" src={inlineWebsiteUrl}>
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
	splitRowStyle: StyleInput;
	alignEndStyle: StyleInput;
};

const ExperienceItemContent = ({ item, header, splitRowStyle, alignEndStyle }: ExperienceItemContentProps) => {
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
					<SectionItemHeader>
						<View style={composeStyles(splitRowStyle)}>
							<Text semanticField="position">{role.position}</Text>
							<Text semanticField="period" style={composeStyles(alignEndStyle)}>
								{role.period}
							</Text>
						</View>
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
	const alignEndStyle = useTemplateStyle("alignEnd");
	const inlineItemHeader = useTemplateFeature("inlineItemHeader");

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={sectionId} title={experience.title}>
			<SectionItems columns={experience.columns}>
				{items.map((item) => {
					const hasPosition = Boolean(item.position.trim());
					const hasLocation = Boolean(item.location.trim());
					const headerLocation = hasLocation ? item.location : item.period;
					const headerLocationField = hasLocation ? "location" : "period";
					const headerPeriod = hasLocation ? item.period : "";

					const renderInlineHeader = () => (
						<InlineItemHeader
							leading={
								hasPosition || hasLocation ? (
									<SemanticTextRuns
										host="experience-position-location"
										separator=" "
										runs={[
											{ field: "position", value: item.position },
											{ field: "location", value: item.location, prefix: "(", suffix: ")" },
										]}
									/>
								) : null
							}
							middle={
								<ItemTitle field="company" website={item.website}>
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

					const renderSplitHeader = () => (
						<>
							<View style={composeStyles(splitRowStyle)}>
								<ItemTitle field="company" website={item.website}>
									{item.company}
								</ItemTitle>
								{hasSplitRowText(headerLocation) && (
									<SemanticTextRuns
										host={headerLocationField === "location" ? "experience-location" : "experience-period"}
										separator=""
										runs={[{ field: headerLocationField, value: headerLocation }]}
										style={composeStyles(alignEndStyle)}
									/>
								)}
							</View>

							{(hasPosition || hasSplitRowText(headerPeriod)) && (
								<View style={hasPosition ? splitRowStyle : getTrailingOnlySplitRowStyle(splitRowStyle)}>
									{hasPosition && <Text semanticField="position">{item.position}</Text>}
									{hasSplitRowText(headerPeriod) && (
										<SemanticTextRuns
											host="experience-period"
											separator=""
											runs={[{ field: "period", value: headerPeriod }]}
											style={composeStyles(alignEndStyle)}
										/>
									)}
								</View>
							)}
						</>
					);

					return (
						<SectionItem key={item.id} itemId={item.id}>
							<ExperienceItemContent
								item={item}
								header={
									<SectionItemHeader>{inlineItemHeader ? renderInlineHeader() : renderSplitHeader()}</SectionItemHeader>
								}
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
	const alignEndStyle = useTemplateStyle("alignEnd");
	const inlineItemHeader = useTemplateFeature("inlineItemHeader");

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={sectionId} title={education.title}>
			<SectionItems columns={education.columns}>
				{items.map((item) => {
					const hasArea = Boolean(item.area.trim());
					const hasDegree = Boolean(item.degree.trim());
					const hasDegreeOrGrade = hasSplitRowText(item.degree) || hasSplitRowText(item.grade);
					const hasLocationOrPeriod = hasSplitRowText(item.location) || hasSplitRowText(item.period);

					const renderInlineHeader = () => (
						<InlineItemHeader
							leading={
								hasArea || hasDegree ? (
									<SemanticTextRuns
										host="education-area-degree"
										separator=" "
										runs={[
											{ field: "area", value: item.area },
											{ field: "degree", value: item.degree, prefix: "(", suffix: ")" },
										]}
									/>
								) : null
							}
							middle={
								<ItemTitle field="school" website={item.website}>
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

					const renderSplitHeader = () => (
						<>
							<View style={composeStyles(splitRowStyle)}>
								<ItemTitle field="school" website={item.website}>
									{item.school}
								</ItemTitle>
								{(hasDegreeOrGrade || hasLocationOrPeriod) && (
									<SemanticTextRuns
										host={hasDegreeOrGrade ? "education-degree-grade" : "education-location-period"}
										separator=" • "
										runs={
											hasDegreeOrGrade
												? [
														{ field: "degree", value: item.degree },
														{ field: "grade", value: item.grade },
													]
												: [
														{ field: "location", value: item.location },
														{ field: "period", value: item.period },
													]
										}
										style={composeStyles(alignEndStyle)}
									/>
								)}
							</View>

							{(hasArea || (hasDegreeOrGrade && hasLocationOrPeriod)) && (
								<View style={hasArea ? splitRowStyle : getTrailingOnlySplitRowStyle(splitRowStyle)}>
									{hasArea && <Text semanticField="area">{item.area}</Text>}
									{hasDegreeOrGrade && hasLocationOrPeriod && (
										<SemanticTextRuns
											host="education-location-period"
											separator=" • "
											runs={[
												{ field: "location", value: item.location },
												{ field: "period", value: item.period },
											]}
											style={composeStyles(alignEndStyle)}
										/>
									)}
								</View>
							)}
						</>
					);

					return (
						<SectionItem key={item.id} itemId={item.id}>
							<EducationItemContent
								item={item}
								header={
									<SectionItemHeader>{inlineItemHeader ? renderInlineHeader() : renderSplitHeader()}</SectionItemHeader>
								}
							/>
						</SectionItem>
					);
				})}
			</SectionItems>
		</SectionShell>
	);
};

const ProjectsSection = ({ sectionId = "projects", sectionData }: ItemSectionProps<ProjectItem> = {}) => {
	const data = useRender();
	const projects = sectionData ?? data.sections.projects;
	const items = getVisibleItems(projects, "projects");
	const splitRowStyle = useSectionSplitRowStyle();
	const alignEndStyle = useTemplateStyle("alignEnd");

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={sectionId} title={projects.title}>
			<SectionItems columns={projects.columns}>
				{items.map((item) => (
					<SectionItem key={item.id} itemId={item.id}>
						<SectionItemHeader>
							<ItemHeaderRow style={composeStyles(splitRowStyle)}>
								<ItemTitle field="name" website={item.website}>
									{item.name}
								</ItemTitle>
								<Text semanticField="period" style={composeStyles(alignEndStyle)}>
									{item.period}
								</Text>
							</ItemHeaderRow>
						</SectionItemHeader>

						<RichText semanticField="description">{item.description}</RichText>

						<ItemWebsiteLink website={item.website} />
					</SectionItem>
				))}
			</SectionItems>
		</SectionShell>
	);
};

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
	const alignEndStyle = useTemplateStyle("alignEnd");

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={sectionId} title={awards.title}>
			<SectionItems columns={awards.columns}>
				{items.map((item) => (
					<SectionItem key={item.id} itemId={item.id}>
						<SectionItemHeader>
							<ItemHeaderRow style={composeStyles(splitRowStyle, awardTitleDateRowStyle(data.rtl))}>
								<ItemTitle field="title" website={item.website} bold={false}>
									{item.title}
								</ItemTitle>
								<Text semanticField="date" style={composeStyles(alignEndStyle)}>
									{item.date}
								</Text>
							</ItemHeaderRow>
							<Text semanticField="awarder">{item.awarder}</Text>
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
}: ItemSectionProps<CertificationItem> = {}) => {
	const data = useRender();
	const certifications = sectionData ?? data.sections.certifications;
	const items = getVisibleItems(certifications, "certifications");
	const splitRowStyle = useSectionSplitRowStyle();
	const alignEndStyle = useTemplateStyle("alignEnd");

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={sectionId} title={certifications.title}>
			<SectionItems columns={certifications.columns}>
				{items.map((item) => (
					<SectionItem key={item.id} itemId={item.id}>
						<SectionItemHeader>
							<ItemHeaderRow style={composeStyles(splitRowStyle)}>
								<ItemTitle field="title" website={item.website}>
									{item.title}
								</ItemTitle>
								<Text semanticField="date" style={composeStyles(alignEndStyle)}>
									{item.date}
								</Text>
							</ItemHeaderRow>
							<Text semanticField="issuer">{item.issuer}</Text>
						</SectionItemHeader>

						<RichText semanticField="description">{item.description}</RichText>

						<ItemWebsiteLink website={item.website} />
					</SectionItem>
				))}
			</SectionItems>
		</SectionShell>
	);
};

const PublicationsSection = ({ sectionId = "publications", sectionData }: ItemSectionProps<PublicationItem> = {}) => {
	const data = useRender();
	const publications = sectionData ?? data.sections.publications;
	const items = getVisibleItems(publications, "publications");
	const splitRowStyle = useSectionSplitRowStyle();
	const alignEndStyle = useTemplateStyle("alignEnd");

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={sectionId} title={publications.title}>
			<SectionItems columns={publications.columns}>
				{items.map((item) => (
					<SectionItem key={item.id} itemId={item.id}>
						<SectionItemHeader>
							<ItemHeaderRow style={composeStyles(splitRowStyle)}>
								<ItemTitle field="title" website={item.website}>
									{item.title}
								</ItemTitle>
								<Text semanticField="date" style={composeStyles(alignEndStyle)}>
									{item.date}
								</Text>
							</ItemHeaderRow>

							<Text semanticField="publisher">{item.publisher}</Text>
						</SectionItemHeader>

						<RichText semanticField="description">{item.description}</RichText>

						<ItemWebsiteLink website={item.website} />
					</SectionItem>
				))}
			</SectionItems>
		</SectionShell>
	);
};

const VolunteerSection = ({ sectionId = "volunteer", sectionData }: ItemSectionProps<VolunteerItem> = {}) => {
	const data = useRender();
	const volunteer = sectionData ?? data.sections.volunteer;
	const items = getVisibleItems(volunteer, "volunteer");
	const splitRowStyle = useSectionSplitRowStyle();
	const alignEndStyle = useTemplateStyle("alignEnd");
	const inlineItemHeader = useTemplateFeature("inlineItemHeader");

	if (items.length === 0) return null;

	return (
		<SectionShell sectionId={sectionId} title={volunteer.title}>
			<SectionItems columns={volunteer.columns}>
				{items.map((item) => {
					return (
						<SectionItem key={item.id} itemId={item.id}>
							<SectionItemHeader>
								{inlineItemHeader ? (
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
							{hasSplitRowText(item.phone) && <Text semanticField="phone">{item.phone}</Text>}
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

const CustomSection = ({ sectionId, showHeading = true }: CustomSectionProps) => {
	const data = useRender();
	const customSection = data.customSections.find((section) => section.id === sectionId);

	if (!customSection) return null;

	// ponytail: satisfies Record<CustomSectionType,...> gives compile-time exhaustiveness without ts-pattern
	const customSectionMap = {
		summary: () => (
			<CustomSummarySection section={customSection as CustomItemSection<SummaryItem>} showHeading={showHeading} />
		),
		profiles: () => (
			<ProfileSection sectionId={sectionId} sectionData={customSection as CustomItemSection<ProfileItem>} />
		),
		experience: () => (
			<ExperienceSection sectionId={sectionId} sectionData={customSection as CustomItemSection<ExperienceItem>} />
		),
		education: () => (
			<EducationSection sectionId={sectionId} sectionData={customSection as CustomItemSection<EducationItem>} />
		),
		projects: () => (
			<ProjectsSection sectionId={sectionId} sectionData={customSection as CustomItemSection<ProjectItem>} />
		),
		skills: () => <SkillsSection sectionId={sectionId} sectionData={customSection as CustomItemSection<SkillItem>} />,
		languages: () => (
			<LanguagesSection sectionId={sectionId} sectionData={customSection as CustomItemSection<LanguageItem>} />
		),
		interests: () => (
			<InterestsSection sectionId={sectionId} sectionData={customSection as CustomItemSection<InterestItem>} />
		),
		awards: () => <AwardsSection sectionId={sectionId} sectionData={customSection as CustomItemSection<AwardItem>} />,
		certifications: () => (
			<CertificationsSection
				sectionId={sectionId}
				sectionData={customSection as CustomItemSection<CertificationItem>}
			/>
		),
		publications: () => (
			<PublicationsSection sectionId={sectionId} sectionData={customSection as CustomItemSection<PublicationItem>} />
		),
		volunteer: () => (
			<VolunteerSection sectionId={sectionId} sectionData={customSection as CustomItemSection<VolunteerItem>} />
		),
		references: () => (
			<ReferencesSection sectionId={sectionId} sectionData={customSection as CustomItemSection<ReferenceItem>} />
		),
		"cover-letter": () => <CoverLetterSection section={customSection as CustomItemSection<CoverLetterItem>} />,
	} satisfies Record<CustomSectionType, () => ReactNode>;

	return customSectionMap[customSection.type]();
};

export const Section = ({ section, placement, showHeading = true }: SectionProps) => {
	const data = useRender();

	if (!isSectionVisible(section, data)) return null;

	// ponytail: satisfies exhaustiveness over built-in types; custom IDs fall through to CustomSection
	const builtInSectionMap = {
		summary: () => <SummarySection showHeading={showHeading} />,
		profiles: () => <ProfileSection />,
		experience: () => <ExperienceSection />,
		education: () => <EducationSection />,
		projects: () => <ProjectsSection />,
		skills: () => <SkillsSection />,
		languages: () => <LanguagesSection />,
		interests: () => <InterestsSection />,
		awards: () => <AwardsSection />,
		certifications: () => <CertificationsSection />,
		publications: () => <PublicationsSection />,
		volunteer: () => <VolunteerSection />,
		references: () => <ReferencesSection />,
	} satisfies Record<Exclude<CustomSectionType, "cover-letter">, () => ReactNode>;

	const render = (builtInSectionMap as Record<string, (() => ReactNode) | undefined>)[section];

	return (
		<TemplatePlacementProvider placement={placement}>
			{render ? render() : <CustomSection sectionId={section} showHeading={showHeading} />}
		</TemplatePlacementProvider>
	);
};
