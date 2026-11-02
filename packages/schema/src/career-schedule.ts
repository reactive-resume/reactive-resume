/** When a briefing runs, relative to the interview. Kept here because the editor and the server must agree. */
export const PREPARE_LEADS = ["24h", "2h", "morning"] as const;
export type PrepareLead = (typeof PREPARE_LEADS)[number];

/**
 * When a briefing runs: 24 or 2 hours before the interview, or 08:00 on its day in `timezone` (or 2 hours before, for
 * an interview that starts before 10:00).
 */
export function prepareRunAt(interviewAt: Date, lead: PrepareLead, timezone: string): Date {
	if (lead !== "morning") return new Date(interviewAt.getTime() - (lead === "24h" ? 24 : 2) * 3_600_000);
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
	const wall = (date: Date) => {
		const f = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, Number(value)]));
		return Date.UTC(f.year ?? 0, (f.month ?? 1) - 1, f.day ?? 1, f.hour ?? 0, f.minute ?? 0);
	};
	const day = new Date(wall(interviewAt));
	const target = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 8);
	// Correct by the zone's offset at the answer itself, not at 08:00 UTC, so a clock change that day can't shift it.
	let at = target;
	for (let i = 0; i < 3; i++) at = target - (wall(new Date(at)) - at);
	return new Date(Math.min(at, interviewAt.getTime() - 2 * 3_600_000));
}

/**
 * The first lead whose run time is still in the future, so a schedule never starts a paid run at once while claiming
 * to be a future briefing. Null means every lead has passed: the switch says so instead of scheduling.
 */
export function firstFutureLead(
	interviewAt: Date,
	timezone: string,
	now: Date,
): { lead: PrepareLead; runAt: Date } | null {
	for (const lead of PREPARE_LEADS) {
		const runAt = prepareRunAt(interviewAt, lead, timezone);
		if (runAt.getTime() > now.getTime()) return { lead, runAt };
	}
	return null;
}
