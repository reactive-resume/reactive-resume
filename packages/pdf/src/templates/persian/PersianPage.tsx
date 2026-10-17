import type { TemplatePageProps } from "../../document";
import type { Style } from "../../forme/style-types";
import type { TemplateColorRoles, TemplateStyleSlots } from "../shared/types";
import { useMemo } from "react";
import { Page, StyleSheet } from "#react-pdf-renderer";
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

type PersianStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	headerName: Style;
	headerHeadline: Style;
	contactList: Style;
	contactItem: Style;
	picture: Style;
};

type PersianHeaderProps = { styles: PersianStyles };

/** A traditional Wall Street resume with a centered identity and thin section rules. */
export function PersianPage({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { colors, styles } = usePersianTemplate();
	const metrics = getTemplateMetrics(data.metadata.page);
	const sections = useRenderedSectionIds(
		pageNodeKey,
		filterSections([...page.main, ...(page.fullWidth ? [] : page.sidebar)], data),
	);

	return (
		<Page
			{...semanticPageProps}
			size={semanticPageSize ?? pageSize}
			style={composeStyles(styles.page, pageMinHeightStyle, semanticPageStyle)}
		>
			<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors}>
				{showHeader && <Header styles={styles} />}
				<SemanticRegionView region="main" style={{ rowGap: metrics.gapY(3) }}>
					{sections.map((section) => (
						<Section key={section} section={section} placement="main" />
					))}
				</SemanticRegionView>
			</TemplateProvider>
		</Page>
	);
}

function Header({ styles }: PersianHeaderProps) {
	const { basics, picture } = useRender();
	return (
		<SemanticHeaderView style={styles.header}>
			{hasTemplatePicture(picture) && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}
			<Heading style={styles.headerName}>{basics.name}</Heading>
			{basics.headline && <Text style={styles.headerHeadline}>{basics.headline}</Text>}
			<SemanticContactListView style={styles.contactList}>
				<PhoneContactItem phone={basics.phone} style={styles.contactItem} />
				<EmailContactItem email={basics.email} style={styles.contactItem} />
				<WebsiteContactItem website={basics.website} style={styles.contactItem} />
				<LocationContactItem location={basics.location} style={styles.contactItem} />
				{basics.customFields.map((field) => (
					<CustomFieldContactItem key={field.id} field={field} style={styles.contactItem} />
				))}
			</SemanticContactListView>
		</SemanticHeaderView>
	);
}

function usePersianTemplate() {
	const { metadata, r, foreground, background, primary, metrics, base } = useTemplateBase();
	return useMemo(() => {
		const colors: TemplateColorRoles = { foreground, background, primary };
		const styles = StyleSheet.create({
			...base,
			page: {
				...base.page,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
				rowGap: metrics.gapY(3),
			},
			header: { alignItems: "center", rowGap: metrics.gapY(0.25) },
			headerName: {
				fontSize: metadata.typography.heading.fontSize * 2.0734,
				fontWeight: "400",
				lineHeight: headerNameLineHeight,
				textAlign: "center",
			},
			headerHeadline: {
				fontSize: metadata.typography.heading.fontSize * 1.2,
				fontWeight: base.bold.fontWeight,
				lineHeight: 1.05,
				textAlign: "center",
			},
			contactList: {
				flexDirection: r.row,
				flexWrap: "wrap",
				justifyContent: "center",
				rowGap: metrics.gapY(0.125),
				columnGap: metrics.gapX(0.75),
			},
			contactItem: { flexDirection: r.row, alignItems: "center", columnGap: metrics.gapX(0.2) },
			section: { flexDirection: "column", rowGap: metrics.gapY(0.25) },
			sectionHeading: {
				borderBottomWidth: 0.398,
				borderBottomColor: foreground,
				paddingBottom: metrics.gapY(0.125),
				textAlign: r.sectionHeadingTextAlign,
			},
			sectionItems: { rowGap: metrics.itemGapY },
			item: { rowGap: metrics.gapY(0.125) },
			levelContainer: { width: "100%" },
			levelItem: { borderColor: primary },
			levelItemActive: { backgroundColor: primary },
		});
		const templateStyles = {
			...styles,
			icon: createIconSlot({ metadata, accentFor: ({ colors }) => colors.foreground }),
		} satisfies PersianStyles;
		return {
			colors,
			styles: templateStyles,
		};
	}, [metadata, r, foreground, background, primary, metrics, base]);
}
