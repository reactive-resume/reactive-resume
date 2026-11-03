import type { ApplicationTimelineEntry } from "./data";
import { fromZonedDateTime } from "@reactive-resume/utils/timezone";

type FollowUp = { followUpAt: Date | string | null; followUpDateOnly?: boolean | undefined };
/** Old servers omit the discriminator; their UTC-midnight values used the date-only contract. */
export const isDateOnlyFollowUp = (value: FollowUp) =>
	value.followUpDateOnly ?? (value.followUpAt !== null && new Date(value.followUpAt).getTime() % 86400000 === 0);

/** Date-only records retain their selected day at 09:00; explicit times retain their exact instant. */
export function followUpInstant(value: FollowUp, timeZone: string): Date | null {
	if (!value.followUpAt) return null;
	const at = new Date(value.followUpAt);
	return isDateOnlyFollowUp(value) ? fromZonedDateTime(at.toISOString().slice(0, 10), "09:00", timeZone) : at;
}

/** Existing reminders keep their saved note, including an intentional blank; new ones start from the latest note. */
export function defaultFollowUpNote(application: {
	followUpAt: Date | string | null;
	followUpNote: string | null;
	activity: readonly ApplicationTimelineEntry[];
}): string {
	if (application.followUpAt) return application.followUpNote ?? "";
	let latest: Extract<ApplicationTimelineEntry, { type: "note" }> | undefined;
	for (const entry of application.activity)
		if (entry.type === "note" && entry.text.trim() && (!latest || new Date(entry.at) >= new Date(latest.at)))
			latest = entry;
	return latest?.text.replace(/\s+/gu, " ").trim() ?? "";
}
