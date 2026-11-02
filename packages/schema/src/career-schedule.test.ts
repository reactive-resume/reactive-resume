import { describe, expect, it } from "vite-plus/test";
import { firstFutureLead, prepareRunAt } from "./career-schedule";

const interview = new Date("2026-10-31T08:00:00.000Z");

describe("firstFutureLead", () => {
	it("picks the first lead still ahead, not the default 24 hours", () => {
		// 12 hours before the interview: only the 2-hour and morning leads remain.
		const now = new Date("2026-10-30T20:00:00.000Z");
		const chosen = firstFutureLead(interview, "UTC", now);
		expect(chosen?.lead).toBe("2h");
		expect(chosen?.runAt.toISOString()).toBe("2026-10-31T06:00:00.000Z");
	});

	it("returns null when every lead has passed instead of scheduling an immediate paid run", () => {
		expect(firstFutureLead(interview, "UTC", new Date("2026-10-31T07:59:00.000Z"))).toBeNull();
	});

	it("uses the interview's timezone for the morning lead", () => {
		const at = new Date("2026-11-02T09:00:00.000Z");
		const chosen = firstFutureLead(at, "Europe/Berlin", new Date("2026-11-01T00:00:00.000Z"));
		expect(chosen?.lead).toBe("24h");
		expect(prepareRunAt(at, "morning", "Europe/Berlin").toISOString()).toBe("2026-11-02T07:00:00.000Z");
	});
});
