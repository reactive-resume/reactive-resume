// @vitest-environment happy-dom

import { describe, expect, it } from "vite-plus/test";
import { cleanPastedHtml } from "./pasted-html";

describe("cleanPastedHtml", () => {
	it("drops a Google Docs paste's colour and font but keeps bold", () => {
		const html =
			'<b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:700;">Led</span><span style="color:rgb(0,0,0)"> the team</span></p></b>';
		const cleaned = cleanPastedHtml(html);
		expect(cleaned).not.toMatch(/color|font-family|font-size|background/);
		expect(cleaned).toContain("font-weight:700");
		expect(cleaned).toContain(" the team");
	});

	it("turns Word's typed bullets into a list", () => {
		const html = [
			'<h2 style="color:#1F3864">Experience</h2>',
			'<p class="MsoListParagraphCxSpFirst" style="text-indent:-18pt;mso-list:l0 level1 lfo1"><span style="font-family:Symbol;mso-list:Ignore">·<span style="font:7.0pt &quot;Times New Roman&quot;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></span>Shipped checkout</p>',
			'<p class="MsoListParagraphCxSpLast" style="text-indent:-18pt;mso-list:l0 level1 lfo1"><span style="font-family:Symbol;mso-list:Ignore">·<span>&nbsp;&nbsp;&nbsp;</span></span>Cut <b>load time</b> 30%</p>',
			'<p class="MsoNormal">After</p>',
		].join("");
		const cleaned = cleanPastedHtml(html);
		expect(cleaned).toBe(
			"<h2>Experience</h2><ul><li>Shipped checkout</li><li>Cut <b>load time</b> 30%</li></ul><p>After</p>",
		);
	});

	it("numbers a Word list typed with numbers, without the conditional marker span", () => {
		const html =
			'<p style="mso-list:l1 level1 lfo2">1.&nbsp;&nbsp;&nbsp;First</p><p style="mso-list:l1 level1 lfo2">2.&nbsp;&nbsp;&nbsp;Second</p>';
		expect(cleanPastedHtml(html)).toBe("<ol><li>First</li><li>Second</li></ol>");
	});

	it("keeps a numbered list's start and an item's own leading dash", () => {
		const html = [
			'<p style="mso-list:l1 level1 lfo2"><span style="mso-list:Ignore">4.<span>&nbsp;&nbsp;</span></span>Fourth</p>',
			'<p style="mso-list:l1 level1 lfo2"><span style="mso-list:Ignore">5.<span>&nbsp;&nbsp;</span></span>- configured monitoring</p>',
		].join("");
		expect(cleanPastedHtml(html)).toBe('<ol start="4"><li>Fourth</li><li>- configured monitoring</li></ol>');
	});

	it("keeps a bullet list and the numbered list after it apart", () => {
		const html = [
			'<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·<span>&nbsp;</span></span>Bullet</p>',
			'<p style="mso-list:l1 level1 lfo2"><span style="mso-list:Ignore">1.<span>&nbsp;</span></span>Step</p>',
		].join("");
		expect(cleanPastedHtml(html)).toBe("<ul><li>Bullet</li></ul><ol><li>Step</li></ol>");
	});

	it("reads Word's marker span whatever its case, and keeps authored words that only look like a marker", () => {
		const html = [
			'<p style="mso-list:l0 level1 lfo1"><span style="MSO-LIST:Ignore">·<span>&nbsp;</span></span>Shipped</p>',
			'<p class="MsoListParagraph">Inc. grew revenue</p>',
		].join("");
		expect(cleanPastedHtml(html)).toBe("<ul><li>Shipped</li></ul><ul><li>Inc. grew revenue</li></ul>");
	});

	it("keeps Word lists without a list number apart when their markers differ", () => {
		const html = [
			'<p class="MsoListParagraph">·&nbsp;Bullet</p>',
			'<p class="MsoListParagraph">1.&nbsp;Numbered</p>',
		].join("");
		expect(cleanPastedHtml(html)).toBe("<ul><li>Bullet</li></ul><ol><li>Numbered</li></ol>");
	});

	it("leaves plain markup alone", () => {
		const html = '<p>One <a href="https://example.com">link</a></p><ul><li>Item</li></ul>';
		expect(cleanPastedHtml(html)).toBe(html);
	});
});
