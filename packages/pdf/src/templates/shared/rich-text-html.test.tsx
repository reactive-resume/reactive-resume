import type { HostElement } from "../../forme/reconciler";
import { describe, expect, it } from "vite-plus/test";
import { HOST } from "../../forme/primitives";
import { renderHostTree } from "../../forme/reconciler";
import { Html } from "../../text";
import { convertPseudoBulletParagraphs, normalizeRichTextHtml, richTextMarkClassName } from "./rich-text-html";

describe("normalizeRichTextHtml", () => {
	it("expands tabs only inside marked paragraphs and headings", () => {
		expect(
			normalizeRichTextHtml(
				'<p data-resume-whitespace="preserve">A\tB</p><h2 data-resume-whitespace="preserve">\tC</h2><p>D\tE</p>',
			),
		).toBe(
			'<p data-resume-whitespace="preserve">A    B</p><h2 data-resume-whitespace="preserve">    C</h2><p>D\tE</p>',
		);
	});

	it("decodes opted-in soft hyphens in text without changing links or escaped literals", () => {
		const html =
			'<p title="&shy;">Soft&shy;ware &#173; &#xAD; &amp;shy; <a href="https://example.com/&shy;">link</a></p>';
		expect(normalizeRichTextHtml(html)).toBe(html);
		expect(normalizeRichTextHtml(html, { softHyphens: true })).toBe(
			'<p title="&shy;">Soft\u00ADware \u00AD \u00AD &amp;shy; <a href="https://example.com/&shy;">link</a></p>',
		);
	});

	it("wraps top-level inline rich text in a paragraph", () => {
		const html =
			"Passionate game developer with 5+ years of professional experience</strong> creating engaging gameplay. <a href='https://www.google.com'>Specialized</a> in Unity.";

		expect(normalizeRichTextHtml(html)).toBe(
			"<p>Passionate game developer with 5+ years of professional experience creating engaging gameplay. <a href='https://www.google.com'>Specialized</a> in Unity.</p>",
		);
	});

	it("moves trailing whitespace outside bold tags", () => {
		expect(normalizeRichTextHtml("<p><strong>Built </strong>and deployed</p>")).toBe(
			"<p><strong>Built</strong> and deployed</p>",
		);
	});

	it("moves leading whitespace outside bold tags", () => {
		expect(normalizeRichTextHtml("<p>Built<strong> and deployed</strong></p>")).toBe(
			"<p>Built <strong>and deployed</strong></p>",
		);
	});

	it("unwraps single paragraph wrappers inside list items", () => {
		expect(normalizeRichTextHtml("<ul><li><p>a</p></li><li><p><strong>b</strong></p></li></ul>")).toBe(
			"<ul><li>a</li><li><strong>b</strong></li></ul>",
		);
	});

	it("flushes accumulated inlines before block-level tags", () => {
		expect(normalizeRichTextHtml("loose<ul><li>a</li></ul>")).toBe("<p>loose</p><ul><li>a</li></ul>");
	});

	it("flushes accumulated inlines after block-level tags", () => {
		expect(normalizeRichTextHtml("<ul><li>a</li></ul>after")).toBe("<ul><li>a</li></ul><p>after</p>");
	});

	it("preserves data-color as inline background-color on multicolor <mark>", () => {
		const result = normalizeRichTextHtml(
			'<mark data-color="rgba(204, 255, 204, 1)" style="background-color: rgba(204, 255, 204, 1)">green</mark>',
		);
		// data-color is kept, class is added, background-color is set from data-color
		expect(result).toContain("rr-pdf-mark");
		expect(result).toContain("background-color: rgba(204, 255, 204, 1)");
		expect(result).toContain(">green</span>");
	});

	it("keeps generated dark-highlight contrast after existing Tiptap mark styles", () => {
		const result = normalizeRichTextHtml(
			'<mark data-color="rgba(0, 0, 0, 1)" style="background-color: rgba(0, 0, 0, 1); color: inherit">dark</mark>',
		);

		expect(result.indexOf("color: inherit")).toBeLessThan(result.lastIndexOf("color: #ffffff"));
	});

	it("keeps highlighted text in the same inline text run as its paragraph", () => {
		const [root] = renderHostTree(
			<Html stylesheet={{ [`.${richTextMarkClassName}`]: { backgroundColor: "#ffff00" } }}>
				{normalizeRichTextHtml("before <mark>highlighted</mark> after")}
			</Html>,
		);
		const paragraph = (root as HostElement).children[0] as HostElement;
		const run = paragraph.children[0] as HostElement;

		expect(run.type).toBe(HOST.text);
		expect(run.children).toHaveLength(3);
		expect(run.children[0]).toEqual({ type: "#text", text: "before " });
		expect(run.children[1]).toMatchObject({ type: HOST.text, children: [{ type: "#text", text: "highlighted" }] });
		expect(run.children[2]).toEqual({ type: "#text", text: " after" });
	});

	it("draws a tag named like an Object.prototype member as plain markup", () => {
		const [root] = renderHostTree(<Html>{"<constructor>a</constructor>"}</Html>);

		expect((root as HostElement).children[0]).toMatchObject({
			type: HOST.view,
			props: { style: [] },
			children: [{ type: HOST.text, children: [{ text: "a" }] }],
		});
	});

	it("preserves authored Unicode spaces around bare rich text", () => {
		expect(normalizeRichTextHtml("\u3000text\u00a0")).toBe("<p>\u3000text\u00a0</p>");
	});

	it("normalizes RTL pseudo-bullets into anchored list items in the shared HTML path", () => {
		expect(normalizeRichTextHtml("<p>‏- א<br>‏- ב</p>", { direction: "rtl" })).toBe("<ul><li>‏א</li><li>‏ב</li></ul>");
		// A Latin paragraph on a right-to-left page reads left to right: no RLM pulls its first fragment across the line.
		expect(normalizeRichTextHtml("<p>Led <b>the</b> team.</p><p>&nbsp;قاد</p>", { direction: "rtl" })).toBe(
			"<p>Led <b>the</b> team.</p><p>‏&nbsp;قاد</p>",
		);
	});
});

describe("convertPseudoBulletParagraphs", () => {
	it("converts a <p> of dash-prefixed lines into a <ul><li> list", () => {
		expect(convertPseudoBulletParagraphs("<p>- a<br>- b<br>- c</p>")).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>");
	});

	it("handles <br> wrapped in inline formatting tags (real editor output)", () => {
		expect(convertPseudoBulletParagraphs("<p>- <strong></strong>foo.<strong><br></strong>- bar.</p>")).toBe(
			"<ul><li>foo.</li><li>bar.</li></ul>",
		);
	});

	it("accepts other bullet markers (• and *)", () => {
		expect(convertPseudoBulletParagraphs("<p>• one<br>* two</p>")).toBe("<ul><li>one</li><li>two</li></ul>");
	});

	it("leaves a paragraph with a single inline <br> untouched", () => {
		const input = "<p>Just a paragraph with a <br> line break.</p>";
		expect(convertPseudoBulletParagraphs(input)).toBe(input);
	});
});
