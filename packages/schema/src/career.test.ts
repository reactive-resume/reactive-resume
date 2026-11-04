import { describe, expect, it } from "vite-plus/test";
import z from "zod";
import {
	careerOfferInputSchema,
	careerProfileDataSchema,
	careerProfileUpdateSchema,
	resumeFactProposalSchema,
} from "./career";

describe("career profile updates", () => {
	it("never supplies defaults for fields another control owns", () => {
		expect(careerProfileUpdateSchema.parse({ memoryMode: "off" })).toEqual({ memoryMode: "off" });
		expect(careerProfileUpdateSchema.parse({ priorities: "Mentoring" })).toEqual({ priorities: "Mentoring" });
		expect(careerProfileUpdateSchema.parse({})).toEqual({});
		expect(careerProfileDataSchema.parse({}).memoryMode).toBe("ask");
	});
	it("trims list entries and rejects whitespace-only entries", () => {
		expect(careerProfileUpdateSchema.parse({ targetRoles: ["  Platform engineer  "] })).toEqual({
			targetRoles: ["Platform engineer"],
		});
		expect(careerProfileUpdateSchema.safeParse({ targetRoles: [" \t "] }).success).toBe(false);
		expect(careerProfileUpdateSchema.parse({ targetRoles: [` ${"x".repeat(200)} `] })).toEqual({
			targetRoles: ["x".repeat(200)],
		});
		expect(careerProfileUpdateSchema.safeParse({ targetRoles: ["x".repeat(201)] }).success).toBe(false);
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
	it.each([{ currency: "eur" }, { base: -1 }, { respondBy: "tomorrow" }])("rejects invalid terms %j", (patch) => {
		expect(careerOfferInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
	});
});

it.each(["text", "quote"] as const)(
	"keeps runtime and published %s validation aligned before normalization",
	(field) => {
		const consumer = z.fromJSONSchema(z.toJSONSchema(resumeFactProposalSchema));
		for (const [value, valid] of [
			[" ", false],
			["\n\t", false],
			["\u00a0", false],
			["\u3000", false],
			["  Valid excerpt  ", true],
			["x".repeat(2000), true],
			[" " + "x".repeat(1998) + " ", true],
			[" \n" + "x".repeat(2000) + "\t\u3000", false],
			["x".repeat(2001), false],
			["  " + "x".repeat(2001) + "  ", false],
			["😀".repeat(2000), true],
			[" \n" + "😀".repeat(2000) + "\t", false],
			["😀".repeat(2001), false],
			["  First line\nSecond line  ", true],
		] as const) {
			const input = { text: "Valid fact", category: "experience", quote: "Valid quote", [field]: value };
			expect(
				consumer.safeParse(input).success,
				"published: " + JSON.stringify(value.slice(0, 30)) + " (length " + Array.from(value).length + ")",
			).toBe(valid);
			const parsed = resumeFactProposalSchema.safeParse(input);
			expect(parsed.success, "runtime: " + JSON.stringify(value)).toBe(valid);
			if (parsed.success) expect(parsed.data[field]).toBe(value.trim());
		}
	},
);
