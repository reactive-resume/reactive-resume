// B13's words and numbers, derived from the visitor and feedback-link hooks.
import { plural, t } from "@lingui/core/macro";
import { now } from "@/data/clock";

export type FeedbackLinkRow = {
	id: string;
	label: string;
	status: string;
	allowComments: boolean;
	openCommentCount: number;
	expiresAt: Date | string | null;
	lastViewedAt: Date | string | null;
};

const DAY = 86_400_000;

/** "3 new comments · expires in 23 days", "Read-only · not opened yet". */
export function feedbackLinkLine(link: FeedbackLinkRow, at: Date = now()): string {
	const parts = [
		link.openCommentCount
			? plural(link.openCommentCount, { one: "# new comment", other: "# new comments" })
			: link.allowComments
				? t`No new comments`
				: t`Read-only`,
	];
	if (link.expiresAt) {
		const days = Math.max(0, Math.ceil((new Date(link.expiresAt).getTime() - at.getTime()) / DAY));
		parts.push(plural(days, { one: "expires in # day", other: "expires in # days" }));
	} else if (!link.lastViewedAt) parts.push(t`not opened yet`);
	return parts.join(" · ");
}

/**
 * The storyboard draws 24 bars (heights in dp of a 64 dp chart); the fixture's daily views are flat, so the
 * storyboard capture uses the drawn shape. Gap: the fake's `dailyVisitors` lacks the storyboard's series.
 */
export const storyboardBars = [
	13, 9.5, 19, 16, 6.5, 22.5, 29, 19, 13, 16, 35, 64, 45, 25.5, 19, 13, 9.5, 22.5, 16, 29, 19, 9.5, 13, 25.5,
];
