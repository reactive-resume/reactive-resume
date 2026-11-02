import { describe, expect, it } from "vite-plus/test";
import z from "zod";
import { careerOfferInputSchema, careerProfileDataSchema, resumeFactProposalSchema } from "./career";

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

it.each(["text", "quote"] as const)("rejects blank %s in both the runtime and published JSON Schema", (field) => {
	const published = z.toJSONSchema(resumeFactProposalSchema);
	const property = published.properties?.[field];
	const pattern = typeof property === "object" && property !== null ? property.pattern : undefined;
	if (typeof pattern !== "string") throw new Error(`Missing published non-blank rule for ${field}`);
	const consumer = new RegExp(pattern);
	for (const value of [" ", "\n\t", "\u00a0", "\u3000"]) {
		expect(consumer.test(value)).toBe(false);
		expect(
			resumeFactProposalSchema.safeParse({
				text: "Valid fact",
				category: "experience",
				quote: "Valid quote",
				[field]: value,
			}).success,
		).toBe(false);
	}
	expect(consumer.test("  Valid excerpt  ")).toBe(true);
	expect(
		resumeFactProposalSchema.parse({
			text: "Valid fact",
			category: "experience",
			quote: "Valid quote",
			[field]: "  Valid excerpt  ",
		})[field],
	).toBe("Valid excerpt");
});
