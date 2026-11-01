import { describe, expect, it } from "vite-plus/test";
import { offerTermsSchema } from "./career";
import { parseOfferEntry, previousOfferCurrency } from "./career-offer";

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

describe("offer selection", () => {
	it("opens this job, upgrades remembered versions, and preserves explicit historical comparison", async () => {
		const { selectOfferPair } = await import("./career-offer");
		const offers = [
			{ id: "other", applicationId: "north" },
			{ id: "written", applicationId: "lumen" },
			{ id: "verbal", applicationId: "lumen" },
		];
		expect(selectOfferPair(offers, { a: "written" }, { a: "other", b: "verbal" })).toEqual({
			a: "written",
			b: "other",
		});
		expect(selectOfferPair(offers, {}, { a: "verbal", b: "other" })).toEqual({ a: "written", b: "other" });
		expect(selectOfferPair(offers, { a: "written", b: "verbal" })).toEqual({ a: "written", b: "verbal" });
	});
});

it("prioritizes Offer-stage jobs while retaining accepted outcomes and omitting not-selected applications", async () => {
	const { offerApplications } = await import("./career-offer");
	expect(
		offerApplications([
			{ status: "saved", closedReason: null },
			{ status: "closed", closedReason: "not-selected" },
			{ status: "closed", closedReason: "accepted" },
			{ status: "offer", closedReason: null },
		]),
	).toEqual([
		{ status: "offer", closedReason: null },
		{ status: "saved", closedReason: null },
		{ status: "closed", closedReason: "accepted" },
	]);
});

describe("previousOfferCurrency", () => {
	it("starts a new offer in the newest saved offer's currency, and in none without one", () => {
		const offer = (currency: string, createdAt: string) => ({ createdAt, data: { kind: "offer", currency } });
		expect(
			previousOfferCurrency([
				offer("USD", "2026-10-01T10:00:00Z"),
				offer("EUR", "2026-10-20T10:00:00Z"),
				{ createdAt: "2026-10-30T10:00:00Z", data: { kind: "note" } },
				offer("GBP", "2026-10-05T10:00:00Z"),
			]),
		).toBe("EUR");
		expect(previousOfferCurrency([])).toBe("");
		expect(previousOfferCurrency(undefined)).toBe("");
	});
});
