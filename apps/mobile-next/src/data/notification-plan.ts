import type { ResourceOutput } from "./resources";
import { useQuery } from "@tanstack/react-query";
import { useSettings } from "./collections";
import { useApplications, useCareerOffers, useNotifications, useDataBackend } from "./provider";

export type NotificationCategory = "interviews" | "followUps" | "newRoles" | "offers" | "feedback";
export type LocalNotification = {
	id: string;
	category: NotificationCategory;
	at: Date;
	title: string;
	body: string;
	applicationId?: string;
	resumeId?: string;
};
export function notificationPlan(input: {
	applications: ResourceOutput<"applications">;
	offers: ResourceOutput<"offers">;
	notices: ResourceOutput<"notifications">;
	feedback: ResourceOutput<"feedbackLink">[];
	categories?: Record<string, boolean>;
}): LocalNotification[] {
	const rows: LocalNotification[] = [];
	for (const app of input.applications) {
		if (app.status === "closed") continue;
		for (const entry of app.activity)
			if (entry.type === "interview")
				rows.push({
					id: `interview:${app.id}:${entry.id}`,
					category: "interviews",
					at: new Date(entry.at),
					title: app.company,
					body: app.role,
					applicationId: app.id,
				});
		if (app.followUpAt)
			rows.push({
				id: `followup:${app.id}`,
				category: "followUps",
				at: new Date(app.followUpAt),
				title: app.company,
				body: app.followUpNote ?? "",
				applicationId: app.id,
			});
	}
	for (const item of input.offers)
		if (item.data.kind === "offer" && item.data.respondBy)
			rows.push({
				id: `offer:${item.id}`,
				category: "offers",
				at: new Date(item.data.respondBy),
				title: item.title,
				body: "",
				...(item.applicationId ? { applicationId: item.applicationId } : {}),
			});
	for (const notice of input.notices) {
		if (notice.readAt) continue;
		const category =
			notice.notice?.type === "opportunities"
				? "newRoles"
				: notice.notice?.type === "briefing"
					? "interviews"
					: notice.notice?.type === "followup"
						? "followUps"
						: null;
		if (category)
			rows.push({
				id: `notice:${notice.id}`,
				category,
				at: new Date(notice.createdAt),
				title: notice.title,
				body: notice.body,
			});
	}
	for (const link of input.feedback)
		for (const comment of link.comments ?? []) {
			if (comment.resolvedAt) continue;
			rows.push({
				id: `feedback:${link.id}:${comment.id}`,
				category: "feedback",
				at: new Date(comment.createdAt),
				title: link.label ?? "",
				body: comment.body,
				resumeId: link.resumeId,
			});
		}
	return rows
		.filter((row) => input.categories?.[row.category] !== false)
		.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
}
/** Feed each owned resume's links to the planner; the caller owns OS permission and scheduling. */
export function useNotificationPlan(resumeId = "") {
	const applications = useApplications();
	const offers = useCareerOffers();
	const notices = useNotifications();
	const settings = useSettings();
	const { backend, scope, generation } = useDataBackend();
	const feedback = useQuery({
		queryKey: [scope, "notification-feedback", resumeId, generation],
		enabled: !!scope,
		queryFn: async ({ signal }) => {
			const documents = await backend.read("documents", { type: "resume" }, signal);
			const ids = resumeId ? [resumeId] : documents.filter((row) => row.type === "resume").map((row) => row.id);
			const lists = await Promise.all(ids.map((id) => backend.read("feedbackLinks", { resumeId: id }, signal)));
			return Promise.all(
				lists
					.flat()
					.filter((link) => link.status === "active")
					.map((link) => backend.read("feedbackLink", { id: link.id }, signal)),
			);
		},
	});
	return {
		applications,
		offers,
		notices,
		feedback,
		data: notificationPlan({
			applications: applications.data ?? [],
			offers: offers.data ?? [],
			notices: notices.data ?? [],
			feedback: feedback.data ?? [],
			...(settings.data ? { categories: settings.data.notificationCategories } : {}),
		}),
	};
}
