import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vitest";
import { pdf } from "@react-pdf/renderer";
import { createElement } from "react";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { EMPTY_SEMANTIC_CSS_SOURCE } from "@reactive-resume/schema/resume/stylesheet";
import { ResumeDocument } from "../../document";
import { shouldShowResumeHeader } from "./cover-letter";

type HostNode = { type: string; value?: string; children?: HostNode[] };

const renderedText = (node: HostNode): string => node.value ?? (node.children ?? []).map(renderedText).join("");

const createCoverLetterOnlyData = () => {
	const data = structuredClone(sampleResumeData);
	const coverLetter = data.customSections.find((section) => section.type === "cover-letter");

	if (!coverLetter) throw new Error("sample resume must include a cover letter");

	return {
		...data,
		customSections: [coverLetter],
		metadata: {
			...data.metadata,
			layout: {
				...data.metadata.layout,
				pages: [{ fullWidth: true, main: [coverLetter.id], sidebar: [] }],
			},
		},
	};
};

describe("shouldShowResumeHeader", () => {
	it("hides the header when every visible layout section is a cover letter", () => {
		expect(shouldShowResumeHeader(createCoverLetterOnlyData(), 0)).toBe(false);
	});

	it("can keep the first-page header for cover letter documents", () => {
		const data = { ...createCoverLetterOnlyData(), renderOptions: { includeCoverLetterHeader: true } };

		expect(shouldShowResumeHeader(data, 0)).toBe(true);
		expect(shouldShowResumeHeader(data, 1)).toBe(false);
	});

	it("keeps the first-page header for normal resume documents", () => {
		expect(shouldShowResumeHeader(sampleResumeData, 0)).toBe(true);
		expect(shouldShowResumeHeader(sampleResumeData, 1)).toBe(false);
	});
});

describe("ResumeDocument cover letter header", () => {
	const renderCoverLetterDocument = async (template: Template) => {
		const data = createCoverLetterOnlyData();
		data.metadata.stylesheet = {
			mode: "semantic",
			source: { languageVersion: 1, text: EMPTY_SEMANTIC_CSS_SOURCE },
		};
		const element = createElement(ResumeDocument, {
			data,
			template,
			renderOptions: { includeCoverLetterHeader: true },
		}) as unknown as Parameters<typeof pdf>[0];
		const instance = pdf(element);
		await expect.poll(() => instance.container.document).not.toBeNull();

		return renderedText(instance.container.document as unknown as HostNode);
	};

	it.each(["gengar", "onyx"] as const)(
		"renders the sender header for %s cover letter PDFs when includeCoverLetterHeader is set",
		async (template) => {
			const data = structuredClone(sampleResumeData);
			const rendered = await renderCoverLetterDocument(template);

			expect(rendered).toContain("Dear Hiring Manager");
			expect(rendered).toContain(data.basics.email);
		},
	);
});
