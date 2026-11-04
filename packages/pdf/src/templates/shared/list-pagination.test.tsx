import { describe, expect, it } from "vite-plus/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../../document";
import { renderToBuffer } from "../../forme/testing";
import { resolveResumeRuntime } from "../../semantic/resolve";

async function listPages(html: string) {
	const data = structuredClone(defaultResumeData);
	data.metadata.typography.body.fontFamily = "Helvetica";
	data.metadata.typography.heading.fontFamily = "Helvetica";
	data.metadata.layout.pages = [{ fullWidth: true, main: ["summary"], sidebar: [] }];
	data.summary.title = "Summary";
	data.summary.content = html;
	data.metadata.stylesheet = {
		mode: "semantic",
		source: {
			languageVersion: 1,
			text: `@version 1; page { size: 300pt 300pt; } rich-text { margin-top: 0pt; }`,
		},
	};
	const runtime = resolveResumeRuntime({ data, template: "onyx" });
	expect(runtime.diagnostics).toEqual([]);
	const bytes = await act(() => renderToBuffer(<ResumeDocument data={data} template="onyx" />));
	const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
	try {
		const doc = await task.promise;
		const pages: string[][] = [];
		const positions: { str: string; x: number; y: number }[][] = [];
		for (let n = 1; n <= doc.numPages; n++) {
			const page = await doc.getPage(n);
			const text = await page.getTextContent();
			pages.push(text.items.flatMap((item) => ("str" in item && item.str ? [item.str] : [])));
			positions.push(
				text.items.flatMap((item) =>
					"str" in item && item.str ? [{ str: item.str, x: item.transform[4], y: item.transform[5] }] : [],
				),
			);
		}
		return {
			marker: pages.findIndex((p) => p.some((s) => s.includes("•") || s.startsWith("1."))),
			first: pages.findIndex((p) => p.some((s) => s.includes("TARGET"))),
			last: pages.findIndex((p) => p.some((s) => s.includes("END"))),
			pages,
			positions,
		};
	} finally {
		await task.destroy();
	}
}

// Marker/content pagination itself is proven in forme/list-pagination and long-list-pagination; this keeps #3495.
describe("list marker pagination (#3344)", () => {
	it("keeps ul continuation lines at the content indentation", async () => {
		const result = await listPages(
			`<ul><li><p>TARGET ${"Some words to fill several lines and force wrapping. ".repeat(60)} END</p></li></ul>`,
		);
		expect(result.marker).toBe(result.first);
		expect(result.last).toBeGreaterThan(result.first);
		// The widest x on the item's first page is its content column; the marker
		// and the section heading sit further left. Continuation pages must keep it.
		const contentX = Math.max(...(result.positions[result.first] ?? []).map((item) => item.x));
		for (const page of result.positions.slice(result.first + 1)) {
			for (const item of page) expect(item.x).toBeCloseTo(contentX, 0);
		}
	});
});
