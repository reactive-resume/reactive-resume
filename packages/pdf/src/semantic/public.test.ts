import { describe, expect, it } from "vite-plus/test";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { resolveResumeRuntime } from "./resolve";

describe("@reactive-resume/pdf/semantic", () => {
	it("falls back to base presentation and preserves fatal source diagnostics", () => {
		const data = structuredClone(sampleResumeData);
		data.metadata.stylesheet = { mode: "semantic", source: { languageVersion: 2, text: "@version 2;" } };
		// The export entry points parse data first, so a fatal source must still parse to reach the fallback.
		expect(() => parseResumeData(data)).not.toThrow();

		const inspection = resolveResumeRuntime({ data, template: data.metadata.template });

		expect(inspection.diagnostics).toContainEqual(
			expect.objectContaining({ code: "UNSUPPORTED_VERSION", severity: "error" }),
		);
		expect(inspection.presentation).toEqual({});
	});

	it("falls back to base presentation when a selector list exceeds the resource limit", () => {
		const data = structuredClone(sampleResumeData);
		const selectors = new Array(65).fill("section").join(",");
		data.metadata.stylesheet = {
			mode: "semantic",
			source: { languageVersion: 1, text: `@version 1;\n${selectors} { color: red; }` },
		};
		expect(() => parseResumeData(data)).not.toThrow();

		const inspection = resolveResumeRuntime({ data, template: data.metadata.template });

		expect(inspection.diagnostics).toContainEqual(
			expect.objectContaining({ code: "RESOURCE_LIMIT", severity: "error" }),
		);
		expect(inspection.presentation).toEqual({});
		expect(inspection.renderTree).toEqual(inspection.sourceTree);
	});

	it("keeps valid PDF presentation when a neighboring value is recoverable", () => {
		const data = structuredClone(sampleResumeData);
		data.metadata.stylesheet = {
			mode: "semantic",
			source: {
				languageVersion: 1,
				text: "@version 1; name { color: #123456; opacity: var(--missing); }",
			},
		};

		const inspection = resolveResumeRuntime({ data, template: data.metadata.template });

		expect(inspection.presentation["page-1/region-header/header/name"]?.style?.color).toBe("#123456");
		expect(inspection.diagnostics).toContainEqual(
			expect.objectContaining({ code: "UNRESOLVED_VARIABLE", severity: "error" }),
		);
	});
});
