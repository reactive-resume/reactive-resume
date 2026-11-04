import type { TemplatePageProps } from "../../document";
import type { Style } from "../../forme/style-types";
import type { TemplateColorRoles, TemplateFeatures, TemplateStyleContext, TemplateStyleSlots } from "../shared/types";
import { useMemo } from "react";
import { Page, StyleSheet, View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { useRenderedSectionIds, useResolvedNode } from "../../semantic/context";
import { semanticNodeKeys } from "../../semantic/node-keys";
import {
	CustomFieldContactItem,
	EmailContactItem,
	hasContactDetails,
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
import { composeStyles, headerNameLineHeight, resolvePlacementColor } from "../shared/styles";
import { createIconSlot, useTemplateBase } from "../shared/template-base";

type PikachuStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	layout: Style;
	sidebarColumn: Style;
	sidebarContent: Style;
	mainColumn: Style;
	headerRow: Style;
	header: Style;
	headerDivider: Style;
	headerIdentity: Style;
	headerName: Style;
	headerText: Style;
	contactList: Style;
	contactItem: Style;
	picture: Style;
};

type PikachuTemplate = {
	colors: TemplateColorRoles;
	styles: PikachuStyles;
};

type PikachuHeaderProps = {
	styles: PikachuStyles;
	colors: TemplateColorRoles;
};

const pikachuFeatures = {
	stackSidebarItemHeader: true,
} satisfies TemplateFeatures;

export const PikachuPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata, picture } = data;
	const { colors, styles } = usePikachuTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const showSidebar = !page.fullWidth;
	const hasPicture = hasTemplatePicture(picture);
	const mainSections = useRenderedSectionIds(pageNodeKey, filterSections(page.main, data));
	const sidebarSections = useRenderedSectionIds(pageNodeKey, filterSections(page.sidebar, data));

	return (
		<Page
			{...semanticPageProps}
			size={semanticPageSize ?? pageSize}
			style={composeStyles(styles.page, pageMinHeightStyle, semanticPageStyle)}
		>
			<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors} features={pikachuFeatures}>
				<View style={styles.layout}>
					{showSidebar && (
						<View
							style={composeStyles(styles.sidebarColumn, {
								width: `${metadata.layout.sidebarWidth}%`,
								rowGap: metrics.sectionGap,
							})}
						>
							{showHeader && showSidebar && hasPicture && (
								<SemanticHeaderPicture src={picture.url} style={styles.picture} />
							)}

							<SemanticRegionView
								region="sidebar"
								style={composeStyles(styles.sidebarContent, { rowGap: metrics.sectionGap })}
							>
								{sidebarSections.map((section) => (
									<Section key={section} section={section} placement="sidebar" />
								))}
							</SemanticRegionView>
						</View>
					)}

					<SemanticRegionView region="main" style={composeStyles(styles.mainColumn, { rowGap: metrics.sectionGap })}>
						{showHeader && (
							<View style={styles.headerRow}>
								{showHeader && !showSidebar && hasPicture && (
									<SemanticHeaderPicture src={picture.url} style={styles.picture} />
								)}
								<Header styles={styles} colors={colors} />
							</View>
						)}

						<View style={{ rowGap: metrics.sectionGap }}>
							{mainSections.map((section) => (
								<Section key={section} section={section} placement="main" />
							))}
						</View>
					</SemanticRegionView>
				</View>
			</TemplateProvider>
		</Page>
	);
};

const Header = ({ styles, colors }: PikachuHeaderProps) => {
	const { basics } = useRender();
	const hasContacts = hasContactDetails(basics);

	return (
		<SemanticHeaderView style={styles.header}>
			<SemanticTemplatePartView
				partKeys={["header-divider"]}
				style={composeStyles(
					styles.headerDivider,
					hasContacts ? undefined : { borderBottomWidth: 0, paddingBottom: 0 },
				)}
			>
				<View style={styles.headerIdentity}>
					<Heading style={styles.headerName}>{basics.name}</Heading>
					<Text style={styles.headerText}>{basics.headline}</Text>
				</View>
			</SemanticTemplatePartView>

			{hasContacts && (
				<SemanticContactListView style={styles.contactList}>
					<EmailContactItem
						email={basics.email}
						style={styles.contactItem}
						textStyle={styles.headerText}
						iconColor={colors.background}
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
			)}
		</SemanticHeaderView>
	);
};

const usePikachuTemplate = (): PikachuTemplate => {
	const { picture, metadata, r, foreground, background, primary, metrics, base } = useTemplateBase();

	return useMemo(() => {
		const colors: TemplateColorRoles = { foreground, background, primary };

		const baseStyles = StyleSheet.create({
			...base,
			page: {
				...base.page,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
			},
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
			layout: {
				flexDirection: r.columns,
				columnGap: metrics.columnGap,
			},
			sidebarColumn: {
				flexShrink: 0,
			},
			sidebarContent: {
				overflow: "hidden",
			},
			mainColumn: {
				flex: 1,
			},
			headerRow: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(1),
			},
			header: {
				flex: 1,
				rowGap: metrics.gapY(0.5),
				backgroundColor: primary,
				color: background,
				borderRadius: picture.borderRadius,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
			},
			headerDivider: {
				rowGap: metrics.gapY(0.125),
				borderBottomWidth: 1,
				borderBottomColor: background,
				paddingBottom: metrics.gapY(0.5),
			},
			headerIdentity: {
				...r.headerIdentity,
				rowGap: metrics.gapY(0.35),
			},
			headerName: {
				color: background,
				fontSize: metadata.typography.heading.fontSize * 1.5,
				lineHeight: headerNameLineHeight,
			},
			headerText: {
				color: background,
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
		});

		const accentFor = ({ colors }: TemplateStyleContext) => colors.primary;
		const foregroundFor = (context: TemplateStyleContext) =>
			resolvePlacementColor({
				placement: context.placement,
				defaultForeground: colors.foreground,
				sidebarForeground: colors.sidebarForeground,
			});

		return {
			colors,
			styles: {
				...baseStyles,
				text: (context) => ({ ...base.text, color: foregroundFor(context) }),
				heading: (context) => ({ ...baseStyles.heading, color: foregroundFor(context) }),
				link: (context) => ({ ...baseStyles.link, color: foregroundFor(context) }),
				sectionHeading: (context) => ({ ...baseStyles.sectionHeading, color: accentFor(context) }),
				levelItem: (context) => ({ borderColor: accentFor(context) }),
				levelItemActive: (context) => ({ backgroundColor: accentFor(context) }),
				icon: createIconSlot({ metadata, accentFor }),
			} satisfies PikachuStyles,
		};
	}, [picture, metadata, r, primary, metrics, foreground, base, background]);
};
