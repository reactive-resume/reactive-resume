import type { CustomSectionType, ResumeData, StyleIntent, StyleSlot } from "./data";
import { sectionTypeSchema } from "./data";

export type SectionStyleRuleContext = {
	sectionId: string;
	sectionType?: CustomSectionType | undefined;
};

export type ResolveStyleRuleSlotOptions = {
	slot: StyleSlot;
	sectionId?: string | undefined;
	sectionType?: CustomSectionType | undefined;
};

export const getSectionStyleRuleContext = (data: ResumeData, sectionId: string): SectionStyleRuleContext => {
	const type = sectionId as CustomSectionType;
	if (type !== "cover-letter" && sectionTypeSchema.options.includes(type)) return { sectionId, sectionType: type };

	const customSection = data.customSections.find((section) => section.id === sectionId);

	return { sectionId, sectionType: customSection?.type };
};

export const resolveStyleIntentForSlot = (data: ResumeData, options: ResolveStyleRuleSlotOptions): StyleIntent => {
	const matchingRules = (data.metadata.styleRules ?? []).filter((rule) => {
		if (!rule.enabled) return false;
		if (!rule.slots[options.slot]) return false;

		if (rule.target.scope === "global") return true;
		if (rule.target.scope === "sectionType") return rule.target.sectionType === options.sectionType;
		return rule.target.sectionId === options.sectionId;
	});

	const specificity = { global: 0, sectionType: 1, sectionId: 2 };
	matchingRules.sort((a, b) => specificity[a.target.scope] - specificity[b.target.scope]);

	return Object.assign({}, ...matchingRules.map((rule) => rule.slots[options.slot]));
};
