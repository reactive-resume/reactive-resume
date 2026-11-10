import { wallTimeChoices, setNow, now, setTimeZone, timeZone } from "./clock";
test("repeated Berlin hour requires an explicit first/second instant and skipped hour has no choice", () => {
	const choices = wallTimeChoices("2026-10-25", "02:30", "Europe/Berlin");
	expect(choices.map((choice) => choice.instant.toISOString())).toEqual([
		"2026-10-25T00:30:00.000Z",
		"2026-10-25T01:30:00.000Z",
	]);
	expect(choices.map((choice) => choice.label)).toEqual(["02:30 CEST, UTC+02 (first)", "02:30 CET, UTC+01 (second)"]);
	expect(wallTimeChoices("2026-03-29", "02:30", "Europe/Berlin")).toEqual([]);
});
test("fixture clock is deterministic and returned dates cannot mutate it", () => {
	setNow("2026-11-07T08:41:00Z");
	setTimeZone("Europe/Berlin");
	const date = now();
	date.setFullYear(2000);
	expect(now().toISOString()).toBe("2026-11-07T08:41:00.000Z");
	expect(timeZone()).toBe("Europe/Berlin");
	setNow();
	setTimeZone();
});
