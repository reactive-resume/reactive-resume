import type { PhosphorIcon } from "../../forme/icons";
import type { StyleInput, TemplatePlacement } from "./styles";
import type { CustomSection as SchemaCustomSection } from "@reactive-resume/schema/resume/data";
import type { ComponentProps } from "react";

export type TemplateColorRoles = {
	foreground: string;
	background: string;
	primary: string;
	sidebarForeground?: string | undefined;
	sidebarBackground?: string | undefined;
};

export type TemplateStyleContext = {
	placement: TemplatePlacement;
	colors: TemplateColorRoles;
};

export type TemplateStyleSlot = StyleInput | ((context: TemplateStyleContext) => StyleInput);

export type TemplateIconProps = Omit<ComponentProps<typeof PhosphorIcon>, "name">;

export type TemplateIconSlot =
	| Partial<TemplateIconProps>
	| ((context: TemplateStyleContext) => Partial<TemplateIconProps>);

export type TemplateFeatures = {
	sectionTimeline?: boolean;
	inlineItemHeader?: boolean;
	stackSidebarItemHeader?: boolean;
	skillLevelAfterName?: boolean;
};

export type SectionTimelineStyleSlots = {
	items?: TemplateStyleSlot;
	line?: TemplateStyleSlot;
	item?: TemplateStyleSlot;
	marker?: TemplateStyleSlot;
	dot?: TemplateStyleSlot;
	content?: TemplateStyleSlot;
};

export type TemplateFeatureStyleSlots = {
	sectionTimeline?: SectionTimelineStyleSlots;
};

export type TemplateStyleSlots = {
	page?: TemplateStyleSlot;
	text?: TemplateStyleSlot;
	heading?: TemplateStyleSlot;
	div?: TemplateStyleSlot;
	inline?: TemplateStyleSlot;
	link?: TemplateStyleSlot;
	small?: TemplateStyleSlot;
	bold?: TemplateStyleSlot;
	richParagraph?: TemplateStyleSlot;
	richListItemRow?: TemplateStyleSlot;
	richListItemMarker?: TemplateStyleSlot;
	richListItemContent?: TemplateStyleSlot;
	splitRow?: TemplateStyleSlot;
	alignEnd?: TemplateStyleSlot;
	inlineItemHeader?: TemplateStyleSlot;
	inlineItemHeaderLeading?: TemplateStyleSlot;
	inlineItemHeaderMiddle?: TemplateStyleSlot;
	inlineItemHeaderTrailing?: TemplateStyleSlot;
	sectionItemHeader?: TemplateStyleSlot;
	section?: TemplateStyleSlot;
	sectionHeading?: TemplateStyleSlot;
	sectionHeadingContainer?: TemplateStyleSlot;
	sectionHeadingIcon?: TemplateIconSlot;
	sectionItems?: TemplateStyleSlot;
	item?: TemplateStyleSlot;
	levelContainer?: TemplateStyleSlot;
	levelItem?: TemplateStyleSlot;
	levelItemActive?: TemplateStyleSlot;
	levelItemInactive?: TemplateStyleSlot;
	icon?: TemplateIconSlot;
};

export type ItemSection<T> = {
	title: string;
	columns: number;
	hidden: boolean;
	items: T[];
};

export type CustomItemSection<T> = Omit<SchemaCustomSection, "items"> & ItemSection<T>;
