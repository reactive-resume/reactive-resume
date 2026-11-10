import { chooseHero } from "./model";

test("interview within 48 hours takes precedence; distant interviews retain ordinary rank", () => {
	const now = new Date("2026-11-07T08:41:00Z");
	const followup = { step: { kind: "follow-up" as const, at: now, note: "", overdue: false } };
	const interview = {
		step: { kind: "interview" as const, at: new Date(now.getTime() + 48 * 3_600_000), interview: {} as never },
	};
	expect(chooseHero([followup, interview], now)).toBe(interview);
	const distant = { ...interview, step: { ...interview.step, at: new Date(now.getTime() + 48 * 3_600_000 + 1) } };
	expect(chooseHero([followup, distant], now)).toBe(followup);
	expect(chooseHero([], now)).toBeUndefined();
});
