import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { copyCoverLetterStyle, createCoverLetterResumeData } from "@reactive-resume/resume/cover-letter";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { ResumeDocument } from "../../document";
import { pdf, type RenderedNode } from "../../forme/testing";
import { shouldShowResumeHeader } from "./cover-letter";

// A letter's document: resume data with one cover-letter section, as the letter export builds it.
const createCoverLetterOnlyData = () =>
	createCoverLetterResumeData({
		name: "Cover Letter",
		recipient: "<p>Hiring Manager</p>",
		content: "<p>Dear Hiring Manager,</p>",
		style: copyCoverLetterStyle(sampleResumeData, "letter-section", "letter-item"),
	});

describe("shouldShowResumeHeader", () => {
	it("hides the header when every visible layout section is a cover letter", () => {
		expect(shouldShowResumeHeader(createCoverLetterOnlyData(), 0)).toBe(false);
	});

	it("keeps the first-page header for normal resume documents", () => {
		expect(shouldShowResumeHeader(sampleResumeData, 0)).toBe(true);
		expect(shouldShowResumeHeader(sampleResumeData, 1)).toBe(false);
	});
});

const renderedText = (node: RenderedNode): string =>
	"value" in node ? node.value : node.children.map(renderedText).join("");

describe("ResumeDocument cover letter header", () => {
	const renderCoverLetterDocument = async (template: Template, includeCoverLetterHeader?: boolean) => {
		const element = createElement(ResumeDocument, {
			data: createCoverLetterOnlyData(),
			template,
			renderOptions: includeCoverLetterHeader === undefined ? undefined : { includeCoverLetterHeader },
		}) as unknown as Parameters<typeof pdf>[0];
		const instance = pdf(element);
		await expect.poll(() => instance.container.document).not.toBeNull();

		return renderedText(instance.container.document as RenderedNode);
	};

	it.each(["gengar", "onyx"] as const)(
		"renders the sender block for %s cover letter PDFs when includeCoverLetterHeader is set",
		async (template) => {
			const data = createCoverLetterOnlyData();
			const rendered = await renderCoverLetterDocument(template, true);

			expect(rendered).toContain("Dear Hiring Manager");
			expect(rendered).toContain(data.basics.email);
		},
	);

	it.each(["gengar", "onyx"] as const)(
		"omits the sender block for %s cover letter PDFs by default",
		async (template) => {
			const data = createCoverLetterOnlyData();
			const rendered = await renderCoverLetterDocument(template);

			expect(rendered).toContain("Dear Hiring Manager");
			expect(rendered).not.toContain(data.basics.email);
		},
	);
});
