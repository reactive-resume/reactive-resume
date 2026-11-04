import { describe, expect, it } from "vite-plus/test";
import {
	countryCodeSchema,
	countryForTimeZone,
	MAX_SEARCH_REGIONS,
	nextSearchRegions,
	searchRegionsSchema,
	shownSearchRegions,
} from "./region";

describe("countryForTimeZone", () => {
	it("maps canonical zones to their country", () => {
		expect(countryForTimeZone("Asia/Singapore")).toBe("SG");
		expect(countryForTimeZone("Australia/Melbourne")).toBe("AU");
		expect(countryForTimeZone("Europe/Berlin")).toBe("DE");
	});

	it("resolves legacy link names through their canonical zone", () => {
		expect(countryForTimeZone("Asia/Calcutta")).toBe("IN");
		expect(countryForTimeZone("Asia/Saigon")).toBe("VN");
	});

	it("prefers the zone a legacy name was meant for over a merged canonical zone", () => {
		expect(countryForTimeZone("Iceland")).toBe("IS");
		expect(countryForTimeZone("Pacific/Truk")).toBe("FM");
		expect(countryForTimeZone("America/Coral_Harbour")).toBe("CA");
		expect(countryForTimeZone("Pacific/Yap")).toBe("FM");
	});

	it("returns null for UTC, Etc zones and unknown names", () => {
		expect(countryForTimeZone("UTC")).toBeNull();
		expect(countryForTimeZone("Etc/GMT+5")).toBeNull();
		expect(countryForTimeZone("CET")).toBeNull();
		expect(countryForTimeZone("Not/AZone")).toBeNull();
	});
});

describe("countryCodeSchema", () => {
	it("accepts codes present in the table and rejects others", () => {
		expect(countryCodeSchema.safeParse("SG").success).toBe(true);
		expect(countryCodeSchema.safeParse("XX").success).toBe(false);
		expect(countryCodeSchema.safeParse("sg").success).toBe(false);
	});
});

describe("searchRegionsSchema", () => {
	it("accepts valid lists, empty, null and undefined", () => {
		expect(searchRegionsSchema.safeParse(["DE", "FR"]).success).toBe(true);
		expect(searchRegionsSchema.safeParse([]).success).toBe(true);
		expect(searchRegionsSchema.safeParse(null).success).toBe(true);
		expect(searchRegionsSchema.safeParse(undefined).success).toBe(true);
	});

	it("rejects lowercase, unknown, duplicate and more than three codes", () => {
		expect(searchRegionsSchema.safeParse(["de"]).success).toBe(false);
		expect(searchRegionsSchema.safeParse(["XX"]).success).toBe(false);
		expect(searchRegionsSchema.safeParse(["DE", "DE"]).success).toBe(false);
		expect(searchRegionsSchema.safeParse(["DE", "FR", "IT", "ES"]).success).toBe(false);
	});
});

describe("shownSearchRegions", () => {
	it("shows a stored list as chosen", () => {
		expect(shownSearchRegions(["DE", "FR"], "Asia/Singapore", "Asia/Singapore")).toEqual({
			codes: ["DE", "FR"],
			automatic: false,
		});
	});

	it("shows an empty list as anywhere, not automatic", () => {
		expect(shownSearchRegions([], "Asia/Singapore", "Asia/Singapore")).toEqual({
			codes: [],
			automatic: false,
		});
	});

	it("shows the account time zone's country when automatic", () => {
		expect(shownSearchRegions(null, "Asia/Singapore", "Australia/Melbourne")).toEqual({
			codes: ["SG"],
			automatic: true,
		});
		expect(shownSearchRegions(undefined, "Asia/Singapore", null)).toEqual({
			codes: ["SG"],
			automatic: true,
		});
	});

	it("shows the device country only for untouched UTC accounts", () => {
		expect(shownSearchRegions(undefined, "UTC", "Australia/Melbourne")).toEqual({
			codes: ["AU"],
			automatic: true,
		});
		expect(shownSearchRegions(undefined, undefined, "Australia/Melbourne")).toEqual({
			codes: ["AU"],
			automatic: true,
		});
	});

	it("keeps explicit automatic mode on the account time zone, showing no country when it names none", () => {
		expect(shownSearchRegions(null, "UTC", "Australia/Melbourne")).toEqual({ codes: [], automatic: true });
		expect(shownSearchRegions(null, "UTC", "UTC")).toEqual({ codes: [], automatic: true });
		expect(shownSearchRegions(null, "Etc/GMT+5", "Australia/Melbourne")).toEqual({
			codes: [],
			automatic: true,
		});
	});
});

describe("nextSearchRegions", () => {
	it("adds a country at the end", () => {
		expect(nextSearchRegions(["SG"], { type: "add", code: "FR" })).toEqual(["SG", "FR"]);
		expect(nextSearchRegions([], { type: "add", code: "FR" })).toEqual(["FR"]);
	});

	it("returns the shown list itself for a duplicate, an invalid code or a full list", () => {
		const shown = ["DE", "FR"];
		expect(nextSearchRegions(shown, { type: "add", code: "DE" })).toBe(shown);
		expect(nextSearchRegions(shown, { type: "add", code: "XX" })).toBe(shown);
		const full = ["DE", "FR", "IT"];
		expect(full).toHaveLength(MAX_SEARCH_REGIONS);
		expect(nextSearchRegions(full, { type: "add", code: "ES" })).toBe(full);
	});

	it("removes a country, and removing the last leaves anywhere", () => {
		expect(nextSearchRegions(["DE", "FR"], { type: "remove", code: "DE" })).toEqual(["FR"]);
		expect(nextSearchRegions(["SG"], { type: "remove", code: "SG" })).toEqual([]);
		const shown = ["DE"];
		expect(nextSearchRegions(shown, { type: "remove", code: "FR" })).toBe(shown);
	});
});
