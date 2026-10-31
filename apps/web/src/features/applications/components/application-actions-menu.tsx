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
import { getDisplayLane, getLaneLabel } from "../lanes";
import { CLOSED_REASONS, getClosedReasonLabel } from "../stages";
import { useApplicationActions } from "../use-application-actions";
import { useApplicationLanes } from "../use-application-lanes";
import { useConfirm } from "@/hooks/use-confirm";

// Keep pointer and clicks from reaching the card, which would start a drag or open the detail sheet. React portals
// bubble synthetic events through the React tree, so a menu item's click would otherwise reach the card.
const stop = (event: React.SyntheticEvent) => event.stopPropagation();

type ApplicationActionsMenuProps = { application: ApplicationSummary; className?: string };

/** A card's ⋯ menu, the keyboard alternative to dragging: Move to…, Mark as closed…, and Delete after asking. */
export function ApplicationActionsMenu({ application, className }: ApplicationActionsMenuProps) {
	const { moveTo, close, remove } = useApplicationActions();
	const { lanes, active } = useApplicationLanes();
	const confirm = useConfirm();
	const current = getDisplayLane(lanes, application);

	const onDelete = async () => {
		const confirmed = await confirm(t`Delete this application?`, {
			description: t`“${application.role} · ${application.company}” and its timeline are deleted permanently. This can't be undone.`,
			confirmText: t`Delete application`,
		});
		if (confirmed) remove.mutate({ id: application.id });
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
							className="text-ink-3"
						/>
					}
				>
					<Icon name="dots-three" size={18} />
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
										<span
											aria-hidden="true"
											className="size-2 shrink-0 rounded-sm"
											style={{ background: lane.color }}
										/>
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

					<DropdownMenuItem variant="destructive" onClick={onDelete}>
						<Icon name="trash" size={18} />
						<Trans>Delete…</Trans>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
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
						<span aria-hidden="true" className="size-2 shrink-0 rounded-sm" style={{ background: lane.color }} />
						<span className="truncate">{getLaneLabel(lane)}</span>
					</DropdownMenuItem>
				) : (
					<DropdownMenuGroup key={lane.id}>
						<DropdownMenuSeparator />
						<DropdownMenuLabel className="flex items-center gap-2">
							<span aria-hidden="true" className="size-2 shrink-0 rounded-sm" style={{ background: lane.color }} />
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
