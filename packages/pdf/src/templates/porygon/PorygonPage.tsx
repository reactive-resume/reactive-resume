import type { TemplatePageProps } from "../../document";
import type { Style } from "../../forme/style-types";
import type { TemplateColorRoles, TemplateStyleContext, TemplateStyleSlots } from "../shared/types";
import { useMemo } from "react";
import { Page, StyleSheet, View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { useRenderedSectionIds, useResolvedNode } from "../../semantic/context";
import { semanticNodeKeys } from "../../semantic/node-keys";
import { getPrimaryTint } from "../shared/color-helpers";
import {
	CustomFieldContactItem,
	EmailContactItem,
	LocationContactItem,
	PhoneContactItem,
	WebsiteContactItem,
} from "../shared/contact-item";
import { TemplateProvider } from "../shared/context";
import { filterSections } from "../shared/filtering";
import { getTemplateMetrics } from "../shared/metrics";
import { hasTemplatePicture } from "../shared/picture";
import {
	Heading,
	SemanticContactListView,
	SemanticHeaderPicture,
	SemanticHeaderView,
	SemanticRegionView,
	Text,
} from "../shared/primitives";
import { Section } from "../shared/sections";
import { composeStyles, headerNameLineHeight } from "../shared/styles";
import { createIconSlot, useTemplateBase } from "../shared/template-base";

type PorygonStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	headerFields: Style;
	headerIdentity: Style;
	headerName: Style;
	headerHeadline: Style;
	contactList: Style;
	contactItem: Style;
	pictureCell: Style;
	picture: Style;
	sections: Style;
};

type PorygonTemplate = {
	colors: TemplateColorRoles;
	styles: PorygonStyles;
};

type PorygonHeaderProps = {
	styles: PorygonStyles;
};

/**
 * Porygon lays the resume out as a ruled form, after the Japanese rirekisho: the header is a bordered
 * block of field cells with the photo in a cell of its own, and every section is a table with a solid
 * title bar over one ruled row per entry. The rules, not whitespace, carry the structure.
 */
export const PorygonPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = usePorygonTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const mainSections = useRenderedSectionIds(pageNodeKey, filterSections(page.main, data));
	const sidebarSections = useRenderedSectionIds(pageNodeKey, page.fullWidth ? [] : filterSections(page.sidebar, data));
	const sections = [...mainSections, ...sidebarSections];

	return (
		<Page
			{...semanticPageProps}
			size={semanticPageSize ?? pageSize}
			style={composeStyles(styles.page, pageMinHeightStyle, semanticPageStyle)}
		>
			<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors}>
				{showHeader && <Header styles={styles} />}

				<SemanticRegionView region="main" style={composeStyles(styles.sections, { rowGap: metrics.sectionGap })}>
					{sections.map((section) => (
						<Section key={section} section={section} placement="main" />
					))}
				</SemanticRegionView>
			</TemplateProvider>
		</Page>
	);
};

const Header = ({ styles }: PorygonHeaderProps) => {
	const { basics, picture } = useRender();
	const hasPicture = hasTemplatePicture(picture);

	return (
		<SemanticHeaderView style={styles.header}>
			<View style={styles.headerFields}>
				<View style={styles.headerIdentity}>
					<Heading style={styles.headerName}>{basics.name}</Heading>
					{basics.headline && <Text style={styles.headerHeadline}>{basics.headline}</Text>}
				</View>

				<SemanticContactListView style={styles.contactList}>
					<EmailContactItem email={basics.email} style={styles.contactItem} />
					<PhoneContactItem phone={basics.phone} style={styles.contactItem} />
					<LocationContactItem location={basics.location} style={styles.contactItem} />
					<WebsiteContactItem website={basics.website} style={styles.contactItem} />
					{basics.customFields.map((field) => (
						<CustomFieldContactItem key={field.id} field={field} style={styles.contactItem} />
					))}
				</SemanticContactListView>
			</View>

			{hasPicture && (
				<View style={styles.pictureCell}>
					<SemanticHeaderPicture src={picture.url} style={styles.picture} />
				</View>
			)}
		</SemanticHeaderView>
	);
};

const usePorygonTemplate = (): PorygonTemplate => {
	const { metadata, r, foreground, background, primary, metrics, base } = useTemplateBase();

	return useMemo(() => {
		const colors: TemplateColorRoles = { foreground, background, primary };
		const { heading } = metadata.typography;
		// The header's frame and the title bars are solid accent; every rule between cells is a light tint of it.
		const rule = getPrimaryTint(metadata.design.colors.primary, 0.3);
		const ruleWidth = 0.75;
		const cellX = metrics.gapX(0.75);
		const cellY = metrics.gapY(0.75);
		// Each contact cell draws the rule on its own start side; pulling the grid back by one rule hides the first
		// column's rule under the header's frame.
		const ruleStart = r.rtl
			? { borderRightWidth: ruleWidth, borderRightColor: rule }
			: { borderLeftWidth: ruleWidth, borderLeftColor: rule };

		const baseStyles = StyleSheet.create({
			...base,
			page: {
				...base.page,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
				rowGap: metrics.sectionGap,
			},
			heading: { ...base.heading, fontWeight: heading.fontWeights.at(-1) ?? "700" },
			section: {
				flexDirection: "column",
			},
			sectionHeading: {
				backgroundColor: primary,
				color: background,
				fontSize: heading.fontSize * 0.8,
				// Tracking breaks the joins of cursive right-to-left scripts such as Arabic.
				letterSpacing: r.rtl ? 0 : heading.fontSize * 0.1,
				textTransform: "uppercase",
				// Longhands: the heading's icon row strips these from its title text, but not the shorthands.
				paddingTop: metrics.gapY(0.4),
				paddingBottom: metrics.gapY(0.4),
				paddingLeft: cellX,
				paddingRight: cellX,
			},
			// Every cell is closed on all four sides, so an entry carried onto the next page still reads as a cell.
			// Forme strokes a border centred on the box's edge: touching cells share one rule, and half a rule of
			// padding keeps the first cell's top rule clear of the title bar.
			sectionItems: {
				rowGap: 0,
				paddingTop: ruleWidth / 2,
			},
			item: {
				rowGap: metrics.gapY(0.125),
				borderWidth: ruleWidth,
				borderColor: rule,
				paddingVertical: cellY,
				paddingHorizontal: cellX,
			},
			levelContainer: {
				width: "100%",
			},
			header: {
				flexDirection: r.row,
				borderWidth: 1,
				borderColor: primary,
			},
			headerFields: {
				flex: 1,
			},
			headerIdentity: {
				...r.headerIdentity,
				rowGap: metrics.gapY(0.35),
				paddingVertical: cellY * 1.25,
				paddingHorizontal: cellX,
			},
			headerName: {
				fontSize: heading.fontSize * 2,
				lineHeight: headerNameLineHeight,
			},
			headerHeadline: {
				color: primary,
			},
			contactList: {
				flexDirection: r.row,
				flexWrap: "wrap",
				...(r.rtl ? { marginRight: -ruleWidth } : { marginLeft: -ruleWidth }),
			},
			contactItem: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(1 / 3),
				flexBasis: "50%",
				flexGrow: 1,
				borderTopWidth: ruleWidth,
				borderTopColor: rule,
				...ruleStart,
				paddingVertical: cellY * 0.6,
				paddingHorizontal: cellX,
			},
			pictureCell: {
				justifyContent: "center",
				...(r.rtl
					? { borderRightWidth: ruleWidth, borderRightColor: rule }
					: { borderLeftWidth: ruleWidth, borderLeftColor: rule }),
				padding: cellX,
			},
			sections: {
				flexDirection: "column",
			},
		});

		const accentFor = ({ colors }: TemplateStyleContext) => colors.primary;

		return {
			colors,
			styles: {
				...baseStyles,
				levelItem: (context) => ({ borderColor: accentFor(context) }),
				levelItemActive: (context) => ({ backgroundColor: accentFor(context) }),
				icon: createIconSlot({ metadata, accentFor }),
				sectionHeadingIcon: { color: background },
			} satisfies PorygonStyles,
		};
	}, [metadata, r, primary, metrics, base, foreground, background]);
};
