import { describe, expect, it } from "vite-plus/test";
import { offerTermsSchema } from "./career";
import { parseOfferEntry } from "./career-offer";

const entry = () => ({
	applicationId: "owned-job",
	terms: offerTermsSchema.parse({ currency: "EUR", period: "month", base: null, variable: null }),
	amounts: { base: "", variable: "", learning: "" },
	date: "",
	time: "17:00",
	locale: "en-US",
	timeZone: "Europe/Berlin" as string | null,
});

describe("manual offer entry", () => {
	it.each(["base", "variable", "learning"] as const)("rejects invalid entered %s rather than saving unknown", (key) => {
		const input = entry();
		input.amounts[key] = "95k";
		const result = parseOfferEntry(input);
		expect(result.amountErrors[key]).toBe(true);
		expect(result.payload.success).toBe(false);
	});
	it("preserves blank optional fields, zero, currency and pay period", () => {
		const input = entry();
		input.timeZone = null;
		input.amounts = { base: "  ", variable: "0", learning: "" };
		const result = parseOfferEntry(input);
		expect(result.payload.success).toBe(true);
		if (!result.payload.success) throw result.payload.error;
		expect(result.payload.data).toMatchObject({
			currency: "EUR",
			period: "month",
			base: null,
			variable: 0,
			learning: null,
			respondBy: null,
		});
	});
	it("rejects a nonexistent wall-clock minute and accepts its correction", () => {
		const input = { ...entry(), date: "2027-03-28", time: "02:30" };
		const invalid = parseOfferEntry(input);
		expect(invalid.deadlineError).toBe("wallTime");
		expect(invalid.payload.success).toBe(false);
		const valid = parseOfferEntry({ ...input, time: "03:30" });
		expect(valid.payload.success).toBe(true);
		if (!valid.payload.success) throw valid.payload.error;
		expect(valid.payload.data.respondBy).toBe("2027-03-28T01:30:00.000Z");
	});
	it("requires the account timezone only when a deadline is entered", () => {
		const input = { ...entry(), date: "2027-03-28", timeZone: null };
		expect(parseOfferEntry(input)).toMatchObject({ deadlineError: "timezone", payload: { success: false } });
		expect(parseOfferEntry({ ...input, timeZone: "Europe/Berlin" }).payload.success).toBe(true);
		expect(parseOfferEntry({ ...input, date: "" }).payload.success).toBe(true);
	});
});
