import type { Style } from "@react-pdf/types";
import type { TemplatePageProps } from "../../document";
import type { TemplateColorRoles, TemplateFeatures, TemplateStyleContext, TemplateStyleSlots } from "../shared/types";
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
import { getFeaturedSummaryLayout } from "../shared/featured-summary";
import { filterSections } from "../shared/filtering";
import { getTemplateMetrics } from "../shared/metrics";
import { PageMarginBackground } from "../shared/page-margin-background";
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
import { composeStyles, headerNameLineHeight, resolvePlacementColor } from "../shared/styles";
import { useTemplateBase } from "../shared/template-base";

type DitgarStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	sidebarColumn: Style;
	sidebarContent: Style;
	mainColumn: Style;
	mainContent: Style;
	specialContainer: Style;
	header: Style;
	picture: Style;
	headerTitle: Style;
	headerIdentity: Style;
	headerName: Style;
	headerText: Style;
	contactList: Style;
	contactItem: Style;
};

type DitgarTemplate = {
	colors: TemplateColorRoles;
	styles: DitgarStyles;
};

type DitgarHeaderProps = {
	styles: DitgarStyles;
	colors: TemplateColorRoles;
};

const ditgarFeatures = {
	stackSidebarItemHeader: true,
} satisfies TemplateFeatures;

const ditgarItemHeaderBorderWidth = 2;

export const DitgarPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useDitgarTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const showSidebar = !page.fullWidth || showHeader;
	const sidebarSections = useRenderedSectionIds(pageNodeKey, filterSections(page.sidebar, data));
	const mainSections = useRenderedSectionIds(pageNodeKey, filterSections(page.main, data));
	const { featuredSummarySection, regularSections: regularMainSections } = getFeaturedSummaryLayout({
		sections: mainSections,
		canFeatureSummary: showHeader,
	});
	const regularSidebarSections = featuredSummarySection
		? sidebarSections.filter((section) => section !== "summary")
		: sidebarSections;

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
			<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors} features={ditgarFeatures}>
				{showSidebar && (
					<View
						style={composeStyles(styles.sidebarColumn, {
							width: `${metadata.layout.sidebarWidth}%`,
							marginTop: -metrics.page.paddingVertical,
						})}
					>
						<PageMarginBackground
							color={colors.sidebarBackground ?? colors.background}
							margin={metrics.page.paddingVertical}
						/>
						{showHeader && <Header styles={styles} colors={colors} />}

						{!page.fullWidth && (
							<SemanticRegionView
								region="sidebar"
								style={composeStyles(styles.sidebarContent, { rowGap: metrics.sectionGap })}
							>
								{regularSidebarSections.map((section) => (
									<Section key={section} section={section} placement="sidebar" />
								))}
							</SemanticRegionView>
						)}
					</View>
				)}

				<View style={composeStyles(styles.mainColumn, { marginTop: -metrics.page.paddingVertical })}>
					{featuredSummarySection && (
						<SemanticRegionTemplatePartView
							region="featured"
							partKeys={["featured-summary"]}
							style={styles.specialContainer}
						>
							<Section
								section={featuredSummarySection}
								placement="main"
								showHeading={data.summary.showHeading !== false}
							/>
						</SemanticRegionTemplatePartView>
					)}

					<SemanticRegionView region="main" style={composeStyles(styles.mainContent, { rowGap: metrics.sectionGap })}>
						{regularMainSections.map((section) => (
							<Section key={section} section={section} placement="main" />
						))}
					</SemanticRegionView>
				</View>
			</TemplateProvider>
		</Page>
	);
};

const Header = ({ styles, colors }: DitgarHeaderProps) => {
	const { basics, picture } = useRender();
	const hasPicture = hasTemplatePicture(picture);

	return (
		<SemanticHeaderView style={styles.header}>
			{hasPicture && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}

			<View style={styles.headerTitle}>
				<View style={styles.headerIdentity}>
					<Heading style={styles.headerName}>{basics.name}</Heading>
					<Text style={styles.headerText}>{basics.headline}</Text>
				</View>
			</View>

			<SemanticContactListView style={styles.contactList}>
				<EmailContactItem
					email={basics.email}
					style={styles.contactItem}
					textStyle={styles.headerText}
					iconColor={colors.background}
					iconName="at"
				/>
				<PhoneContactItem
					phone={basics.phone}
					style={styles.contactItem}
					textStyle={styles.headerText}
					iconColor={colors.background}
				/>
				<LocationContactItem
					location={basics.location}
					style={styles.contactItem}
					textStyle={styles.headerText}
					iconColor={colors.background}
				/>
				<WebsiteContactItem
					website={basics.website}
					style={styles.contactItem}
					textStyle={styles.headerText}
					iconColor={colors.background}
				/>
				{basics.customFields.map((field) => (
					<CustomFieldContactItem
						key={field.id}
						field={field}
						style={styles.contactItem}
						textStyle={styles.headerText}
						iconColor={colors.background}
					/>
				))}
			</SemanticContactListView>
		</SemanticHeaderView>
	);
};

const useDitgarTemplate = (): DitgarTemplate => {
	const { metadata, r, foreground, background, primary, metrics, base } = useTemplateBase();

	return useMemo(() => {
		const primaryTint = getPrimaryTint(metadata.design.colors.primary, 0.2);
		const colors: TemplateColorRoles = {
			foreground,
			background,
			primary,
			sidebarForeground: foreground,
			sidebarBackground: primaryTint,
		};

		const baseStyles = StyleSheet.create({
			...base,
			page: {
				...base.page,
				flexDirection: r.row,
			},
			section: {
				flexDirection: "column",
				rowGap: metrics.gapY(0.25),
			},
			sectionHeading: {
				fontSize: metadata.typography.heading.fontSize * 0.9,
				color: primary,
				borderBottomWidth: 1,
				borderBottomColor: primary,
				paddingBottom: metrics.gapY(0.125),
			},
			item: {
				rowGap: metrics.gapY(0.125),
			},
			levelContainer: {
				width: "70%",
			},
			levelItem: {
				borderColor: primary,
			},
			levelItemActive: {
				backgroundColor: primary,
			},
			sidebarColumn: {
				flexShrink: 0,
				backgroundColor: primaryTint,
			},
			sidebarContent: {
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingTop: metrics.page.paddingVertical,
			},
			mainColumn: {
				flex: 1,
			},
			mainContent: {
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingTop: metrics.page.paddingVertical,
			},
			specialContainer: {
				backgroundColor: primaryTint,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
			},
			header: {
				backgroundColor: primary,
				color: background,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
				rowGap: metrics.gapY(0.5),
			},
			headerTitle: {},
			headerIdentity: {
				...r.headerIdentity,
				rowGap: metrics.gapY(0.35),
			},
			headerName: {
				fontSize: metadata.typography.heading.fontSize * 1.5,
				lineHeight: headerNameLineHeight,
				color: background,
			},
			headerText: {
				color: background,
			},
			contactList: {
				rowGap: metrics.gapY(0.125),
			},
			contactItem: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(1 / 6),
			},
		});

		const foregroundFor = ({ placement, colors }: TemplateStyleContext) =>
			resolvePlacementColor({
				placement,
				defaultForeground: colors.foreground,
				sidebarForeground: colors.sidebarForeground,
			});

		const accentFor = ({ colors }: TemplateStyleContext) => colors.primary;

		return {
			colors,
			styles: {
				...baseStyles,
				text: (context) => ({ ...baseStyles.text, color: foregroundFor(context) }),
				heading: (context) => ({ ...baseStyles.heading, color: foregroundFor(context) }),
				link: (context) => ({ ...baseStyles.link, color: foregroundFor(context) }),
				richParagraph: (context) => ({ ...baseStyles.richParagraph, color: foregroundFor(context) }),
				richListItemMarker: (context) => ({ ...baseStyles.richListItemMarker, color: foregroundFor(context) }),
				richListItemContent: (context) => ({ ...baseStyles.richListItemContent, color: foregroundFor(context) }),
				alignEnd: (context) => ({
					...baseStyles.alignEnd,
					...(context.placement === "sidebar" ? { textAlign: "left" } : {}),
				}),
				sectionHeading: (context) => ({
					...baseStyles.sectionHeading,
					color: accentFor(context),
					borderBottomColor: accentFor(context),
				}),
				sectionItemHeader: (context) => ({
					/** Ditgar packs the header rows tight inside the accent border, without the usual row gap. */
					rowGap: 0,
					...(context.placement === "main"
						? {
								borderLeftWidth: ditgarItemHeaderBorderWidth,
								borderLeftColor: accentFor(context),
								paddingLeft: metrics.gapX(0.5),
								paddingVertical: metrics.gapY(0.125),
								// Keep header text aligned with the body after its border and padding.
								marginLeft: -(ditgarItemHeaderBorderWidth + metrics.gapX(0.5)),
							}
						: {}),
				}),
				levelItem: (context) => ({ borderColor: accentFor(context) }),
				levelItemActive: (context) => ({ backgroundColor: accentFor(context) }),
				icon: (context) => ({
					display: metadata.page.hideIcons ? "none" : "flex",
					size: metadata.typography.body.fontSize,
					color: context.placement === "sidebar" ? foreground : primary,
				}),
			} satisfies DitgarStyles,
		};
	}, [
		metadata,
		r.row,
		r.headerIdentity,
		primary,
		metrics.gapY,
		metrics.page.paddingVertical,
		metrics.gapX,
		base,
		metrics.page.paddingHorizontal,
		foreground,
		background,
	]);
};
