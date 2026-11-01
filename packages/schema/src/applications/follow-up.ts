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
