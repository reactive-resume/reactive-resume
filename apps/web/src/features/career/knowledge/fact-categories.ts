import type { FactCategory } from "@reactive-resume/schema/career";
import { t } from "@lingui/core/macro";
import { factCategorySchema } from "@reactive-resume/schema/career";
export const CATEGORIES = factCategorySchema.options;

export const categoryLabel = (category: FactCategory) =>
	({
		accomplishment: t`Accomplishment`,
		experience: t`Experience`,
		skill: t`Skill`,
		preference: t`Preference`,
	})[category];
