import { describe, expect, it } from "vite-plus/test";
import { formatDateOnly, fromZonedDateTime, formatReadTime } from "./timezone";

describe("wall-clock timezone conversion", () => {
	it.each([
		["2027-03-28", "01:30", "Europe/Berlin", "2027-03-28T00:30:00.000Z"],
		["2027-03-28", "03:30", "Europe/Berlin", "2027-03-28T01:30:00.000Z"],
		["2027-01-01", "09:00", "Asia/Kathmandu", "2027-01-01T03:15:00.000Z"],
	])("preserves the requested clock minute: %s %s %s", (date, time, zone, expected) => {
		expect(fromZonedDateTime(date, time, zone)?.toISOString()).toBe(expected);
	});

	it.each([
		["2027-03-28", "02:30", "Europe/Berlin"],
		["2027-03-14", "02:30", "America/New_York"],
		["2027-02-30", "09:00", "UTC"],
		["2027-01-01", "24:30", "UTC"],
		["2027-01-01", "09:00", "Invalid/Timezone"],
	])("rejects nonexistent clock minutes: %s %s %s", (date, time, zone) => {
		expect(fromZonedDateTime(date, time, zone)).toBeNull();
	});
});

describe("formatDateOnly", () => {
	it("keeps the calendar date and year regardless of the viewer's timezone", () => {
		expect(formatDateOnly("2027-01-04", "en-US")).toBe("Jan 4, 2027");
		expect(formatDateOnly("2027-01-04", "de-DE")).toBe("4. Jan. 2027");
	});
	it("leaves an invalid or non-date value untouched", () => {
		expect(formatDateOnly("2027-02-31", "en-US")).toBe("2027-02-31");
		expect(formatDateOnly("", "en-US")).toBe("");
	});
});

describe("formatReadTime", () => {
	const now = Date.parse("2026-11-02T13:30:00Z");
	it.each([
		[0, "now"],
		[59, "now"],
		[60, "1 minute ago"],
		[3_599, "59 minutes ago"],
		[3_600, "1 hour ago"],
		[86_399, "23 hours ago"],
		[86_400, "yesterday"],
		[259_200, "3 days ago"],
	])("shows elapsed time without rounding up (%s seconds)", (age, expected) => {
		expect(formatReadTime(new Date(now - age * 1_000), "en-US", now)).toBe(expected);
	});
	it("localizes relative time and keeps future clock skew absolute", () => {
		expect(formatReadTime(new Date(now - 180_000), "de-DE", now)).toBe("vor 3 Minuten");
		expect(formatReadTime(new Date(now + 60_000), "en-US", now)).toMatch(/^Nov 2, 2026, /);
		expect(formatReadTime("not a date", "en-US")).toBeNull();
		expect(formatReadTime(new Date(now), "en-US", Number.NaN)).toBeNull();
	});
});
