import { describe, expect, it } from "vite-plus/test";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act, createElement } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../../document";
import { renderToBuffer } from "../../forme/testing";

const renderHeading = async (css: string, hideSectionIcons = false) => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Audit";
	data.metadata.typography.body.fontFamily = "Helvetica";
	data.metadata.typography.heading.fontFamily = "Helvetica";
	data.metadata.page.hideSectionIcons = hideSectionIcons;
	data.metadata.layout.pages = [{ fullWidth: true, main: ["skills", "summary"], sidebar: [] }];
	data.summary.content = "<p>Summary body</p>";
	data.summary.title = "Heading";
	data.sections.skills.title = "Heading";
	data.metadata.stylesheet = { mode: "semantic", source: { languageVersion: 1, text: `@version 1; ${css}` } };
	data.sections.skills.items = [
		{ id: "skill", hidden: false, name: "Skill", proficiency: "", level: 0, keywords: [], icon: "", iconColor: "" },
	];
	const element = createElement(ResumeDocument, {
		data,
		template: "scizor",
	}) as unknown as Parameters<typeof renderToBuffer>[0];
	let bytes: Uint8Array = new Uint8Array();
	await act(async () => {
		bytes = new Uint8Array(await renderToBuffer(element));
	});
	const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
	try {
		const document = await loadingTask.promise;
		const page = await document.getPage(1);
		const operators = await page.getOperatorList();
		let fill = "";
		let size = 0;
		const text: { value: string; fill: string }[] = [];
		const sizes: { value: string; size: number }[] = [];
		for (const [index, fn] of operators.fnArray.entries()) {
			const args = operators.argsArray[index];
			if (fn === OPS.setFillRGBColor) fill = args[0];
			if (fn === OPS.setFont) size = args[1];
			if (fn === OPS.showText) {
				const value = args[0]
					.map((glyph: { unicode?: string } | number) => (typeof glyph === "number" ? "" : (glyph.unicode ?? "")))
					.join("");
				text.push({ value, fill });
				sizes.push({ value, size });
			}
		}
		return { text, sizes };
	} finally {
		await loadingTask.destroy();
	}
};

describe("Semantic section heading colors (#3348)", () => {
	it("applies heading color and text styles with section icons visible", async () => {
		const { text, sizes } = await renderHeading(
			"section-heading { color: #1234ef; } section[type='skills'] section-heading { font-size: 21pt; text-transform: lowercase; }",
		);
		expect(text).toContainEqual({ value: "heading", fill: "#1234ef" });
		expect(text).toContainEqual({ value: "HEADING", fill: "#1234ef" });
		expect(sizes).toContainEqual({ value: "heading", size: 21 });
	});
});
