// Detail-only writes and reads. Stage moves, close and delete use `useApplicationMutations` from
// features/applications/queries.ts (optimistic list update with rollback); everything here refreshes on settlement.
import type { Application } from "@/features/applications/types";
import type { ReminderTarget } from "@/features/reminders";
import type { InterviewKind, InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { File } from "expo-file-system";
import { useEffect, useState } from "react";
import { followUpInstant } from "@reactive-resume/schema/applications/follow-up";
import { orpc, rest } from "@/api/client";
import { useSession } from "@/auth/session";
import { useInvalidateApplications } from "@/features/applications/queries";
import { deviceTimeZone, isTimeZone } from "@/features/reminders";
import { useProfile } from "@/features/settings/queries";

export type AttachmentKind = "resume" | "cover-letter";

export const interviewTypeLabel = (kind: InterviewKind) =>
	({
		screening: t`Screening`,
		technical: t`Technical`,
		behavioral: t`Behavioral`,
		onsite: t`Onsite`,
		other: t`Other`,
	})[kind];

export function useDetailMutations(applicationId: string) {
	const invalidate = useInvalidateApplications();
	const onSettled = () => void invalidate();
	return {
		addNote: useMutation({ ...orpc.applications.addNote.mutationOptions(), onSettled }),
		updateEntry: useMutation({ ...orpc.applications.updateTimelineEntry.mutationOptions(), onSettled }),
		deleteEntry: useMutation({ ...orpc.applications.deleteTimelineEntry.mutationOptions(), onSettled }),
		addInterview: useMutation({ ...orpc.applications.addInterview.mutationOptions(), onSettled }),
		updateInterview: useMutation({ ...orpc.applications.updateInterview.mutationOptions(), onSettled }),
		removeDocument: useMutation({ ...orpc.applications.removeDocument.mutationOptions(), onSettled }),
		createLetter: useMutation({ ...orpc.coverLetters.create.mutationOptions(), onSettled }),
		/** Uploads a picked PDF (already checked by `attachmentProblem`) through the REST multipart endpoint. */
		attach: useMutation({
			mutationFn: async ({ kind, uri }: { kind: AttachmentKind; uri: string }) => {
				const form = new FormData();
				form.append("file", new File(uri));
				const response = await rest(`/applications/${encodeURIComponent(applicationId)}/documents/${kind}`, {
					method: "POST",
					body: form,
				});
				if (!response.ok) throw new Error(`Upload failed (${response.status})`);
			},
			onSettled,
		}),
	};
}

/** The notification for one interview. The body has no time in it, so a timezone change needs no reschedule. */
export const interviewReminder = (
	application: Pick<Application, "id" | "company" | "role">,
	entry: InterviewTimelineEntry,
): ReminderTarget => ({
	kind: "interview",
	applicationId: application.id,
	entryId: entry.id,
	start: new Date(entry.at),
	title: t`${interviewTypeLabel(entry.kind)} interview · ${application.company}`,
	body: [application.role, entry.location].filter(Boolean).join(" · "),
});

/** The notification for the follow-up; it fires at the follow-up itself (09:00 that day). */
export const followUpReminder = (
	application: Pick<Application, "id" | "company" | "role" | "followUpAt" | "followUpDateOnly" | "followUpNote">,
	timeZone = "UTC",
): ReminderTarget | null =>
	application.followUpAt
		? {
				kind: "follow-up",
				applicationId: application.id,
				start: followUpInstant(application, timeZone) ?? new Date(application.followUpAt),
				title: application.followUpNote || t`Follow up`,
				body: `${application.role} · ${application.company}`,
			}
		: null;

/** Everything that may have a reminder; a closed application has none. */
export function reminderTargets(
	application: Pick<
		Application,
		"id" | "status" | "activity" | "company" | "role" | "followUpAt" | "followUpDateOnly" | "followUpNote"
	>,
	timeZone = "UTC",
): ReminderTarget[] {
	if (application.status === "closed") return [];
	const followUp = followUpReminder(application, timeZone);
	return [
		...application.activity.filter(isInterview).map((entry) => interviewReminder(application, entry)),
		...(followUp ? [followUp] : []),
	];
}

export const isInterview = (entry: Application["activity"][number]): entry is InterviewTimelineEntry =>
	entry.type === "interview";

/** The user's documents (not in Trash), for "What you sent" and Mark as applied. */
export function useDocuments() {
	const session = useSession();
	const options = orpc.documents.list.queryOptions({ input: { trashed: false } });
	return useQuery({
		...options,
		queryKey: [...options.queryKey, session.server],
		enabled: session.status === "signed-in",
	});
}

/** Ticks once a minute, so countdowns and "next interview" move on. */
export function useNow() {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const id = setInterval(() => setNow(new Date()), 60_000);
		return () => clearInterval(id);
	}, []);
	return now;
}

/** Formatters in the user's timezone (Settings → Preferences), falling back to the device's, and the UI locale. */
export function useUserTime() {
	const { i18n } = useLingui();
	const profile = useProfile();
	const preferred = profile.data?.timezone;
	const timeZone = preferred && isTimeZone(preferred) ? preferred : deviceTimeZone();
	const format = (value: Date | string, options: Intl.DateTimeFormatOptions, zone = timeZone) =>
		new Intl.DateTimeFormat(i18n.locale, { timeZone: zone, ...options }).format(new Date(value));
	const time = (value: Date | string, zone?: string) =>
		format(value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, zone);
	const day = (value: Date | string, zone?: string) =>
		format(value, { weekday: "short", day: "numeric", month: "short" }, zone);
	return {
		timeZone,
		locale: i18n.locale,
		/** "Mon 19 Oct" */
		day,
		/** "16:00" */
		time,
		/** "Mon 19 Oct, 16:00" */
		when: (value: Date | string, zone?: string) => `${day(value, zone)}, ${time(value, zone)}`,
		/** "12 Oct 2026" */
		date: (value: Date | string) => format(value, { day: "numeric", month: "short", year: "numeric" }),
		/** Stage and note entries are whole days stored at noon UTC: "12 Oct". */
		utcDay: (value: Date | string) => format(value, { day: "numeric", month: "short" }, "UTC"),
	};
}

/** "10 min", "1 h", "1 day": how long before the interview the reminder fires. */
export const leadLabel = (minutes: number) => (minutes >= 1440 ? t`1 day` : minutes >= 60 ? t`1 h` : t`${minutes} min`);
