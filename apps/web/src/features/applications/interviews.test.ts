import type { ScheduledInterview } from "./interviews";
import { describe, expect, it } from "vite-plus/test";
import { dayKey, fromDateTimeLocal, groupByDay, monthGrid, toDateTimeLocal } from "./interviews";

describe("interviews", () => {
	it("round-trips datetime-local values", () => {
		const iso = fromDateTimeLocal("2026-10-05T09:30");
		expect(iso).not.toBeNull();
		expect(toDateTimeLocal(iso ?? "")).toBe("2026-10-05T09:30");
		expect(fromDateTimeLocal("")).toBeNull();
	});
});

// Instants stay absolute; only their calendar bucket changes with the account clock.
describe("account calendar days", () => {
	it.each([
		["2026-10-30T23:30:00Z", "2026-10-30", "2026-10-31"],
		["2026-10-31T23:30:00Z", "2026-10-31", "2026-11-01"],
		["2026-03-28T23:30:00Z", "2026-03-28", "2026-03-29"],
		["2026-03-29T22:30:00Z", "2026-03-29", "2026-03-30"],
		["2026-10-25T00:30:00Z", "2026-10-25", "2026-10-25"],
		["2026-10-25T01:30:00Z", "2026-10-25", "2026-10-25"],
	])("groups %s by account date across midnight and DST", (iso, utc, berlin) => {
		const start = new Date(iso);
		const event = { start } as ScheduledInterview;
		expect(dayKey(start, "UTC")).toBe(utc);
		expect(dayKey(start, "Europe/Berlin")).toBe(berlin);
		expect([...groupByDay([event], "UTC").keys()]).toEqual([utc]);
		expect([...groupByDay([event], "Europe/Berlin").keys()]).toEqual([berlin]);
		expect(start.toISOString()).toBe(iso.replace("Z", ".000Z"));
	});

	it("keeps all six weeks as consecutive whole days across DST", () => {
		const days = monthGrid(new Date("2026-03-01T00:00:00Z"));
		expect(days).toHaveLength(42);
		expect(days[0]?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
		expect(days.at(-1)?.toISOString()).toBe("2026-04-11T00:00:00.000Z");
		expect(days.every((day, i) => i === 0 || day.getTime() - (days[i - 1]?.getTime() ?? 0) === 86_400_000)).toBe(true);
	});
});
