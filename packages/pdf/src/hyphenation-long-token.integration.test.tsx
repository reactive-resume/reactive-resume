import type { ElementInfo } from "@formepdf/core";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vite-plus/test";
import * as forme from "@formepdf/core";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { renderResume } from "./forme/render";

// #3686: Forme 0.29 built hypher without `alloc`, so hyphenating a word over 45 bytes panicked and aborted the render.
const LONG_ALPHA_WORD = "supercalifragilisticexpialidocioussupercalifragilistic";
const LONG_URL = "https://example.com/articles/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const textBlocks = (node: ElementInfo, out: ElementInfo[] = []): ElementInfo[] => {
	if (node.nodeType === "Text") out.push(node);
	node.children.forEach((child) => textBlocks(child, out));
	return out;
};

describe("hyphenation with long unbroken tokens (#3686)", () => {
	it("renders words over 45 bytes in full", async () => {
		const data: ResumeData = structuredClone(defaultResumeData);
		data.picture.hidden = true;
		data.metadata.typography.hyphenation = true;
		data.basics.website = { url: LONG_URL, label: "" };
		data.summary.content = `<p>${LONG_ALPHA_WORD}</p>`;

		const { pdf, layout } = await renderResume(forme, { data, template: "onyx" });
		expect(pdf.length).toBeGreaterThan(0);
		const text = layout.pages
			.flatMap((page) => page.elements.flatMap((element) => textBlocks(element)))
			.flatMap((block) => block.children.filter((line) => line.nodeType === "TextLine"))
			.map((line) => line.textContent ?? "")
			.join("")
			.replaceAll("-", "");
		expect(text).toContain(LONG_URL);
		expect(text).toContain(LONG_ALPHA_WORD);
	});
});
