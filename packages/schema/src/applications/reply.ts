import type { ApplicationTimelineEntry, ApplicationStatus } from "./data";
import { latestStageEntryId } from "./data";
import { isDateOnlyFollowUp } from "./follow-up";

/** Bracketed draft fields, including localized labels; never blocks copying. */
export const replyPlaceholders = (text: string) => [...new Set(text.match(/\[[^[\]\r\n]+\]/gu) ?? [])];

type ReplyApplication = {
	updatedAt: Date | string;
	status: ApplicationStatus;
	activity: readonly ApplicationTimelineEntry[];
	followUpAt: Date | string | null;
	followUpNote: string | null;
	followUpDateOnly?: boolean | undefined;
};

/** Include reviewed fields: timestamps alone can collide within one millisecond. */
export const replyLogVersion = (application: ReplyApplication) =>
	JSON.stringify([
		new Date(application.updatedAt).toISOString(),
		application.status,
		latestStageEntryId(
			application.activity.filter((entry) => entry.type === "stage" && entry.canonicalTransition !== false),
		),
		application.followUpAt ? new Date(application.followUpAt).toISOString() : null,
		application.followUpNote?.trim() ?? null,
		isDateOnlyFollowUp(application),
	]);
