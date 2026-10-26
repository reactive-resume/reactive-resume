import { describe, expect, it } from "vite-plus/test";
import { isValidSlug, normalizeSlug, slugSchema } from "./slug";

describe("slug schema and validator", () => {
	it("validates valid slugs with isValidSlug", () => {
		expect(isValidSlug("resume")).toBe(true);
		expect(isValidSlug("my-resume-2026")).toBe(true);
		expect(isValidSlug("a".repeat(64))).toBe(true);
	});

	it("rejects invalid slugs with isValidSlug", () => {
		expect(isValidSlug("")).toBe(false);
		expect(isValidSlug("a".repeat(65))).toBe(false);
		expect(isValidSlug("My-Resume")).toBe(false);
		expect(isValidSlug("-starts-with-dash")).toBe(false);
		expect(isValidSlug("ends-with-dash-")).toBe(false);
		expect(isValidSlug("double--dash")).toBe(false);
		expect(isValidSlug("invalid_slug!")).toBe(false);
	});

	it("parses strings without rejecting values that need a domain error", () => {
		expect(slugSchema.parse("")).toBe("");
		expect(slugSchema.parse("a".repeat(65))).toBe("a".repeat(65));
		expect(slugSchema.parse("valid-slug")).toBe("valid-slug");
		expect(slugSchema.parse("  trimmed-slug  ")).toBe("trimmed-slug");
	});

	it("normalizes user input with normalizeSlug", () => {
		expect(normalizeSlug("My Resume 2026")).toBe("my-resume-2026");
		expect(normalizeSlug("UPPERCASE")).toBe("uppercase");
		expect(normalizeSlug("words with multiple   spaces")).toBe("words-with-multiple-spaces");
	});
});
