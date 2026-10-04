import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../../document";
import { renderToBuffer } from "../../forme/testing";

for (const template of ["ditgar", "gengar"] as const) {
	describe(`${template} featured summary heading`, () => {
		it.each([
			[true, true],
			[false, false],
			[undefined, true],
		] as const)("showHeading=%s renders heading=%s", async (showHeading, expected) => {
			const data = structuredClone(defaultResumeData);
			data.metadata.typography.body.fontFamily = "Helvetica";
			data.metadata.typography.heading.fontFamily = "Helvetica";
			data.metadata.page.hideIcons = true;
			data.basics.name = "Ada Lovelace";
			data.summary.title = "Summary";
			data.summary.content = "<p>Seasoned engineer shipping reliable systems.</p>";
			data.metadata.layout.pages = [{ fullWidth: false, main: ["summary"], sidebar: [] }];
			if (showHeading === undefined) delete data.summary.showHeading;
			else data.summary.showHeading = showHeading;
			const bytes = await act(() => renderToBuffer(<ResumeDocument data={data} template={template} />));
			const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
			try {
				const document = await loading.promise;
				const page = await document.getPage(1);
				const text = (await page.getTextContent()).items.flatMap((item) => ("str" in item ? [item.str] : []));
				expect(text.some((run) => run.includes("Summary"))).toBe(expected);
			} finally {
				await loading.destroy();
			}
		});
	});
}
