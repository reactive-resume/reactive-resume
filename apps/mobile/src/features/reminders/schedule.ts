// When local reminders fire, and wall-clock time in a named timezone. Pure: Node runs it in the M5-T2 scenarios.

/** Minutes before an interview that a reminder can fire. */
export const REMINDER_LEADS = [10, 30, 60, 1440] as const;
export type ReminderLead = (typeof REMINDER_LEADS)[number];
export const DEFAULT_LEAD: ReminderLead = 30;

export type ReminderKind = "interview" | "follow-up";

/** One notification per interview and one per application's follow-up; scheduling again replaces it. */
export const reminderId = (kind: ReminderKind, applicationId: string, entryId?: string) =>
	kind === "interview" ? `interview:${entryId ?? ""}` : `follow-up:${applicationId}`;

/** When the reminder fires: `lead` minutes before `start`, or null once that moment has passed. */
export function reminderTime(start: Date, leadMinutes: number, now = new Date()): Date | null {
	const at = new Date(start.getTime() - leadMinutes * 60_000);
	return at.getTime() > now.getTime() ? at : null;
}

export const isTimeZone = (value: string) => {
	try {
		new Intl.DateTimeFormat("en", { timeZone: value });
		return true;
	} catch {
		return false;
	}
};

export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** An instant as the date ("2026-10-08") and time ("17:58") on a clock in `timeZone`. */
export function zonedParts(instant: Date | string, timeZone: string) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		})
			.formatToParts(new Date(instant))
			.map(({ type, value }) => [type, value]),
	);
	return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
