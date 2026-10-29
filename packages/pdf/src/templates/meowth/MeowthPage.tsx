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

type MeowthStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	headerTitle: Style;
	headerIdentity: Style;
	headerName: Style;
	headerHeadline: Style;
	contactList: Style;
	contactItem: Style;
	picture: Style;
	sectionGroup: Style;
};

type MeowthTemplate = {
	colors: TemplateColorRoles;
	styles: MeowthStyles;
};

type MeowthHeaderProps = {
	styles: MeowthStyles;
};

export const MeowthPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useMeowthTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const mainSections = useRenderedSectionIds(pageNodeKey, filterSections(page.main, data));
	const sidebarSections = useRenderedSectionIds(pageNodeKey, filterSections(page.sidebar, data));

	return (
		<Page
			{...semanticPageProps}
			size={semanticPageSize ?? pageSize}
			style={composeStyles(styles.page, pageMinHeightStyle, semanticPageStyle)}
		>
			<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors}>
				{showHeader && <Header styles={styles} />}

				<SemanticRegionView region="main" style={composeStyles(styles.sectionGroup, { rowGap: metrics.sectionGap })}>
					{mainSections.map((section) => (
						<Section key={section} section={section} placement="main" />
					))}
				</SemanticRegionView>

				{!page.fullWidth && (
					<SemanticRegionView
						region="sidebar"
						style={composeStyles(styles.sectionGroup, { rowGap: metrics.sectionGap })}
					>
						{sidebarSections.map((section) => (
							<Section key={section} section={section} placement="sidebar" />
						))}
					</SemanticRegionView>
				)}
			</TemplateProvider>
		</Page>
	);
};

const Header = ({ styles }: MeowthHeaderProps) => {
	const { basics, picture } = useRender();
	const hasPicture = hasTemplatePicture(picture);

	return (
		<SemanticHeaderView style={styles.header}>
			<View style={styles.headerTitle}>
				<View style={styles.headerIdentity}>
					<Heading style={styles.headerName}>{basics.name}</Heading>
					<Text style={styles.headerHeadline}>{basics.headline}</Text>
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

			{hasPicture && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}
		</SemanticHeaderView>
	);
};

const useMeowthTemplate = (): MeowthTemplate => {
	const { metadata, r, foreground, background, primary, metrics, base } = useTemplateBase();

	return useMemo(() => {
		const colors: TemplateColorRoles = { foreground, background, primary };

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
				rowGap: metrics.gapY(0.25),
			},
			sectionHeading: {
				color: primary,
				textTransform: "uppercase",
				letterSpacing: 0,
				borderBottomWidth: 1,
				borderBottomColor: primary,
				paddingBottom: metrics.gapY(0.125),
				textAlign: r.sectionHeadingTextAlign,
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
			header: {
				flexDirection: r.row,
				alignItems: "flex-start",
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
			headerHeadline: {
				opacity: 0.8,
			},
			contactList: {
				flexDirection: r.row,
				flexWrap: "wrap",
				rowGap: metrics.gapY(0.125),
				columnGap: metrics.gapX(0.75),
			},
			contactItem: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(1 / 6),
			},
			sectionGroup: {},
		});

		const accentFor = ({ colors }: TemplateStyleContext) => colors.primary;

		return {
			colors,
			styles: {
				...baseStyles,
				sectionHeading: (context) => ({
					...baseStyles.sectionHeading,
					color: accentFor(context),
					borderBottomColor: accentFor(context),
				}),
				levelItem: (context) => ({ borderColor: accentFor(context) }),
				levelItemActive: (context) => ({ backgroundColor: accentFor(context) }),
				icon: createIconSlot({ metadata, accentFor }),
			} satisfies MeowthStyles,
		};
	}, [metadata, r, primary, metrics, base, foreground, background]);
};
