import type { CustomSectionItem, CustomSectionType } from "@reactive-resume/schema/resume/data";
import { EMPTY_RESUME_DATES } from "@reactive-resume/schema/resume/dates";
import { generateId } from "@reactive-resume/utils/string";

const website = () => ({ url: "", label: "", inlineLink: false });
const dates = () => ({ ...EMPTY_RESUME_DATES });

/** A new, empty entry of a type: the starting point for "+ Add" and for Add section's first draft. */
export function createEntry(type: CustomSectionType): CustomSectionItem {
	const base = { id: generateId(), hidden: false };
	const fields: Record<CustomSectionType, Record<string, unknown>> = {
		profiles: { icon: "", iconColor: "", network: "", username: "", website: website() },
		experience: {
			company: "",
			position: "",
			location: "",
			period: "",
			dates: dates(),
			website: website(),
			description: "",
			roles: [],
		},
		education: {
			school: "",
			degree: "",
			area: "",
			grade: "",
			location: "",
			period: "",
			dates: dates(),
			website: website(),
			description: "",
		},
		projects: { name: "", period: "", dates: dates(), website: website(), description: "" },
		skills: { icon: "", iconColor: "", name: "", proficiency: "", level: 0, keywords: [] },
		languages: { language: "", fluency: "", level: 0 },
		interests: { icon: "", iconColor: "", name: "", keywords: [] },
		awards: { title: "", awarder: "", date: "", dates: dates(), website: website(), description: "" },
		certifications: { title: "", issuer: "", date: "", dates: dates(), website: website(), description: "" },
		publications: { title: "", publisher: "", date: "", dates: dates(), website: website(), description: "" },
		volunteer: { organization: "", location: "", period: "", dates: dates(), website: website(), description: "" },
		references: { name: "", position: "", website: website(), phone: "", description: "" },
		summary: { content: "" },
		"cover-letter": { recipient: "", content: "" },
	};
	return { ...base, ...fields[type] } as CustomSectionItem;
}
