import type { ApplicationLane } from "../../lanes";
import type { ApplicationClosedReason, ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { RadioGroup, RadioGroupItem } from "@reactive-resume/ui/components/radio-group";
import { getLaneLabel } from "../../lanes";
import { CLOSED_REASONS, getClosedReasonLabel } from "../../stages";

type CloseDialogProps = {
	open: boolean;
	/** Where the application stands now: closing from Offer is usually accepting it, so that's the default there. */
	status?: ApplicationStatus | undefined;
	onOpenChange: (open: boolean) => void;
	/** Active lanes; custom Closed lanes among them can be chosen. */
	lanes: readonly ApplicationLane[];
	/** A custom Closed lane, or null for the default one; the reason is absent when the lane presets it. */
	onClose: (lane: ApplicationLane | null, reason: ApplicationClosedReason | undefined) => void;
};

/** "Mark as closed": one reason, kept for Insights, and the Closed lane when there's more than one. */
export function CloseDialog({ open, status, onOpenChange, lanes, onClose }: CloseDialogProps) {
	const id = useId();
	const initialReason: ApplicationClosedReason = status === "offer" ? "accepted" : "not-selected";
	const [reason, setReason] = useState<ApplicationClosedReason>(initialReason);
	// Each opening starts from the stage's default, not from the last choice.
	const [wasOpen, setWasOpen] = useState(open);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) setReason(initialReason);
	}
	const [laneId, setLaneId] = useState("");
	const custom = lanes.filter((lane) => lane.category === "closed" && !lane.systemKey);
	const lane = custom.find((item) => item.id === laneId) ?? null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent closeLabel={t`Close`} className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>
						<Trans>Mark as closed</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>The reason is kept for Insights. Linked documents aren't touched.</Trans>
					</DialogDescription>
				</DialogHeader>
				{custom.length > 0 && (
					<div className="grid gap-1.5">
						<Label htmlFor={`${id}-lane`}>
							<Trans>Stage</Trans>
						</Label>
						<NativeSelect id={`${id}-lane`} value={laneId} onChange={(event) => setLaneId(event.target.value)}>
							<option value="">{t`Closed`}</option>
							{custom.map((item) => (
								<option key={item.id} value={item.id}>
									{item.closedReason
										? `${getLaneLabel(item)} (${getClosedReasonLabel(item.closedReason)})`
										: getLaneLabel(item)}
								</option>
							))}
						</NativeSelect>
					</div>
				)}
				{!lane?.closedReason && (
					<RadioGroup
						aria-label={t`Reason`}
						value={reason}
						onValueChange={(value) => setReason(value as ApplicationClosedReason)}
						className="grid gap-1"
					>
						{CLOSED_REASONS.map((value) => (
							<div
								key={value}
								className="flex h-10 items-center gap-2.5 rounded-lg px-2 transition-colors hover:bg-hover"
							>
								<RadioGroupItem id={`${id}-${value}`} value={value} />
								<label htmlFor={`${id}-${value}`} className="flex-1 cursor-pointer text-sm">
									{getClosedReasonLabel(value)}
								</label>
							</div>
						))}
					</RadioGroup>
				)}
				<DialogFooter>
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						onClick={() => {
							onClose(lane, lane?.closedReason ? undefined : reason);
							onOpenChange(false);
						}}
					>
						<Trans>Mark as closed</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
