import type { TemplatePageProps } from "../../document";
import type { Style } from "../../forme/style-types";
import type { TemplateColorRoles, TemplateStyleContext, TemplateStyleSlots } from "../shared/types";
import { useMemo } from "react";
import { Page, StyleSheet, View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { useRenderedSectionIds, useResolvedNode } from "../../semantic/context";
import { semanticNodeKeys } from "../../semantic/node-keys";
import { getPrimaryTint as getPrimaryAlpha } from "../shared/color-helpers";
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
	SemanticTemplatePartView,
	Text,
} from "../shared/primitives";
import { Section } from "../shared/sections";
import { composeStyles, headerNameLineHeight } from "../shared/styles";
import { createIconSlot, useTemplateBase } from "../shared/template-base";

type LeafishStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	headerIntro: Style;
	headerBody: Style;
	headerTitle: Style;
	headerIdentity: Style;
	headerName: Style;
	headerContactBand: Style;
	contactList: Style;
	contactItem: Style;
	picture: Style;
	body: Style;
	mainColumn: Style;
	sidebarColumn: Style;
};

type LeafishTemplate = {
	colors: TemplateColorRoles;
	styles: LeafishStyles;
};

type LeafishHeaderProps = {
	styles: LeafishStyles;
};

export const LeafishPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useLeafishTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const mainSections = useRenderedSectionIds(
		pageNodeKey,
		filterSections(page.main, data).filter((section) => section !== "summary"),
	);
	const sidebarSections = useRenderedSectionIds(
		pageNodeKey,
		filterSections(page.sidebar, data).filter((section) => section !== "summary"),
	);

	return (
		<Page
			{...semanticPageProps}
			size={semanticPageSize ?? pageSize}
			style={composeStyles(
				styles.page,
				{ paddingVertical: metrics.page.paddingVertical },
				pageMinHeightStyle,
				semanticPageStyle,
			)}
		>
			<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors}>
				{showHeader && <Header styles={styles} />}

				<View style={composeStyles(styles.body, showHeader ? undefined : { paddingTop: 0 })}>
					<SemanticRegionView region="main" style={composeStyles(styles.mainColumn, { rowGap: metrics.sectionGap })}>
						{mainSections.map((section) => (
							<Section key={section} section={section} placement="main" />
						))}
					</SemanticRegionView>

					{!page.fullWidth && (
						<SemanticRegionView
							region="sidebar"
							style={composeStyles(styles.sidebarColumn, {
								width: `${metadata.layout.sidebarWidth}%`,
								rowGap: metrics.sectionGap,
							})}
						>
							{sidebarSections.map((section) => (
								<Section key={section} section={section} placement="sidebar" />
							))}
						</SemanticRegionView>
					)}
				</View>
			</TemplateProvider>
		</Page>
	);
};

const Header = ({ styles }: LeafishHeaderProps) => {
	const { basics, picture } = useRender();
	const hasPicture = hasTemplatePicture(picture);

	return (
		<SemanticHeaderView style={styles.header}>
			<SemanticTemplatePartView partKeys={["header-intro"]} style={styles.headerIntro}>
				<SemanticTemplatePartView partKeys={["header-intro", "header-body"]} style={styles.headerBody}>
					{hasPicture && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}

					<View style={styles.headerTitle}>
						<View style={styles.headerIdentity}>
							<Heading style={styles.headerName}>{basics.name}</Heading>
							<Text>{basics.headline}</Text>
						</View>

						<Section section="summary" placement="main" />
					</View>
				</SemanticTemplatePartView>
			</SemanticTemplatePartView>

			<SemanticTemplatePartView partKeys={["header-contact-band"]} style={styles.headerContactBand}>
				<SemanticContactListView style={styles.contactList}>
					<EmailContactItem email={basics.email} style={styles.contactItem} />
					<PhoneContactItem phone={basics.phone} style={styles.contactItem} />
					<LocationContactItem location={basics.location} style={styles.contactItem} />
					<WebsiteContactItem website={basics.website} style={styles.contactItem} />
					{basics.customFields.map((field) => (
						<CustomFieldContactItem key={field.id} field={field} style={styles.contactItem} />
					))}
				</SemanticContactListView>
			</SemanticTemplatePartView>
		</SemanticHeaderView>
	);
};

const useLeafishTemplate = (): LeafishTemplate => {
	const { metadata, r, foreground, background, primary, metrics, base } = useTemplateBase();

	return useMemo(() => {
		const primaryTintLight = getPrimaryAlpha(metadata.design.colors.primary, 0.1);
		const primaryTintDark = getPrimaryAlpha(metadata.design.colors.primary, 0.2);
		const colors: TemplateColorRoles = { foreground, background, primary };

		const baseStyles = StyleSheet.create({
			...base,
			section: {
				flexDirection: "column",
				rowGap: metrics.gapY(0.25),
			},
			sectionHeading: {
				borderBottomWidth: 1,
				borderBottomColor: primary,
			},
			item: {
				rowGap: metrics.gapY(0.125),
			},
			levelContainer: {
				width: "100%",
			},
			levelItem: {
				borderColor: primary,
			},
			levelItemActive: {
				backgroundColor: primary,
			},
			header: { marginTop: -metrics.page.paddingVertical },
			headerIntro: {
				backgroundColor: primaryTintLight,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
			},
			headerBody: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(1),
			},
			headerTitle: {
				flex: 1,
				rowGap: metrics.gapY(0.5),
			},
			headerIdentity: {
				...r.headerIdentity,
				rowGap: metrics.gapY(0.35),
			},
			headerName: {
				fontSize: metadata.typography.heading.fontSize * 1.5,
				lineHeight: headerNameLineHeight,
			},
			headerContactBand: {
				backgroundColor: primaryTintDark,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
			},
			contactList: {
				flexDirection: r.row,
				flexWrap: "wrap",
				rowGap: metrics.gapY(0.125),
				columnGap: metrics.gapX(1),
			},
			contactItem: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(1 / 6),
			},
			body: {
				flexDirection: r.columns,
				columnGap: metrics.columnGap,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingTop: metrics.page.paddingVertical,
			},
			mainColumn: {
				flex: 1,
			},
			sidebarColumn: {
				flexShrink: 0,
			},
		});

		const accentFor = ({ colors }: TemplateStyleContext) => colors.primary;

		return {
			colors,
			styles: {
				...baseStyles,
				sectionHeading: (context) => ({ ...baseStyles.sectionHeading, color: accentFor(context) }),
				levelItem: (context) => ({ borderColor: accentFor(context) }),
				levelItemActive: (context) => ({ backgroundColor: accentFor(context) }),
				icon: createIconSlot({ metadata, accentFor }),
			} satisfies LeafishStyles,
		};
	}, [metadata, r, primary, metrics, base, foreground, background]);
};
