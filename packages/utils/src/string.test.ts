import { describe, expect, it, vi } from "vite-plus/test";
import { slugify } from "./slug";
import { filterOptions, isolate, toUsername, rewriteSummary } from "./string";

describe("slugify", () => {
	it("falls back to a non-empty slug for CJK input", () => {
		expect(slugify("中文简历")).not.toBe("");
	});
});

describe("toUsername", () => {
	it("removes characters outside [a-z0-9._-]", () => {
		expect(toUsername("  John!@#Doe$%^  ")).toBe("johndoe");
		expect(toUsername("john.doe_test-123")).toBe("john.doe_test-123");
	});

	it("truncates to 64 characters max", () => {
		const longName = "a".repeat(100);
		expect(toUsername(longName)).toHaveLength(64);
	});
});

describe("filterOptions", () => {
	const options = [
		{ value: "AT", label: "Österreich" },
		{ value: "FR", label: "France" },
		{ value: "DE", label: "Germany" },
	];

	it("keeps every option for a blank query", () => {
		expect(filterOptions(options, "  ")).toEqual(options);
	});

	it("matches part of a label, ignoring case and accents", () => {
		expect(filterOptions(options, "fra")).toEqual([options[1]]);
		expect(filterOptions(options, "oster")).toEqual([options[0]]);
		expect(filterOptions(options, "MANY")).toEqual([options[2]]);
	});

	it("matches a value only exactly", () => {
		expect(filterOptions(options, "de")).toEqual([options[2]]);
		expect(filterOptions(options, "d")).toEqual([]);
	});

	it("matches independently of a Turkish runtime's default casing", () => {
		const lower = String.prototype.toLocaleLowerCase;
		const locale = vi.spyOn(String.prototype, "toLocaleLowerCase").mockImplementation(function (this: string) {
			return lower.call(this, "tr-TR");
		});
		try {
			const iceland = { value: "IS", label: "Iceland" };
			expect(filterOptions([iceland], "ice")).toEqual([iceland]);
		} finally {
			locale.mockRestore();
		}
	});
});

it("reports a rewrite's shorter length, the user's changed sentences and the new ones", () => {
	const before = "I have used Figma daily since 2016. I co-organise the Berlin meetup.";
	const after = "I have used Figma daily since 2016. I'd be excited to bring that to the team.";
	expect(rewriteSummary(before, after)).toEqual({ words: 4, removed: 1, added: 1 });
	expect(rewriteSummary(before, "I have used Figma daily since 2016.")).toEqual({ words: -5, removed: 1, added: 0 });
});

describe("isolate", () => {
	it("wraps user text in first-strong isolate marks, so its direction stops at the text", () => {
		expect(isolate("Lebenslauf (DE)")).toBe("\u2068Lebenslauf (DE)\u2069");
		// The marks are invisible: a reader sees the text itself.
		expect(isolate("Lebenslauf (DE)").replaceAll(/[\u2068\u2069]/g, "")).toBe("Lebenslauf (DE)");
	});
});
