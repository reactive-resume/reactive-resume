import { describe, expect, it } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { parseReactiveResumeJSON } from "./reactive-resume-json";

describe("parseReactiveResumeJSON", () => {
	it("creates a default layout page when the imported data has no pages", () => {
		const data = structuredClone(defaultResumeData);
		data.metadata.layout.pages = [];

		const result = parseReactiveResumeJSON(JSON.stringify(data));
		expect(result.metadata.layout.pages.length).toBe(1);
		expect(result.metadata.layout.pages[0]?.main.slice(0, 4)).toEqual([
			"summary",
			"experience",
			"education",
			"projects",
		]);
		expect(result.metadata.layout.pages[0]?.main.indexOf("profiles")).toBeGreaterThan(
			result.metadata.layout.pages[0]?.main.indexOf("references") ?? -1,
		);
	});

	it("recovers missing built-in sections by appending them to the first page", () => {
		const data = structuredClone(defaultResumeData);
		data.metadata.layout.pages = [
			{
				fullWidth: false,
				main: ["experience"],
				sidebar: ["skills"],
			},
		];

		const result = parseReactiveResumeJSON(JSON.stringify(data));
		const firstPage = result.metadata.layout.pages[0];
		expect(firstPage).toBeDefined();
		const allIds = new Set([...(firstPage?.main ?? []), ...(firstPage?.sidebar ?? [])]);

		// Every built-in section (except cover-letter) ends up somewhere on page 1.
		for (const expected of ["education", "projects", "languages", "awards"]) {
			expect(allIds.has(expected), expected).toBe(true);
		}
		// The originally-placed sections remain where the user put them.
		expect(firstPage?.sidebar).toContain("skills");
		expect(firstPage?.main[0]).toBe("experience");
		expect(firstPage?.sidebar).toEqual(["skills"]);
		expect(firstPage?.main.indexOf("profiles")).toBeGreaterThan(firstPage?.main.indexOf("education") ?? -1);
	});
});
