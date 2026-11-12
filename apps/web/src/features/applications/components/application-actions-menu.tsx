import type { ApplicationLane } from "../lanes";
import type { ApplicationSummary } from "../types";
import type { ApplicationClosedReason } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
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
import { cn } from "@reactive-resume/utils/style";
import { getDisplayLane, getLaneLabel, laneDotColor } from "../lanes";
import { CLOSED_REASONS, getClosedReasonLabel } from "../stages";
import { useApplicationActions } from "../use-application-actions";
import { useApplicationLanes } from "../use-application-lanes";
import { StageDot } from "@/components/calm/stage-dot";

// Keep pointer and clicks from reaching the card, which would start a drag or open the detail sheet. React portals
// bubble synthetic events through the React tree, so a menu item's click would otherwise reach the card.
const stop = (event: React.SyntheticEvent) => event.stopPropagation();

type ApplicationActionsMenuProps = { application: ApplicationSummary; className?: string };

/** A row's or card's ⋯ menu, the keyboard alternative to dragging: Move to…, Mark as closed…, and Move to Trash (with Undo). */
export function ApplicationActionsMenu({ application, className }: ApplicationActionsMenuProps) {
	const { moveTo, close, remove } = useApplicationActions();
	const { lanes, active } = useApplicationLanes();
	const current = getDisplayLane(lanes, application);

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
				<DropdownMenuContent align="end" className="w-48" onClick={stop}>
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<Icon name="arrow-right" size={18} />
							<Trans>Move to…</Trans>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
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
							<Icon name="check" size={18} />
							<Trans>Mark as closed…</Trans>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
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
