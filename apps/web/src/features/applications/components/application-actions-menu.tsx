import type { ApplicationLane } from "../lanes";
import type { Application, ApplicationSummary } from "../types";
import type { ApplicationClosedReason } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { getDisplayLane, getLaneLabel, laneDotColor } from "../lanes";
import { applicationDetailQueryOptions } from "../queries";
import { CLOSED_REASONS, getClosedReasonLabel } from "../stages";
import { useApplicationActions } from "../use-application-actions";
import { useApplicationLanes } from "../use-application-lanes";
import { ApplicationFormSheet } from "./application-form-sheet";
import { InterviewDialog } from "./interview-dialog";
import { StageDot } from "@/components/calm/stage-dot";
import { getAccountGeneration } from "@/libs/auth/account-scope";

// Keep pointer and clicks from reaching the card, which would start a drag or open the detail sheet. React portals
// bubble synthetic events through the React tree, so a menu item's click would otherwise reach the card.
const stop = (event: React.SyntheticEvent) => event.stopPropagation();

type ApplicationActionsMenuProps = {
	application: ApplicationSummary;
	className?: string;
	/** Items after Schedule an interview (the workspace's Ask the coach, on phones). */
	children?: ReactNode;
};

/** A row's or card's ⋯ menu, the keyboard alternative to dragging: Move to, Mark as closed, and Move to Trash (with Undo). */
export function ApplicationActionsMenu({ application, className, children }: ApplicationActionsMenuProps) {
	const { moveTo, close, remove } = useApplicationActions();
	const { lanes, active } = useApplicationLanes();
	const current = getDisplayLane(lanes, application);
	const queryClient = useQueryClient();
	const [form, setForm] = useState<{ kind: "details" | "interview"; application: Application } | null>(null);
	const openForm = async (kind: "details" | "interview") => {
		const generation = getAccountGeneration();
		try {
			const detail = await queryClient.fetchQuery(applicationDetailQueryOptions(application.id));
			if (generation !== getAccountGeneration()) return;
			setForm({ kind, application: detail });
		} catch {
			if (generation !== getAccountGeneration()) return;
			toast.add({ type: "error", description: t`Couldn't load this application. Try again.` });
		}
	};

	return (
		<div className={cn("shrink-0", className)}>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							size="icon-xs"
							variant="ghost"
							aria-label={t`Options for ${application.role} at ${application.company}`}
							onClick={stop}
							onPointerDown={stop}
						/>
					}
				>
					<Icon name="dots-three" size={16} />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-[234px]" onClick={stop}>
					<DropdownMenuItem
						render={
							<Link to="/dashboard/applications/$applicationId/{-$tab}" params={{ applicationId: application.id }} />
						}
					>
						<Icon name="arrow-square-out" />
						<Trans>Open</Trans>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => void openForm("details")}>
						<Icon name="pencil-simple" />
						<Trans>Edit details…</Trans>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => void openForm("interview")}>
						<Icon name="calendar-plus" />
						<Trans>Schedule an interview…</Trans>
					</DropdownMenuItem>
					{children}
					<DropdownMenuSeparator />
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<Icon name="arrow-right" size={18} />
							<Trans>Move to</Trans>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent className="w-[212px]">
							{active
								.filter((lane) => lane.category !== "closed")
								.map((lane) => (
									<DropdownMenuItem
										key={lane.id}
										disabled={lane.id === current.id}
										onClick={() => moveTo(application, lane)}
									>
										<LaneDot lane={lane} />
										<span className="truncate">{getLaneLabel(lane)}</span>
									</DropdownMenuItem>
								))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>

					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<Icon name="check-circle" size={18} />
							<Trans>Mark as closed</Trans>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent className="w-[212px]">
							<ClosedLaneItems
								lanes={active}
								currentId={current.id}
								onPick={(lane, reason) =>
									lane ? moveTo(application, lane, reason) : reason && close(application, reason)
								}
							/>
						</DropdownMenuSubContent>
					</DropdownMenuSub>

					<DropdownMenuSeparator />

					<DropdownMenuItem variant="destructive" onClick={() => remove.mutate({ id: application.id })}>
						<Icon name="trash" size={18} />
						<Trans>Move to Trash</Trans>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{form?.kind === "details" && (
				<ApplicationFormSheet open application={form.application} onOpenChange={(open) => !open && setForm(null)} />
			)}
			{form?.kind === "interview" && (
				<InterviewDialog
					open
					application={form.application}
					interview={null}
					onOpenChange={(open) => !open && setForm(null)}
				/>
			)}
		</div>
	);
}

/** A lane's dot in a menu, centred in the 18px icon slot. */
export function LaneDot({ lane }: { lane: Pick<ApplicationLane, "category" | "color"> }) {
	return (
		<StageDot status={lane.category} color={laneDotColor(lane)} className="mx-[5px]">
			{null}
		</StageDot>
	);
}

type ClosedLaneItemsProps = {
	lanes: readonly ApplicationLane[];
	currentId?: string;
	/** A custom Closed lane (with its outcome), or null for the default Closed lane. */
	onPick: (lane: ApplicationLane | null, reason?: ApplicationClosedReason) => void;
};

/**
 * The ways to close: an outcome for the default Closed lane, then each custom Closed lane. A lane with a preset
 * outcome (Ghosted, say) is one item; one without lists the outcomes under its name.
 */
export function ClosedLaneItems({ lanes, currentId, onPick }: ClosedLaneItemsProps) {
	const custom = lanes.filter((lane) => lane.category === "closed" && !lane.systemKey);
	return (
		<>
			{CLOSED_REASONS.map((reason) => (
				<DropdownMenuItem key={reason} onClick={() => onPick(null, reason)}>
					{getClosedReasonLabel(reason)}
				</DropdownMenuItem>
			))}
			{custom.map((lane) =>
				lane.closedReason ? (
					<DropdownMenuItem key={lane.id} disabled={lane.id === currentId} onClick={() => onPick(lane)}>
						<LaneDot lane={lane} />
						<span className="truncate">{getLaneLabel(lane)}</span>
					</DropdownMenuItem>
				) : (
					<DropdownMenuGroup key={lane.id}>
						<DropdownMenuSeparator />
						<DropdownMenuLabel className="flex items-center gap-2">
							<LaneDot lane={lane} />
							<span className="truncate">{getLaneLabel(lane)}</span>
						</DropdownMenuLabel>
						{CLOSED_REASONS.map((reason) => (
							<DropdownMenuItem key={reason} onClick={() => onPick(lane, reason)}>
								{getClosedReasonLabel(reason)}
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				),
			)}
		</>
	);
}
