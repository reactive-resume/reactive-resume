import { describe, expect, it } from "vite-plus/test";
import { careerOfferInputSchema, careerProfileDataSchema, careerProfileUpdateSchema } from "./career";

describe("career profile updates", () => {
	it("never supplies defaults for fields another control owns", () => {
		expect(careerProfileUpdateSchema.parse({ memoryMode: "off" })).toEqual({ memoryMode: "off" });
		expect(careerProfileUpdateSchema.parse({ priorities: "Mentoring" })).toEqual({ priorities: "Mentoring" });
		expect(careerProfileUpdateSchema.parse({})).toEqual({});
		expect(careerProfileDataSchema.parse({}).memoryMode).toBe("ask");
	});
	it.each(["targetRoles", "locations"])("trims %s and rejects whitespace-only entries", (field) => {
		expect(careerProfileUpdateSchema.parse({ [field]: ["  Platform engineer  "] })).toEqual({
			[field]: ["Platform engineer"],
		});
		expect(careerProfileUpdateSchema.safeParse({ [field]: [" \t "] }).success).toBe(false);
		expect(careerProfileUpdateSchema.parse({ [field]: [` ${"x".repeat(200)} `] })).toEqual({
			[field]: ["x".repeat(200)],
		});
		expect(careerProfileUpdateSchema.safeParse({ [field]: ["x".repeat(201)] }).success).toBe(false);
	});
});

describe("careerProfileDataSchema searchRegions", () => {
	it("leaves searchRegions absent when the input has none", () => {
		const parsed = careerProfileDataSchema.parse({});

		expect(parsed.searchRegions).toBeUndefined();
		expect(Object.hasOwn(parsed, "searchRegions")).toBe(false);
	});

	it("keeps chosen countries, an empty list and null", () => {
		expect(careerProfileDataSchema.parse({ searchRegions: ["SG"] }).searchRegions).toEqual(["SG"]);
		expect(careerProfileDataSchema.parse({ searchRegions: [] }).searchRegions).toEqual([]);
		expect(careerProfileDataSchema.parse({ searchRegions: null }).searchRegions).toBeNull();
	});

	it("rejects invalid search regions", () => {
		expect(careerProfileDataSchema.safeParse({ searchRegions: ["XX"] }).success).toBe(false);
		expect(careerProfileDataSchema.safeParse({ searchRegions: ["SG", "SG"] }).success).toBe(false);
		expect(careerProfileDataSchema.safeParse({ searchRegions: ["SG", "AU", "DE", "FR"] }).success).toBe(false);
	});
});

describe("manual offer input", () => {
	const input = { applicationId: "application", currency: "EUR", period: "year", base: 95000, variable: null };
	it("keeps unknown amounts distinct from zero and preserves explicit terms", () => {
		expect(careerOfferInputSchema.parse({ ...input, base: null, variable: 0, period: "hour" })).toMatchObject({
			base: null,
			variable: 0,
			learning: null,
			period: "hour",
		});
	});
	it.each([
		{ applicationId: "" },
		{ currency: "eur" },
		{ currency: "EURO" },
		{ period: "week" },
		{ base: -1 },
		{ variable: Infinity },
		{ learning: -1 },
		{ officeDays: 6 },
		{ officeDays: 1.5 },
		{ equity: "x".repeat(1001) },
		{ respondBy: "tomorrow" },
	])("rejects invalid terms %j", (patch) => {
		expect(careerOfferInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
	});
});
