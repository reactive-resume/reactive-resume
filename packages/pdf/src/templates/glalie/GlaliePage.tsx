import type { TemplatePageProps } from "../../document";
import type { Style } from "../../forme/style-types";
import type { TemplateColorRoles, TemplateFeatures, TemplateStyleContext, TemplateStyleSlots } from "../shared/types";
import { useMemo } from "react";
import { Page, StyleSheet, View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { useRenderedSectionIds, useResolvedNode } from "../../semantic/context";
import { semanticNodeKeys } from "../../semantic/node-keys";
import { getPrimaryTint } from "../shared/color-helpers";
import { TemplateProvider } from "../shared/context";
import { filterSections } from "../shared/filtering";
import { getTemplateMetrics } from "../shared/metrics";
import { SemanticRegionView, SemanticTemplatePartView } from "../shared/primitives";
import { Section } from "../shared/sections";
import { composeStyles, headerNameLineHeight, resolvePlacementColor } from "../shared/styles";
import { createIconSlot, TemplateHeader, useTemplateBase } from "../shared/template-base";

type GlalieStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	layout: Style;
	sidebarBackground: Style;
	sidebarColumn: Style;
	sidebarContent: Style;
	mainColumn: Style;
	mainContent: Style;
	header: Style;
	picture: Style;
	headerTitle: Style;
	headerIdentity: Style;
	headerName: Style;
	contactList: Style;
	contactItem: Style;
	contactText: Style;
};

type GlalieTemplate = {
	colors: TemplateColorRoles;
	styles: GlalieStyles;
};

type GlalieHeaderProps = {
	styles: GlalieStyles;
};

const glalieFeatures = {
	stackSidebarItemHeader: true,
} satisfies TemplateFeatures;

export const GlaliePage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useGlalieTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const showSidebar = !page.fullWidth || showHeader;
	const mainSections = useRenderedSectionIds(pageNodeKey, filterSections(page.main, data));
	const sidebarSections = useRenderedSectionIds(pageNodeKey, filterSections(page.sidebar, data));

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
			<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors} features={glalieFeatures}>
				{showSidebar && (
					<SemanticTemplatePartView
						ownerNodeKey={semanticNodeKeys.region(pageNodeKey, "sidebar")}
						partKeys={["sidebar-background"]}
						fixed
						style={styles.sidebarBackground}
					/>
				)}

				<View style={composeStyles(styles.layout, { marginTop: -metrics.page.paddingVertical })}>
					{showSidebar && (
						<View
							style={composeStyles(styles.sidebarColumn, {
								width: `${metadata.layout.sidebarWidth}%`,
							})}
						>
							{showHeader && <Header styles={styles} />}

							{!page.fullWidth && (
								<SemanticRegionView
									region="sidebar"
									style={composeStyles(styles.sidebarContent, { rowGap: metrics.sectionGap })}
								>
									{sidebarSections.map((section) => (
										<Section key={section} section={section} placement="sidebar" />
									))}
								</SemanticRegionView>
							)}
						</View>
					)}

					<View style={styles.mainColumn}>
						<SemanticRegionView region="main" style={composeStyles(styles.mainContent, { rowGap: metrics.sectionGap })}>
							{mainSections.map((section) => (
								<Section key={section} section={section} placement="main" />
							))}
						</SemanticRegionView>
					</View>
				</View>
			</TemplateProvider>
		</Page>
	);
};

const Header = ({ styles }: GlalieHeaderProps) => (
	<TemplateHeader
		styles={{
			header: styles.header,
			picture: styles.picture,
			title: styles.headerTitle,
			identity: styles.headerIdentity,
			name: styles.headerName,
			contactList: styles.contactList,
			contactItem: styles.contactItem,
			contactText: styles.contactText,
		}}
		contactListOutsideTitle
	/>
);

const useGlalieTemplate = (): GlalieTemplate => {
	const { metadata, r, foreground, background, primary, metrics, base } = useTemplateBase();

	return useMemo(() => {
		// One band at the tint the former column-over-band pair of 20% layers added up to: the column no longer paints
		// its own, so a custom band colour shows as authored, margins included.
		const primaryTint = getPrimaryTint(metadata.design.colors.primary, 0.36);
		const colors: TemplateColorRoles = {
			foreground,
			background,
			primary,
			sidebarForeground: foreground,
			sidebarBackground: primaryTint,
		};

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
			sidebarBackground: {
				position: "absolute",
				top: 0,
				bottom: 0,
				...r.anchorToColumnStart(0),
				width: `${metadata.layout.sidebarWidth}%`,
				backgroundColor: primaryTint,
			},
			layout: {
				flexDirection: r.columns,
				minHeight: "100%",
			},
			sidebarColumn: {
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingTop: metrics.page.paddingVertical,
				rowGap: metrics.sectionGap,
			},
			sidebarContent: {
				overflow: "hidden",
			},
			mainColumn: {
				flex: 1,
			},
			mainContent: {
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingTop: metrics.page.paddingVertical,
			},
			header: {
				alignItems: "center",
				rowGap: metrics.gapY(0.5),
			},
			headerTitle: {
				alignItems: "center",
				textAlign: "center",
			},
			headerIdentity: {
				alignItems: "center",
				textAlign: "center",
				rowGap: metrics.gapY(0.35),
			},
			headerName: {
				fontSize: metadata.typography.heading.fontSize * 1.5,
				lineHeight: headerNameLineHeight,
			},
			contactList: {
				width: "100%",
				borderWidth: 1,
				borderColor: primary,
				borderRadius: 0,
				padding: metrics.gapX(0.75),
				rowGap: metrics.gapY(0.125),
			},
			contactItem: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(1 / 6),
			},
			// The text takes the rest of the row, so a long email or link wraps inside the box instead of running out.
			contactText: {
				flexGrow: 1,
				flexBasis: 0,
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
			} satisfies GlalieStyles,
		};
	}, [metadata, r, primary, metrics, base, foreground, background]);
};
