import type { Application } from "./types";
import { describe, expect, it } from "vitest";
import {
	collectInterviews,
	dayKey,
	formatDuration,
	fromDateTimeLocal,
	groupByDay,
	monthGrid,
	toDateTimeLocal,
	upcomingInterviews,
} from "./interviews";

const app = (id: string, activity: Application["activity"]) =>
	({ id, company: id, activity }) as unknown as Application;

describe("interviews", () => {
	const a = app("a", [
		{ id: "s", type: "stage", stage: "screening", at: new Date("2026-09-01T12:00:00Z") },
		{
			id: "i2",
			type: "interview",
			kind: "technical",
			at: new Date("2026-10-02T15:00:00Z"),
			durationMinutes: 90,
			location: "",
			notes: "",
		},
	]);
	const b = app("b", [
		{
			id: "i1",
			type: "interview",
			kind: "screening",
			at: new Date("2026-09-30T15:00:00Z"),
			durationMinutes: 30,
			location: "Zoom",
			notes: "",
		},
	]);

	it("collects interviews across applications, soonest first, with end times", () => {
		const result = collectInterviews([a, b]);
		expect(result.map((item) => item.interview.id)).toEqual(["i1", "i2"]);
		expect(result[0]?.application.id).toBe("b");
		expect(result[1]?.end.toISOString()).toBe("2026-10-02T16:30:00.000Z");
	});

	it("keeps interviews that are still in progress as upcoming", () => {
		const all = collectInterviews([a, b]);
		expect(upcomingInterviews(all, new Date("2026-09-30T15:20:00Z")).map((i) => i.interview.id)).toEqual(["i1", "i2"]);
		expect(upcomingInterviews(all, new Date("2026-09-30T15:31:00Z")).map((i) => i.interview.id)).toEqual(["i2"]);
	});

	it("groups interviews by local day", () => {
		const grouped = groupByDay(collectInterviews([a, b]));
		expect(grouped.get(dayKey(new Date("2026-10-02T15:00:00Z")))?.[0]?.interview.id).toBe("i2");
	});

	it("round-trips datetime-local values", () => {
		const iso = fromDateTimeLocal("2026-10-05T09:30");
		expect(iso).not.toBeNull();
		expect(toDateTimeLocal(iso ?? "")).toBe("2026-10-05T09:30");
		expect(fromDateTimeLocal("")).toBeNull();
	});

	it("formats durations as hours and minutes", () => {
		expect(formatDuration(30, "en-US")).toBe("30 min");
		expect(formatDuration(60, "en-US")).toBe("1 hr");
		expect(formatDuration(90, "en-US")).toBe("1 hr 30 min");
	});

	it("builds a six-week month grid starting on the requested weekday", () => {
		const grid = monthGrid(new Date(2026, 8, 15));
		expect(grid).toHaveLength(42);
		expect(grid[0]?.getDay()).toBe(0);
		expect(grid.some((day) => day.getMonth() === 8 && day.getDate() === 1)).toBe(true);
		expect(monthGrid(new Date(2026, 8, 15), 1)[0]?.getDay()).toBe(1);
	});
});
