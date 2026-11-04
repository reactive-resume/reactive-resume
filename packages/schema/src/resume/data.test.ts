import type { CustomSectionType } from "./data";
import { describe, expect, it } from "vite-plus/test";
import { customSectionSchema, parseResumeData, resumeDataSchema } from "./data";
import { defaultResumeData } from "./default";

const representativeCustomSectionItemByType = {
	summary: { id: "summary-item", hidden: false, content: "<p>Summary</p>" },
	experience: {
		id: "experience-item",
		hidden: false,
		company: "Analytical Engines",
		position: "Programmer",
		location: "London",
		period: "1842–1843",
		description: "<p>Wrote the first algorithm.</p>",
	},
} as const satisfies Partial<Record<CustomSectionType, Record<string, unknown>>>;

const customSectionFixture = (type: CustomSectionType, item: Record<string, unknown>) => ({
	id: `custom-${type}`,
	type,
	title: "Custom section",
	icon: "",
	columns: 1,
	hidden: false,
	keepTogether: false,
	startOnNewPage: false,
	items: [item],
});

describe("resumeDataSchema", () => {
	it("rejects a renderer-unsafe custom section before PDF or DOCX dispatch", () => {
		const rendererUnsafeSection = customSectionFixture("experience", representativeCustomSectionItemByType.summary);

		expect(customSectionSchema.safeParse(rendererUnsafeSection).success).toBe(false);
		expect(
			resumeDataSchema.safeParse({
				...defaultResumeData,
				customSections: [rendererUnsafeSection],
			}).success,
		).toBe(false);
	});

	it("returns renderer-safe normalized data without losing compatible overlapping fields", () => {
		const data = {
			...structuredClone(defaultResumeData),
			customSections: [
				customSectionFixture("experience", {
					...representativeCustomSectionItemByType.experience,
					content: "<p>Preserve this overlapping field</p>",
				}),
			],
		};
		const parsed = parseResumeData(data);

		expect(parsed.customSections[0]?.items[0]).toMatchObject({
			content: "<p>Preserve this overlapping field</p>",
			roles: [],
			website: { url: "", label: "", inlineLink: false },
		});
	});
});

it("defaults fields that resumes saved before they existed leave out", () => {
	const legacy = JSON.parse(JSON.stringify(defaultResumeData));
	delete legacy.picture.fit;
	delete legacy.metadata.page.hideLinkUnderline;
	delete legacy.summary.icon;
	delete legacy.sections.experience.icon;
	delete legacy.sections.skills.layout;
	legacy.basics.customFields = [{ id: "1", icon: "phone", text: "x" }];

	expect(resumeDataSchema.parse(legacy)).toMatchObject({
		picture: { fit: "cover" },
		basics: { customFields: [{ link: "" }] },
		summary: { icon: "" },
		sections: { experience: { icon: "" }, skills: { layout: "default" } },
		metadata: { page: { hideLinkUnderline: false } },
	});
	expect(resumeDataSchema.parse({ ...legacy, picture: { ...legacy.picture, fit: "stretch" } }).picture.fit).toBe(
		"cover",
	);
});
