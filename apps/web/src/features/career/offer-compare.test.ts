import type { OfferTerms } from "@reactive-resume/schema/career";
import { describe, expect, it } from "vite-plus/test";
import { formatBonus, meetsMinimum, moneyDifference } from "./offer-compare";

const offer = (patch: Partial<OfferTerms>): OfferTerms => ({
	version: "written",
	currency: "EUR",
	period: "year",
	base: 100_000,
	variable: null,
	variableConditions: "",
	equity: "",
	location: "",
	officeDays: null,
	leave: "",
	learning: null,
	other: "",
	respondBy: null,
	startDate: null,
	...patch,
});

describe("money is only compared in the same currency and pay period", () => {
	it("gives the difference when both match", () => {
		expect(moneyDifference(offer({ base: 108_000 }), offer({ base: 101_000 }), "base")).toBe(7000);
	});

	it("refuses a different currency, a different period, or an unknown amount", () => {
		expect(moneyDifference(offer({}), offer({ currency: "USD" }), "base")).toBeNull();
		expect(moneyDifference(offer({}), offer({ period: "month" }), "base")).toBeNull();
		expect(moneyDifference(offer({}), offer({ base: null }), "base")).toBeNull();
	});

	it("compares percentage bonuses against amounts only in matching terms with a known base", () => {
		const percentage = offer({ base: 85000, variablePercent: 10 });
		expect(moneyDifference(percentage, offer({ variable: 8000 }), "variable")).toBe(500);
		expect(moneyDifference(percentage, offer({ variable: 8000, currency: "USD" }), "variable")).toBeNull();
		expect(moneyDifference(percentage, offer({ variable: 8000, period: "month" }), "variable")).toBeNull();
		expect(
			moneyDifference(offer({ base: null, variablePercent: 10 }), offer({ variable: 8000 }), "variable"),
		).toBeNull();
	});

	it("shows stored percentage precision rather than rounding a small rate to zero", () => {
		i18n.load("en-US", {});
		i18n.activate("en-US");
		expect(formatBonus("en-US", offer({ base: null, variablePercent: 12.345 }))).toBe("12.345% of base");
		expect(formatBonus("en-US", offer({ base: null, variablePercent: 1e-25 }))).toBe(
			"0.0000000000000000000000001% of base",
		);
	});

	it("checks the Preferences minimum by the same rule", () => {
		expect(meetsMinimum(offer({}), { amount: 95_000, currency: "EUR", period: "year" })).toBe(true);
		expect(meetsMinimum(offer({}), { amount: 95_000, currency: "EUR", period: "month" })).toBeNull();
	});
});
import { i18n } from "@lingui/core";
