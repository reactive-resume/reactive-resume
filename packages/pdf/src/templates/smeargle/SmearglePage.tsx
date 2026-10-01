import type { TemplatePageProps } from "../../document";
import type { Style } from "../../forme/style-types";
import type { TemplateColorRoles, TemplateStyleContext, TemplateStyleSlots } from "../shared/types";
import { useMemo } from "react";
import { Page, StyleSheet, View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { useRenderedSectionIds, useResolvedNode } from "../../semantic/context";
import { semanticNodeKeys } from "../../semantic/node-keys";
import {
	CustomFieldContactItem,
	EmailContactItem,
	LocationContactItem,
	PhoneContactItem,
	WebsiteContactItem,
} from "../shared/contact-item";
import { TemplateProvider } from "../shared/context";
import { getFeaturedSummaryLayout } from "../shared/featured-summary";
import { filterSections } from "../shared/filtering";
import { getTemplateMetrics } from "../shared/metrics";
import { hasTemplatePicture } from "../shared/picture";
import {
	Heading,
	SemanticContactListView,
	SemanticHeaderPicture,
	SemanticHeaderView,
	SemanticRegionTemplatePartView,
	SemanticRegionView,
	Text,
} from "../shared/primitives";
import { Section } from "../shared/sections";
import { composeStyles } from "../shared/styles";
import { createIconSlot, useTemplateBase } from "../shared/template-base";

type SmeargleStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	headerTitle: Style;
	headerKicker: Style;
	headerName: Style;
	contactList: Style;
	contactItem: Style;
	contactText: Style;
	picture: Style;
	standfirst: Style;
	sections: Style;
};

type SmeargleTemplate = {
	colors: TemplateColorRoles;
	styles: SmeargleStyles;
	/** The summary set as a standfirst: the larger, italic introduction under a magazine headline. */
	standfirstStyles: TemplateStyleSlots;
};

type SmeargleHeaderProps = {
	styles: SmeargleStyles;
};

/**
 * Smeargle sets the resume like the opening page of a magazine feature: the headline as a small
 * uppercase kicker over a large display name, the summary as an italic standfirst, and italic
 * section headings. Contrast between the heading and body type carries the hierarchy, not boxes.
 */
export const SmearglePage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles, standfirstStyles } = useSmeargleTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const mainSections = filterSections(page.main, data);
	const sidebarSections = page.fullWidth ? [] : filterSections(page.sidebar, data);
	const { featuredSummarySection, regularSections } = getFeaturedSummaryLayout({
		sections: mainSections,
		canFeatureSummary: showHeader,
	});
	const sections = useRenderedSectionIds(pageNodeKey, [
		...regularSections,
		...(featuredSummarySection ? sidebarSections.filter((section) => section !== "summary") : sidebarSections),
	]);

	return (
		<Page
			{...semanticPageProps}
			size={semanticPageSize ?? pageSize}
			style={composeStyles(styles.page, pageMinHeightStyle, semanticPageStyle)}
		>
			<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors}>
				{showHeader && <Header styles={styles} />}

				{featuredSummarySection && (
					<SemanticRegionTemplatePartView region="featured" partKeys={["featured-summary"]} style={styles.standfirst}>
						<TemplateProvider pageNodeKey={pageNodeKey} styles={standfirstStyles} colors={colors}>
							<Section section={featuredSummarySection} placement="main" showHeading={false} />
						</TemplateProvider>
					</SemanticRegionTemplatePartView>
				)}

				<SemanticRegionView region="main" style={composeStyles(styles.sections, { rowGap: metrics.sectionGap })}>
					{sections.map((section) => (
						<Section key={section} section={section} placement="main" />
					))}
				</SemanticRegionView>
			</TemplateProvider>
		</Page>
	);
};

const Header = ({ styles }: SmeargleHeaderProps) => {
	const { basics, picture } = useRender();
	const hasPicture = hasTemplatePicture(picture);

	return (
		<SemanticHeaderView style={styles.header}>
			<View style={styles.headerTitle}>
				{basics.headline && <Text style={styles.headerKicker}>{basics.headline}</Text>}
				<Heading style={styles.headerName}>{basics.name}</Heading>

				<SemanticContactListView style={styles.contactList}>
					<EmailContactItem email={basics.email} style={styles.contactItem} textStyle={styles.contactText} />
					<PhoneContactItem phone={basics.phone} style={styles.contactItem} textStyle={styles.contactText} />
					<LocationContactItem location={basics.location} style={styles.contactItem} textStyle={styles.contactText} />
					<WebsiteContactItem website={basics.website} style={styles.contactItem} textStyle={styles.contactText} />
					{basics.customFields.map((field) => (
						<CustomFieldContactItem
							key={field.id}
							field={field}
							style={styles.contactItem}
							textStyle={styles.contactText}
						/>
					))}
				</SemanticContactListView>
			</View>

			{hasPicture && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}
		</SemanticHeaderView>
	);
};

const useSmeargleTemplate = (): SmeargleTemplate => {
	const { metadata, r, foreground, background, primary, metrics, base } = useTemplateBase();

	return useMemo(() => {
		const colors: TemplateColorRoles = { foreground, background, primary };
		const { body, heading } = metadata.typography;
		const displayWeight = heading.fontWeights[0] ?? "400";
		const smallSize = body.fontSize * 0.85;

		const baseStyles = StyleSheet.create({
			...base,
			page: {
				...base.page,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
				rowGap: metrics.sectionGap,
			},
			section: {
				flexDirection: "column",
				rowGap: metrics.gapY(0.5),
			},
			sectionHeading: {
				fontWeight: displayWeight,
				fontStyle: "italic",
				color: foreground,
			},
			item: {
				rowGap: metrics.gapY(0.125),
			},
			levelContainer: {
				width: "100%",
			},
			header: {
				flexDirection: r.row,
				alignItems: "flex-end",
				columnGap: metrics.gapX(1.5),
				borderBottomWidth: 0.5,
				borderBottomColor: foreground,
				paddingBottom: metrics.gapY(1.25),
			},
			headerTitle: {
				flex: 1,
				...r.headerIdentity,
				rowGap: metrics.gapY(0.6),
			},
			headerKicker: {
				fontSize: smallSize,
				fontWeight: base.bold.fontWeight,
				// Tracking breaks the joins of cursive right-to-left scripts such as Arabic.
				letterSpacing: r.rtl ? 0 : smallSize * 0.18,
				textTransform: "uppercase",
				color: primary,
			},
			headerName: {
				fontSize: heading.fontSize * 2.25,
				fontWeight: displayWeight,
				lineHeight: 1.05,
				letterSpacing: -heading.fontSize * 0.02,
			},
			contactList: {
				flexDirection: r.row,
				flexWrap: "wrap",
				rowGap: metrics.gapY(0.25),
				columnGap: metrics.gapX(1),
				marginTop: metrics.gapY(0.25),
			},
			contactItem: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(1 / 6),
			},
			contactText: {
				fontSize: smallSize,
			},
			standfirst: {
				width: "85%",
				alignSelf: r.rtl ? "flex-end" : "flex-start",
			},
			sections: {
				flexDirection: "column",
			},
		});

		// The standfirst keeps the body face, set larger and in italic.
		const standfirstText = {
			fontSize: body.fontSize * 1.15,
			fontStyle: "italic",
			lineHeight: 1.45,
		} satisfies Style;

		const accentFor = ({ colors }: TemplateStyleContext) => colors.primary;

		const styles = {
			...baseStyles,
			levelItem: (context) => ({ borderColor: accentFor(context) }),
			levelItemActive: (context) => ({ backgroundColor: accentFor(context) }),
			icon: createIconSlot({ metadata, accentFor }),
		} satisfies SmeargleStyles;

		return {
			colors,
			styles,
			standfirstStyles: {
				...styles,
				richParagraph: { ...baseStyles.richParagraph, ...standfirstText },
				richListItemMarker: { ...baseStyles.richListItemMarker, ...standfirstText },
				richListItemContent: { ...baseStyles.richListItemContent, ...standfirstText },
			},
		};
	}, [metadata, r, primary, metrics, base, foreground, background]);
};
