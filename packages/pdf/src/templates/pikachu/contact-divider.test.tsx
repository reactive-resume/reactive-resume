import { expect, it } from "vite-plus/test";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act, createElement } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../../document";
import { renderToBuffer } from "../../forme/testing";

async function header(email: string) {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Fictional header";
	data.basics.email = email;
	data.metadata.page.hideIcons = true;
	data.metadata.page.hideLinkUnderline = true;
	data.metadata.typography.body.fontFamily = "Helvetica";
	data.metadata.typography.heading.fontFamily = "Helvetica";
	const element = createElement(ResumeDocument, { data, template: "pikachu" }) as unknown as Parameters<
		typeof renderToBuffer
	>[0];
	let bytes: Uint8Array = new Uint8Array();
	await act(async () => {
		bytes = new Uint8Array(await renderToBuffer(element));
	});
	const task = getDocument({ data: bytes, useSystemFonts: true });
	try {
		const document = await task.promise;
		const page = await document.getPage(1);
		const operators = await page.getOperatorList();
		const text = (await page.getTextContent()).items.flatMap((item) => ("str" in item ? [item.str] : [])).join(" ");
		return { paths: operators.fnArray.filter((operation) => operation === OPS.constructPath).length, text };
	} finally {
		await task.destroy();
	}
}

it("paints a contact divider only when contact details print", async () => {
	const empty = await header("");
	const contact = await header("fictional@example.test");
	expect(empty.text).toContain("Fictional header");
	expect(empty.text).not.toContain("fictional@example.test");
	expect(contact.text).toContain("fictional@example.test");
	expect(contact.paths).toBeGreaterThan(empty.paths);
});
