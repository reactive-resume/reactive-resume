import { describe, expect, it } from "vite-plus/test";
import z from "zod";
import { defaultResumeData } from "./default";
import { createResumeDataJsonSchema } from "./json-schema";

describe("createResumeDataJsonSchema", () => {
	const generatedSchema = z.fromJSONSchema(createResumeDataJsonSchema());

	it("accepts legacy input with omitted picture fit and skill keyword layout, rejecting an unknown layout", () => {
		const input = JSON.parse(JSON.stringify(defaultResumeData));
		delete input.picture.fit;
		delete input.sections.skills.keywordLayout;
		expect(generatedSchema.safeParse(input).success).toBe(true);
		input.sections.skills.keywordLayout = "list";
		expect(generatedSchema.safeParse(input).success).toBe(true);
		input.sections.skills.keywordLayout = "invalid";
		expect(generatedSchema.safeParse(input).success).toBe(false);
	});

	it("enforces the custom-section type and item correlation", () => {
		const valid = {
			...defaultResumeData,
			customSections: [
				{
					id: "custom-summary",
					type: "summary",
					title: "Summary",
					icon: "",
					columns: 1,
					hidden: false,
					keepTogether: false,
					startOnNewPage: false,
					items: [{ id: "summary-item", hidden: false, content: "<p>Summary</p>" }],
				},
			],
		};
		const mismatched = {
			...valid,
			customSections: valid.customSections.map((section) => ({ ...section, type: "experience" })),
		};

		expect(generatedSchema.safeParse(valid).success).toBe(true);
		expect(generatedSchema.safeParse(mismatched).success).toBe(false);
	});
});
