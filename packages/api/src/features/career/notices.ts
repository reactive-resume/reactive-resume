import type { CareerNotice } from "@reactive-resume/schema/career";

/**
 * The words for every career notice, in English for now. Rows keep the notice itself, so showing them in the
 * reader's language later changes this function (or moves it to the web app's catalogs), not the callers.
 */
export function noticeText(notice: CareerNotice): { title: string; body: string } {
	switch (notice.type) {
		case "opportunities":
			return {
				title: notice.count === 1 ? "1 new role to review" : `${notice.count} new roles to review`,
				body: `Found by your search for “${notice.query}”. Review them before tracking any.`,
			};
		case "briefing":
			return { title: `Your ${notice.company} briefing is ready`, body: `${notice.company} · ${notice.role}` };
		case "followup":
			return { title: `Follow up with ${notice.company}`, body: `${notice.company} · ${notice.role}` };
		case "schedule-failed":
			return {
				title: "Career schedule needs attention",
				body:
					notice.reason === "stopped"
						? "This schedule stopped several times before finishing. Review it and try again."
						: "This schedule failed. Check the selected provider and application, then review the schedule.",
			};
		case "email-failed":
			return {
				title: "Career email needs attention",
				body: "Your update is available here, but the email may not have been sent. Ask the server administrator to check email delivery.",
			};
		case "briefing-paused":
			return {
				title: "Interview briefing paused",
				body: "The interview it prepared for was removed. Choose another interview or delete the schedule.",
			};
	}
}
