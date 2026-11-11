// @vitest-environment happy-dom

import type { LayoutPage } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { buildDocument } from "./builder";

const NAME = "HeaderProbe";
const BODY = "SummaryProbe";

const templates = Object.keys(templateLayouts) as Template[];

const split: LayoutPage = { fullWidth: false, main: ["summary"], sidebar: ["skills"] };
const fullWidth: LayoutPage = { fullWidth: true, main: ["summary"], sidebar: [] };
const noSidebar: LayoutPage = { fullWidth: false, main: ["summary"], sidebar: [] };
const laterSplit: LayoutPage = { fullWidth: false, main: ["experience"], sidebar: ["languages"] };

/** The document body as JSON, in reading order. */
function documentJson(template: Template, pages: LayoutPage[]) {
	const data = structuredClone(defaultResumeData);
	data.metadata.template = template;
	data.metadata.layout.pages = pages;
	data.basics.name = NAME;
	data.summary.content = `<p>${BODY}</p>`;
	const file = buildDocument(data);
	return JSON.stringify(file.Document.View.prepForXml({ file, viewWrapper: file.Document, stack: [] }));
}

describe("DOCX header placement", () => {
	it.each(templates)("prints the %s header on a single-column first page", (template) => {
		for (const first of [fullWidth, noSidebar]) {
			const xml = documentJson(template, [first]);
			expect(xml.split(NAME)).toHaveLength(2);
			expect(xml.indexOf(NAME)).toBeLessThan(xml.indexOf(BODY));
		}
	});

	it.each(templates)("does not repeat the %s header on a second split page", (template) => {
		const xml = documentJson(template, [split, laterSplit]);
		expect(xml.split(NAME)).toHaveLength(2);
		expect(xml.indexOf(NAME)).toBeLessThan(xml.indexOf(BODY));
	});

	it.each(templates)(
		"prints the %s header before a single-column first page, not on a later split page",
		(template) => {
			const xml = documentJson(template, [fullWidth, laterSplit]);
			expect(xml.split(NAME)).toHaveLength(2);
			expect(xml.indexOf(NAME)).toBeLessThan(xml.indexOf(BODY));
		},
	);
});
