import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../../document";

type FixtureOptions = {
	mode: "legacy" | "semantic";
	template: Template;
	/** `undefined` simulates an older resume saved before the show-heading toggle existed. */
	showHeading: boolean | undefined;
};

function fixture({ mode, template, showHeading }: FixtureOptions): ResumeData {
	const data = structuredClone(defaultResumeData);
	data.metadata.template = template;
	data.metadata.typography.body.fontFamily = "Helvetica";
	data.metadata.typography.heading.fontFamily = "Helvetica";
	data.metadata.page.hideIcons = true;
	data.basics.name = "Ada Lovelace";
	data.summary.title = "Summary";
	data.summary.content = "<p>Seasoned engineer shipping reliable systems.</p>";
	data.metadata.layout.pages = [{ fullWidth: false, main: ["summary"], sidebar: [] }];
	if (mode === "semantic") data.metadata.stylesheet = { mode, source: { languageVersion: 1, text: "@version 1;" } };
	if (showHeading === undefined) delete data.summary.showHeading;
	else data.summary.showHeading = showHeading;
	return data;
}

async function renderFirstPageText(options: FixtureOptions): Promise<string[]> {
	const bytes = await act(() => renderToBuffer(<ResumeDocument data={fixture(options)} template={options.template} />));
	const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
	try {
		const document = await loading.promise;
		expect(document.numPages).toBe(1);
		const page = await document.getPage(1);
		return (await page.getTextContent()).items.flatMap((item) => ("str" in item && item.str ? [item.str] : []));
	} finally {
		await loading.destroy();
	}
}

describe("featured summary heading (#3543)", () => {
	it.each(["ditgar", "gengar"] as const)("shows the Summary heading on %s when enabled", async (template) => {
		for (const mode of ["legacy", "semantic"] as const) {
			const runs = await renderFirstPageText({ mode, template, showHeading: true });
			expect(runs.some((text) => text.includes("Summary"))).toBe(true);
		}
	});

	it.each(["ditgar", "gengar"] as const)("hides the Summary heading on %s when disabled", async (template) => {
		for (const mode of ["legacy", "semantic"] as const) {
			const runs = await renderFirstPageText({ mode, template, showHeading: false });
			expect(runs.some((text) => text.includes("Summary"))).toBe(false);
		}
	});

	it.each(["ditgar", "gengar"] as const)(
		"shows the Summary heading on %s for resumes without the setting",
		async (template) => {
			for (const mode of ["legacy", "semantic"] as const) {
				const runs = await renderFirstPageText({ mode, template, showHeading: undefined });
				expect(runs.some((text) => text.includes("Summary"))).toBe(true);
			}
		},
	);
});
