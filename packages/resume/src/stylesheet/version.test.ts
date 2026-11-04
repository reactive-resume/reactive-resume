import { describe, expect, it } from "vite-plus/test";
import { compileStylesheet } from "./compile";

describe("compileStylesheet", () => {
	it("compiles plain CSS without a version line", () => {
		const result = compileStylesheet({ languageVersion: 1, text: "section { color: #123456; }\n" });

		expect(result.program?.languageVersion).toBe(1);
		expect(result.diagnostics).toEqual([]);
	});

	it("ignores the @version line older stylesheets start with", () => {
		const result = compileStylesheet({ languageVersion: 1, text: "@version 1;\nsection { color: #123456; }\n" });

		expect(result.program?.rules).toHaveLength(1);
		expect(result.diagnostics).toEqual([]);
	});
});
