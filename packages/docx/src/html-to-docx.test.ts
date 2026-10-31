// @vitest-environment happy-dom

import { describe, expect, it } from "vite-plus/test";
import { Document } from "docx";
import { htmlToParagraphs } from "./html-to-docx";

function paragraphXml(html: string) {
	const paragraphs = htmlToParagraphs(html);
	const file = new Document({ sections: [{ children: paragraphs }] });
	return paragraphs.map((paragraph) =>
		JSON.stringify(paragraph.prepForXml({ file, viewWrapper: file.Document, stack: [] })),
	);
}

describe("htmlToParagraphs", () => {
	it("converts plain text nodes at the body root into a paragraph", () => {
		const result = htmlToParagraphs("Just some plain text");
		expect(result.length).toBe(1);
	});

	it("reads custom background-color from <mark> style for shading fill", () => {
		const result = htmlToParagraphs('<p><mark style="background-color: rgba(204, 255, 204, 1)">green</mark></p>');
		const json = JSON.stringify(result[0]);
		expect(json).toContain("CCFFCC");
	});

	it("leaves script and style text out of the document", () => {
		const json = JSON.stringify(
			htmlToParagraphs("<p>Hello<style>.x { color: red }</style></p><script>alert(1)</script>"),
		);
		expect(json).toContain("Hello");
		expect(json).not.toContain("color: red");
		expect(json).not.toContain("alert(1)");
	});
});

describe("list paragraphs", () => {
	it("marks editor paragraphs inside list items as list paragraphs", () => {
		const [editor] = paragraphXml("<ul><li><p>Typed bullet</p></li></ul>");
		const [plain] = paragraphXml("<ul><li>Typed bullet</li></ul>");

		for (const xml of [editor, plain]) {
			expect(xml).toContain('"w:numPr"');
			expect(xml).toContain('"w:ilvl":{"_attr":{"w:val":0}');
			expect(xml).toContain('"w:numId":{"_attr":{"w:val":1}');
			expect(xml).toContain('"w:pStyle":{"_attr":{"w:val":"ListParagraph"}');
		}
		expect(editor).toBe(plain);
	});

	it("keeps nested list paragraphs at their own numbering level", () => {
		const [outer, inner] = paragraphXml("<ul><li><p>Outer</p><ul><li><p>Inner</p></li></ul></li></ul>");

		expect(outer).toContain('"w:ilvl":{"_attr":{"w:val":0}');
		expect(inner).toContain('"w:ilvl":{"_attr":{"w:val":1}');
		expect(outer).toContain("Outer");
		expect(inner).toContain("Inner");
	});

	it("keeps every paragraph of a multi-paragraph list item", () => {
		const xml = paragraphXml("<ul><li><p>First</p><p>Second</p></li></ul>");

		expect(xml).toHaveLength(2);
		expect(xml[0]).toContain("First");
		expect(xml[1]).toContain("Second");
		expect(xml.every((paragraph) => paragraph.includes('"w:numPr"'))).toBe(true);
	});

	it("keeps ordered list paragraphs marked, matching the existing list rendering", () => {
		const [item] = paragraphXml("<ol><li><p>First</p></li></ol>");

		expect(item).toContain('"w:numPr"');
		expect(item).toContain("First");
	});
});
