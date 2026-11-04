import { describe, expect, it } from "vite-plus/test";
import { applicationProfileDataSchema, saveApplicationProfileSchema } from "./application-profile";

describe("private application profile", () => {
	it("keeps missing answers unknown without inferring from contact country", () => {
		const profile = applicationProfileDataSchema.parse({
			address: { countryCode: "DE" },
			workAuthorization: [{ countryCode: "US" }],
		});
		expect(profile.workAuthorization).toEqual([
			{ countryCode: "US", authorized: "unknown", needsSponsorship: "unknown" },
		]);
		expect(profile.willingToRelocate).toBe("unknown");
		expect(profile.requestedSalary).toBeNull();
		expect(profile.email).toBe("");
		expect(profile.references).toEqual([]);
	});
	it.each([
		{ workAuthorization: [{ countryCode: "DE" }, { countryCode: "DE" }] },
		{ links: [{ label: "Site", url: "javascript:alert(1)" }] },
		{ requestedSalary: { amount: -1, currency: "EUR", period: "year" } },
		{ userId: "someone-else" },
	])("rejects invalid or unsupported profile input: %j", (input) => {
		expect(applicationProfileDataSchema.safeParse(input).success).toBe(false);
	});
	it("keeps requested salary explicit, including zero, currency and period", () => {
		expect(
			applicationProfileDataSchema.parse({ requestedSalary: { amount: 0, currency: "EUR", period: "hour" } })
				.requestedSalary,
		).toEqual({ amount: 0, currency: "EUR", period: "hour" });
		expect(saveApplicationProfileSchema.safeParse({ data: {}, expectedRevision: null }).success).toBe(true);
		expect(saveApplicationProfileSchema.safeParse({ data: {} }).success).toBe(false);
	});
});
