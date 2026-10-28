// @vitest-environment happy-dom

import { expect, it } from "vite-plus/test";
import { Editor } from "@tiptap/react";
import { richTextExtensions } from "./rich-text-extensions";
import { hasUnsupportedTableMarkup, toPreviewHtml } from "./rich-text-markup";

it("bounds inherited table spans before Tiptap allocates columns", () => {
	const html =
		'<table><tbody><tr><td colspan="999999999" rowspan="999999999" colwidth="999999999"><p>Keep text</p></td></tr></tbody></table>';
	expect(hasUnsupportedTableMarkup(html)).toBe(true);
	const editor = new Editor({ extensions: richTextExtensions, content: html });
	try {
		expect(editor.getHTML()).toContain("Keep text");
		expect(editor.getHTML()).not.toContain("999999999");
	} finally {
		editor.destroy();
	}
});

it("flattens grids whose spans multiply across too many rows", () => {
	const html = `<table><tbody><tr><td colspan="100" rowspan="1000"><p>Keep text</p></td></tr>${"<tr></tr>".repeat(999)}</tbody></table>`;
	expect(hasUnsupportedTableMarkup(html)).toBe(true);
	expect(toPreviewHtml(html)).toContain("Keep text");
	expect(toPreviewHtml(html)).not.toContain("<table");
});

it("strips imported link classes from the read-only preview", () => {
	expect(toPreviewHtml('<p><a class="fixed inset-0 z-50" href="https://example.test">Link</a></p>')).not.toMatch(
		/class=|href=/,
	);
});

it("keeps supported table formatting and drops other CSS from imported tables", () => {
	const editor = new Editor({
		extensions: richTextExtensions,
		content:
			'<table style="width: 100%; position: fixed; inset: 0"><tbody><tr><td style="padding: 4px; background-image: url(https://example.test/x.png)"><p>Cell</p></td></tr></tbody></table>',
	});
	const html = editor.getHTML();
	editor.destroy();

	expect(html).toContain("width: 100%");
	expect(html).toContain("padding: 4px");
	expect(html).not.toMatch(/position|inset|background-image/);
});
