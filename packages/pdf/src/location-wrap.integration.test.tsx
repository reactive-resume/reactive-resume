import type { SectionTitleResolver } from "./section-title";
import type { ElementInfo } from "@formepdf/core";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vitest";
import * as forme from "@formepdf/core";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { templateSchema } from "@reactive-resume/schema/templates";
import { renderResume } from "./forme/render";

const resolveSectionTitle: SectionTitleResolver = (input) => input.defaultEnglishTitle ?? input.sectionId;

/**
 * Issue #3586: the work-experience location wrapped mid-word ("Mumbai" rendered as
 * "Mumba"/"i", "Mumbai," as "Mumbai"/",") after the Forme v6 renderer landed. The trailing
 * header text goes into a row item measured by the engine; a nested inline run makes the line
 * breaker fall back to character breaks when the measured box is a hair under the shaped width.
 */

const buildData = (location: string): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.picture.hidden = true;
	data.sections.experience.items = [
		{
			id: "experience/1",
			hidden: false,
			company: "Acme",
			position: "Engineer",
			location,
			period: "Jan 2024 - Mar 2025",
			website: { url: "", label: "", inlineLink: false },
			description: "",
			roles: [],
		},
	];
	const page = data.metadata.layout.pages[0];
	if (!page) throw new Error("Missing authored page");
	page.main = ["experience"];
	page.sidebar = [];
	return data;
};

const textBlocks = (node: ElementInfo, out: ElementInfo[] = []): ElementInfo[] => {
	if (node.nodeType === "Text") out.push(node);
	node.children.forEach((child) => textBlocks(child, out));
	return out;
};

const linesOf = (block: ElementInfo): string[] =>
	block.children.filter((line) => line.nodeType === "TextLine").map((line) => line.textContent ?? "");

/** Every laid-out text block whose lines reassemble into the location token, as line arrays. */
const tokenBlocks = (layout: Awaited<ReturnType<typeof renderResume>>["layout"], token: string): string[][] =>
	layout.pages
		.flatMap((page) => page.elements.flatMap((element) => textBlocks(element)))
		.map(linesOf)
		.filter((lines) => lines.join("").includes(token));

const expectSingleLine = (layout: Awaited<ReturnType<typeof renderResume>>["layout"], token: string) => {
	const blocks = tokenBlocks(layout, token);
	expect(blocks).not.toEqual([]);
	for (const lines of blocks) {
		// The whole token appears on one line, with no mid-word fragment on another.
		expect(lines.some((line) => line.includes(token))).toBe(true);
		expect(lines.filter((line) => line !== "" && line !== token && token.includes(line))).toEqual([]);
	}
};

describe("experience location wrapping (#3586)", () => {
	it.each(templateSchema.options)("keeps the whole location on one line in %s", async (template) => {
		const { layout } = await renderResume(forme, {
			data: buildData("Mumbai"),
			template: template as Template,
			resolveSectionTitle,
		});
		expectSingleLine(layout, "Mumbai");
	});

	it.each(templateSchema.options)("keeps a trailing comma on the same line in %s", async (template) => {
		const { layout } = await renderResume(forme, {
			data: buildData("Mumbai,"),
			template: template as Template,
			resolveSectionTitle,
		});
		expectSingleLine(layout, "Mumbai,");
	});
});
