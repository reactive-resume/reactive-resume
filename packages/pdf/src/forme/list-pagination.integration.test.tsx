import type { ElementInfo } from "@formepdf/core";
import assert from "node:assert/strict";
import { expect, it } from "vite-plus/test";
import * as forme from "@formepdf/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act } from "react";
import { Document, Page, Text, View } from "./primitives";
import { renderResumeElement } from "./render";
import { LIST_ROLE } from "./to-forme";

it.each([false, true])("handles a detached fitting row with off-page recovery %s", async (recoverable) => {
	const markerIn = (elements: ElementInfo[]): ElementInfo | undefined => {
		for (const element of elements) {
			if (element.sourceLocation?.column === LIST_ROLE.marker) return element;
			const marker = markerIn(element.children);
			if (marker) return marker;
		}
	};
	let calls = 0;
	const rendering = act(() =>
		renderResumeElement(
			{
				async renderSerializedDocWithLayout(document) {
					calls++;
					const result = await forme.renderSerializedDocWithLayout(document);
					if (recoverable && calls > 1) return result;
					const marker = markerIn(result.layout.pages.flatMap((page) => page.elements));
					const first = result.layout.pages[0];
					assert(marker && first);
					// Simulate a corrupt engine result: its marker appears on an earlier page than its text.
					first.elements.unshift(marker);
					if (recoverable) first.elements.push({ ...marker, y: -Number.MAX_VALUE });
					return result;
				},
			},
			<Document>
				<Page size={{ width: 200, height: 150 }} style={{ padding: 10, fontSize: 10 }}>
					<View style={{ height: 120 }} />
					<View data-resume-list-item style={{ flexDirection: "row" }}>
						<Text data-resume-list-marker style={{ width: 10 }}>
							•
						</Text>
						<View data-resume-list-content style={{ flex: 1 }}>
							<Text>Fitting row</Text>
						</View>
					</View>
				</Page>
			</Document>,
		),
	);
	if (recoverable) {
		const result = await rendering;
		expect(calls).toBe(2);
		expect(result.warnings).toEqual([]);
	} else await expect(rendering).rejects.toThrow("could not keep a list marker with its content");
});

it.each([
	[8, 1, 0],
	[25, 1, 0],
	[25, 12, 0],
	[8, 1, 8],
])(
	"lets %i-line list items (%i items, %i padding) continue without hiding following content",
	async (length, count, padding) => {
		const lines = Array.from({ length: length * count }, (_, index) => `LONG_LINE_${index}`);
		let calls = 0;
		const result = await act(() =>
			renderResumeElement(
				{
					renderSerializedDocWithLayout(document) {
						calls++;
						return forme.renderSerializedDocWithLayout(document);
					},
				},
				<Document>
					<Page size={{ width: 200, height: 150 }} style={{ padding: 10, fontSize: 10, lineHeight: 1.5 }}>
						<Text>Before list</Text>
						<View style={{ padding }}>
							{Array.from({ length: count }, (_, item) => (
								<View key={item} data-resume-list-item style={{ flexDirection: "row" }}>
									<Text data-resume-list-marker style={{ width: 10 }}>
										•
									</Text>
									<View data-resume-list-content style={{ flex: 1 }}>
										<Text>{lines.slice(item * length, (item + 1) * length).join("\n")}</Text>
									</View>
								</View>
							))}
						</View>
						<Text>After list</Text>
					</Page>
				</Document>,
			),
		);
		if (count === 1) expect(calls).toBeLessThanOrEqual(3);
		const loading = getDocument({ data: result.pdf.slice(), useSystemFonts: true });
		try {
			const pdf = await loading.promise;
			if (count === 1) expect(pdf.numPages).toBe(length === 8 ? 2 : 4);
			const rendered: string[] = [];
			for (let index = 1; index <= pdf.numPages; index++) {
				const page = await pdf.getPage(index);
				const items = (await page.getTextContent()).items.flatMap((item) =>
					"str" in item && item.str.trim() ? [item] : [],
				);
				if (index === 1) expect(items.map((item) => item.str)).toContain("LONG_LINE_0");
				for (let offset = 0; offset < items.length; offset++) {
					const marker = items[offset];
					if (marker?.str !== "•") continue;
					const first = items[offset + 1];
					assert(first);
					expect(first.str).toMatch(/^LONG_LINE_\d+$/);
					expect(marker.transform[5]).toBeCloseTo(first.transform[5] ?? 0, 1);
				}
				for (const item of items) {
					expect(item.transform[5]).toBeGreaterThanOrEqual(10);
					expect(item.transform[5] + item.height).toBeLessThanOrEqual(140);
					rendered.push(item.str);
				}
			}
			expect(rendered.filter((text) => text !== "•")).toEqual(["Before list", ...lines, "After list"]);
		} finally {
			await loading.destroy();
		}
	},
);

it("reserves every line of a list item moved to the next page", async () => {
	const result = await act(() =>
		renderResumeElement(
			forme,
			<Document>
				<Page size={{ width: 200, height: 150 }} style={{ padding: 10, fontSize: 10, lineHeight: 1.5 }}>
					<View style={{ height: 120 }} />
					<View>
						<View data-resume-list-item style={{ flexDirection: "row", marginBottom: 6 }}>
							<Text data-resume-list-marker style={{ width: 10 }}>
								•
							</Text>
							<View data-resume-list-content style={{ flex: 1 }}>
								<Text>{"First line\nSecond line"}</Text>
							</View>
						</View>
						<View data-resume-list-item style={{ flexDirection: "row" }}>
							<Text data-resume-list-marker style={{ width: 10 }}>
								•
							</Text>
							<View data-resume-list-content style={{ flex: 1 }}>
								<Text>Next item</Text>
							</View>
						</View>
					</View>
				</Page>
			</Document>,
		),
	);
	const loading = getDocument({ data: result.pdf.slice(), useSystemFonts: true });
	try {
		const pdf = await loading.promise;
		expect(pdf.numPages).toBe(2);
		const page = await pdf.getPage(2);
		const lines = (await page.getTextContent()).items
			.filter((item) => "str" in item)
			.filter((item) => item.str.trim() && item.str !== "•");
		expect(lines.map((line) => line.str)).toEqual(["First line", "Second line", "Next item"]);
		const [, second, next] = lines;
		assert(second && next);
		assert(second.transform[5] !== undefined && next.transform[5] !== undefined);
		// PDF coordinates grow upward: the following line's top must stay below the preceding baseline.
		expect(next.transform[5] + next.height).toBeLessThanOrEqual(second.transform[5]);
	} finally {
		await loading.destroy();
	}
});
