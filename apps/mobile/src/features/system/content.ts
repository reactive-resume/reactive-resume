import type { RouterOutput } from "@/api/client";
import { t } from "@lingui/core/macro";
export type Notice = RouterOutput["career"]["notifications"][number];
export const notificationCategories = () => ({
	interviews: t`Interviews`,
	followUps: t`Follow-ups`,
	newRoles: t`New roles`,
	offers: t`Offer deadlines`,
	feedback: t`Feedback comments`,
});
export function notificationTarget(notice: Pick<Notice, "notice" | "applicationId">) {
	const id = notice.applicationId ? encodeURIComponent(notice.applicationId) : null;
	if (notice.notice.type === "briefing") return id ? `/applications/${id}/prepare` : null;
	if (notice.notice.type === "followup") return id ? `/applications/${id}/messages` : null;
	if (notice.notice.type === "opportunities") return "/?section=new-roles";
	return null;
}
/** iOS category actions and Android buttons. Logging a follow-up is safe to run without opening the app; drafting opens it. */
export const notificationActions = () => ({
	interviews: [
		{ identifier: "open-briefing", buttonTitle: t`Open briefing`, options: { opensAppToForeground: true } },
		{ identifier: "practise", buttonTitle: t`Practice`, options: { opensAppToForeground: true } },
	],
	followUps: [
		{ identifier: "draft-followup", buttonTitle: t`Draft follow-up`, options: { opensAppToForeground: true } },
		{ identifier: "log-followup", buttonTitle: t`Log follow-up`, options: { opensAppToForeground: false } },
	],
	newRoles: [],
	offers: [],
	feedback: [],
});
export type NotificationCommand = { kind: "open"; href: string } | { kind: "log-followup"; applicationId: string };
/** What a tap or an action button on one of our notifications does. Only known routes open; anything else is dropped. */
export function notificationCommand(
	actionIdentifier: string,
	data: { href?: unknown; applicationId?: unknown } | undefined,
): NotificationCommand | null {
	const href = data?.href;
	if (typeof href !== "string" || !/^\/(?:applications\/[^/]+\/(?:prepare|messages)|\?section=new-roles)$/.test(href))
		return null;
	const app = typeof data?.applicationId === "string" ? data.applicationId : null;
	const id = app ? encodeURIComponent(app) : null;
	if (actionIdentifier === "practise") return id ? { kind: "open", href: `/applications/${id}/practise` } : null;
	if (actionIdentifier === "draft-followup") return id ? { kind: "open", href: `/applications/${id}/messages` } : null;
	if (actionIdentifier === "log-followup") return app ? { kind: "log-followup", applicationId: app } : null;
	return { kind: "open", href };
}
export function noticeCategory(notice: Notice) {
	return notice.notice.type === "briefing"
		? "interviews"
		: notice.notice.type === "followup"
			? "followUps"
			: notice.notice.type === "opportunities"
				? "newRoles"
				: null;
}
export const quickActions = () => [
	{ id: "save-job", title: t`Save a job`, href: "/applications/new", icon: "briefcase" as const },
	{ id: "new-resume", title: t`New resume`, href: "/new", icon: "file-plus" as const },
	{ id: "search", title: t`Search`, href: "/search", icon: "magnifying-glass" as const },
];
