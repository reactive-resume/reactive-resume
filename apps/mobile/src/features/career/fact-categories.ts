import type { FactCategory } from "@reactive-resume/schema/career";
import { t } from "@lingui/core/macro";
export const categoryLabel = (category: string) =>
	({ accomplishment: t`Accomplishment`, experience: t`Experience`, skill: t`Skill`, preference: t`Preference` })[
		category
	] ?? t`Experience`;
export const factCategories = (): { value: FactCategory; label: string }[] =>
	["accomplishment", "experience", "skill", "preference"].map((value) => ({
		value: value as FactCategory,
		label: categoryLabel(value),
	}));
