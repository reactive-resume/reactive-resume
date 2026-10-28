import { describe, expect, it } from "vite-plus/test";
import fc from "fast-check";
import { buildExtractedDocument } from "./extract";
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
