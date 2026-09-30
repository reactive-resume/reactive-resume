import type { TemplatePageProps } from "../../document";
import type { Style } from "../../forme/style-types";
import type { TemplateColorRoles, TemplateStyleContext, TemplateStyleSlots } from "../shared/types";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { Page, StyleSheet, View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { resolvedPdfFlowProps } from "../../semantic/adapter";
import { useRenderedSectionIds, useResolvedNode, useSemanticNodeVisible } from "../../semantic/context";
import { semanticNodeKeys } from "../../semantic/node-keys";
import {
	CustomFieldContactItem,
	EmailContactItem,
	LocationContactItem,
	PhoneContactItem,
	WebsiteContactItem,
} from "../shared/contact-item";
import { TemplateProvider, useTemplatePageNodeKey } from "../shared/context";
import { filterSections } from "../shared/filtering";
import { getTemplateMetrics } from "../shared/metrics";
import { hasTemplatePicture } from "../shared/picture";
import {
	Heading,
	SemanticContactListView,
	SemanticHeaderPicture,
	SemanticHeaderView,
	SemanticRegionView,
	semanticTemplatePartNodeKey,
	Text,
} from "../shared/primitives";
import { Section } from "../shared/sections";
import { composeStyles, headerNameLineHeight } from "../shared/styles";
import { createIconSlot, useTemplateBase } from "../shared/template-base";

type RhyhornStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	headerTitle: Style;
	headerIdentity: Style;
	headerName: Style;
	contactList: Style;
	contactItem: Style;
	contactItemContent: Style;
	contactItemLast: Style;
	picture: Style;
	sectionGroup: Style;
};

type RhyhornTemplate = {
	colors: TemplateColorRoles;
	styles: RhyhornStyles;
};

type RhyhornHeaderProps = {
	styles: RhyhornStyles;
};

type RhyhornContactItemProps = {
	nodeKey: string | undefined;
	last: boolean;
	styles: RhyhornStyles;
	children: ReactNode;
};

const RhyhornContactItem = ({ nodeKey, last, styles, children }: RhyhornContactItemProps) => {
	const resolved = useResolvedNode(nodeKey);
	const visible = useSemanticNodeVisible(nodeKey);
	if (!visible) return null;

	return (
		<View
			{...resolvedPdfFlowProps(resolved)}
			style={composeStyles(styles.contactItem, last ? styles.contactItemLast : undefined, resolved.style)}
		>
			{children}
		</View>
	);
};

export const RhyhornPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useRhyhornTemplate();
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

const Header = ({ styles }: RhyhornHeaderProps) => {
	const { basics, picture } = useRender();
	const hasPicture = hasTemplatePicture(picture);
	const pageNodeKey = useTemplatePageNodeKey();
	const headerNodeKey = semanticNodeKeys.header(semanticNodeKeys.region(pageNodeKey, "header"));
	const contactListNodeKey = headerNodeKey ? semanticNodeKeys.contactList(headerNodeKey) : undefined;
	const contactNodeKey = (name: string, id?: string) =>
		contactListNodeKey ? semanticNodeKeys.contactItem(contactListNodeKey, name, id) : undefined;
	const contentNodeKey = (name: string, id?: string) =>
		semanticTemplatePartNodeKey(contactNodeKey(name, id), "contact-item-content");
	const contactItems: {
		id: string;
		nodeKey: string | undefined;
		content: ReactNode;
	}[] = [];

	if (basics.email) {
		contactItems.push({
			id: "email",
			nodeKey: contactNodeKey("email"),
			content: (
				<EmailContactItem
					email={basics.email}
					primitiveNodeKey={contentNodeKey("email")}
					style={styles.contactItemContent}
				/>
			),
		});
	}
	if (basics.phone) {
		contactItems.push({
			id: "phone",
			nodeKey: contactNodeKey("phone"),
			content: (
				<PhoneContactItem
					phone={basics.phone}
					primitiveNodeKey={contentNodeKey("phone")}
					style={styles.contactItemContent}
				/>
			),
		});
	}
	if (basics.location) {
		contactItems.push({
			id: "location",
			nodeKey: contactNodeKey("location"),
			content: (
				<LocationContactItem
					location={basics.location}
					primitiveNodeKey={contentNodeKey("location")}
					style={styles.contactItemContent}
				/>
			),
		});
	}

	if (basics.website.url) {
		contactItems.push({
			id: "website",
			nodeKey: contactNodeKey("website"),
			content: (
				<WebsiteContactItem
					website={basics.website}
					primitiveNodeKey={contentNodeKey("website")}
					style={styles.contactItemContent}
				/>
			),
		});
	}

	contactItems.push(
		...basics.customFields.map((field) => ({
			id: `custom-${field.id}`,
			nodeKey: contactNodeKey("custom", field.id),
			content: (
				<CustomFieldContactItem
					field={field}
					primitiveNodeKey={contentNodeKey("custom", field.id)}
					style={styles.contactItemContent}
				/>
			),
		})),
	);

	return (
		<SemanticHeaderView style={styles.header}>
			<View style={styles.headerTitle}>
				<View style={styles.headerIdentity}>
					<Heading style={styles.headerName}>{basics.name}</Heading>
					<Text>{basics.headline}</Text>
				</View>

				<SemanticContactListView style={styles.contactList}>
					{contactItems.map((item, index) => (
						<RhyhornContactItem
							key={item.id}
							nodeKey={item.nodeKey}
							last={index === contactItems.length - 1}
							styles={styles}
						>
							{item.content}
						</RhyhornContactItem>
					))}
				</SemanticContactListView>
			</View>

			{hasPicture && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}
		</SemanticHeaderView>
	);
};

const useRhyhornTemplate = (): RhyhornTemplate => {
	const { metadata, r, foreground, background, primary, metrics, base } = useTemplateBase();

	return useMemo(() => {
		const colors: TemplateColorRoles = { foreground, background, primary };
		const contactGap = metrics.gapX(0.5);

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
				borderBottomWidth: 1,
				borderBottomColor: primary,
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
				alignItems: "center",
				columnGap: metrics.gapX(0.5),
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
			contactList: {
				flexDirection: r.row,
				flexWrap: "wrap",
				rowGap: metrics.gapY(0.125),
			},
			contactItem: {
				flexDirection: r.row,
				alignItems: "center",
				...r.contactSeparator(primary, contactGap),
			},
			contactItemContent: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(1 / 6),
			},
			contactItemLast: r.contactSeparatorClear,
			sectionGroup: {},
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
			} satisfies RhyhornStyles,
		};
	}, [metadata, r, primary, metrics, base, foreground, background]);
};
