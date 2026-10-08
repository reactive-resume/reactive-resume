import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vitest";
import * as forme from "@formepdf/core";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { templateSchema } from "@reactive-resume/schema/templates";
import { renderResume } from "./render";

const withFormat = (format: ResumeData["metadata"]["page"]["format"]): ResumeData => ({
	...sampleResumeData,
	picture: { ...sampleResumeData.picture, hidden: true },
	metadata: {
		...sampleResumeData.metadata,
		layout: {
			...sampleResumeData.metadata.layout,
			pages: [{ fullWidth: false, main: ["summary"], sidebar: ["profiles"] }],
		},
		page: { ...sampleResumeData.metadata.page, format },
	},
});

describe("free-form pages", () => {
	// A free-form page is never shorter than A4, so content shorter than a sheet lays out exactly as on A4. Templates
	// whose columns or backgrounds fill the page used to measure as tall as the page they were measured on (#3582).
	it.each(templateSchema.options)("lay out short content like A4 in %s", async (template) => {
		const [freeForm, a4] = await Promise.all([
			renderResume(forme, { data: withFormat("free-form"), template }),
			renderResume(forme, { data: withFormat("a4"), template }),
		]);

		expect(freeForm.layout.pages).toEqual(a4.layout.pages);
	});
});
