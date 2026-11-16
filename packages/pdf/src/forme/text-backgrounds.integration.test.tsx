import { expect, it } from "vite-plus/test";
import * as forme from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { templateSchema } from "@reactive-resume/schema/templates";
import { rasterizePdf } from "../semantic/test/rasterize-pdf";
import { normalizeRichTextHtml } from "../templates/shared/rich-text-html";
import { createRichTextStylesheet } from "../templates/shared/rich-text-stylesheet";
import { Html } from "../text";
import { Document, Link, Page, Text, View } from "./primitives";
import { renderResume, renderResumeElement } from "./render";

it("paints inline highlights and code behind selectable text without leaking probe links", async () => {
	const result = await act(() =>
		renderResumeElement(
			forme,
			<Document>
				<Page style={{ padding: 30, fontSize: 12, fontFamily: "Helvetica" }}>
					<Html
						stylesheet={createRichTextStylesheet()}
						renderers={{
							a: ({ element, children }) => <Link src={element.getAttribute("href") ?? ""}>{children}</Link>,
						}}
					>
						{normalizeRichTextHtml(
							'<p>Before <mark>Mark</mark> after <code>Code</code> <mark data-color="#000000">Dark</mark> <a href="https://example.com"><mark data-color="#00ff00">Linked</mark></a></p>',
						)}
					</Html>
				</Page>
			</Document>,
		),
	);
	const [page] = await rasterizePdf(Uint8Array.from(result.pdf));
	if (!page) throw new Error("Missing rendered page");
	const count = (r: number, g: number, b: number) => {
		let pixels = 0;
		for (let i = 0; i < page.data.length; i += 4)
			if (page.data[i] === r && page.data[i + 1] === g && page.data[i + 2] === b) pixels++;
		return pixels;
	};
	expect(count(255, 255, 0)).toBeGreaterThan(200);
	expect(count(238, 238, 238)).toBeGreaterThan(200);
	expect(count(0, 255, 0)).toBeGreaterThan(200);
	const loading = getDocument({ data: Uint8Array.from(result.pdf) });
	const pdf = await loading.promise;
	try {
		const first = await pdf.getPage(1);
		const text = (await first.getTextContent()).items.flatMap((item) => ("str" in item ? [item.str] : [])).join("");
		expect(text).toBe("Before Mark after Code Dark Linked");
		expect((await first.getAnnotations()).map((annotation) => annotation.url)).toEqual(["https://example.com/"]);
	} finally {
		await loading.destroy();
	}
});

it.each(templateSchema.options)("paints rich-text backgrounds in the %s template", async (template) => {
	const data = structuredClone(defaultResumeData);
	data.picture.hidden = true;
	data.metadata.layout.pages = [{ fullWidth: true, main: ["summary"], sidebar: [] }];
	data.summary.content =
		'<p>Before <mark data-color="#00ff00">Marked <strong>bold</strong> text</mark> after <code>Code</code>.</p>';
	const result = await act(() => renderResume(forme, { data, template }));
	const [page] = await rasterizePdf(Uint8Array.from(result.pdf));
	if (!page) throw new Error("Missing rendered page");
	let green = 0;
	let code = 0;
	for (let i = 0; i < page.data.length; i += 4) {
		if (page.data[i] === 0 && page.data[i + 1] === 255 && page.data[i + 2] === 0) green++;
		if (page.data[i] === 238 && page.data[i + 1] === 238 && page.data[i + 2] === 238) code++;
	}
	expect(green).toBeGreaterThan(200);
	expect(code).toBeGreaterThan(100);
});

it("keeps wrapping and layout unchanged across highlighted page breaks", async () => {
	const render = (highlighted: boolean) =>
		act(() =>
			renderResumeElement(
				forme,
				<Document>
					<Page size={{ width: 200, height: 160 }} style={{ padding: 20, fontSize: 12, fontFamily: "Helvetica" }}>
						<Text>
							Plain start{" "}
							<Text style={highlighted ? { backgroundColor: "#ffff00" } : {}}>{"Wrapped highlight ".repeat(40)}</Text>{" "}
							plain end
						</Text>
					</Page>
				</Document>,
			),
		);
	const [marked, plain] = await Promise.all([render(true), render(false)]);
	expect(marked.layout).toEqual(plain.layout);
	const pages = await rasterizePdf(Uint8Array.from(marked.pdf));
	expect(pages.length).toBeGreaterThan(1);
	for (const page of pages) {
		let yellow = 0;
		for (let i = 0; i < page.data.length; i += 4)
			if (page.data[i] === 255 && page.data[i + 1] === 255 && page.data[i + 2] === 0) yellow++;
		expect(yellow).toBeGreaterThan(200);
	}
});

it("places translucent backgrounds in the correct column over its backdrop", async () => {
	const result = await act(() =>
		renderResumeElement(
			forme,
			<Document>
				<Page style={{ padding: 20, fontSize: 12, fontFamily: "Helvetica" }}>
					<View style={{ flexDirection: "row" }}>
						<View style={{ width: 200, backgroundColor: "#123456", padding: 10 }}>
							<Text>
								Left <Text style={{ backgroundColor: "rgba(255, 0, 0, 0.5)" }}>Tint</Text>
							</Text>
						</View>
						<View style={{ width: 200, padding: 10 }}>
							<Text>
								Right <Text style={{ backgroundColor: "#ffff00" }}>Yellow</Text>
							</Text>
						</View>
					</View>
				</Page>
			</Document>,
		),
	);
	const [page] = await rasterizePdf(Uint8Array.from(result.pdf));
	if (!page) throw new Error("Missing rendered page");
	let tint = 0;
	let yellow = 0;
	for (let y = 0; y < page.height; y++)
		for (let x = 0; x < page.width; x++) {
			const offset = (y * page.width + x) * 4;
			const [r, g, b] = page.data.subarray(offset, offset + 3);
			if (r === 137 && g === 26 && b === 43) {
				tint++;
				expect(x).toBeLessThan(330);
			}
			if (r === 255 && g === 255 && b === 0) {
				yellow++;
				expect(x).toBeGreaterThan(330);
			}
		}
	expect(tint).toBeGreaterThan(200);
	expect(yellow).toBeGreaterThan(200);
});
