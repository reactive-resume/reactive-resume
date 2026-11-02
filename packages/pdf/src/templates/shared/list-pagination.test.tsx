import { describe, expect, it } from "vite-plus/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../../document";
import { renderToBuffer } from "../../forme/testing";
import { resolveResumeRuntime } from "../../semantic/resolve";

async function listPages(margin: number, repeats = 5, options: { html?: string } = {}) {
	const data = structuredClone(defaultResumeData);
	data.metadata.typography.body.fontFamily = "Helvetica";
	data.metadata.typography.heading.fontFamily = "Helvetica";
	data.metadata.layout.pages = [{ fullWidth: true, main: ["summary"], sidebar: [] }];
	data.summary.title = "Summary";
	data.summary.content =
		options.html ??
		`<ul><li><p>TARGET ${"Some words to fill several lines and force wrapping. ".repeat(repeats)} END</p></li></ul>`;
	data.metadata.stylesheet = {
		mode: "semantic",
		source: {
			languageVersion: 1,
			text: `@version 1; page { size: 300pt 300pt; } rich-text { margin-top: ${margin}pt; }`,
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

// Forme 0.25 has no keep-with-next: `renderResume` finds a marker left on a page its first line leaves and renders
// again with that item starting the next page.
describe("list marker pagination (#3344)", () => {
	it("keeps content on the current page when the first paragraph can start", async () => {
		// The margins sit either side of where the first line stops fitting under the name-only header.
		const result = await listPages(196);
		expect(result.first).toBe(0);
		expect(result.marker).toBe(result.first);
	});
	it("allows a long list item to continue across pages", async () => {
		const result = await listPages(198, 30);
		expect(result.first).toBe(1);
		expect(result.marker).toBe(result.first);
		expect(result.last).toBeGreaterThan(result.first);
		expect(result.pages.flat().join(" ").match(/•/g)).toHaveLength(1);
		expect(
			result.pages
				.flat()
				.join(" ")
				.match(/\bSome\b/g),
		).toHaveLength(30);
	});
	it.each(["ul"])("keeps %s continuation lines at the content indentation", async (tag) => {
		const result = await listPages(0, 60, {
			html: `<${tag}><li><p>TARGET ${"Some words to fill several lines and force wrapping. ".repeat(60)} END</p></li></${tag}>`,
		});
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
