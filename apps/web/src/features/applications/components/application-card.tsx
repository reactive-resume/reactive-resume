import type { ApplicationSummary } from "../types";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { Badge } from "@reactive-resume/ui/components/badge";
import { cn } from "@reactive-resume/utils/style";
import { describeNextStepLine, getNextStep } from "../next-step";
import { offerHintFor, useOfferHints } from "../queries";
import { ApplicationActionsMenu } from "./application-actions-menu";
import { useCareerTime, useNow } from "@/features/career/shared";

type ApplicationCardProps = {
	application: ApplicationSummary;
	/** The ⋯ menu (Move to…, Close…, Move to Trash); cards dragged in the overlay go without. */
	withMenu?: boolean;
	dragging?: boolean;
};

/**
 * A board card: the company with its place, the role, then the next step as the list writes it. The card is a link
 * to the application's page; its menu shows on hover and on focus.
 */
export function ApplicationCard({ application, withMenu = false, dragging = false }: ApplicationCardProps) {
	const { locale, timeZone } = useCareerTime();
	const now = useNow();
	const hints = useOfferHints(application.status === "offer");
	const next = describeNextStepLine(
		getNextStep(application, now, timeZone, offerHintFor(hints, application.id)),
		application,
		locale,
		timeZone,
		now,
		"short",
	);
	// "Lisbon · Hybrid" has room in the list; a card names the place only.
	const place = application.location?.split(/\s*[·,]\s*/)[0];
	const title = (
		<span dir="auto" className="min-w-0 truncate text-sm font-medium text-ink">
			{application.company}
		</span>
	);

	return (
		<div
			data-application-id={application.id}
			className={cn(
				"group/row relative flex flex-col gap-1 rounded-lg border border-line bg-raised p-3 shadow-e1 transition-[border-color,scale] duration-quick ease-enter hover:border-line-2 active:not-has-[[data-slot=button]:active]:scale-[0.98]",
				// The overlay card lifts as it's picked up and settles flat again while the drop animation flies it home.
				dragging &&
					"scale-[1.02] -rotate-2 cursor-grabbing shadow-[var(--shadow-3),0_0_0_2px_var(--accent)] transition-[rotate,scale,box-shadow] duration-quick ease-enter **:cursor-grabbing in-[.is-dropping]:scale-100 in-[.is-dropping]:rotate-0 in-[.is-dropping]:shadow-e1 starting:scale-100 starting:rotate-0 starting:shadow-e1",
			)}
		>
			<span className="flex items-baseline justify-between gap-2">
				{dragging ? (
					title
				) : (
					<Link
						to="/dashboard/applications/$applicationId/{-$tab}"
						params={{ applicationId: application.id }}
						data-application-open
						draggable={false}
						className="flex min-w-0 after:absolute after:inset-0 after:rounded-lg"
					>
						{title}
					</Link>
				)}
				{place && (
					<span dir="auto" className="shrink-0 text-[13px]/[18px] text-ink-3">
						{place}
					</span>
				)}
			</span>
			<span dir="auto" className="truncate text-[13px]/[18px] text-ink-3">
				{application.role}
			</span>
			<span className="mt-1.5 truncate text-[13px]/[18px] font-medium text-ink">{next.title}</span>
			{next.sub && <span className="truncate text-[13px]/[18px] text-ink-3">{next.sub}</span>}
			{next.needsYou && (
				<Badge variant="warn" className="mt-1 self-start">
					<Trans>Needs you</Trans>
				</Badge>
			)}
			{withMenu && (
				<ApplicationActionsMenu
					application={application}
					className="absolute end-1.5 bottom-1.5 z-10 rounded-sm bg-raised opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-[[data-popup-open]]:opacity-100 pointer-coarse:opacity-100"
				/>
			)}
		</div>
	);
}
