import { describe, expect, it } from "vite-plus/test";
import fc from "fast-check";
import { buildExtractedDocument, columnSegments } from "./extract";
import { healthyResume, healthyResumeLines, makeRawExtraction } from "./test-fixtures";

describe("buildExtractedDocument", () => {
	it.each([1e12, Number.POSITIVE_INFINITY, Number.NaN])(
		"does not allocate a width-sized histogram for invalid geometry %s",
		(width) => {
			const raw = healthyResume({ pages: { 1: { width } } });
			expect(() => buildExtractedDocument(raw)).not.toThrow();
		},
	);

	it("clusters spans on the same baseline into one line, in left-to-right order", () => {
		const raw = makeRawExtraction({
			lines: [
				{ text: "Principal Engineer", x: 56, y: 60 },
				{ text: "Jan 2020 - Present", x: 400, y: 60 },
			],
		});

		const [line] = buildExtractedDocument(raw).lines;

		expect(line?.text).toBe("Principal Engineer Jan 2020 - Present");
		expect(line?.spans).toHaveLength(2);
	});

	/**
	 * Geometry must not depend on the order the reader happened to emit items in. Stream order is
	 * measured separately, as inversion; everything else has to be a pure function of the page.
	 */
	it("derives the same lines however the content stream was ordered", () => {
		const baseline = buildExtractedDocument(healthyResume());
		const indices = [...healthyResumeLines.keys()];

		fc.assert(
			fc.property(fc.shuffledSubarray(indices, { minLength: indices.length }), (permutation) => {
				const shuffled = healthyResume({
					streamOrder: (lines) => permutation.map((index) => lines[index]).filter((line) => line !== undefined),
				});

				const document = buildExtractedDocument(shuffled);

				expect(document.fullText).toBe(baseline.fullText);
				expect(document.lines.map((line) => [line.x, line.y, line.width, line.height])).toEqual(
					baseline.lines.map((line) => [line.x, line.y, line.width, line.height]),
				);
			}),
			{ numRuns: 25 },
		);
	});
});

it("keeps explicit word spaces across font runs, without splitting words or bridging columns", () => {
	const raw = makeRawExtraction({
		lines: [
			{ text: "Built", x: 50, y: 50 },
			{ text: " ", x: 75, y: 50 },
			{ text: "Important", x: 80, y: 50, fontRef: "bold" },
			{ text: "Sys", x: 50, y: 70 },
			{ text: "tems", x: 65, y: 70, fontRef: "bold" },
			{ text: "Company", x: 50, y: 90 },
			{ text: "                              ", x: 85, y: 90 },
			{ text: "2020 – 2021", x: 235, y: 90 },
			{ text: "Heading", x: 50, y: 110, size: 12 },
			{ text: "Date", x: 200, y: 112, size: 10 },
		],
	});
	const page = raw.pages[0];
	if (!page) throw new Error("Missing fixture page");
	for (const order of [page.items, [...page.items].reverse()]) {
		const doc = buildExtractedDocument({ ...raw, pages: [{ ...page, items: order }] });
		expect(doc.lines.map((line) => line.text)).toEqual([
			"Built Important",
			"Systems",
			"Company 2020 – 2021",
			"Heading Date",
		]);
		const row = doc.lines[2];
		if (!row) throw new Error("Missing column row");
		expect(columnSegments(row)).toHaveLength(2);
	}
});
