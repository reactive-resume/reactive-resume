import { describe, expect, it } from "vite-plus/test";
import { assertResumeRenderBudget, assertRichTextComplexity } from "./limits";
import { sampleResumeData } from "./sample";

describe("rendering budgets", () => {
	it("accepts ordinary documents and rejects compact layouts with excessive expansion", () => {
		const data = structuredClone(sampleResumeData);
		expect(() => assertResumeRenderBudget(data)).not.toThrow();
		data.summary.content = "x".repeat(100_000);
		data.metadata.layout.pages = [{ fullWidth: true, main: Array(101).fill("summary"), sidebar: [] }];
		expect(() => assertResumeRenderBudget(data)).toThrow("too complex");
	});
	it("bounds nesting before invoking any HTML parser", () => {
		expect(() => assertRichTextComplexity("<div>".repeat(65) + "text" + "</div>".repeat(65))).toThrow("deeply");
		expect(() => assertRichTextComplexity("<p>ordinary<br>text</p>".repeat(200))).not.toThrow();
		expect(() => assertRichTextComplexity("<br>".repeat(20_001))).toThrow("too many");
	});
});
