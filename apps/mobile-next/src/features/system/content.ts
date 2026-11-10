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
	{ id: "new-resume", title: t`New resume`, href: "/documents/new", icon: "file-plus" as const },
	{ id: "search", title: t`Search`, href: "/documents/search", icon: "magnifying-glass" as const },
];
