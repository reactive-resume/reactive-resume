import { describe, expect, it, vi } from "vite-plus/test";
import { slugify } from "./slug";
import { filterOptions, toUsername } from "./string";

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
