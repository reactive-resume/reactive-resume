import type { ApplicationStatus, ApplicationTimelineEntry, InterviewTimelineEntry } from "./data";
import type { OfferHint } from "./next-step";
import { followUpInstant } from "./follow-up";

type ApplicationDates = {
	id: string;
	status: ApplicationStatus;
	activity: readonly ApplicationTimelineEntry[];
	followUpAt: Date | string | null;
	followUpDateOnly?: boolean | undefined;
	followUpNote: string | null;
};

export type UpcomingApplicationEvent<T> = { key: string; application: T; at: Date } & (
	| { kind: "interview"; interview: InterviewTimelineEntry }
	| { kind: "follow-up"; note: string }
	| { kind: "offer" }
);

/** All dated steps coexist, even when Next step prioritizes just one. Overdue reminders remain in Needs you. */
export function upcomingApplicationEvents<T extends ApplicationDates>(
	applications: readonly T[],
	offers: ReadonlyMap<string, OfferHint> | undefined,
	now: Date,
	timeZone: string,
): UpcomingApplicationEvent<T>[] {
	const events: UpcomingApplicationEvent<T>[] = [];
	for (const application of applications) {
		if (application.status === "closed") continue;
		for (const interview of application.activity) {
			if (interview.type !== "interview") continue;
			const at = new Date(interview.at);
			if (at.getTime() + interview.durationMinutes * 60_000 >= now.getTime())
				events.push({ key: `interview:${interview.id}`, kind: "interview", application, interview, at });
		}
		const followUp = followUpInstant(application, timeZone);
		if (followUp && followUp >= now)
			events.push({
				key: `follow-up:${application.id}`,
				kind: "follow-up",
				application,
				at: followUp,
				note: application.followUpNote ?? "",
			});
		const deadline = application.status === "offer" ? offers?.get(application.id)?.respondBy : null;
		if (deadline) {
			const at = new Date(deadline);
			if (at >= now) events.push({ key: `offer:${application.id}`, kind: "offer", application, at });
		}
	}
	return events.sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key));
}
