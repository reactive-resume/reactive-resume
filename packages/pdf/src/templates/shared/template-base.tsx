import type { Style } from "../../forme/style-types";
import type { TemplateIconSlot, TemplateStyleContext } from "./types";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { useMemo } from "react";
import { rgbaStringToHex } from "@reactive-resume/utils/color";
import { View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { createBaseTemplateStyles } from "./base-template-styles";
import {
	CustomFieldContactItem,
	EmailContactItem,
	LocationContactItem,
	PhoneContactItem,
	WebsiteContactItem,
} from "./contact-item";
import { getTemplateMetrics } from "./metrics";
import { hasTemplatePicture } from "./picture";
import { Heading, SemanticContactListView, SemanticHeaderPicture, SemanticHeaderView, Text } from "./primitives";
import { createRtlStyleHelpers } from "./rtl";

export const useTemplateBase = () => {
	const { picture, metadata, rtl, columnsReversed } = useRender();

	return useMemo(() => {
		const r = createRtlStyleHelpers(rtl, columnsReversed);
		const foreground = rgbaStringToHex(metadata.design.colors.text);
		const background = rgbaStringToHex(metadata.design.colors.background);
		const primary = rgbaStringToHex(metadata.design.colors.primary);
		const metrics = getTemplateMetrics(metadata.page);
		const base = createBaseTemplateStyles({ metadata, foreground, background, r, metrics, picture });

		return { picture, metadata, rtl, r, foreground, background, primary, metrics, base };
	}, [picture, metadata, rtl, columnsReversed]);
};

export const createIconSlot = ({
	metadata,
	accentFor,
}: {
	metadata: ResumeData["metadata"];
	accentFor: (context: TemplateStyleContext) => string;
}): TemplateIconSlot => {
	return (context) => ({
		display: metadata.page.hideIcons ? "none" : "flex",
		size: metadata.typography.body.fontSize,
		color: accentFor(context),
	});
};

type TemplateHeaderStyles = {
	header: Style;
	picture: Style;
	title: Style;
	identity: Style;
	name: Style;
	contactList: Style;
	contactItem: Style;
};

export const TemplateHeader = ({
	styles,
	contactListOutsideTitle = false,
}: {
	styles: TemplateHeaderStyles;
	contactListOutsideTitle?: boolean;
}) => {
	const { basics, picture } = useRender();
	const hasPicture = hasTemplatePicture(picture);
	const contactList = (
		<SemanticContactListView style={styles.contactList}>
			<EmailContactItem email={basics.email} style={styles.contactItem} />
			<PhoneContactItem phone={basics.phone} style={styles.contactItem} />
			<LocationContactItem location={basics.location} style={styles.contactItem} />
			<WebsiteContactItem website={basics.website} style={styles.contactItem} />
			{basics.customFields.map((field) => (
				<CustomFieldContactItem key={field.id} field={field} style={styles.contactItem} />
			))}
		</SemanticContactListView>
	);

	return (
		<SemanticHeaderView style={styles.header}>
			{hasPicture && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}

			<View style={styles.title}>
				<View style={styles.identity}>
					<Heading style={styles.name}>{basics.name}</Heading>
					<Text>{basics.headline}</Text>
				</View>
				{!contactListOutsideTitle && contactList}
			</View>

			{contactListOutsideTitle && contactList}
		</SemanticHeaderView>
	);
};
