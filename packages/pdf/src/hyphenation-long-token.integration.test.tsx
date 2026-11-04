import type { ElementInfo } from "@formepdf/core";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vite-plus/test";
import * as forme from "@formepdf/core";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { templateSchema } from "@reactive-resume/schema/templates";
import { renderResume } from "./forme/render";

/**
 * Issue #3686: with automatic hyphenation enabled, PDF preview/export panicked
 * inside the Forme engine when a long unbroken token reached the hyphenator —
 * `hypher` compiled without `alloc` aborts on words longer than 45 bytes
 * ("hypher: maximum word length is 45 bytes when `alloc` is disabled"). The
 * reporter's "long URL" case is a URL whose path holds an all-alphabetic
 * segment over that limit. @formepdf 0.30.0 builds hypher with `alloc`, so the
 * same document renders instead of aborting the whole render.
 */

const LONG_ALPHA_WORD = "supercalifragilisticexpialidocioussupercalifragilistic";
const LONG_URL = "https://example.com/articles/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const buildData = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.picture.hidden = true;
	data.metadata.typography.hyphenation = true;
	data.basics.website = { url: LONG_URL, label: "" };
	data.summary.content = `<p>${LONG_ALPHA_WORD}</p>`;
	return data;
};

const textBlocks = (node: ElementInfo, out: ElementInfo[] = []): ElementInfo[] => {
	if (node.nodeType === "Text") out.push(node);
	node.children.forEach((child) => textBlocks(child, out));
	return out;
};

const pageText = (layout: Awaited<ReturnType<typeof renderResume>>["layout"]): string =>
	layout.pages
		.flatMap((page) => page.elements.flatMap((element) => textBlocks(element)))
		.flatMap((block) => block.children.filter((line) => line.nodeType === "TextLine"))
		.map((line) => line.textContent ?? "")
		.join("")
		.replaceAll("-", "");

describe("hyphenation with long unbroken tokens (#3686)", () => {
	it.each(templateSchema.options)("renders without panicking in %s", async (template) => {
		const { pdf, layout } = await renderResume(forme, { data: buildData(), template: template as Template });
		expect(pdf.length).toBeGreaterThan(0);
		const text = pageText(layout);
		expect(text).toContain(LONG_URL);
		expect(text).toContain(LONG_ALPHA_WORD);
	});
});
