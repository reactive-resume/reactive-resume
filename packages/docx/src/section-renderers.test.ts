// @vitest-environment happy-dom

import type { CustomSection, ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vite-plus/test";
import { getDefaultSectionIconName } from "@reactive-resume/schema/resume/section-icons";
import { renderCustomSection, renderSummary, setRenderConfig } from "./section-renderers";

const baseConfig = {
	headingFont: "Inter",
	headingSizeHalfPt: 28,
	bodyFont: "Inter",
	bodySizeHalfPt: 20,
	textColorHex: "111111",
	primaryColorHex: "0563C1",
};

setRenderConfig(baseConfig);

const HEX = "#0563C1";

describe("renderSummary", () => {
	it("returns [] when the section is hidden", () => {
		const summary: ResumeData["summary"] = {
			title: "Summary",
			icon: getDefaultSectionIconName("summary"),
			content: "<p>Hello</p>",
			hidden: true,
			showHeading: true,
			columns: 1,
			keepTogether: false,
			startOnNewPage: false,
		};
		expect(renderSummary(summary, HEX)).toEqual([]);
	});

	it("includes a heading paragraph when both title and content are present", () => {
		const summary: ResumeData["summary"] = {
			title: "Summary",
			icon: getDefaultSectionIconName("summary"),
			content: "<p>Hello world</p>",
			hidden: false,
			showHeading: true,
			columns: 1,
			keepTogether: false,
			startOnNewPage: false,
		};
		const paragraphs = renderSummary(summary, HEX);
		// One heading + the htmlToParagraphs output for one <p>.
		expect(paragraphs).toHaveLength(2);
	});

	it("omits a disabled heading while retaining summary content", () => {
		const summary: ResumeData["summary"] = {
			title: "Summary",
			icon: getDefaultSectionIconName("summary"),
			content: "<p>Hello world</p>",
			hidden: false,
			showHeading: false,
			columns: 1,
			keepTogether: false,
			startOnNewPage: false,
		};

		const paragraphs = renderSummary(summary, HEX);

		expect(paragraphs).toHaveLength(1);
	});
});

describe("renderCustomSection", () => {
	const baseCustom: CustomSection = {
		id: "custom-1",
		type: "summary",
		title: "Notes",
		icon: getDefaultSectionIconName("summary"),
		columns: 1,
		hidden: false,
		showHeading: true,
		keepTogether: false,
		startOnNewPage: false,
		items: [],
	};

	it("returns [] when every item is hidden", () => {
		const section: CustomSection = {
			...baseCustom,
			items: [{ id: "x", hidden: true } as never],
		};
		expect(renderCustomSection(section, HEX)).toEqual([]);
	});

	it("renders recipient + content for a cover-letter custom section", () => {
		const section: CustomSection = {
			...baseCustom,
			type: "cover-letter",
			title: "Cover Letter",
			items: [
				{
					id: "x",
					hidden: false,
					recipient: "<p>Dear Jane,</p>",
					content: "<p>Body</p>",
				} as never,
			],
		};
		const paragraphs = renderCustomSection(section, HEX);
		expect(paragraphs).toHaveLength(2);
	});
});
