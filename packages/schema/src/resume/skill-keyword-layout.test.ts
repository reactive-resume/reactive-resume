import { describe, expect, it } from "vite-plus/test";
import { parseResumeData } from "./data";
import { defaultResumeData } from "./default";

describe("skill keyword presentation", () => {
	it.each([undefined, "invalid", "list"])(
		"normalizes and round-trips %s for built-in and custom Skills",
		(keywordLayout) => {
			const input = structuredClone(defaultResumeData);
			Object.assign(input.sections.skills, { keywordLayout });
			input.customSections = [{ ...input.sections.skills, id: "custom-skills", type: "skills" }];
			const parsed = parseResumeData(input);
			const expected = keywordLayout === "list" ? "list" : "inline";
			expect(parsed.sections.skills).toHaveProperty("keywordLayout", expected);
			expect(parsed.customSections[0]).toHaveProperty("keywordLayout", expected);
			expect(parseResumeData(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
		},
	);
});
