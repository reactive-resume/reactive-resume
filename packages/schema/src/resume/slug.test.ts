import { describe, expect, it } from "vite-plus/test";
import { isValidSlug } from "./slug";

describe("slug validator", () => {
	it("accepts lowercase dash-separated slugs up to 64 characters and rejects the rest", () => {
		expect(isValidSlug("my-resume-2026")).toBe(true);
		expect(isValidSlug("a".repeat(64))).toBe(true);
		expect(isValidSlug("")).toBe(false);
		expect(isValidSlug("a".repeat(65))).toBe(false);
		expect(isValidSlug("My-Resume")).toBe(false);
		expect(isValidSlug("-starts-with-dash")).toBe(false);
		expect(isValidSlug("ends-with-dash-")).toBe(false);
		expect(isValidSlug("double--dash")).toBe(false);
		expect(isValidSlug("invalid_slug!")).toBe(false);
	});
});
