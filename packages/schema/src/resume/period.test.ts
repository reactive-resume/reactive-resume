import { describe, expect, it } from "vite-plus/test";
import { isFutureEndpoint, isReversedPeriod, ONGOING_TOKENS_BY_LANGUAGE, parsePeriod } from "./period";

const NOW = new Date("2024-06-15T00:00:00Z");

describe("parsePeriod", () => {
	it.each([
		["2020-2022", { start: { year: 2020 }, end: { year: 2022 }, ongoing: false }],
		["03/2020-06/2021", { start: { year: 2020, month: 3 }, end: { year: 2021, month: 6 }, ongoing: false }],
		["Jan 2020 until now", { start: { year: 2020, month: 1 }, ongoing: true }],
		["Fall 2019 - Spring 2021", { start: { year: 2019, month: 9 }, end: { year: 2021, month: 3 }, ongoing: false }],
		["15/03/2020", { start: { year: 2020, month: 3 }, ongoing: false }],
	])("reads %s", (input, expected) => {
		expect(parsePeriod(input)).toEqual(expected);
	});

	it.each(["", "20-22", "Jan 2020 - Feb", "Present - 2020"])("rejects %j", (input) => {
		expect(parsePeriod(input)).toBeNull();
	});

	it("reads localized ongoing tokens followed by ordinary punctuation", () => {
		expect(parsePeriod("2020 - heute.", "de-DE")).toEqual({ start: { year: 2020 }, ongoing: true });
		expect(parsePeriod("2020 - 現在。", "ja-JP")).toEqual({ start: { year: 2020 }, ongoing: true });
	});

	it("still reads English month names under a non-English locale", () => {
		expect(parsePeriod("Jan 2020 - Mar 2022", "fr-FR")).toEqual({
			start: { year: 2020, month: 1 },
			end: { year: 2022, month: 3 },
			ongoing: false,
		});
	});

	it("falls back to English when the locale tag is unusable", () => {
		expect(parsePeriod("Jan 2020", "not a locale")).toEqual({ start: { year: 2020, month: 1 }, ongoing: false });
	});
});

describe("isReversedPeriod", () => {
	it("reads a missing end month as the end of its year", () => {
		expect(isReversedPeriod({ year: 2020, month: 12 }, { year: 2020 })).toBe(false);
	});
});

describe("isFutureEndpoint", () => {
	it("accepts the current month, reading a missing month as the start of its year", () => {
		expect(isFutureEndpoint({ year: 2024, month: 6 }, NOW)).toBe(false);
		expect(isFutureEndpoint({ year: 2024 }, NOW)).toBe(false);
	});
});

describe("ONGOING_TOKENS_BY_LANGUAGE", () => {
	it("reads every listed token as an open-ended period", () => {
		for (const [language, tokens] of Object.entries(ONGOING_TOKENS_BY_LANGUAGE)) {
			for (const token of tokens) {
				expect(parsePeriod(`2020 - ${token}`, language), `${language}: ${token}`).toEqual({
					start: { year: 2020 },
					ongoing: true,
				});
			}
		}
	});
});
